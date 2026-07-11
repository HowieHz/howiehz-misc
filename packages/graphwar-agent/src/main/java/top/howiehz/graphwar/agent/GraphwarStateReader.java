package top.howiehz.graphwar.agent;

import java.awt.Image;
import java.awt.Window;
import java.awt.image.BufferedImage;
import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

final class GraphwarStateReader {
    // Source: official GraphServer.Constants game-state values.
    private static final int GRAPHWAR_GAME_STATE_PRE_GAME = 1;
    private static final int GRAPHWAR_GAME_STATE_GAME = 2;
    private static final String GRAPHWAR_COMPUTER_PLAYER_CLASS_NAME = "Graphwar.ComputerPlayer";
    private final Supplier<Object> graphwarFinder;

    /** Locates the live official client through AWT in production. */
    GraphwarStateReader() {
        this(GraphwarStateReader::findGraphwarWindow);
    }

    /** Accepts a client locator so tests can exercise the same reflection and HTTP paths. */
    GraphwarStateReader(Supplier<Object> graphwarFinder) {
        this.graphwarFinder = graphwarFinder;
    }

    /** Reads the active match through reflection so the build remains JDK-only. */
    String readStateJson() throws GraphwarStateException {
        RuntimeState runtime = readRuntimeState(false);
        if (!runtime.available) {
            return unavailableStateJson(runtime.reason);
        }

        StringBuilder json = new StringBuilder(8192);
        json.append('{');
        appendPlane(json);
        appendAgent(json);
        json.append(",\"available\":true");
        json.append(",\"terrainReversed\":").append(runtime.terrainReversed);
        json.append(",\"gameState\":").append(runtime.gameState);
        json.append(",\"gameMode\":").append(runtime.gameMode);
        json.append(",\"currentTurn\":").append(runtime.currentTurn);
        appendObstacleMaskMetadata(json, runtime.terrainReversed);
        appendPlayers(json, runtime.players, runtime.terrainReversed);
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

        // GameData.handleMessage synchronizes on this object while applying server
        // messages. Encode the small room snapshot under the same lock so one response
        // cannot mix player fields from different messages.
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
                // The wire protocol does not identify remote computer players. Only a
                // local runtime subtype is authoritative; remote player type is unknown.
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

    /** Reads blocking pixels in the requested world or current-view orientation. */
    byte[] readObstacleMask(String space) throws GraphwarStateException {
        RuntimeState runtime = readRuntimeState(true);
        boolean viewSpace = !"world".equals(space);
        BufferedImage terrain = runtime.terrain;
        byte[] mask = new byte[Coordinates.PLANE_WIDTH * Coordinates.PLANE_HEIGHT];

        // Source: Obstacle.collidePoint treats terrain.getRGB(x, y) != -1 as blocked.
        for (int y = 0; y < Coordinates.PLANE_HEIGHT; y += 1) {
            int rowOffset = y * Coordinates.PLANE_WIDTH;
            for (int x = 0; x < Coordinates.PLANE_WIDTH; x += 1) {
                int worldX = viewSpace ? Coordinates.toWorldMaskX(x, runtime.terrainReversed) : x;
                mask[rowOffset + x] = terrain.getRGB(worldX, y) != -1 ? (byte) 1 : (byte) 0;
            }
        }

        return mask;
    }

    /** Validates and submits a function through the original active-turn path. */
    void submitFunction(String function) throws GraphwarStateException {
        if (function == null || function.isEmpty()) {
            throw new GraphwarInvalidFunctionException("Graphwar function is empty");
        }

        Object graphwar = graphwarFinder.get();
        if (graphwar == null) {
            throw new GraphwarStateUnavailableException("Graphwar window was not found");
        }

        Object gameData = invoke(graphwar, "getGameData");
        if (gameData == null) {
            throw new GraphwarStateUnavailableException("Graphwar GameData is not initialized yet");
        }

        // Source: GraphServer.Constants.GAME == 2 in the official Graphwar source.
        if (readInt(gameData, "getGameState", -1) != GRAPHWAR_GAME_STATE_GAME) {
            throw new GraphwarStateUnavailableException("Graphwar is not in an active game");
        }

        int currentTurn = readInt(gameData, "getCurrentTurnIndex", -1);
        List<?> players = readPlayers(gameData);
        if (currentTurn < 0 || currentTurn >= players.size()) {
            throw new GraphwarStateUnavailableException("Graphwar current turn is unavailable");
        }

        Object currentPlayer = players.get(currentTurn);
        if (!readBoolean(currentPlayer, "isLocalPlayer", false)) {
            throw new GraphwarStateUnavailableException("It is not this client's turn");
        }
        // Source: GameScreen.actionPerformed does not fire for ComputerPlayer turns.
        if (isComputerPlayer(currentPlayer)) {
            throw new GraphwarStateUnavailableException(
                    "The current turn belongs to a local computer player");
        }
        if (readBoolean(gameData, "isDrawingFunction", false)) {
            throw new GraphwarStateUnavailableException("Graphwar is already drawing a function");
        }

        validateFunctionSyntax(graphwar, function);
        // Source: GameScreen submits the text field through GameData.sendFunction(String).
        invoke(gameData, "sendFunction", String.class, function);
    }

    /** Serializes one original-button-equivalent ready update for every local player. */
    synchronized void submitReady(boolean ready) throws GraphwarStateException {
        Object graphwar = graphwarFinder.get();
        if (graphwar == null) {
            throw new GraphwarStateUnavailableException("Graphwar window was not found");
        }

        Object gameData = invoke(graphwar, "getGameData");
        if (gameData == null) {
            throw new GraphwarStateUnavailableException("Graphwar GameData is not initialized yet");
        }

        List<Object> localPlayers = new ArrayList<Object>();
        synchronized (gameData) {
            if (readInt(gameData, "getGameState", -1) != GRAPHWAR_GAME_STATE_PRE_GAME) {
                throw new GraphwarStateUnavailableException("Graphwar is not in a pre-game room");
            }

            for (Object player : readPlayers(gameData)) {
                if (readBoolean(player, "isLocalPlayer", false)) {
                    localPlayers.add(player);
                }
            }
        }

        if (localPlayers.isEmpty()) {
            throw new GraphwarStateUnavailableException("Graphwar has no local players to update");
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
            // Do not suppress repeated values. The original UI sends one SET_READY for
            // every local player, and the server remains the authority for final state.
            for (Object player : localPlayers) {
                setReadyMethod.invoke(gameData, player, Boolean.valueOf(ready));
            }
        } catch (ClassNotFoundException | IllegalAccessException | NoSuchMethodException error) {
            throw new GraphwarStateException("Cannot call Graphwar method setReady", error);
        } catch (InvocationTargetException error) {
            throw new GraphwarStateException("Graphwar method setReady failed", error.getCause());
        }
    }

    private RuntimeState readRuntimeState(boolean requireObstacle) throws GraphwarStateException {
        // Source: Graphwar.Graphwar extends JFrame and exposes public getGameData().
        Object graphwar = graphwarFinder.get();
        if (graphwar == null) {
            if (requireObstacle) {
                throw new GraphwarStateUnavailableException("Graphwar window was not found");
            }
            return RuntimeState.unavailable("graphwar-window-not-found");
        }

        Object gameData = invoke(graphwar, "getGameData");
        if (gameData == null) {
            if (requireObstacle) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar GameData is not initialized yet");
            }
            return RuntimeState.unavailable("game-data-not-initialized");
        }

        Object obstacle = invoke(gameData, "getObstacle");
        if (obstacle == null) {
            // getObstacle() becomes available only after a game has started.
            if (requireObstacle) {
                throw new GraphwarStateUnavailableException(
                        "Graphwar game has not started; obstacle is unavailable");
            }
            return RuntimeState.unavailable("game-not-started");
        }

        BufferedImage terrain = readTerrain(obstacle);
        RuntimeState runtime = new RuntimeState();
        runtime.available = true;
        runtime.currentTurn = readInt(gameData, "getCurrentTurnIndex", -1);
        runtime.gameMode = readInt(gameData, "getGameMode", -1);
        runtime.gameState = readInt(gameData, "getGameState", -1);
        runtime.players = readPlayers(gameData);
        runtime.terrain = terrain;
        runtime.terrainReversed = readBoolean(gameData, "isTerrainReversed", false);
        return runtime;
    }

