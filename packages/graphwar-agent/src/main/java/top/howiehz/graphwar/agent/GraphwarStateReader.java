package top.howiehz.graphwar.agent;

import java.awt.Window;
import java.awt.image.BufferedImage;
import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

final class GraphwarStateReader {
    // Source: official GraphServer.Constants game-state and game-mode values.
    private static final int API_VERSION = 3;
    private static final int GRAPHWAR_GAME_MODE_NORMAL = 0;
    private static final int GRAPHWAR_GAME_MODE_FIRST_DERIVATIVE = 1;
    private static final int GRAPHWAR_GAME_MODE_SECOND_DERIVATIVE = 2;
    private static final int GRAPHWAR_GAME_STATE_PRE_GAME = 1;
    private static final int GRAPHWAR_GAME_STATE_GAME = 2;
    private static final String GRAPHWAR_COMPUTER_PLAYER_CLASS_NAME = "Graphwar.ComputerPlayer";
    private static final double MAX_ANGLE_RADIANS = Math.PI / 2.0;
    private final String agentInstanceId = UUID.randomUUID().toString();
    private final Supplier<Object> graphwarFinder;
    private final GraphwarFunctionLimits functionLimits;
    private final Object identityLock = new Object();
    // Serializes GameData replacement with identity publication; old snapshots must never retire a
    // newer game.
    private final Object snapshotLock = new Object();
    private byte[] cachedWorldObstacleMask;
    private int cachedWorldObstacleMaskExplosionRadius = Integer.MIN_VALUE;
    private int cachedWorldObstacleMaskExplosionX = Integer.MIN_VALUE;
    private int cachedWorldObstacleMaskExplosionY = Integer.MIN_VALUE;
    private Object cachedWorldObstacleMaskSource;
    private Object identityGameData;
    private Object identityObstacle;
    private String gameInstanceId;
    private int identityPlayerId = -1;
    private int identitySoldierIndex = -1;
    private long identityTurnStartedAt = Long.MIN_VALUE;
    private long identityObservationSequence;
    private String turnToken;
    private boolean isTurnTokenClaimed;
    private GraphwarShotCommandStore shotCommands;

    /** Locates the live official client through AWT in production. */
    GraphwarStateReader() {
        this(GraphwarAgentConfig.parse(null), GraphwarStateReader::findGraphwarWindow);
    }

    /** Uses one startup configuration for formula validation and production window lookup. */
    GraphwarStateReader(GraphwarAgentConfig config) {
        this(config, GraphwarStateReader::findGraphwarWindow);
    }

    /** Accepts a client locator so tests can exercise the same reflection and HTTP paths. */
    GraphwarStateReader(Supplier<Object> graphwarFinder) {
        this(GraphwarAgentConfig.parse(null), graphwarFinder);
    }

    /** Accepts both limits and a client locator for complete contract tests. */
    GraphwarStateReader(GraphwarAgentConfig config, Supplier<Object> graphwarFinder) {
        this.functionLimits =
                new GraphwarFunctionLimits(config.maxFunctionBytes, config.maxFunctionTokens);
        this.graphwarFinder = graphwarFinder;
    }

    /** Connects the command ledger after construction without creating an ownership cycle. */
    void setShotCommands(GraphwarShotCommandStore shotCommands) {
        this.shotCommands = shotCommands;
    }

    /** Reads and then serializes one immutable active-match snapshot. */
    String readStateJson() throws GraphwarStateException {
        StateSnapshot snapshot = readStateSnapshot(false);
        if (!snapshot.isAvailable) {
            return unavailableStateJson(
                    snapshot.reason,
                    agentInstanceId,
                    snapshot.observationSequence,
                    snapshot.observedAtEpochMs);
        }

        StringBuilder json = new StringBuilder(10_240);
        json.append('{');
        appendPlane(json);
        appendApiMetadata(json);
        appendAgent(json);
        json.append(",\"agentInstanceId\":");
        appendJsonString(json, agentInstanceId);
        json.append(",\"observationSequence\":").append(snapshot.observationSequence);
        json.append(",\"observedAtEpochMs\":").append(snapshot.observedAtEpochMs);
        json.append(",\"isAvailable\":true");
        json.append(",\"gameInstanceId\":");
        appendJsonString(json, snapshot.gameInstanceId);
        json.append(",\"turnToken\":");
        if (snapshot.turnToken == null) {
            json.append("null");
        } else {
            appendJsonString(json, snapshot.turnToken);
        }
        json.append(",\"battleRevision\":");
        appendJsonString(json, snapshot.battleRevision);
        json.append(",\"remainingTurnMs\":").append(snapshot.remainingTurnMs);
        json.append(",\"phase\":");
        appendJsonString(json, snapshot.phase);
        json.append(",\"functionDraw\":");
        if (snapshot.functionDraw == null) {
            json.append("null");
        } else {
            json.append("{\"currentStep\":")
                    .append(snapshot.functionDraw.currentStep)
                    .append(",\"stepsPerSecond\":")
                    .append(snapshot.functionDraw.stepsPerSecond)
                    .append('}');
        }
        json.append(",\"isTerrainReversed\":").append(snapshot.isTerrainReversed);
        json.append(",\"equationMode\":");
        appendJsonString(json, equationMode(snapshot.gameMode));
        json.append(",\"currentPlayerIndex\":");
        appendNullableInteger(json, snapshot.currentTurn);
        json.append(",\"currentPlayerId\":");
        appendNullableInteger(json, snapshot.currentTurnPlayerId);
        json.append(",\"canAcceptShotCommands\":")
                .append(shotCommands == null || shotCommands.canAcceptShotCommands());
        json.append(",\"shotCommand\":");
        if (shotCommands == null) {
            json.append("null");
        } else {
            shotCommands.observeState(
                    snapshot.observationSequence, snapshot.gameInstanceId, snapshot.turnToken);
            if (snapshot.turnToken == null) {
                json.append("null");
            } else {
                shotCommands.appendCurrentSummary(
                        json, snapshot.gameInstanceId, snapshot.turnToken);
            }
        }
        appendObstacleMaskMetadata(json, snapshot.isTerrainReversed, snapshot.battleRevision);
        appendPlayers(json, snapshot.players, snapshot.isTerrainReversed);
        json.append('}');
        return json.toString();
    }

