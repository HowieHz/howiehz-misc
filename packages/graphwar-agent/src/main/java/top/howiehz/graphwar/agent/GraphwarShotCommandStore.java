package top.howiehz.graphwar.agent;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Owns the bounded idempotency ledger and the single official shot execution slot. */
final class GraphwarShotCommandStore {
    static final int MAX_RECORDS = 50;
    private static final long SYNCHRONOUS_WAIT_MILLISECONDS = 5_000L;
    private static final long SHOT_THREAD_STACK_BYTES = 2L * 1_024L * 1_024L;
    private final Map<String, Command> commands = new LinkedHashMap<String, Command>();
    private final ExecutorService executor =
            Executors.newSingleThreadExecutor(new ShotThreadFactory());
    private final Object lock = new Object();
    private final GraphwarStateReader stateReader;
    private Command activeCommand;
    private String currentGameInstanceId;
    private String currentTurnToken;
    private long latestObservationSequence = Long.MIN_VALUE;

    /** Uses one state reader for every guarded official-client call. */
    GraphwarShotCommandStore(GraphwarStateReader stateReader) {
        this.stateReader = stateReader;
    }

    /** Creates or safely replays one command without queueing behind a stuck official call. */
    Submission submit(GraphwarShotRequest request) throws GraphwarShotCommandException {
        byte[] fingerprint = createFingerprint(request);
        Command command;
        synchronized (lock) {
            Command existing = commands.get(request.requestId);
            if (existing != null) {
                if (!MessageDigest.isEqual(existing.fingerprint, fingerprint)) {
                    throw new GraphwarShotCommandException(
                            409,
                            "request-id-conflict",
                            "The request ID is already associated with different shot content");
                }
                return new Submission(false, !existing.isTerminal(), existing.toJson());
            }

            ensureCapacity();
            command = new Command(request, fingerprint);
            commands.put(command.requestId, command);
            if (activeCommand != null) {
                command.fail(
                        "shot-executor-busy",
                        "Another Graphwar shot command is still executing",
                        true);
                return new Submission(true, false, command.toJson());
            }
            activeCommand = command;
        }

        Future<?> future = executor.submit(() -> execute(command, request));
        try {
            future.get(SYNCHRONOUS_WAIT_MILLISECONDS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException ignored) {
            // The official call may still complete. Keep the sole execution slot occupied and
            // return the observable claimed state instead of spawning another worker.
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException error) {
            // execute() records every expected result. An unexpected task failure is still
            // captured defensively so the resource never remains validating forever.
            synchronized (lock) {
                if (!command.isTerminal()) {
                    command.unknown("internal-error", "The shot command failed unexpectedly");
                }
                if (activeCommand == command) {
                    activeCommand = null;
                }
            }
        }

        synchronized (lock) {
            return new Submission(true, !command.isTerminal(), command.toJson());
        }
    }

    /** Returns one retained command by canonical request ID. */
    String read(String requestId) throws GraphwarShotCommandException {
        synchronized (lock) {
            Command command = commands.get(requestId);
            if (command == null) {
                throw new GraphwarShotCommandException(
                        404, "shot-command-not-found", "The shot command was not found");
            }
            return command.toJson();
        }
    }

    /** Updates pinning and clears terminal records from previous game instances. */
    void observeState(long observationSequence, String gameInstanceId, String turnToken) {
        synchronized (lock) {
            if (observationSequence <= latestObservationSequence) {
                return;
            }
            latestObservationSequence = observationSequence;
            if (currentGameInstanceId != null && !currentGameInstanceId.equals(gameInstanceId)) {
                Iterator<Command> iterator = commands.values().iterator();
                while (iterator.hasNext()) {
                    Command command = iterator.next();
                    if (command != activeCommand && command.isTerminal()) {
                        iterator.remove();
                    }
                }
            }
            currentGameInstanceId = gameInstanceId;
            currentTurnToken = turnToken;
        }
    }

    /** Writes the current turn's recoverable command summary or JSON null. */
    void appendCurrentSummary(StringBuilder json, String gameInstanceId, String turnToken) {
        synchronized (lock) {
            Command matched = null;
            for (Command command : commands.values()) {
                if (command.gameInstanceId.equals(gameInstanceId)
                        && command.turnToken.equals(turnToken)
                        && !"failed".equals(command.status)) {
                    matched = command;
                }
            }
            if (matched == null) {
                json.append("null");
                return;
            }
            json.append('{');
            json.append("\"requestId\":");
            GraphwarStateReader.appendJsonString(json, matched.requestId);
            json.append(",\"status\":");
            GraphwarStateReader.appendJsonString(json, matched.status);
            json.append('}');
        }
    }

    /** Reports dynamic capacity separately from static protocol capabilities. */
    boolean canAcceptShotCommands() {
        synchronized (lock) {
            return activeCommand == null;
        }
    }

    /** Interrupts the sole shot worker during Agent shutdown. */
    void stop() {
        executor.shutdownNow();
    }

    /** Transitions one command around the irreversible turn-token claim boundary. */
    private void execute(Command command, GraphwarShotRequest request) {
        try {
            stateReader.submitShot(
                    request,
                    () -> {
                        synchronized (lock) {
                            command.claim();
                        }
                    });
            synchronized (lock) {
                command.submit();
            }
        } catch (GraphwarStateException error) {
            synchronized (lock) {
                if ("claimed".equals(command.status)) {
                    command.unknown("graphwar-call-failed", error.getMessage());
                } else {
                    ShotFailure failure = classifyFailure(error);
                    command.fail(
                            failure.code, error.getMessage(), failure.canRetryWithNewRequestId);
                }
            }
        } catch (Throwable error) {
            // Future.get is no longer observing this task after the five-second POST boundary.
            // Record every late unchecked failure here so no command can remain pending forever.
            synchronized (lock) {
                if ("claimed".equals(command.status)) {
                    command.unknown("internal-error", "The shot command failed unexpectedly");
                } else {
                    command.fail(
                            "internal-error",
                            "The shot command failed before claiming the turn",
                            true);
                }
            }
        } finally {
            synchronized (lock) {
                if (activeCommand == command) {
                    activeCommand = null;
                }
            }
        }
    }

    /** Evicts oldest safe terminal records until one new record fits. */
    private void ensureCapacity() throws GraphwarShotCommandException {
        while (commands.size() >= MAX_RECORDS) {
            Command candidate = null;
            for (Command command : commands.values()) {
                if (command != activeCommand && command.isTerminal() && !isPinned(command)) {
                    candidate = command;
                    break;
                }
            }
            if (candidate == null) {
                throw new GraphwarShotCommandException(
                        503,
                        "command-capacity-exhausted",
                        "The shot command record capacity is exhausted");
            }
            commands.remove(candidate.requestId);
        }
    }

    /** Protects the current turn's non-failed recovery record from eviction. */
    private boolean isPinned(Command command) {
        return currentGameInstanceId != null
                && currentGameInstanceId.equals(command.gameInstanceId)
                && currentTurnToken != null
                && currentTurnToken.equals(command.turnToken)
                && !"failed".equals(command.status);
    }

    /** Maps known pre-claim validation failures to stable public error codes. */
    private static ShotFailure classifyFailure(GraphwarStateException error) {
        String message = error.getMessage();
        if (error instanceof GraphwarInvalidFunctionException) {
            if ("Graphwar function is empty".equals(message)) {
                return new ShotFailure("function-empty", true);
            }
            if ("Graphwar function exceeds the byte limit".equals(message)) {
                return new ShotFailure("function-too-large", true);
            }
            if ("Graphwar function exceeds the nesting depth limit".equals(message)) {
                return new ShotFailure("function-nesting-too-deep", true);
            }
            return new ShotFailure("malformed-function", true);
        }
        if (error instanceof GraphwarInvalidShotException) {
            if ("angleRadians is required in second-derivative mode".equals(message)) {
                return new ShotFailure("angle-required", true);
            }
            if ("angleRadians is not allowed in this game mode".equals(message)) {
                return new ShotFailure("angle-not-allowed", true);
            }
            if ("angleRadians must be finite and between -pi/2 and pi/2".equals(message)) {
                return new ShotFailure("angle-out-of-range", true);
            }
            return new ShotFailure("invalid-shot-request", true);
        }
        if ("Graphwar turn token is stale".equals(message)) {
            return new ShotFailure("turn-token-stale", false);
        }
        if ("Graphwar turn token has already been used".equals(message)) {
            return new ShotFailure("turn-token-used", false);
        }
        if ("Graphwar battle revision is stale".equals(message)) {
            return new ShotFailure("battle-revision-stale", false);
        }
        if ("Graphwar game instance is stale".equals(message)) {
            return new ShotFailure("game-instance-stale", false);
        }
        if ("Graphwar turn has expired".equals(message)) {
            return new ShotFailure("turn-expired", false);
        }
        if ("Graphwar is already resolving a function".equals(message)) {
            return new ShotFailure("shot-already-resolving", false);
        }
        return new ShotFailure("graphwar-state-unavailable", true);
    }

    /** Hashes the complete semantic request without retaining its function text. */
    private static byte[] createFingerprint(GraphwarShotRequest request)
            throws GraphwarShotCommandException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            updateDigest(digest, request.gameInstanceId);
            updateDigest(digest, request.function);
            updateDigest(digest, request.turnToken);
            updateDigest(digest, request.battleRevision);
            if (request.angleRadians == null) {
                digest.update((byte) 0);
            } else {
                digest.update((byte) 1);
                digest.update(
                        ByteBuffer.allocate(8)
                                .putLong(
                                        Double.doubleToLongBits(request.angleRadians.doubleValue()))
                                .array());
            }
            return digest.digest();
        } catch (NoSuchAlgorithmException error) {
            throw new GraphwarShotCommandException(500, "internal-error", "SHA-256 is unavailable");
        }
    }

    /** Adds one length-prefixed UTF-8 value to the semantic fingerprint. */
    private static void updateDigest(MessageDigest digest, String value) {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        digest.update(ByteBuffer.allocate(4).putInt(bytes.length).array());
        digest.update(bytes);
    }

    static final class Submission {
        final boolean isCreated;
        final boolean isPending;
        final String json;

        /** Carries HTTP creation and retry metadata with the serialized resource. */
        Submission(boolean isCreated, boolean isPending, String json) {
            this.isCreated = isCreated;
            this.isPending = isPending;
            this.json = json;
        }
    }

    private static final class Command {
        final String battleRevision;
        final long createdAtEpochMs;
        final byte[] fingerprint;
        final String gameInstanceId;
        final String requestId;
        final String turnToken;
        Boolean canRetryWithNewRequestId;
        String errorCode;
        String errorMessage;
        String status = "validating";
        long updatedAtEpochMs;

        /** Copies bounded request identity and its semantic fingerprint. */
        Command(GraphwarShotRequest request, byte[] fingerprint) {
            this.battleRevision = request.battleRevision;
            this.createdAtEpochMs = System.currentTimeMillis();
            this.fingerprint = fingerprint;
            this.gameInstanceId = request.gameInstanceId;
            this.requestId = request.requestId;
            this.turnToken = request.turnToken;
            this.updatedAtEpochMs = createdAtEpochMs;
        }

        /** Records the irreversible turn-token claim. */
        void claim() {
            updateStatus("claimed");
        }

        /** Records a normal return from the original client call. */
        void submit() {
            updateStatus("submitted");
        }

        /** Records a proven pre-claim failure and whether a fresh state may permit retry. */
        void fail(String code, String message, boolean canRetryWithNewRequestId) {
            errorCode = code;
            errorMessage = message;
            this.canRetryWithNewRequestId = Boolean.valueOf(canRetryWithNewRequestId);
            updateStatus("failed");
        }

        /** Records a result whose original-client side effect cannot be proven. */
        void unknown(String code, String message) {
            errorCode = code;
            errorMessage = message;
            canRetryWithNewRequestId = null;
            updateStatus("unknown");
        }

        /** Reports whether no further public transition is expected. */
        boolean isTerminal() {
            return "submitted".equals(status)
                    || "failed".equals(status)
                    || "unknown".equals(status);
        }

        /** Serializes only bounded public fields, never function or fingerprint data. */
        String toJson() {
            StringBuilder json = new StringBuilder(512);
            json.append('{');
            json.append("\"requestId\":");
            GraphwarStateReader.appendJsonString(json, requestId);
            json.append(",\"gameInstanceId\":");
            GraphwarStateReader.appendJsonString(json, gameInstanceId);
            json.append(",\"turnToken\":");
            GraphwarStateReader.appendJsonString(json, turnToken);
            json.append(",\"battleRevision\":");
            GraphwarStateReader.appendJsonString(json, battleRevision);
            json.append(",\"status\":");
            GraphwarStateReader.appendJsonString(json, status);
            json.append(",\"createdAtEpochMs\":").append(createdAtEpochMs);
            json.append(",\"updatedAtEpochMs\":").append(updatedAtEpochMs);
            if (errorCode != null) {
                json.append(",\"error\":{\"code\":");
                GraphwarStateReader.appendJsonString(json, errorCode);
                json.append(",\"message\":");
                GraphwarStateReader.appendJsonString(
                        json, errorMessage == null ? "" : errorMessage);
                if (canRetryWithNewRequestId != null) {
                    json.append(",\"canRetryWithNewRequestId\":")
                            .append(canRetryWithNewRequestId.booleanValue());
                }
                json.append('}');
            }
            json.append("}\n");
            return json.toString();
        }

        /** Applies one timestamped state transition. */
        private void updateStatus(String nextStatus) {
            status = nextStatus;
            updatedAtEpochMs = System.currentTimeMillis();
        }
    }

    private static final class ShotFailure {
        final boolean canRetryWithNewRequestId;
        final String code;

        /** Couples one stable code with its safe retry metadata. */
        ShotFailure(String code, boolean canRetryWithNewRequestId) {
            this.canRetryWithNewRequestId = canRetryWithNewRequestId;
            this.code = code;
        }
    }

    private static final class ShotThreadFactory implements ThreadFactory {
        /** Creates the sole daemon worker with explicit parser stack headroom. */
        @Override
        public Thread newThread(Runnable runnable) {
            // The official parser recursively rebuilds its expression tree. Give the single
            // bounded shot worker explicit stack headroom; configured formula limits remain
            // the primary guard because the JVM treats this size as a platform hint.
            Thread thread =
                    new Thread(null, runnable, "graphwar-agent-shot", SHOT_THREAD_STACK_BYTES);
            thread.setDaemon(true);
            return thread;
        }
    }
}
