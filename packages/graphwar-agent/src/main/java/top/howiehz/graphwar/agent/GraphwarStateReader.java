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
    private static final int API_VERSION = 2;
    private static final int GRAPHWAR_GAME_MODE_NORMAL = 0;
    private static final int GRAPHWAR_GAME_MODE_FIRST_DERIVATIVE = 1;
    private static final int GRAPHWAR_GAME_MODE_SECOND_DERIVATIVE = 2;
    private static final int GRAPHWAR_GAME_STATE_PRE_GAME = 1;
    private static final int GRAPHWAR_GAME_STATE_GAME = 2;
    private static final String GRAPHWAR_COMPUTER_PLAYER_CLASS_NAME = "Graphwar.ComputerPlayer";
    private static final double MAX_ANGLE_RADIANS = Math.PI / 2.0;
    private final Supplier<Object> graphwarFinder;
    private final Object identityLock = new Object();
    private Object identityGameData;
    private Object identityObstacle;
    private String gameInstanceId;
    private int identityPlayerId = -1;
    private int identitySoldierIndex = -1;
    private long identityTurnStartedAt = Long.MIN_VALUE;
    private String turnToken;
    private boolean turnTokenClaimed;

    /** Locates the live official client through AWT in production. */
    GraphwarStateReader() {
        this(GraphwarStateReader::findGraphwarWindow);
    }

    /** Accepts a client locator so tests can exercise the same reflection and HTTP paths. */
    GraphwarStateReader(Supplier<Object> graphwarFinder) {
        this.graphwarFinder = graphwarFinder;
    }

    /** Reads and then serializes one immutable active-match snapshot. */
    String readStateJson() throws GraphwarStateException {
        StateSnapshot snapshot = readStateSnapshot(false);
        if (!snapshot.available) {
            return unavailableStateJson(snapshot.reason);
        }

        StringBuilder json = new StringBuilder(10_240);
        json.append('{');
        appendPlane(json);
        appendApiMetadata(json);
        appendAgent(json);
        json.append(",\"available\":true");
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
        json.append(",\"drawingFunction\":").append(snapshot.drawingFunction);
        json.append(",\"exploding\":").append(snapshot.exploding);
        json.append(",\"phase\":");
        appendJsonString(json, snapshot.phase);
        json.append(",\"terrainReversed\":").append(snapshot.terrainReversed);
        json.append(",\"gameState\":").append(snapshot.gameState);
        json.append(",\"gameMode\":").append(snapshot.gameMode);
        json.append(",\"currentTurn\":").append(snapshot.currentTurn);
        json.append(",\"currentTurnPlayerId\":").append(snapshot.currentTurnPlayerId);
        appendObstacleMaskMetadata(json, snapshot.terrainReversed, snapshot.battleRevision);
        appendPlayers(json, snapshot.players, snapshot.terrainReversed);
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
            json.append("{\"available\":true");
            json.append(",\"gameState\":").append(GRAPHWAR_GAME_STATE_PRE_GAME);
            json.append(",\"gameMode\":").append(readInt(gameData, "getGameMode", -1));
            json.append(",\"leader\":").append(readBoolean(gameData, "isLeader", false));
            json.append(",\"players\":[");

            for (int index = 0; index < players.size(); index += 1) {
                if (index > 0) {
                    json.append(',');
                }

                Object player = players.get(index);
                boolean local = readBoolean(player, "isLocalPlayer", false);
                json.append('{');
                json.append("\"index\":").append(index);
                json.append(",\"id\":").append(readInt(player, "getID", -1));
                json.append(",\"name\":");
                appendJsonString(json, readString(player, "getName", ""));
                json.append(",\"team\":").append(readInt(player, "getTeam", -1));
                json.append(",\"local\":").append(local);
                json.append(",\"computer\":");
                // Remote computer ownership is not represented by the official protocol.
                json.append(local ? Boolean.toString(isComputerPlayer(player)) : "null");
                json.append(",\"ready\":").append(readBoolean(player, "getReady", false));
                json.append(",\"numSoldiers\":").append(readInt(player, "getNumSoldiers", 0));
                json.append(",\"disconnected\":")
                        .append(readBoolean(player, "isDisconnected", false));
                json.append('}');
            }

            json.append("]}");
            return json.toString();
        }
    }

    /** Returns an immutable mask and the revision of the snapshot that produced it. */
    ObstacleMaskSnapshot readObstacleMask(String space) throws GraphwarStateException {
        StateSnapshot snapshot = readStateSnapshot(true);
        if ("world".equals(space) || !snapshot.terrainReversed) {
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

    /** Validates, claims, and submits one shot while the official state monitor is held. */
    void submitShot(GraphwarShotRequest request) throws GraphwarStateException {
        if (request.function.isEmpty()) {
            throw new GraphwarInvalidFunctionException("Graphwar function is empty");
        }
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

        Object graphwar = graphwarFinder.get();
        if (graphwar == null) {
            throw new GraphwarStateUnavailableException("Graphwar window was not found");
        }
        Object gameData = invoke(graphwar, "getGameData");
        if (gameData == null) {
            throw new GraphwarStateUnavailableException("Graphwar GameData is not initialized yet");
        }

        // Syntax does not depend on mutable match state and is cheaper to reject before locking it.
        validateFunctionSyntax(graphwar, request.function);
        synchronized (gameData) {
            if (readInt(gameData, "getGameState", -1) != GRAPHWAR_GAME_STATE_GAME) {
                throw new GraphwarStateUnavailableException("Graphwar is not in an active game");
            }

            StateSnapshot snapshot = readStateSnapshotLocked(gameData, true);
            if (!request.turnToken.equals(snapshot.turnToken)) {
                throw new GraphwarStateUnavailableException("Graphwar turn token is stale");
            }
            if (!request.battleRevision.equals(snapshot.battleRevision)) {
                throw new GraphwarStateUnavailableException("Graphwar battle revision is stale");
            }
            if (snapshot.drawingFunction || snapshot.exploding) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar is already resolving a function");
            }
            if (snapshot.remainingTurnMs <= 0) {
                throw new GraphwarStateUnavailableException("Graphwar turn has expired");
            }
            if (snapshot.currentTurn < 0 || snapshot.currentTurn >= snapshot.players.size()) {
                throw new GraphwarStateUnavailableException("Graphwar current turn is unavailable");
            }

            PlayerSnapshot currentPlayer = snapshot.players.get(snapshot.currentTurn);
            if (!currentPlayer.local) {
                throw new GraphwarStateUnavailableException("It is not this client's turn");
            }
            if (currentPlayer.computer) {
                throw new GraphwarStateUnavailableException(
                        "The current turn belongs to a local computer player");
            }
            if (currentPlayer.disconnected) {
                throw new GraphwarStateUnavailableException(
                        "The current local player is disconnected");
            }
            if (currentPlayer.currentTurnSoldierIndex < 0
                    || currentPlayer.currentTurnSoldierIndex >= currentPlayer.soldiers.size()
                    || !currentPlayer.soldiers.get(currentPlayer.currentTurnSoldierIndex).alive) {
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

    /** Sends one contiguous original-button-equivalent ready batch for all local players. */
    void submitReady(boolean ready) throws GraphwarStateException {
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

                boolean foundLocalPlayer = false;
                for (Object player : readPlayers(gameData)) {
                    if (readBoolean(player, "isLocalPlayer", false)) {
                        foundLocalPlayer = true;
                        // Repeated values are intentional: the server owns final ready state.
                        setReadyMethod.invoke(gameData, player, Boolean.valueOf(ready));
                    }
                }
                if (!foundLocalPlayer) {
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
    private StateSnapshot readStateSnapshot(boolean requireObstacle) throws GraphwarStateException {
        Object graphwar = graphwarFinder.get();
        if (graphwar == null) {
            if (requireObstacle) {
                throw new GraphwarStateUnavailableException("Graphwar window was not found");
            }
            return StateSnapshot.unavailable("graphwar-window-not-found");
        }

        Object gameData = invoke(graphwar, "getGameData");
        if (gameData == null) {
            if (requireObstacle) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar GameData is not initialized yet");
            }
            return StateSnapshot.unavailable("game-data-not-initialized");
        }

        synchronized (gameData) {
            return readStateSnapshotLocked(gameData, requireObstacle);
        }
    }

    /** Assumes the caller owns the GameData monitor and returns no live Graphwar objects. */
    private StateSnapshot readStateSnapshotLocked(Object gameData, boolean requireObstacle)
            throws GraphwarStateException {
        int gameState = readInt(gameData, "getGameState", -1);
        if (gameState != GRAPHWAR_GAME_STATE_GAME) {
            if (requireObstacle) {
                throw new GraphwarStateUnavailableException("Graphwar is not in an active game");
            }
            return StateSnapshot.unavailable("game-not-started");
        }

        Object obstacle = invoke(gameData, "getObstacle");
        if (obstacle == null) {
            if (requireObstacle) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar game has not started; obstacle is unavailable");
            }
            return StateSnapshot.unavailable("game-not-started");
        }

        int gameMode = readInt(gameData, "getGameMode", -1);
        int currentTurn = readInt(gameData, "getCurrentTurnIndex", -1);
        boolean drawingFunction = readBoolean(gameData, "isDrawingFunction", false);
        boolean exploding = readBoolean(gameData, "isExploding", false);
        boolean terrainReversed = readBoolean(gameData, "isTerrainReversed", false);
        List<PlayerSnapshot> players = readPlayerSnapshots(gameData);
        byte[] worldObstacleMask = readWorldObstacleMask(obstacle);
        String battleRevision =
                createBattleRevision(gameMode, terrainReversed, players, worldObstacleMask);

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
                battleRevision,
                Math.max(0L, readLong(gameData, "getRemainingTime", 0L)),
                drawingFunction,
                exploding,
                exploding ? "exploding" : drawingFunction ? "drawing" : "aiming",
                terrainReversed,
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
            boolean terrainReversed,
            List<PlayerSnapshot> players,
            byte[] worldObstacleMask)
            throws GraphwarStateException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            updateDigestInt(digest, 1);
            updateDigestInt(digest, gameMode);
            digest.update((byte) (terrainReversed ? 1 : 0));
            updateDigestInt(digest, players.size());
            for (PlayerSnapshot player : players) {
                updateDigestInt(digest, player.playerId);
                updateDigestInt(digest, player.team);
                digest.update((byte) (player.local ? 1 : 0));
                digest.update((byte) (player.computer ? 1 : 0));
                digest.update((byte) (player.disconnected ? 1 : 0));
                updateDigestInt(digest, player.soldiers.size());
                // Turn cursors and angles are intentionally excluded: prediction targets
                // the next soldier and /shot supplies the second-derivative angle.
                for (SoldierSnapshot soldier : player.soldiers) {
                    updateDigestInt(digest, soldier.soldierIndex);
                    digest.update((byte) (soldier.alive ? 1 : 0));
                    digest.update((byte) (soldier.exploding ? 1 : 0));
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
            boolean activeTurn,
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
                turnTokenClaimed = false;
            }

            if (activeTurn
                    && (identityTurnStartedAt != turnStartedAt
                            || identityPlayerId != playerId
                            || identitySoldierIndex != soldierIndex)) {
                identityTurnStartedAt = turnStartedAt;
                identityPlayerId = playerId;
                identitySoldierIndex = soldierIndex;
                turnToken = UUID.randomUUID().toString();
                turnTokenClaimed = false;
            }
            return new IdentitySnapshot(gameInstanceId, activeTurn ? turnToken : null);
        }
    }

    /** Consumes the current token before any network side effect can become ambiguous. */
    private void claimTurnToken(String expectedToken) throws GraphwarStateUnavailableException {
        synchronized (identityLock) {
            if (turnToken == null || !turnToken.equals(expectedToken)) {
                throw new GraphwarStateUnavailableException("Graphwar turn token is stale");
            }
            if (turnTokenClaimed) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar turn token has already been used");
            }
            turnTokenClaimed = true;
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
                            readBoolean(player, "isDisconnected", false),
                            readInt(player, "getCurrentTurnSoldierIndex", -1),
                            soldiers));
        }
        return players;
    }

    /** Copies the mutable terrain image into the stable world-space wire format. */
    private static byte[] readWorldObstacleMask(Object obstacle) throws GraphwarStateException {
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
        return mask;
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
        json.append("\"shot\":true");
        json.append(",\"room\":true");
        json.append(",\"ready\":true");
        json.append(",\"worldObstacleMask\":true}");
    }

    /** Preserves capability discovery when no active battlefield can be copied. */
    private static String unavailableStateJson(String reason) {
        StringBuilder json = new StringBuilder(384);
        json.append('{');
        appendPlane(json);
        appendApiMetadata(json);
        appendAgent(json);
        json.append(",\"available\":false,\"reason\":");
        appendJsonString(json, reason);
        json.append('}');
        return json.toString();
    }

    /** Returns a polling-friendly room response when no pre-game room is available. */
    private static String unavailableRoomJson(String reason) {
        StringBuilder json = new StringBuilder(96);
        json.append("{\"available\":false,\"reason\":");
        appendJsonString(json, reason);
        json.append('}');
        return json.toString();
    }

    /** Writes build provenance used to diagnose stale jars. */
    private static void appendAgent(StringBuilder json) {
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
            StringBuilder json, boolean terrainReversed, String battleRevision) {
        json.append(",\"obstacleMask\":{");
        json.append("\"available\":true");
        json.append(",\"width\":").append(Coordinates.PLANE_WIDTH);
        json.append(",\"height\":").append(Coordinates.PLANE_HEIGHT);
        json.append(",\"blockedValue\":1,\"emptyValue\":0");
        json.append(",\"defaultSpace\":\"view\"");
        json.append(",\"viewMirrored\":").append(terrainReversed);
        json.append(",\"revision\":");
        appendJsonString(json, battleRevision);
        json.append(",\"revisionHeader\":\"X-Graphwar-Battle-Revision\"");
        json.append(",\"viewUrl\":\"/obstacle-mask.bin?space=view\"");
        json.append(",\"worldUrl\":\"/obstacle-mask.bin?space=world\"");
        json.append('}');
    }

    /** Serializes copied players in their protocol-significant list order. */
    private static void appendPlayers(
            StringBuilder json, List<PlayerSnapshot> players, boolean terrainReversed) {
        json.append(",\"players\":[");
        for (int index = 0; index < players.size(); index += 1) {
            if (index > 0) {
                json.append(',');
            }
            appendPlayer(json, players.get(index), terrainReversed);
        }
        json.append(']');
    }

    /** Preserves legacy field names while exposing explicit ownership aliases. */
    private static void appendPlayer(
            StringBuilder json, PlayerSnapshot player, boolean terrainReversed) {
        json.append('{');
        json.append("\"index\":").append(player.playerIndex);
        json.append(",\"playerId\":").append(player.playerId);
        json.append(",\"id\":").append(player.playerId);
        json.append(",\"team\":").append(player.team);
        json.append(",\"name\":");
        appendJsonString(json, player.name);
        json.append(",\"local\":").append(player.local);
        json.append(",\"computer\":").append(player.computer);
        json.append(",\"ready\":").append(player.ready);
        json.append(",\"disconnected\":").append(player.disconnected);
        json.append(",\"currentTurnSoldier\":").append(player.currentTurnSoldierIndex);
        json.append(",\"currentTurnSoldierIndex\":").append(player.currentTurnSoldierIndex);
        json.append(",\"soldiers\":[");
        for (int index = 0; index < player.soldiers.size(); index += 1) {
            if (index > 0) {
                json.append(',');
            }
            appendSoldier(json, player.soldiers.get(index), terrainReversed);
        }
        json.append("]}");
    }

    /** Serializes one copied soldier in both world and current-view coordinates. */
    private static void appendSoldier(
            StringBuilder json, SoldierSnapshot soldier, boolean terrainReversed) {
        int viewX = Coordinates.toViewPointX(soldier.worldX, terrainReversed);
        json.append('{');
        json.append("\"index\":").append(soldier.soldierIndex);
        json.append(",\"soldierIndex\":").append(soldier.soldierIndex);
        json.append(",\"alive\":").append(soldier.alive);
        json.append(",\"exploding\":").append(soldier.exploding);
        json.append(",\"rendered\":").append(soldier.alive || soldier.exploding);
        json.append(",\"angle\":").append(soldier.angle);
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
    private static boolean readBoolean(Object target, String methodName, boolean fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof Boolean ? ((Boolean) value).booleanValue() : fallback;
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
    private static void appendJsonString(StringBuilder json, String value) {
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
        final String turnToken;

        /** Captures both identity scopes without exposing their source markers. */
        IdentitySnapshot(String gameInstanceId, String turnToken) {
            this.gameInstanceId = gameInstanceId;
            this.turnToken = turnToken;
        }
    }

    private static final class PlayerSnapshot {
        final boolean computer;
        final int currentTurnSoldierIndex;
        final boolean disconnected;
        final boolean local;
        final String name;
        final int playerId;
        final int playerIndex;
        final boolean ready;
        final List<SoldierSnapshot> soldiers;
        final int team;

        /** Owns an unmodifiable soldier copy for one protocol player. */
        PlayerSnapshot(
                int playerIndex,
                int playerId,
                int team,
                String name,
                boolean local,
                boolean computer,
                boolean ready,
                boolean disconnected,
                int currentTurnSoldierIndex,
                List<SoldierSnapshot> soldiers) {
            this.computer = computer;
            this.currentTurnSoldierIndex = currentTurnSoldierIndex;
            this.disconnected = disconnected;
            this.local = local;
            this.name = name;
            this.playerId = playerId;
            this.playerIndex = playerIndex;
            this.ready = ready;
            this.soldiers = Collections.unmodifiableList(soldiers);
            this.team = team;
        }
    }

    private static final class SoldierSnapshot {
        final boolean alive;
        final double angle;
        final boolean exploding;
        final int soldierIndex;
        final int worldX;
        final int worldY;

        /** Copies one soldier's calculation and presentation inputs. */
        SoldierSnapshot(
                int soldierIndex,
                boolean alive,
                boolean exploding,
                double angle,
                int worldX,
                int worldY) {
            this.alive = alive;
            this.angle = angle;
            this.exploding = exploding;
            this.soldierIndex = soldierIndex;
            this.worldX = worldX;
            this.worldY = worldY;
        }
    }

    private static final class StateSnapshot {
        final boolean available;
        final String battleRevision;
        final int currentTurn;
        final int currentTurnPlayerId;
        final boolean drawingFunction;
        final boolean exploding;
        final int gameMode;
        final String gameInstanceId;
        final int gameState;
        final String phase;
        final List<PlayerSnapshot> players;
        final long remainingTurnMs;
        final String reason;
        final boolean terrainReversed;
        final String turnToken;
        final byte[] worldObstacleMask;

        /** Owns all fields copied under one GameData monitor acquisition. */
        private StateSnapshot(
                boolean available,
                String reason,
                String gameInstanceId,
                String turnToken,
                String battleRevision,
                long remainingTurnMs,
                boolean drawingFunction,
                boolean exploding,
                String phase,
                boolean terrainReversed,
                int gameState,
                int gameMode,
                int currentTurn,
                int currentTurnPlayerId,
                List<PlayerSnapshot> players,
                byte[] worldObstacleMask) {
            this.available = available;
            this.battleRevision = battleRevision;
            this.currentTurn = currentTurn;
            this.currentTurnPlayerId = currentTurnPlayerId;
            this.drawingFunction = drawingFunction;
            this.exploding = exploding;
            this.gameMode = gameMode;
            this.gameInstanceId = gameInstanceId;
            this.gameState = gameState;
            this.phase = phase;
            this.players = players == null ? null : Collections.unmodifiableList(players);
            this.remainingTurnMs = remainingTurnMs;
            this.reason = reason;
            this.terrainReversed = terrainReversed;
            this.turnToken = turnToken;
            this.worldObstacleMask = worldObstacleMask;
        }

        /** Represents a polling response before the official obstacle exists. */
        static StateSnapshot unavailable(String reason) {
            return new StateSnapshot(
                    false,
                    reason,
                    null,
                    null,
                    null,
                    0L,
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
}