    /** Reads one consistent snapshot of the current pre-game room. */
    String readRoomJson() throws GraphwarStateException {
        Object graphwar = graphwarFinder.get();
        if (graphwar == null) {
            return unavailableRoomJson("graphwar-window-not-found");
        }

        Object gameData = invoke(graphwar, "getGameData");
        if (gameData == null) {
            return unavailableRoomJson("game-data-not-initialized");
        }

        // GameData.handleMessage uses this monitor while applying server messages.
        synchronized (gameData) {
            if (readInt(gameData, "getGameState", -1) != GRAPHWAR_GAME_STATE_PRE_GAME) {
                return unavailableRoomJson("not-in-pre-game-room");
            }

            List<?> players = readPlayers(gameData);
            StringBuilder json = new StringBuilder(1024);
            json.append("{\"isAvailable\":true");
            json.append(",\"equationMode\":");
            appendJsonString(json, equationMode(readInt(gameData, "getGameMode", -1)));
            json.append(",\"isLeader\":").append(readBoolean(gameData, "isLeader", false));
            json.append(",\"players\":[");

            for (int index = 0; index < players.size(); index += 1) {
                if (index > 0) {
                    json.append(',');
                }

                Object player = players.get(index);
                boolean isLocal = readBoolean(player, "isLocalPlayer", false);
                json.append('{');
                json.append("\"playerIndex\":").append(index);
                json.append(",\"playerId\":").append(readInt(player, "getID", -1));
                json.append(",\"name\":");
                appendJsonString(json, readString(player, "getName", ""));
                json.append(",\"team\":").append(readInt(player, "getTeam", -1));
                json.append(",\"isLocal\":").append(isLocal);
                json.append(",\"isComputerControlled\":");
                // Remote computer ownership is not represented by the official protocol.
                json.append(isLocal ? Boolean.toString(isComputerPlayer(player)) : "null");
                json.append(",\"isReady\":").append(readBoolean(player, "getReady", false));
                json.append(",\"numSoldiers\":").append(readInt(player, "getNumSoldiers", 0));
                json.append(",\"isConnected\":")
                        .append(!readBoolean(player, "isDisconnected", false));
                json.append('}');
            }

            json.append("]}");
            return json.toString();
        }
    }

    /** Returns an immutable mask and the revision of the snapshot that produced it. */
    ObstacleMaskSnapshot readObstacleMask(String space) throws GraphwarStateException {
        StateSnapshot snapshot = readStateSnapshot(true);
        if ("world".equals(space) || !snapshot.isTerrainReversed) {
            return new ObstacleMaskSnapshot(snapshot.worldObstacleMask, snapshot.battleRevision);
        }

        byte[] viewMask = new byte[snapshot.worldObstacleMask.length];
        for (int y = 0; y < Coordinates.PLANE_HEIGHT; y += 1) {
            int rowOffset = y * Coordinates.PLANE_WIDTH;
            for (int x = 0; x < Coordinates.PLANE_WIDTH; x += 1) {
                viewMask[rowOffset + x] =
                        snapshot.worldObstacleMask[rowOffset + Coordinates.toWorldMaskX(x, true)];
            }
        }
        return new ObstacleMaskSnapshot(viewMask, snapshot.battleRevision);
    }