    private static Object findGraphwarWindow() {
        // The agent runs inside the official client JVM, so the JFrame is already live in AWT.
        Window[] windows = Window.getWindows();
        for (Window window : windows) {
            if ("Graphwar.Graphwar".equals(window.getClass().getName())) {
                return window;
            }
        }
        return null;
    }

    private static BufferedImage readTerrain(Object obstacle) throws GraphwarStateException {
        Object image = invoke(obstacle, "getImage");
        // Source: Obstacle.getImage() returns the mutable terrain image used by rendering.
        if (image instanceof BufferedImage) {
            return (BufferedImage) image;
        }
        if (image instanceof Image) {
            throw new GraphwarStateException("Graphwar obstacle image is not a BufferedImage");
        }
        throw new GraphwarStateException("Graphwar obstacle image is unavailable");
    }

    private static List<?> readPlayers(Object gameData) throws GraphwarStateException {
        Object players = invoke(gameData, "getPlayers");
        if (players instanceof List<?>) {
            return (List<?>) players;
        }
        throw new GraphwarStateException("Graphwar players list is unavailable");
    }

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

    private static void appendPlane(StringBuilder json) {
        json.append("\"plane\":{");
        json.append("\"width\":").append(Coordinates.PLANE_WIDTH);
        json.append(",\"height\":").append(Coordinates.PLANE_HEIGHT);
        json.append(",\"gameLength\":").append(Coordinates.PLANE_GAME_LENGTH);
        json.append('}');
    }