    /** Validates, claims, and submits one shot while reporting the irreversible claim point. */
    void submitShot(GraphwarShotRequest request, Runnable onClaimed) throws GraphwarStateException {
        if (request.function.isEmpty()) {
            throw new GraphwarInvalidFunctionException("Graphwar function is empty");
        }
        functionLimits.validate(request.function);
        if (request.turnToken.isEmpty() || request.battleRevision.isEmpty()) {
            throw new GraphwarInvalidShotException(
                    "turnToken and battleRevision must not be empty");
        }
        if (request.angleRadians != null
                && (request.angleRadians.isNaN()
                        || request.angleRadians.isInfinite()
                        || request.angleRadians.doubleValue() < -MAX_ANGLE_RADIANS
                        || request.angleRadians.doubleValue() > MAX_ANGLE_RADIANS)) {
            throw new GraphwarInvalidShotException(
                    "angleRadians must be finite and between -pi/2 and pi/2");
        }

        Object graphwarForValidation = graphwarFinder.get();
        if (graphwarForValidation == null) {
            throw new GraphwarStateUnavailableException("Graphwar window was not found");
        }

        // Syntax does not depend on mutable match state and is cheaper to reject before locking it.
        validateFunctionSyntax(graphwarForValidation, request.function);
        synchronized (snapshotLock) {
            Object graphwar = graphwarFinder.get();
            if (graphwar == null) {
                throw new GraphwarStateUnavailableException("Graphwar window was not found");
            }
            Object gameData = invoke(graphwar, "getGameData");
            if (gameData == null) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar GameData is not initialized yet");
            }
            synchronized (gameData) {
                if (readInt(gameData, "getGameState", -1) != GRAPHWAR_GAME_STATE_GAME) {
                    throw new GraphwarStateUnavailableException(
                            "Graphwar is not in an active game");
                }

                StateSnapshot snapshot = readStateSnapshotLocked(gameData, true);
                if (!request.gameInstanceId.equals(snapshot.gameInstanceId)) {
                    throw new GraphwarStateUnavailableException("Graphwar game instance is stale");
                }
                if (!request.turnToken.equals(snapshot.turnToken)) {
                    throw new GraphwarStateUnavailableException("Graphwar turn token is stale");
                }
                if (!request.battleRevision.equals(snapshot.battleRevision)) {
                    throw new GraphwarStateUnavailableException(
                            "Graphwar battle revision is stale");
                }
                if (snapshot.isDrawingFunction || snapshot.isExploding) {
                    throw new GraphwarStateUnavailableException(
                            "Graphwar is already resolving a function");
                }
                if (snapshot.remainingTurnMs <= 0) {
                    throw new GraphwarStateUnavailableException("Graphwar turn has expired");
                }
                if (snapshot.currentTurn < 0 || snapshot.currentTurn >= snapshot.players.size()) {
                    throw new GraphwarStateUnavailableException(
                            "Graphwar current turn is unavailable");
                }

                PlayerSnapshot currentPlayer = snapshot.players.get(snapshot.currentTurn);
                if (!currentPlayer.isLocal) {
                    throw new GraphwarStateUnavailableException("It is not this client's turn");
                }
                if (currentPlayer.isComputerControlled) {
                    throw new GraphwarStateUnavailableException(
                            "The current turn belongs to a local computer player");
                }
                if (!currentPlayer.isConnected) {
                    throw new GraphwarStateUnavailableException(
                            "The current local player is disconnected");
                }
                if (currentPlayer.currentTurnSoldierIndex < 0
                        || currentPlayer.currentTurnSoldierIndex >= currentPlayer.soldiers.size()
                        || !currentPlayer.soldiers.get(currentPlayer.currentTurnSoldierIndex)
                                .isAlive) {
                    throw new GraphwarStateUnavailableException(
                            "Graphwar current soldier is unavailable");
                }

                if (snapshot.gameMode == GRAPHWAR_GAME_MODE_SECOND_DERIVATIVE) {
                    if (request.angleRadians == null) {
                        throw new GraphwarInvalidShotException(
                                "angleRadians is required in second-derivative mode");
                    }
                } else {
                    if (snapshot.gameMode != GRAPHWAR_GAME_MODE_NORMAL
                            && snapshot.gameMode != GRAPHWAR_GAME_MODE_FIRST_DERIVATIVE) {
                        throw new GraphwarStateUnavailableException(
                                "Graphwar game mode is unsupported");
                    }
                    if (request.angleRadians != null) {
                        throw new GraphwarInvalidShotException(
                                "angleRadians is not allowed in this game mode");
                    }
                }
                claimTurnToken(request.turnToken);
                onClaimed.run();
                if (request.angleRadians != null) {
                    invoke(
                            gameData,
                            "setAngle",
                            Double.TYPE,
                            Double.valueOf(request.angleRadians.doubleValue()));
                }
                // The local monitor prevents a Graphwar message from changing turns between
                // validation, angle mutation, and queuing the original two wire messages.
                invoke(gameData, "sendFunction", String.class, request.function);
            }
        }
    }

    /** Sends one contiguous original-button-equivalent ready batch for all local players. */
    void submitReady(boolean isReady) throws GraphwarStateException {
        Object graphwar = graphwarFinder.get();
        if (graphwar == null) {
            throw new GraphwarStateUnavailableException("Graphwar window was not found");
        }
        Object gameData = invoke(graphwar, "getGameData");
        if (gameData == null) {
            throw new GraphwarStateUnavailableException("Graphwar GameData is not initialized yet");
        }

        try {
            Method setReadyMethod =
                    gameData.getClass()
                            .getMethod(
                                    "setReady",
                                    Class.forName(
                                            "Graphwar.Player",
                                            false,
                                            graphwar.getClass().getClassLoader()),
                                    Boolean.TYPE);
            synchronized (gameData) {
                if (readInt(gameData, "getGameState", -1) != GRAPHWAR_GAME_STATE_PRE_GAME) {
                    throw new GraphwarStateUnavailableException(
                            "Graphwar is not in a pre-game room");
                }

                boolean hasLocalPlayer = false;
                for (Object player : readPlayers(gameData)) {
                    if (readBoolean(player, "isLocalPlayer", false)) {
                        hasLocalPlayer = true;
                        if (readBoolean(player, "getReady", false) != isReady) {
                            setReadyMethod.invoke(gameData, player, Boolean.valueOf(isReady));
                        }
                    }
                }
                if (!hasLocalPlayer) {
                    throw new GraphwarStateUnavailableException(
                            "Graphwar has no local players to update");
                }
            }
        } catch (ClassNotFoundException | IllegalAccessException | NoSuchMethodException error) {
            throw new GraphwarStateException("Cannot call Graphwar method setReady", error);
        } catch (InvocationTargetException error) {
            throw new GraphwarStateException("Graphwar method setReady failed", error.getCause());
        }
    }

    /** Copies every mutable field needed by callers while GameData.handleMessage is excluded. */
    private StateSnapshot readStateSnapshot(boolean shouldRequireObstacle)
            throws GraphwarStateException {
        synchronized (snapshotLock) {
            Object graphwar = graphwarFinder.get();
            if (graphwar == null) {
                if (shouldRequireObstacle) {
                    throw new GraphwarStateUnavailableException("Graphwar window was not found");
                }
                return StateSnapshot.unavailable(
                        "graphwar-window-not-found", nextObservationSequence());
            }

            Object gameData = invoke(graphwar, "getGameData");
            if (gameData == null) {
                if (shouldRequireObstacle) {
                    throw new GraphwarStateUnavailableException(
                            "Graphwar GameData is not initialized yet");
                }
                return StateSnapshot.unavailable(
                        "game-data-not-initialized", nextObservationSequence());
            }

            synchronized (gameData) {
                return readStateSnapshotLocked(gameData, shouldRequireObstacle);
            }
        }
    }

    /** Assumes snapshotLock then the GameData monitor and returns no live Graphwar objects. */
    private StateSnapshot readStateSnapshotLocked(Object gameData, boolean shouldRequireObstacle)
            throws GraphwarStateException {
        int gameState = readInt(gameData, "getGameState", -1);
        if (gameState != GRAPHWAR_GAME_STATE_GAME) {
            if (shouldRequireObstacle) {
                throw new GraphwarStateUnavailableException("Graphwar is not in an active game");
            }
            return StateSnapshot.unavailable("game-not-started", nextObservationSequence());
        }

        Object obstacle = invoke(gameData, "getObstacle");
        if (obstacle == null) {
            if (shouldRequireObstacle) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar game has not started; obstacle is unavailable");
            }
            return StateSnapshot.unavailable("game-not-started", nextObservationSequence());
        }

        int gameMode = readInt(gameData, "getGameMode", -1);
        int currentTurn = readInt(gameData, "getCurrentTurnIndex", -1);
        boolean isDrawingFunction = readBoolean(gameData, "isDrawingFunction", false);
        boolean isExploding = readBoolean(gameData, "isExploding", false);
        boolean isTerrainReversed = readBoolean(gameData, "isTerrainReversed", false);
        long observedAtEpochMs;
        FunctionDrawSnapshot functionDraw = null;
        if (isDrawingFunction && !isExploding) {
            int stepsPerSecond;
            try {
                Class<?> constantsClass =
                        Class.forName(
                                "GraphServer.Constants",
                                false,
                                gameData.getClass().getClassLoader());
                stepsPerSecond = constantsClass.getField("FUNCTION_VELOCITY").getInt(null);
            } catch (ClassNotFoundException
                    | IllegalAccessException
                    | NoSuchFieldException
                    | RuntimeException error) {
                throw new GraphwarStateException(
                        "Cannot read Graphwar static field GraphServer.Constants.FUNCTION_VELOCITY",
                        error);
            }
            if (stepsPerSecond <= 0) {
                throw new GraphwarStateException("Graphwar FUNCTION_VELOCITY is not positive");
            }
            // Anchor response-age correction immediately beside the official time-derived cursor;
            // first-use class loading above must not make clients advance the trajectory twice.
            observedAtEpochMs = System.currentTimeMillis();
            int currentStep = readInt(gameData, "getCurrentFunctionPosition", -1);
            if (currentStep < 0) {
                throw new GraphwarStateException("Graphwar function draw cursor is negative");
            }
            functionDraw = new FunctionDrawSnapshot(currentStep, stepsPerSecond);
        } else {
            observedAtEpochMs = System.currentTimeMillis();
        }
        // The official cursor getter performs the drawing-to-explosion transition at the exact
        // final step, so phase and cursor must be sampled again before copying the battlefield.
        isExploding = readBoolean(gameData, "isExploding", false);
        if (isExploding) {
            functionDraw = null;
        }
        long remainingTurnMs = Math.max(0L, readLong(gameData, "getRemainingTime", 0L));
        List<PlayerSnapshot> players = readPlayerSnapshots(gameData);
        byte[] worldObstacleMask = readWorldObstacleMask(obstacle);
        String battleRevision =
                createBattleRevision(gameMode, isTerrainReversed, players, worldObstacleMask);

        int currentTurnPlayerId = -1;
        int currentTurnSoldierIndex = -1;
        if (currentTurn >= 0 && currentTurn < players.size()) {
            PlayerSnapshot currentPlayer = players.get(currentTurn);
            currentTurnPlayerId = currentPlayer.playerId;
            currentTurnSoldierIndex = currentPlayer.currentTurnSoldierIndex;
        }

        IdentitySnapshot identity =
                resolveIdentity(
                        gameData,
                        obstacle,
                        currentTurnPlayerId >= 0,
                        currentTurnPlayerId >= 0
                                ? readLongField(gameData, "timeTurnStarted")
                                : Long.MIN_VALUE,
                        currentTurnPlayerId,
                        currentTurnSoldierIndex);

        return new StateSnapshot(
                true,
                null,
                identity.gameInstanceId,
                identity.turnToken,
                identity.observationSequence,
                battleRevision,
                observedAtEpochMs,
                remainingTurnMs,
                functionDraw,
                isDrawingFunction,
                isExploding,
                isExploding ? "exploding" : isDrawingFunction ? "drawing" : "aiming",
                isTerrainReversed,
                gameState,
                gameMode,
                currentTurn,
                currentTurnPlayerId,
                players,
                worldObstacleMask);
    }

    /** Finds the official JFrame on demand so a closed window is never retained. */
    private static Object findGraphwarWindow() {
        // The agent runs inside the official client JVM, so the JFrame is already live in AWT.
        for (Window window : Window.getWindows()) {
            if ("Graphwar.Graphwar".equals(window.getClass().getName())) {
                return window;
            }
        }
        return null;
    }

    /** Computes one revision from inputs that affect automatic path calculation. */
    private static String createBattleRevision(
            int gameMode,
            boolean isTerrainReversed,
            List<PlayerSnapshot> players,
            byte[] worldObstacleMask)
            throws GraphwarStateException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            updateDigestInt(digest, 1);
            updateDigestInt(digest, gameMode);
            digest.update((byte) (isTerrainReversed ? 1 : 0));
            updateDigestInt(digest, players.size());
            for (PlayerSnapshot player : players) {
                updateDigestInt(digest, player.playerId);
                updateDigestInt(digest, player.team);
                digest.update((byte) (player.isLocal ? 1 : 0));
                digest.update((byte) (player.isComputerControlled ? 1 : 0));
                digest.update((byte) (player.isConnected ? 1 : 0));
                updateDigestInt(digest, player.soldiers.size());
                // Turn cursors and angles are intentionally excluded: prediction targets
                // the next soldier and /shots supplies the second-derivative angle.
                for (SoldierSnapshot soldier : player.soldiers) {
                    updateDigestInt(digest, soldier.soldierIndex);
                    digest.update((byte) (soldier.isAlive ? 1 : 0));
                    digest.update((byte) (soldier.isExploding ? 1 : 0));
                    updateDigestInt(digest, soldier.worldX);
                    updateDigestInt(digest, soldier.worldY);
                }
            }
            digest.update(worldObstacleMask);
            StringBuilder revision = new StringBuilder(71);
            revision.append("sha256:");
            for (byte value : digest.digest()) {
                int unsigned = value & 0xff;
                if (unsigned < 0x10) {
                    revision.append('0');
                }
                revision.append(Integer.toHexString(unsigned));
            }
            return revision.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new GraphwarStateException("SHA-256 is unavailable", error);
        }
    }

    /** Issues opaque IDs from the battlefield object and exact official turn marker. */
    private IdentitySnapshot resolveIdentity(
            Object gameData,
            Object obstacle,
            boolean isActiveTurn,
            long turnStartedAt,
            int playerId,
            int soldierIndex) {
        synchronized (identityLock) {
            if (identityGameData != gameData || identityObstacle != obstacle) {
                identityGameData = gameData;
                identityObstacle = obstacle;
                gameInstanceId = UUID.randomUUID().toString();
                identityTurnStartedAt = Long.MIN_VALUE;
                identityPlayerId = -1;
                identitySoldierIndex = -1;
                turnToken = null;
                isTurnTokenClaimed = false;
            }

            if (isActiveTurn
                    && (identityTurnStartedAt != turnStartedAt
                            || identityPlayerId != playerId
                            || identitySoldierIndex != soldierIndex)) {
                identityTurnStartedAt = turnStartedAt;
                identityPlayerId = playerId;
                identitySoldierIndex = soldierIndex;
                turnToken = UUID.randomUUID().toString();
                isTurnTokenClaimed = false;
            }
            return new IdentitySnapshot(
                    gameInstanceId, isActiveTurn ? turnToken : null, nextObservationSequence());
        }
    }

    /** Orders every available and unavailable state snapshot formed by this Agent process. */
    private long nextObservationSequence() {
        synchronized (identityLock) {
            identityObservationSequence += 1L;
            return identityObservationSequence;
        }
    }

    /** Consumes the current token before any network side effect can become ambiguous. */
    private void claimTurnToken(String expectedToken) throws GraphwarStateUnavailableException {
        synchronized (identityLock) {
            if (turnToken == null || !turnToken.equals(expectedToken)) {
                throw new GraphwarStateUnavailableException("Graphwar turn token is stale");
            }
            if (isTurnTokenClaimed) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar turn token has already been used");
            }
            isTurnTokenClaimed = true;
        }
    }

    /** Copies ownership and soldier fields without retaining the official live objects. */
    private static List<PlayerSnapshot> readPlayerSnapshots(Object gameData)
            throws GraphwarStateException {
        List<?> livePlayers = readPlayers(gameData);
        List<PlayerSnapshot> players = new ArrayList<PlayerSnapshot>(livePlayers.size());
        for (int playerIndex = 0; playerIndex < livePlayers.size(); playerIndex += 1) {
            Object player = livePlayers.get(playerIndex);
            int numSoldiers = readInt(player, "getNumSoldiers", 0);
            Object liveSoldiers = invoke(player, "getSoldiers");
            if (liveSoldiers == null || !liveSoldiers.getClass().isArray()) {
                throw new GraphwarStateException("Graphwar soldiers array is unavailable");
            }

            int soldierCount = Math.min(numSoldiers, Array.getLength(liveSoldiers));
            List<SoldierSnapshot> soldiers = new ArrayList<SoldierSnapshot>(soldierCount);
            for (int soldierIndex = 0; soldierIndex < soldierCount; soldierIndex += 1) {
                Object soldier = Array.get(liveSoldiers, soldierIndex);
                soldiers.add(
                        new SoldierSnapshot(
                                soldierIndex,
                                readBoolean(soldier, "isAlive", false),
                                readBoolean(soldier, "isExploding", false),
                                readDouble(soldier, "getAngle", 0.0),
                                readInt(soldier, "getX", 0),
                                readInt(soldier, "getY", 0)));
            }

            players.add(
                    new PlayerSnapshot(
                            playerIndex,
                            readInt(player, "getID", -1),
                            readInt(player, "getTeam", -1),
                            readString(player, "getName", ""),
                            readBoolean(player, "isLocalPlayer", false),
                            isComputerPlayer(player),
                            readBoolean(player, "getReady", false),
                            !readBoolean(player, "isDisconnected", false),
                            readInt(player, "getCurrentTurnSoldierIndex", -1),
                            soldiers));
        }
        return players;
    }

    /**
     * Copies terrain only after the official explosion signature says its pixels may have changed.
     */
    private byte[] readWorldObstacleMask(Object obstacle) throws GraphwarStateException {
        int explosionX = readInt(obstacle, "getExplosionX", 0);
        int explosionY = readInt(obstacle, "getExplosionY", 0);
        int explosionRadius = readInt(obstacle, "getExplosionRadius", 0);
        synchronized (identityLock) {
            if (cachedWorldObstacleMask != null
                    && cachedWorldObstacleMaskSource == obstacle
                    && cachedWorldObstacleMaskExplosionX == explosionX
                    && cachedWorldObstacleMaskExplosionY == explosionY
                    && cachedWorldObstacleMaskExplosionRadius == explosionRadius) {
                return cachedWorldObstacleMask;
            }

            Object image = invoke(obstacle, "getImage");
            if (!(image instanceof BufferedImage)) {
                throw new GraphwarStateException(
                        image == null
                                ? "Graphwar obstacle image is unavailable"
                                : "Graphwar obstacle image is not a BufferedImage");
            }
            BufferedImage terrain = (BufferedImage) image;
            byte[] mask = new byte[Coordinates.PLANE_WIDTH * Coordinates.PLANE_HEIGHT];
            // Source: Obstacle.collidePoint treats terrain.getRGB(x, y) != -1 as blocked.
            for (int y = 0; y < Coordinates.PLANE_HEIGHT; y += 1) {
                int rowOffset = y * Coordinates.PLANE_WIDTH;
                for (int x = 0; x < Coordinates.PLANE_WIDTH; x += 1) {
                    mask[rowOffset + x] = terrain.getRGB(x, y) != -1 ? (byte) 1 : (byte) 0;
                }
            }
            cachedWorldObstacleMaskSource = obstacle;
            cachedWorldObstacleMaskExplosionX = explosionX;
            cachedWorldObstacleMaskExplosionY = explosionY;
            cachedWorldObstacleMaskExplosionRadius = explosionRadius;
            cachedWorldObstacleMask = mask;
            return mask;
        }
    }

    /** Validates the official player collection before any indexed access. */
    private static List<?> readPlayers(Object gameData) throws GraphwarStateException {
        Object players = invoke(gameData, "getPlayers");
        if (players instanceof List<?>) {
            return (List<?>) players;
        }
        throw new GraphwarStateException("Graphwar players list is unavailable");
    }

    /** Uses the authoritative local runtime subtype instead of guessing from player data. */
    private static boolean isComputerPlayer(Object player) {
        return GRAPHWAR_COMPUTER_PLAYER_CLASS_NAME.equals(player.getClass().getName());
    }

    /** Runs the official parser without submitting or mutating the current turn. */
    private static void validateFunctionSyntax(Object graphwar, String function)
            throws GraphwarStateException {
        try {
            Class<?> functionClass =
                    Class.forName("Graphwar.Function", false, graphwar.getClass().getClassLoader());
            Constructor<?> constructor = functionClass.getDeclaredConstructor(String.class);
            constructor.setAccessible(true);
            constructor.newInstance(function);
        } catch (ClassNotFoundException
                | InstantiationException
                | IllegalAccessException
                | NoSuchMethodException error) {
            throw new GraphwarStateException("Cannot validate Graphwar function syntax", error);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause != null && "Graphwar.MalformedFunction".equals(cause.getClass().getName())) {
                throw new GraphwarInvalidFunctionException("Malformed Graphwar function");
            }
            throw new GraphwarStateException("Graphwar function validation failed", cause);
        }
    }

    /** Writes geometry metadata shared by available and unavailable state responses. */
    private static void appendPlane(StringBuilder json) {
        json.append("\"plane\":{");
        json.append("\"width\":").append(Coordinates.PLANE_WIDTH);
        json.append(",\"height\":").append(Coordinates.PLANE_HEIGHT);
        json.append(",\"gameLength\":").append(Coordinates.PLANE_GAME_LENGTH);
        json.append('}');
    }

    /** Advertises independently testable API features instead of relying on version order. */
    private static void appendApiMetadata(StringBuilder json) {
        json.append(",\"apiVersion\":").append(API_VERSION);
        json.append(",\"capabilities\":{");
        json.append("\"canSubmitShots\":true");
        json.append(",\"canReadRoom\":true");
        json.append(",\"canSetReady\":true");
        json.append(",\"canReadWorldObstacleMask\":true}");
    }

    /** Preserves capability discovery when no active battlefield can be copied. */
    private static String unavailableStateJson(
            String reason,
            String agentInstanceId,
            long observationSequence,
            long observedAtEpochMs) {
        StringBuilder json = new StringBuilder(384);
        json.append('{');
        appendPlane(json);
        appendApiMetadata(json);
        appendAgent(json);
        json.append(",\"agentInstanceId\":");
        appendJsonString(json, agentInstanceId);
        json.append(",\"observationSequence\":").append(observationSequence);
        json.append(",\"observedAtEpochMs\":").append(observedAtEpochMs);
        json.append(",\"isAvailable\":false,\"reason\":");
        appendJsonString(json, reason);
        json.append('}');
        return json.toString();
    }

    /** Returns a polling-friendly room response when no pre-game room is available. */
    private static String unavailableRoomJson(String reason) {
        StringBuilder json = new StringBuilder(96);
        json.append("{\"isAvailable\":false,\"reason\":");
        appendJsonString(json, reason);
        json.append('}');
        return json.toString();
    }

    /** Writes build provenance used to diagnose stale jars. */
    static void appendAgent(StringBuilder json) {
        json.append(",\"agent\":{");
        json.append("\"version\":");
        appendJsonString(json, GraphwarAgentBuildInfo.VERSION);
        json.append(",\"sourceCommit\":");
        appendJsonString(json, GraphwarAgentBuildInfo.SOURCE_COMMIT);
        json.append(",\"sourceCommitShort\":");
        appendJsonString(json, GraphwarAgentBuildInfo.SOURCE_COMMIT_SHORT);
        json.append(",\"sourceCommitTime\":");
        appendJsonString(json, GraphwarAgentBuildInfo.SOURCE_COMMIT_TIME);
        json.append('}');
    }

    /** Describes the mask response and the header required for snapshot verification. */
    private static void appendObstacleMaskMetadata(
            StringBuilder json, boolean isTerrainReversed, String battleRevision) {
        json.append(",\"obstacleMask\":{");
        json.append("\"width\":").append(Coordinates.PLANE_WIDTH);
        json.append(",\"height\":").append(Coordinates.PLANE_HEIGHT);
        json.append(",\"blockedValue\":1,\"emptyValue\":0");
        json.append(",\"isViewMirrored\":").append(isTerrainReversed);
        json.append(",\"revision\":");
        appendJsonString(json, battleRevision);
        json.append(",\"viewUrl\":\"/obstacle-masks/view.bin\"");
        json.append(",\"worldUrl\":\"/obstacle-masks/world.bin\"");
        json.append('}');
    }

    /** Serializes copied players in their protocol-significant list order. */
    private static void appendPlayers(
            StringBuilder json, List<PlayerSnapshot> players, boolean isTerrainReversed) {
        json.append(",\"players\":[");
        for (int index = 0; index < players.size(); index += 1) {
            if (index > 0) {
                json.append(',');
            }
            appendPlayer(json, players.get(index), isTerrainReversed);
        }
        json.append(']');
    }

    /** Serializes one player with explicit protocol ID and array-index names. */
    private static void appendPlayer(
            StringBuilder json, PlayerSnapshot player, boolean isTerrainReversed) {
        json.append('{');
        json.append("\"playerIndex\":").append(player.playerIndex);
        json.append(",\"playerId\":").append(player.playerId);
        json.append(",\"team\":").append(player.team);
        json.append(",\"name\":");
        appendJsonString(json, player.name);
        json.append(",\"isLocal\":").append(player.isLocal);
        json.append(",\"isComputerControlled\":").append(player.isComputerControlled);
        json.append(",\"isReady\":").append(player.isReady);
        json.append(",\"isConnected\":").append(player.isConnected);
        json.append(",\"currentSoldierIndex\":");
        appendNullableInteger(json, player.currentTurnSoldierIndex);
        json.append(",\"soldiers\":[");
        for (int index = 0; index < player.soldiers.size(); index += 1) {
            if (index > 0) {
                json.append(',');
            }
            appendSoldier(json, player.soldiers.get(index), isTerrainReversed);
        }
        json.append("]}");
    }

    /** Serializes one copied soldier in both world and current-view coordinates. */
    private static void appendSoldier(
            StringBuilder json, SoldierSnapshot soldier, boolean isTerrainReversed) {
        int viewX = Coordinates.toViewPointX(soldier.worldX, isTerrainReversed);
        json.append('{');
        json.append("\"soldierIndex\":").append(soldier.soldierIndex);
        json.append(",\"isAlive\":").append(soldier.isAlive);
        json.append(",\"isRendered\":").append(soldier.isAlive || soldier.isExploding);
        json.append(",\"angleRadians\":").append(soldier.angle);
        json.append(",\"world\":");
        appendPoint(json, soldier.worldX, soldier.worldY);
        json.append(",\"view\":");
        appendPoint(json, viewX, soldier.worldY);
        json.append('}');
    }

    /** Keeps adjacent pixel and mathematical coordinates derived from one point. */
    private static void appendPoint(StringBuilder json, int pixelX, int pixelY) {
        json.append('{');
        json.append("\"pixel\":{\"x\":")
                .append(pixelX)
                .append(",\"y\":")
                .append(pixelY)
                .append('}');
        json.append(",\"game\":{\"x\":").append(Coordinates.toGameX(pixelX));
        json.append(",\"y\":").append(Coordinates.toGameY(pixelY)).append("}}");
    }

    /** Centralizes reflected no-argument calls and unwraps official exceptions. */
    private static Object invoke(Object target, String methodName) throws GraphwarStateException {
        try {
            Method method = target.getClass().getMethod(methodName);
            return method.invoke(target);
        } catch (IllegalAccessException | NoSuchMethodException error) {
            throw new GraphwarStateException("Cannot read Graphwar method " + methodName, error);
        } catch (InvocationTargetException error) {
            throw new GraphwarStateException(
                    "Graphwar method " + methodName + " failed", error.getCause());
        }
    }

    /** Centralizes reflected one-argument calls used for official side effects. */
    private static Object invoke(
            Object target, String methodName, Class<?> parameterType, Object argument)
            throws GraphwarStateException {
        try {
            Method method = target.getClass().getMethod(methodName, parameterType);
            return method.invoke(target, argument);
        } catch (IllegalAccessException | NoSuchMethodException error) {
            throw new GraphwarStateException("Cannot call Graphwar method " + methodName, error);
        } catch (InvocationTargetException error) {
            throw new GraphwarStateException(
                    "Graphwar method " + methodName + " failed", error.getCause());
        }
    }

    /** Iteratively locates the private turn marker across compatible GameData subclasses. */
    private static long readLongField(Object target, String fieldName)
            throws GraphwarStateException {
        Class<?> type = target.getClass();
        while (type != null) {
            try {
                Field field = type.getDeclaredField(fieldName);
                field.setAccessible(true);
                return field.getLong(target);
            } catch (NoSuchFieldException error) {
                type = type.getSuperclass();
            } catch (IllegalAccessException | RuntimeException error) {
                throw new GraphwarStateException("Cannot read Graphwar field " + fieldName, error);
            }
        }
        throw new GraphwarStateException("Cannot read Graphwar field " + fieldName);
    }

    /** Reads a reflected boolean while keeping unexpected return types deterministic. */
    private static boolean readBoolean(Object target, String methodName, boolean isFallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof Boolean ? ((Boolean) value).booleanValue() : isFallback;
    }

    /** Reads a reflected floating-point number with a deterministic type fallback. */
    private static double readDouble(Object target, String methodName, double fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof Number ? ((Number) value).doubleValue() : fallback;
    }

    /** Reads a reflected integer with a deterministic type fallback. */
    private static int readInt(Object target, String methodName, int fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof Number ? ((Number) value).intValue() : fallback;
    }

    /** Reads a reflected long with a deterministic type fallback. */
    private static long readLong(Object target, String methodName, long fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof Number ? ((Number) value).longValue() : fallback;
    }

    /** Reads a reflected string with a deterministic type fallback. */
    private static String readString(Object target, String methodName, String fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof String ? (String) value : fallback;
    }

    /** Escapes arbitrary official names and opaque values as one JSON string. */
    static void appendJsonString(StringBuilder json, String value) {
        json.append('"');
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            switch (character) {
                case '"':
                    json.append("\\\"");
                    break;
                case '\\':
                    json.append("\\\\");
                    break;
                case '\b':
                    json.append("\\b");
                    break;
                case '\f':
                    json.append("\\f");
                    break;
                case '\n':
                    json.append("\\n");
                    break;
                case '\r':
                    json.append("\\r");
                    break;
                case '\t':
                    json.append("\\t");
                    break;
                default:
                    if (character < 0x20) {
                        String hex = Integer.toHexString(character);
                        json.append("\\u");
                        for (int pad = hex.length(); pad < 4; pad += 1) {
                            json.append('0');
                        }
                        json.append(hex);
                    } else {
                        json.append(character);
                    }
                    break;
            }
        }
        json.append('"');
    }

    /** Maps official numeric modes to the stable public equation enum. */
    private static String equationMode(int gameMode) throws GraphwarStateException {
        switch (gameMode) {
            case GRAPHWAR_GAME_MODE_NORMAL:
                return "y";
            case GRAPHWAR_GAME_MODE_FIRST_DERIVATIVE:
                return "dy";
            case GRAPHWAR_GAME_MODE_SECOND_DERIVATIVE:
                return "ddy";
            default:
                throw new GraphwarStateException("Graphwar game mode is unsupported");
        }
    }

    /** Uses JSON null instead of negative integer sentinels for missing indexes and IDs. */
    private static void appendNullableInteger(StringBuilder json, int value) {
        if (value < 0) {
            json.append("null");
        } else {
            json.append(value);
        }
    }

    /** Adds fixed-endian integers so revisions are stable across JVM architectures. */
    private static void updateDigestInt(MessageDigest digest, int value) {
        digest.update((byte) (value >>> 24));
        digest.update((byte) (value >>> 16));
        digest.update((byte) (value >>> 8));
        digest.update((byte) value);
    }

    /** Binary body and its matching world-state revision. */
    static final class ObstacleMaskSnapshot {
        final String battleRevision;
        final byte[] bytes;

        /** Couples bytes and revision from the same locked snapshot. */
        ObstacleMaskSnapshot(byte[] bytes, String battleRevision) {
            this.battleRevision = battleRevision;
            this.bytes = bytes;
        }
    }

    private static final class IdentitySnapshot {
        final String gameInstanceId;
        final long observationSequence;
        final String turnToken;

        /** Captures both identity scopes without exposing their source markers. */
        IdentitySnapshot(String gameInstanceId, String turnToken, long observationSequence) {
            this.gameInstanceId = gameInstanceId;
            this.observationSequence = observationSequence;
            this.turnToken = turnToken;
        }
    }

    private static final class PlayerSnapshot {
        final boolean isComputerControlled;
        final int currentTurnSoldierIndex;
        final boolean isConnected;
        final boolean isLocal;
        final String name;
        final int playerId;
        final int playerIndex;
        final boolean isReady;
        final List<SoldierSnapshot> soldiers;
        final int team;

        /** Owns an unmodifiable soldier copy for one protocol player. */
        PlayerSnapshot(
                int playerIndex,
                int playerId,
                int team,
                String name,
                boolean isLocal,
                boolean isComputerControlled,
                boolean isReady,
                boolean isConnected,
                int currentTurnSoldierIndex,
                List<SoldierSnapshot> soldiers) {
            this.isComputerControlled = isComputerControlled;
            this.currentTurnSoldierIndex = currentTurnSoldierIndex;
            this.isConnected = isConnected;
            this.isLocal = isLocal;
            this.name = name;
            this.playerId = playerId;
            this.playerIndex = playerIndex;
            this.isReady = isReady;
            this.soldiers = Collections.unmodifiableList(soldiers);
            this.team = team;
        }
    }

    private static final class SoldierSnapshot {
        final boolean isAlive;
        final double angle;
        final boolean isExploding;
        final int soldierIndex;
        final int worldX;
        final int worldY;

        /** Copies one soldier's calculation and presentation inputs. */
        SoldierSnapshot(
                int soldierIndex,
                boolean isAlive,
                boolean isExploding,
                double angle,
                int worldX,
                int worldY) {
            this.isAlive = isAlive;
            this.angle = angle;
            this.isExploding = isExploding;
            this.soldierIndex = soldierIndex;
            this.worldX = worldX;
            this.worldY = worldY;
        }
    }

    private static final class StateSnapshot {
        final boolean isAvailable;
        final String battleRevision;
        final int currentTurn;
        final int currentTurnPlayerId;
        final boolean isDrawingFunction;
        final boolean isExploding;
        final int gameMode;
        final String gameInstanceId;
        final int gameState;
        final FunctionDrawSnapshot functionDraw;
        final String phase;
        final List<PlayerSnapshot> players;
        final long observedAtEpochMs;
        final long observationSequence;
        final long remainingTurnMs;
        final String reason;
        final boolean isTerrainReversed;
        final String turnToken;
        final byte[] worldObstacleMask;

        /** Owns all fields copied under one GameData monitor acquisition. */
        private StateSnapshot(
                boolean isAvailable,
                String reason,
                String gameInstanceId,
                String turnToken,
                long observationSequence,
                String battleRevision,
                long observedAtEpochMs,
                long remainingTurnMs,
                FunctionDrawSnapshot functionDraw,
                boolean isDrawingFunction,
                boolean isExploding,
                String phase,
                boolean isTerrainReversed,
                int gameState,
                int gameMode,
                int currentTurn,
                int currentTurnPlayerId,
                List<PlayerSnapshot> players,
                byte[] worldObstacleMask) {
            this.isAvailable = isAvailable;
            this.battleRevision = battleRevision;
            this.currentTurn = currentTurn;
            this.currentTurnPlayerId = currentTurnPlayerId;
            this.isDrawingFunction = isDrawingFunction;
            this.isExploding = isExploding;
            this.gameMode = gameMode;
            this.gameInstanceId = gameInstanceId;
            this.gameState = gameState;
            this.functionDraw = functionDraw;
            this.phase = phase;
            this.players = players == null ? null : Collections.unmodifiableList(players);
            this.observedAtEpochMs = observedAtEpochMs;
            this.observationSequence = observationSequence;
            this.remainingTurnMs = remainingTurnMs;
            this.reason = reason;
            this.isTerrainReversed = isTerrainReversed;
            this.turnToken = turnToken;
            this.worldObstacleMask = worldObstacleMask;
        }

        /** Represents a polling response before the official obstacle exists. */
        static StateSnapshot unavailable(String reason, long observationSequence) {
            return new StateSnapshot(
                    false,
                    reason,
                    null,
                    null,
                    observationSequence,
                    null,
                    System.currentTimeMillis(),
                    0L,
                    null,
                    false,
                    false,
                    "inactive",
                    false,
                    -1,
                    -1,
                    -1,
                    -1,
                    null,
                    null);
        }
    }

    private static final class FunctionDrawSnapshot {
        final int currentStep;
        final int stepsPerSecond;

        /** Stores the authoritative draw cursor and its official advancement rate. */
        FunctionDrawSnapshot(int currentStep, int stepsPerSecond) {
            this.currentStep = currentStep;
            this.stepsPerSecond = stepsPerSecond;
        }
    }
}