    private static String unavailableStateJson(String reason) {
        StringBuilder json = new StringBuilder(256);
        json.append('{');
        appendPlane(json);
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

    private static void appendObstacleMaskMetadata(StringBuilder json, boolean terrainReversed) {
        json.append(",\"obstacleMask\":{");
        json.append("\"available\":true");
        json.append(",\"width\":").append(Coordinates.PLANE_WIDTH);
        json.append(",\"height\":").append(Coordinates.PLANE_HEIGHT);
        json.append(",\"blockedValue\":1,\"emptyValue\":0");
        json.append(",\"defaultSpace\":\"view\"");
        json.append(",\"viewMirrored\":").append(terrainReversed);
        json.append(",\"viewUrl\":\"/obstacle-mask.bin?space=view\"");
        json.append(",\"worldUrl\":\"/obstacle-mask.bin?space=world\"");
        json.append('}');
    }

    private static void appendPlayers(StringBuilder json, List<?> players, boolean terrainReversed)
            throws GraphwarStateException {
        json.append(",\"players\":[");
        for (int index = 0; index < players.size(); index += 1) {
            if (index > 0) {
                json.append(',');
            }
            appendPlayer(json, players.get(index), index, terrainReversed);
        }
        json.append(']');
    }

    private static void appendPlayer(
            StringBuilder json, Object player, int playerIndex, boolean terrainReversed)
            throws GraphwarStateException {
        int numSoldiers = readInt(player, "getNumSoldiers", 0);
        json.append('{');
        json.append("\"index\":").append(playerIndex);
        json.append(",\"id\":").append(readInt(player, "getID", -1));
        json.append(",\"team\":").append(readInt(player, "getTeam", -1));
        json.append(",\"name\":");
        appendJsonString(json, readString(player, "getName", ""));
        json.append(",\"local\":").append(readBoolean(player, "isLocalPlayer", false));
        json.append(",\"computer\":").append(isComputerPlayer(player));
        json.append(",\"disconnected\":").append(readBoolean(player, "isDisconnected", false));
        json.append(",\"currentTurnSoldier\":")
                .append(readInt(player, "getCurrentTurnSoldierIndex", -1));
        json.append(",\"soldiers\":[");

        Object soldiers = invoke(player, "getSoldiers");
        if (soldiers == null || !soldiers.getClass().isArray()) {
            throw new GraphwarStateException("Graphwar soldiers array is unavailable");
        }
        // Source: GraphPlane renders getSoldiers()[0..getNumSoldiers()).
        int soldierCount = Math.min(numSoldiers, Array.getLength(soldiers));
        for (int soldierIndex = 0; soldierIndex < soldierCount; soldierIndex += 1) {
            if (soldierIndex > 0) {
                json.append(',');
            }
            appendSoldier(json, Array.get(soldiers, soldierIndex), soldierIndex, terrainReversed);
        }

        json.append("]}");
    }

    private static boolean isComputerPlayer(Object player) {
        return GRAPHWAR_COMPUTER_PLAYER_CLASS_NAME.equals(player.getClass().getName());
    }

    private static void appendSoldier(
            StringBuilder json, Object soldier, int index, boolean terrainReversed)
            throws GraphwarStateException {
        int worldX = readInt(soldier, "getX", 0);
        int worldY = readInt(soldier, "getY", 0);
        int viewX = Coordinates.toViewPointX(worldX, terrainReversed);
        boolean alive = readBoolean(soldier, "isAlive", false);
        boolean exploding = readBoolean(soldier, "isExploding", false);

        // Source: GraphPlane draws soldiers while alive or during the death animation.
        json.append('{');
        json.append("\"index\":").append(index);
        json.append(",\"alive\":").append(alive);
        json.append(",\"exploding\":").append(exploding);
        json.append(",\"rendered\":").append(alive || exploding);
        json.append(",\"angle\":").append(readDouble(soldier, "getAngle", 0.0));
        json.append(",\"world\":");
        appendPoint(json, worldX, worldY);
        json.append(",\"view\":");
        appendPoint(json, viewX, worldY);
        json.append('}');
    }

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

    private static Object invoke(Object target, String methodName) throws GraphwarStateException {
        try {
            // Keep all Graphwar API coupling here so field extraction stays easy to audit.
            Method method = target.getClass().getMethod(methodName);
            return method.invoke(target);
        } catch (IllegalAccessException | NoSuchMethodException error) {
            throw new GraphwarStateException("Cannot read Graphwar method " + methodName, error);
        } catch (InvocationTargetException error) {
            throw new GraphwarStateException(
                    "Graphwar method " + methodName + " failed", error.getCause());
        }
    }

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

    private static boolean readBoolean(Object target, String methodName, boolean fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof Boolean ? ((Boolean) value).booleanValue() : fallback;
    }

    private static double readDouble(Object target, String methodName, double fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof Number ? ((Number) value).doubleValue() : fallback;
    }

    private static int readInt(Object target, String methodName, int fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof Number ? ((Number) value).intValue() : fallback;
    }

    private static String readString(Object target, String methodName, String fallback)
            throws GraphwarStateException {
        Object value = invoke(target, methodName);
        return value instanceof String ? (String) value : fallback;
    }

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

    private static final class RuntimeState {
        boolean available;
        int currentTurn;
        int gameMode;
        int gameState;
        List<?> players;
        String reason;
        BufferedImage terrain;
        boolean terrainReversed;

        static RuntimeState unavailable(String reason) {
            RuntimeState runtime = new RuntimeState();
            runtime.available = false;
            runtime.reason = reason;
            return runtime;
        }
    }
}
