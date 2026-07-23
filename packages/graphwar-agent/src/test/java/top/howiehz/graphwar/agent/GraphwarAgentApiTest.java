package top.howiehz.graphwar.agent;

import Graphwar.ComputerPlayer;
import Graphwar.Function;
import Graphwar.GameData;
import Graphwar.Graphwar;
import Graphwar.Obstacle;
import Graphwar.Player;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** Dependency-free regression tests for the complete localhost API contract. */
public final class GraphwarAgentApiTest {
    private static final String GAME_INSTANCE_ID = "00000000-0000-0000-0000-000000000001";
    private static final String REQUEST_ID = "00000000-0000-0000-0000-000000000002";
    private static final String REVISION =
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final String TURN_TOKEN = "00000000-0000-0000-0000-000000000003";

    /** Prevents construction of the test entry-point class. */
    private GraphwarAgentApiTest() {}

    /** Runs every assertion and exits nonzero when any API contract regresses. */
    public static void main(String[] arguments) throws Exception {
        testShotJsonParser();
        testLedgerInvariantFailureIsInternalError();
        testStoppedShotExecutorReleasesSlot();
        testShotWorkerStartupFailureReleasesSlot();
        testOutOfOrderStateObservation();
        testGameDataReplacementCannotPublishOutOfOrder();
        testEquivalentFractionFunction();
        testFunctionTokenCounting();
        testGraphPlaneAlphaClamp();
        testFunctionGuardTransformation();
        GameData gameData = new GameData();
        configureRoom(gameData);
        Graphwar graphwar = new Graphwar(gameData);
        GraphwarStateReader stateReader = new GraphwarStateReader(() -> graphwar);
        GraphwarHttpServer server = GraphwarHttpServer.start(0, 0, stateReader);
        try {
            testV3HttpContract(server.getPort(), gameData, graphwar, stateReader);
        } finally {
            server.stop();
        }
        testFunctionHttpBoundariesAndReflectedErrors();
        testAuthenticationAndRequestLimit();

        System.out.println("graphwar-agent API tests passed");
    }

    /** Verifies an impossible full ledger is reported as an internal invariant failure. */
    private static void testLedgerInvariantFailureIsInternalError() throws Exception {
        GraphwarStateReader stateReader = new GraphwarStateReader(() -> null);
        GraphwarShotCommandStore commands = new GraphwarShotCommandStore(stateReader);
        commands.observeState(1L, GAME_INSTANCE_ID, TURN_TOKEN);
        try {
            Field recordsField = GraphwarShotCommandStore.class.getDeclaredField("commands");
            recordsField.setAccessible(true);
            @SuppressWarnings("unchecked")
            Map<String, Object> records = (Map<String, Object>) recordsField.get(commands);
            Class<?> commandClass =
                    Class.forName("top.howiehz.graphwar.agent.GraphwarShotCommandStore$Command");
            Constructor<?> constructor =
                    commandClass.getDeclaredConstructor(GraphwarShotRequest.class, byte[].class);
            constructor.setAccessible(true);
            for (int index = 0; index < GraphwarShotCommandStore.MAX_RECORDS; index += 1) {
                String requestId = uuidFor(700 + index);
                GraphwarShotRequest request =
                        GraphwarShotRequest.parse(
                                createV3ShotBody(
                                        requestId,
                                        GAME_INSTANCE_ID,
                                        TURN_TOKEN,
                                        REVISION,
                                        "x",
                                        null));
                records.put(requestId, constructor.newInstance(request, new byte[] {(byte) index}));
            }

            try {
                commands.submit(
                        GraphwarShotRequest.parse(
                                createV3ShotBody(
                                        uuidFor(800),
                                        GAME_INSTANCE_ID,
                                        TURN_TOKEN,
                                        REVISION,
                                        "x",
                                        null)));
                throw new AssertionError("invalid full ledger accepted another command");
            } catch (GraphwarShotCommandException expected) {
                assertEquals(500, expected.status, "ledger invariant HTTP status");
                assertEquals("internal-error", expected.code, "ledger invariant error code");
            }
            assertEquals(
                    GraphwarShotCommandStore.MAX_RECORDS,
                    records.size(),
                    "ledger invariant retained bound");
        } finally {
            commands.stop();
        }
    }

    /** Verifies shutdown-race rejection cannot leave the sole shot slot permanently occupied. */
    private static void testStoppedShotExecutorReleasesSlot() throws Exception {
        GraphwarShotCommandStore commands =
                new GraphwarShotCommandStore(new GraphwarStateReader(() -> null));
        commands.stop();
        GraphwarShotCommandStore.Submission submission =
                commands.submit(
                        GraphwarShotRequest.parse(
                                createV3ShotBody(
                                        uuidFor(899),
                                        GAME_INSTANCE_ID,
                                        TURN_TOKEN,
                                        REVISION,
                                        "x",
                                        null)));
        assertContains(submission.json, "\"code\":\"internal-error\"", "stopped executor error");
        assertTrue(commands.canAcceptShotCommands(), "stopped executor leaked the shot slot");
    }

    /**
     * Verifies a failure before the worker starts still terminates its command and releases its
     * slot.
     */
    private static void testShotWorkerStartupFailureReleasesSlot() throws Exception {
        GraphwarShotCommandStore commands =
                new GraphwarShotCommandStore(
                        new GraphwarStateReader(() -> null),
                        runnable -> {
                            throw new SecurityException("worker creation denied");
                        });
        try {
            GraphwarShotCommandStore.Submission submission =
                    commands.submit(
                            GraphwarShotRequest.parse(
                                    createV3ShotBody(
                                            uuidFor(898),
                                            GAME_INSTANCE_ID,
                                            TURN_TOKEN,
                                            REVISION,
                                            "x",
                                            null)));
            assertContains(
                    submission.json, "\"status\":\"failed\"", "worker startup failure status");
            assertContains(
                    submission.json, "\"code\":\"internal-error\"", "worker startup failure code");
            assertTrue(
                    commands.canAcceptShotCommands(),
                    "worker startup failure leaked the shot slot");
        } finally {
            commands.stop();
        }
    }

    /**
     * Verifies the long fraction accepted by the Agent preserves Graphwar's parsed double value.
     */
    private static void testEquivalentFractionFunction() throws Exception {
        String numerator = "3096532637734579";
        String denominator = "35184372088832";

        assertEquals(
                Double.valueOf(Double.parseDouble("88.008750871454684")),
                Double.valueOf(Double.parseDouble(numerator) / Double.parseDouble(denominator)),
                "equivalent fraction runtime value");
        new Function(numerator + "/" + denominator);
    }

    /** Reproduces the official renderer crash and verifies transformed alpha clamping. */
    private static void testGraphPlaneAlphaClamp() throws Exception {
        byte[] originalClass = readClassBytes("/Graphwar/GraphPlane.class");

        GraphwarAlphaCompositeFixer fixer = new GraphwarAlphaCompositeFixer();
        assertTrue(
                fixer.transform(null, "Graphwar/OtherPlane", null, null, originalClass) == null,
                "unrelated renderer class was patched");
        byte[] patchedClass =
                fixer.transform(null, "Graphwar/GraphPlane", null, null, originalClass);
        assertTrue(patchedClass != null, "GraphPlane alpha call was not patched");
        Class<?> graphPlaneClass =
                new TransformedClassLoader().define("Graphwar.GraphPlane", patchedClass);
        Object graphPlane = graphPlaneClass.getConstructor().newInstance();
        assertEquals(
                Float.valueOf(1.0f),
                graphPlaneClass
                        .getMethod("renderAlpha", Float.TYPE)
                        .invoke(graphPlane, Float.valueOf(1.25f)),
                "alpha above one");
        assertEquals(
                Float.valueOf(0.0f),
                graphPlaneClass
                        .getMethod("renderAlpha", Float.TYPE)
                        .invoke(graphPlane, Float.valueOf(-0.25f)),
                "alpha below zero");
        assertEquals(
                Float.valueOf(0.4f),
                graphPlaneClass
                        .getMethod("renderAlpha", Float.TYPE)
                        .invoke(graphPlane, Float.valueOf(0.4f)),
                "valid alpha");
    }

    /** Verifies UI rejection, inbound disconnect, and precise stack-overflow containment. */
    private static void testFunctionGuardTransformation() throws Exception {
        GraphwarFunctionGuard guard = new GraphwarFunctionGuard(GraphwarAgentConfig.forTest(0, 0));
        byte[] gameScreenBytes = readClassBytes("/Graphwar/GameScreen.class");
        byte[] patchedGameScreen =
                guard.transform(null, "Graphwar/GameScreen", null, null, gameScreenBytes);
        assertTrue(patchedGameScreen != null, "GameScreen sendFunction call was not guarded");
        Class<?> gameScreenClass =
                new TransformedClassLoader().define("Graphwar.GameScreen", patchedGameScreen);
        Object gameScreen = gameScreenClass.getConstructor().newInstance();
        GameData gameData = new GameData();
        gameScreenClass
                .getMethod("fire", GameData.class, String.class)
                .invoke(gameScreen, gameData, repeatedTerms("x", "+", 1_537));
        assertEquals(0, gameData.getShotCalls().size(), "guarded UI complex function calls");
        gameScreenClass
                .getMethod("fire", GameData.class, String.class)
                .invoke(gameScreen, gameData, "x");
        assertEquals(
                Collections.singletonList("function:x"),
                gameData.getShotCalls(),
                "guarded UI valid function call");
        gameData.setShouldOverflowFromFunction(true);
        gameScreenClass
                .getMethod("fire", GameData.class, String.class)
                .invoke(gameScreen, gameData, "x");
        assertEquals(1, gameData.getShotCalls().size(), "outbound stack overflow side effects");
        gameData.setShouldOverflowFromFunction(false);
        gameData.setShouldThrowOtherErrorFromFunction(true);
        try {
            gameScreenClass
                    .getMethod("fire", GameData.class, String.class)
                    .invoke(gameScreen, gameData, "x");
            throw new AssertionError("unrelated outbound Error was suppressed");
        } catch (java.lang.reflect.InvocationTargetException expected) {
            assertTrue(
                    expected.getCause() instanceof AssertionError,
                    "unrelated outbound Error type changed");
        }

        byte[] computerPlayerBytes = readClassBytes("/Graphwar/ComputerPlayer.class");
        byte[] patchedComputerPlayer =
                guard.transform(null, "Graphwar/ComputerPlayer", null, null, computerPlayerBytes);
        assertTrue(
                patchedComputerPlayer != null, "ComputerPlayer sendFunction call was not guarded");
        Class<?> computerPlayerClass =
                new TransformedClassLoader()
                        .define("Graphwar.ComputerPlayer", patchedComputerPlayer);
        GameData computerGameData = new GameData();
        Object computerPlayer =
                computerPlayerClass
                        .getConstructor(
                                GameData.class,
                                Integer.TYPE,
                                String.class,
                                Integer.TYPE,
                                Boolean.TYPE,
                                Integer.TYPE)
                        .newInstance(computerGameData, 7, "computer", 1, true, 1);
        computerGameData.addPlayer((Player) computerPlayer);
        computerPlayerClass
                .getMethod("fire", GameData.class, Double.TYPE, String.class)
                .invoke(
                        computerPlayer,
                        computerGameData,
                        Double.valueOf(0.25),
                        repeatedTerms("x", "+", 1_537));
        assertEquals(
                Collections.singletonList("angle:0.25"),
                computerGameData.getShotCalls(),
                "guarded AI complex function calls");
        computerGameData.clearShotCalls();
        computerPlayerClass
                .getMethod("fire", GameData.class, Double.TYPE, String.class)
                .invoke(computerPlayer, computerGameData, Double.valueOf(0.5), "x");
        assertEquals(
                Arrays.asList("angle:0.5", "function:x"),
                computerGameData.getShotCalls(),
                "guarded AI valid call order");

        byte[] gameDataBytes = readClassBytes("/Graphwar/GameData.class");
        byte[] patchedGameData =
                guard.transform(null, "Graphwar/GameData", null, null, gameDataBytes);
        assertTrue(patchedGameData != null, "GameData inbound function call was not guarded");
        Class<?> gameDataClass =
                new TransformedClassLoader().define("Graphwar.GameData", patchedGameData);

        Object ignoredDrawingGameData = gameDataClass.getConstructor().newInstance();
        addTransformedCurrentPlayer(gameDataClass, ignoredDrawingGameData, false);
        gameDataClass
                .getMethod("setDrawingFunction", Boolean.TYPE)
                .invoke(ignoredDrawingGameData, Boolean.TRUE);
        gameDataClass
                .getMethod("handleIncomingFunction", String[].class)
                .invoke(
                        ignoredDrawingGameData,
                        new Object[] {new String[] {"24", "7", repeatedTerms("x", "%2B", 1_537)}});
        assertEquals(
                Boolean.FALSE,
                gameDataClass.getMethod("isDisconnected").invoke(ignoredDrawingGameData),
                "drawing-state inbound no-op");

        Object ignoredOutOfTurnGameData = gameDataClass.getConstructor().newInstance();
        addTransformedCurrentPlayer(gameDataClass, ignoredOutOfTurnGameData, false);
        gameDataClass
                .getMethod("handleIncomingFunction", String[].class)
                .invoke(
                        ignoredOutOfTurnGameData,
                        new Object[] {new String[] {"24", "9", repeatedTerms("x", "%2B", 1_537)}});
        assertEquals(
                Boolean.FALSE,
                gameDataClass.getMethod("isDisconnected").invoke(ignoredOutOfTurnGameData),
                "out-of-turn inbound no-op");

        Object inboundGameData = gameDataClass.getConstructor().newInstance();
        addTransformedCurrentPlayer(gameDataClass, inboundGameData, false);
        gameDataClass
                .getMethod("handleIncomingFunction", String[].class)
                .invoke(
                        inboundGameData,
                        new Object[] {new String[] {"24", "7", repeatedTerms("x", "%2B", 1_537)}});
        assertEquals(
                Boolean.TRUE,
                gameDataClass.getMethod("isDisconnected").invoke(inboundGameData),
                "complex inbound disconnect");
        assertEquals(
                Collections.emptyList(),
                gameDataClass.getMethod("getInboundFunctions").invoke(inboundGameData),
                "complex inbound processing");

        Object computerInboundGameData = gameDataClass.getConstructor().newInstance();
        addTransformedCurrentPlayer(gameDataClass, computerInboundGameData, true);
        gameDataClass
                .getMethod("handleIncomingFunction", String[].class)
                .invoke(computerInboundGameData, new Object[] {new String[] {"24", "7", "x"}});
        assertEquals(
                Collections.singletonList("x"),
                gameDataClass.getMethod("getInboundFunctions").invoke(computerInboundGameData),
                "computer-player inbound processing");

        Object overflowGameData = gameDataClass.getConstructor().newInstance();
        addTransformedCurrentPlayer(gameDataClass, overflowGameData, false);
        gameDataClass
                .getMethod("setShouldOverflowFromInbound", Boolean.TYPE)
                .invoke(overflowGameData, Boolean.TRUE);
        gameDataClass
                .getMethod("handleIncomingFunction", String[].class)
                .invoke(overflowGameData, new Object[] {new String[] {"24", "7", "x"}});
        assertEquals(
                Boolean.TRUE,
                gameDataClass.getMethod("isDisconnected").invoke(overflowGameData),
                "inbound stack overflow disconnect");

        Object unrelatedErrorGameData = gameDataClass.getConstructor().newInstance();
        addTransformedCurrentPlayer(gameDataClass, unrelatedErrorGameData, false);
        gameDataClass
                .getMethod("setShouldThrowOtherErrorFromInbound", Boolean.TYPE)
                .invoke(unrelatedErrorGameData, Boolean.TRUE);
        try {
            gameDataClass
                    .getMethod("handleIncomingFunction", String[].class)
                    .invoke(unrelatedErrorGameData, new Object[] {new String[] {"24", "7", "x"}});
            throw new AssertionError("unrelated inbound Error was suppressed");
        } catch (java.lang.reflect.InvocationTargetException expected) {
            assertTrue(
                    expected.getCause() instanceof AssertionError,
                    "unrelated inbound Error type changed");
        }
    }

    /** Verifies strict field, escape, and JSON-number handling before HTTP routing. */
    private static void testShotJsonParser() throws Exception {
        GraphwarShotRequest parsed =
                GraphwarShotRequest.parse(
                        "{\"requestId\":\""
                                + REQUEST_ID
                                + "\",\"gameInstanceId\":\""
                                + GAME_INSTANCE_ID
                                + "\",\"function\":\"x\\u002b1\",\"turnToken\":\""
                                + TURN_TOKEN
                                + "\",\"battleRevision\":\""
                                + REVISION
                                + "\",\"angleRadians\":-2.5e-1}");
        assertEquals(REQUEST_ID, parsed.requestId, "parsed request ID");
        assertEquals(GAME_INSTANCE_ID, parsed.gameInstanceId, "parsed game instance ID");
        assertEquals("x+1", parsed.function, "unicode shot function");
        assertEquals(TURN_TOKEN, parsed.turnToken, "parsed turn token");
        assertEquals(REVISION, parsed.battleRevision, "parsed battle revision");
        assertEquals(Double.valueOf(-0.25), parsed.angleRadians, "parsed angle");

        for (String body :
                Arrays.asList(
                        "",
                        "{}",
                        "{\"function\":\"x\",\"function\":\"y\",\"turnToken\":\"t\","
                                + "\"battleRevision\":\"r\"}",
                        "{\"function\":\"x\",\"turnToken\":\"t\","
                                + "\"battleRevision\":\"r\",\"angleRadians\":null}",
                        "{\"function\":\"x\",\"turnToken\":\"t\","
                                + "\"battleRevision\":\"r\",\"angleRadians\":01}",
                        "{\"function\":\"x\",\"turnToken\":\"t\","
                                + "\"battleRevision\":\"r\"} trailing")) {
            try {
                GraphwarShotRequest.parse(body);
                throw new AssertionError("invalid shot JSON was accepted: " + body);
            } catch (GraphwarInvalidShotException expected) {
                assertTrue(
                        expected.getMessage().startsWith("Invalid shot JSON at character "),
                        "invalid shot message");
            }
        }

        for (String invalidString : Arrays.asList("\\uD800", "\\uDC00", "\\uD800x")) {
            try {
                GraphwarShotRequest.parse(
                        "{\"requestId\":\""
                                + REQUEST_ID
                                + "\",\"gameInstanceId\":\""
                                + GAME_INSTANCE_ID
                                + "\",\"function\":\""
                                + invalidString
                                + "\",\"turnToken\":\""
                                + TURN_TOKEN
                                + "\",\"battleRevision\":\""
                                + REVISION
                                + "\"}");
                throw new AssertionError("unpaired surrogate was accepted: " + invalidString);
            } catch (GraphwarInvalidShotException expected) {
                assertContains(expected.getMessage(), "unpaired surrogate", "surrogate message");
            }
        }
    }

    /** Verifies that a late older state response cannot roll command retention backward. */
    private static void testOutOfOrderStateObservation() throws Exception {
        GraphwarStateReader stateReader = new GraphwarStateReader(() -> null);
        GraphwarShotCommandStore commands = new GraphwarShotCommandStore(stateReader);
        stateReader.setShotCommands(commands);
        String requestId = uuidFor(90);
        try {
            commands.submit(
                    GraphwarShotRequest.parse(
                            createV3ShotBody(
                                    requestId, uuidFor(91), uuidFor(92), REVISION, "x", null)));
            commands.observeState(2L, uuidFor(91), uuidFor(92));
            commands.observeState(1L, uuidFor(93), null);
            assertContains(commands.read(requestId), requestId, "out-of-order state observation");
        } finally {
            commands.stop();
        }
    }

    /** Ensures an old GameData read cannot retire a newer game identity after replacement. */
    private static void testGameDataReplacementCannotPublishOutOfOrder() throws Exception {
        GameData oldGameData = new GameData();
        configureActiveMatch(oldGameData);
        oldGameData.setShouldBlockStateRead(true);
        GameData newGameData = new GameData();
        configureActiveMatch(newGameData);
        newGameData.setShouldBlockStateRead(true);
        Graphwar graphwar = new Graphwar(oldGameData);
        GraphwarStateReader stateReader = new GraphwarStateReader(() -> graphwar);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<String> oldState = executor.submit(stateReader::readStateJson);
            assertTrue(
                    oldGameData.awaitStateRead(5, TimeUnit.SECONDS),
                    "old GameData read reached replacement barrier");
            graphwar.setGameData(newGameData);
            Future<String> newState = executor.submit(stateReader::readStateJson);
            boolean hasNewStateReadStarted = newGameData.awaitStateRead(100, TimeUnit.MILLISECONDS);
            newGameData.setShouldBlockStateRead(false);
            oldGameData.setShouldBlockStateRead(false);

            assertTrue(
                    !hasNewStateReadStarted,
                    "new GameData read waits for the older snapshot to publish");
            String oldStateBody = oldState.get(5, TimeUnit.SECONDS);
            String newStateBody = newState.get(5, TimeUnit.SECONDS);
            String finalStateBody = stateReader.readStateJson();
            String oldGameInstanceId = extractJsonString(oldStateBody, "gameInstanceId");
            String newGameInstanceId = extractJsonString(newStateBody, "gameInstanceId");
            assertNotEquals(
                    oldGameInstanceId, newGameInstanceId, "replacement changes game identity");
            assertEquals(
                    newGameInstanceId,
                    extractJsonString(finalStateBody, "gameInstanceId"),
                    "later reads retain the replacement identity");
        } finally {
            oldGameData.setShouldBlockStateRead(false);
            newGameData.setShouldBlockStateRead(false);
            executor.shutdownNow();
        }
    }

    /** Verifies the v3 wire contract, idempotent commands, conditions, and renamed fields. */
    private static void testV3HttpContract(
            int port, GameData gameData, Graphwar graphwar, GraphwarStateReader stateReader)
            throws Exception {
        String health = request(port, "GET", "/health", null, null).bodyText();
        assertContains(health, "\"apiVersion\":3", "health API version");
        assertContains(health, "\"version\":\"2.0.0\"", "Agent version");
        assertContains(health, "\"isAuthenticationRequired\":false", "health auth flag");
        assertContains(health, "\"maxRequestHeaderBytes\":8192", "health header limit");
        assertContains(health, "\"maxFunctionBytes\":65536", "health function byte limit");
        assertContains(health, "\"maxFunctionTokens\":3072", "health function token limit");

        assertContains(
                request(port, "GET", "/room", null, null).bodyText(),
                "\"isAvailable\":true",
                "room availability");
        assertResponse(
                request(port, "PUT", "/room/ready", "{\"isReady\":true}", "application/json"),
                200,
                "{\"isReady\":true}\n",
                "ready target");

        configureActiveMatch(gameData);
        String stateBody = request(port, "GET", "/state", null, null).bodyText();
        assertContains(stateBody, "\"apiVersion\":3", "state API version");
        assertContains(stateBody, "\"observedAtEpochMs\":", "state observation time");
        assertContains(stateBody, "\"isAvailable\":true", "state availability");
        assertContains(
                stateBody,
                "\"capabilities\":{\"canSubmitShots\":true,\"canReadRoom\":true,"
                        + "\"canSetReady\":true,\"canReadWorldObstacleMask\":true}",
                "v3 capabilities");
        assertContains(stateBody, "\"equationMode\":\"y\"", "equation mode");
        assertContains(stateBody, "\"agentInstanceId\":", "Agent process identity");
        assertContains(stateBody, "\"observationSequence\":", "state observation sequence");
        assertContains(stateBody, "\"functionDraw\":null", "idle function draw state");
        assertContains(stateBody, "\"currentPlayerIndex\":0", "current player index");
        assertContains(stateBody, "\"currentPlayerId\":7", "current player ID");
        assertContains(stateBody, "\"isTerrainReversed\":true", "orientation");
        assertContains(stateBody, "\"playerIndex\":0,\"playerId\":7", "player identity");
        assertContains(stateBody, "\"isConnected\":true", "connection state");
        assertContains(stateBody, "\"soldierIndex\":0,\"isAlive\":true", "soldier state");
        assertContains(stateBody, "\"shotCommand\":null", "empty shot summary");

        gameData.setDrawingFunction(true);
        gameData.setCurrentFunctionPosition(1500);
        String drawingStateBody = request(port, "GET", "/state", null, null).bodyText();
        assertContains(drawingStateBody, "\"phase\":\"drawing\"", "drawing phase");
        assertContains(drawingStateBody, "\"functionDraw\":{\"currentStep\":1500", "draw cursor");
        assertContains(drawingStateBody, "\"stepsPerSecond\":1500}", "draw step rate");
        gameData.setFunctionNumSteps(1500);
        gameData.setCurrentFunctionPosition(1501);
        assertContains(
                request(port, "GET", "/state", null, null).bodyText(),
                "\"phase\":\"exploding\",\"functionDraw\":null",
                "official cursor transition");
        gameData.setExploding(true);
        assertContains(
                request(port, "GET", "/state", null, null).bodyText(),
                "\"phase\":\"exploding\",\"functionDraw\":null",
                "explosion draw state");
        gameData.setDrawingFunction(false);
        gameData.setExploding(false);

        String revision = extractJsonString(stateBody, "battleRevision");
        HttpResponse mask =
                requestWithHeader(
                        port,
                        "GET",
                        "/obstacle-masks/world.bin",
                        null,
                        null,
                        "If-Match",
                        "\"" + revision + "\"");
        assertEquals(200, mask.status, "conditioned mask status");
        assertEquals("\"" + revision + "\"", mask.entityTag, "mask ETag");
        assertEquals(770 * 450, mask.body.length, "mask length");
        assertEquals(
                2,
                gameData.getObstacle().getImageReadCount(),
                "terrain rescans per explosion signature");
        assertEquals(
                428,
                request(port, "GET", "/obstacle-masks/world.bin", null, null).status,
                "missing If-Match");

        String gameInstanceId = extractJsonString(stateBody, "gameInstanceId");
        String turnToken = extractJsonString(stateBody, "turnToken");
        String shotBody =
                createV3ShotBody(REQUEST_ID, gameInstanceId, turnToken, revision, "x", null);
        gameData.clearShotCalls();
        String complexRequestId = uuidFor(90);
        HttpResponse complexFunction =
                request(
                        port,
                        "POST",
                        "/shots",
                        createV3ShotBody(
                                complexRequestId,
                                gameInstanceId,
                                turnToken,
                                revision,
                                repeatedTerms("x", "+", 1_537),
                                null),
                        "application/json");
        assertEquals(201, complexFunction.status, "complex function command creation");
        String complexCommand = waitForCommandStatus(port, complexRequestId, "failed");
        assertContains(
                complexCommand, "\"code\":\"function-too-complex\"", "complex function error code");
        assertEquals(0, gameData.getShotCalls().size(), "complex function side effects");
        HttpResponse created = request(port, "POST", "/shots", shotBody, "application/json");
        assertEquals(201, created.status, "created command status");
        waitForCommandStatus(port, REQUEST_ID, "submitted");
        assertEquals(
                Collections.singletonList("function:x"),
                gameData.getShotCalls(),
                "shot side effect");
        assertEquals(
                200,
                request(port, "POST", "/shots", shotBody, "application/json").status,
                "idempotent replay");
        assertEquals(1, gameData.getShotCalls().size(), "replay side effects");
        assertContains(
                request(port, "GET", "/shots/" + REQUEST_ID, null, null).bodyText(),
                "\"status\":\"submitted\"",
                "command query");
        assertEquals(
                409,
                request(
                                port,
                                "POST",
                                "/shots",
                                createV3ShotBody(
                                        REQUEST_ID,
                                        gameInstanceId,
                                        turnToken,
                                        revision,
                                        "x+1",
                                        null),
                                "application/json")
                        .status,
                "request ID conflict");

        String secondRequestId = "00000000-0000-0000-0000-000000000003";
        HttpResponse usedToken =
                request(
                        port,
                        "POST",
                        "/shots",
                        createV3ShotBody(
                                secondRequestId, gameInstanceId, turnToken, revision, "x", null),
                        "application/json");
        assertEquals(201, usedToken.status, "failed command resource status");
        assertContains(
                waitForCommandStatus(port, secondRequestId, "failed"),
                "\"code\":\"turn-token-used\"",
                "stable error code");

        testStuckShotRecoveryAndLedgerBound(port, gameData);
        String unknownRequestId = testUnknownAfterClaim(port, gameData);
        testNewGameCleanupWithoutTurnToken(port, gameData, unknownRequestId);

        gameData.setGameState(1);
        String unavailableState = request(port, "GET", "/state", null, null).bodyText();
        assertContains(unavailableState, "\"observedAtEpochMs\":", "unavailable observation time");
        assertContains(unavailableState, "\"isAvailable\":false", "unavailable state");
        graphwar.setGameData(null);
        assertEquals(
                "{\"isAvailable\":false,\"reason\":\"game-data-not-initialized\"}",
                stateReader.readRoomJson(),
                "missing GameData room");
    }

    /** Verifies immediate response, concurrent replay, a stuck slot, and bounded eviction. */
    private static void testStuckShotRecoveryAndLedgerBound(int port, GameData gameData)
            throws Exception {
        configureActiveMatch(gameData);
        gameData.setTimeTurnStarted(2_000L);
        String state = request(port, "GET", "/state", null, null).bodyText();
        String gameInstanceId = extractJsonString(state, "gameInstanceId");
        String turnToken = extractJsonString(state, "turnToken");
        String revision = extractJsonString(state, "battleRevision");
        String activeRequestId = uuidFor(100);
        String body =
                createV3ShotBody(activeRequestId, gameInstanceId, turnToken, revision, "x", null);
        gameData.setShouldBlockFunction(true);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        Future<HttpResponse> first =
                executor.submit(() -> request(port, "POST", "/shots", body, "application/json"));
        try {
            assertTrue(
                    gameData.awaitFunctionCall(2, TimeUnit.SECONDS),
                    "shot worker did not enter the blocked original call");
            HttpResponse created = first.get(2, TimeUnit.SECONDS);
            assertEquals(201, created.status, "non-blocking initial command status");
            assertEquals(
                    "/shots/" + activeRequestId, created.location, "non-blocking command location");
            assertEquals("1", created.retryAfter, "non-blocking command retry interval");
            assertTrue(
                    created.bodyText().contains("\"status\":\"validating\"")
                            || created.bodyText().contains("\"status\":\"claimed\""),
                    "initial command did not return a pending state: " + created.bodyText());
            HttpResponse replay = request(port, "POST", "/shots", body, "application/json");
            assertEquals(200, replay.status, "concurrent replay status");
            assertContains(replay.bodyText(), "\"status\":\"claimed\"", "concurrent replay state");
            assertEquals("1", replay.retryAfter, "concurrent replay retry interval");

            String firstBusyRequestId = null;
            for (int index = 0; index < 55; index += 1) {
                String busyRequestId = uuidFor(200 + index);
                if (firstBusyRequestId == null) {
                    firstBusyRequestId = busyRequestId;
                }
                HttpResponse busy =
                        request(
                                port,
                                "POST",
                                "/shots",
                                createV3ShotBody(
                                        busyRequestId,
                                        gameInstanceId,
                                        turnToken,
                                        revision,
                                        "x",
                                        null),
                                "application/json");
                assertEquals(201, busy.status, "busy command creation");
                assertContains(
                        busy.bodyText(), "\"code\":\"shot-executor-busy\"", "busy error code");
            }

            assertEquals(
                    200,
                    request(port, "GET", "/shots/" + activeRequestId, null, null).status,
                    "active command retained");
            assertEquals(
                    404,
                    request(port, "GET", "/shots/" + firstBusyRequestId, null, null).status,
                    "oldest terminal command evicted");

            ExecutorService blockedStateReadExecutor = Executors.newFixedThreadPool(6);
            List<Future<HttpResponse>> blockedStateReads = new ArrayList<Future<HttpResponse>>(6);
            try {
                for (int index = 0; index < 6; index += 1) {
                    blockedStateReads.add(
                            blockedStateReadExecutor.submit(
                                    () -> request(port, "GET", "/state", null, null)));
                }
                Thread.sleep(100L);
                assertEquals(
                        200,
                        request(port, "GET", "/health", null, null).status,
                        "health worker reserve");
                assertEquals(
                        200,
                        request(port, "GET", "/shots/" + activeRequestId, null, null).status,
                        "command recovery worker reserve");
            } finally {
                // Releasing the Graphwar monitor does not immediately release the six HTTP
                // admission slots. Wait for every blocked request to finish before the next
                // contract test sends another Graphwar-dependent request.
                gameData.setShouldBlockFunction(false);
                try {
                    for (Future<HttpResponse> blockedStateRead : blockedStateReads) {
                        assertEquals(
                                200,
                                blockedStateRead.get(5, TimeUnit.SECONDS).status,
                                "released blocked state request");
                    }
                } finally {
                    blockedStateReadExecutor.shutdownNow();
                }
            }
        } finally {
            gameData.setShouldBlockFunction(false);
            executor.shutdownNow();
        }

        waitForCommandStatus(port, activeRequestId, "submitted");
    }

    /** Verifies that an exception after claim is retained as unknown rather than retried. */
    private static String testUnknownAfterClaim(int port, GameData gameData) throws Exception {
        configureActiveMatch(gameData);
        gameData.setTimeTurnStarted(3_000L);
        String state = request(port, "GET", "/state", null, null).bodyText();
        String requestId = uuidFor(300);
        gameData.setShouldThrowFromFunction(true);
        try {
            HttpResponse response =
                    request(
                            port,
                            "POST",
                            "/shots",
                            createV3ShotBody(
                                    requestId,
                                    extractJsonString(state, "gameInstanceId"),
                                    extractJsonString(state, "turnToken"),
                                    extractJsonString(state, "battleRevision"),
                                    "x",
                                    null),
                            "application/json");
            assertEquals(201, response.status, "unknown command creation");
            assertContains(
                    waitForCommandStatus(port, requestId, "unknown"),
                    "\"code\":\"graphwar-call-failed\"",
                    "unknown error code");
            return requestId;
        } finally {
            gameData.setShouldThrowFromFunction(false);
        }
    }

    /** Covers formula limits above the HTTP envelope and reflected Error terminal semantics. */
    private static void testFunctionHttpBoundariesAndReflectedErrors() throws Exception {
        GameData gameData = new GameData();
        configureActiveMatch(gameData);
        Graphwar graphwar = new Graphwar(gameData);
        GraphwarAgentConfig config = GraphwarAgentConfig.forTest(0, 0, 8_192, 131_072, null);
        GraphwarStateReader stateReader = new GraphwarStateReader(config, () -> graphwar);
        GraphwarShotCommandStore commands = new GraphwarShotCommandStore(stateReader);
        stateReader.setShotCommands(commands);
        GraphwarHttpServer server = GraphwarHttpServer.start(config, stateReader, commands);
        try {
            String exactTokenFunction = repeatedTerms("sin", "", 3_071) + "x";
            assertEquals(
                    3_072,
                    GraphwarFunctionLimits.countTokens(exactTokenFunction, 3_072),
                    "exact HTTP token boundary fixture");
            String state = request(server.getPort(), "GET", "/state", null, null).bodyText();
            String exactTokenRequestId = uuidFor(400);
            HttpResponse exactTokenResponse =
                    request(
                            server.getPort(),
                            "POST",
                            "/shots",
                            createV3ShotBody(
                                    exactTokenRequestId,
                                    extractJsonString(state, "gameInstanceId"),
                                    extractJsonString(state, "turnToken"),
                                    extractJsonString(state, "battleRevision"),
                                    exactTokenFunction,
                                    null),
                            "application/json");
            assertEquals(201, exactTokenResponse.status, "exact token boundary HTTP status");
            waitForCommandStatus(server.getPort(), exactTokenRequestId, "submitted");

            gameData.clearShotCalls();
            gameData.setTimeTurnStarted(10_001L);
            state = request(server.getPort(), "GET", "/state", null, null).bodyText();
            String exactByteRequestId = uuidFor(401);
            HttpResponse exactByteResponse =
                    request(
                            server.getPort(),
                            "POST",
                            "/shots",
                            createV3ShotBody(
                                    exactByteRequestId,
                                    extractJsonString(state, "gameInstanceId"),
                                    extractJsonString(state, "turnToken"),
                                    extractJsonString(state, "battleRevision"),
                                    repeat('x', 65_536),
                                    null),
                            "application/json");
            assertEquals(201, exactByteResponse.status, "exact byte boundary HTTP status");
            assertContains(
                    waitForCommandStatus(server.getPort(), exactByteRequestId, "failed"),
                    "\"code\":\"function-too-complex\"",
                    "exact byte boundary reached token validation");
            assertEquals(0, gameData.getShotCalls().size(), "exact byte boundary side effects");

            gameData.setGameMode(2);
            gameData.setTimeTurnStarted(10_002L);
            state = request(server.getPort(), "GET", "/state", null, null).bodyText();
            String oversizedRequestId = uuidFor(402);
            HttpResponse oversizedResponse =
                    request(
                            server.getPort(),
                            "POST",
                            "/shots",
                            createV3ShotBody(
                                    oversizedRequestId,
                                    extractJsonString(state, "gameInstanceId"),
                                    extractJsonString(state, "turnToken"),
                                    extractJsonString(state, "battleRevision"),
                                    repeat('x', 65_537),
                                    "0.25"),
                            "application/json");
            assertEquals(201, oversizedResponse.status, "oversized formula command status");
            assertContains(
                    waitForCommandStatus(server.getPort(), oversizedRequestId, "failed"),
                    "\"code\":\"function-too-large\"",
                    "oversized formula error code");
            assertEquals(0, gameData.getShotCalls().size(), "oversized formula angle side effect");

            String oversizedRetryRequestId = uuidFor(403);
            request(
                    server.getPort(),
                    "POST",
                    "/shots",
                    createV3ShotBody(
                            oversizedRetryRequestId,
                            extractJsonString(state, "gameInstanceId"),
                            extractJsonString(state, "turnToken"),
                            extractJsonString(state, "battleRevision"),
                            "x",
                            "0.25"),
                    "application/json");
            waitForCommandStatus(server.getPort(), oversizedRetryRequestId, "submitted");
            assertEquals(
                    Arrays.asList("angle:0.25", "function:x"),
                    gameData.getShotCalls(),
                    "legal retry call order");

            gameData.clearShotCalls();
            gameData.setGameMode(0);
            gameData.setTimeTurnStarted(10_003L);
            state = request(server.getPort(), "GET", "/state", null, null).bodyText();
            String parserErrorRequestId = uuidFor(404);
            HttpResponse parserErrorResponse =
                    request(
                            server.getPort(),
                            "POST",
                            "/shots",
                            createV3ShotBody(
                                    parserErrorRequestId,
                                    extractJsonString(state, "gameInstanceId"),
                                    extractJsonString(state, "turnToken"),
                                    extractJsonString(state, "battleRevision"),
                                    "error",
                                    null),
                            "application/json");
            assertEquals(201, parserErrorResponse.status, "reflected parser Error command status");
            assertContains(
                    waitForCommandStatus(server.getPort(), parserErrorRequestId, "failed"),
                    "\"code\":\"internal-error\"",
                    "reflected parser Error classification");
            assertTrue(
                    commands.canAcceptShotCommands(),
                    "reflected parser Error leaked the shot slot");
            String parserErrorRetryRequestId = uuidFor(405);
            request(
                    server.getPort(),
                    "POST",
                    "/shots",
                    createV3ShotBody(
                            parserErrorRetryRequestId,
                            extractJsonString(state, "gameInstanceId"),
                            extractJsonString(state, "turnToken"),
                            extractJsonString(state, "battleRevision"),
                            "x",
                            null),
                    "application/json");
            waitForCommandStatus(server.getPort(), parserErrorRetryRequestId, "submitted");

            gameData.setTimeTurnStarted(10_004L);
            state = request(server.getPort(), "GET", "/state", null, null).bodyText();
            gameData.setShouldThrowOtherErrorFromFunction(true);
            String methodErrorRequestId = uuidFor(406);
            HttpResponse methodErrorResponse =
                    request(
                            server.getPort(),
                            "POST",
                            "/shots",
                            createV3ShotBody(
                                    methodErrorRequestId,
                                    extractJsonString(state, "gameInstanceId"),
                                    extractJsonString(state, "turnToken"),
                                    extractJsonString(state, "battleRevision"),
                                    "x",
                                    null),
                            "application/json");
            assertEquals(201, methodErrorResponse.status, "reflected method Error command status");
            assertContains(
                    waitForCommandStatus(server.getPort(), methodErrorRequestId, "unknown"),
                    "\"code\":\"internal-error\"",
                    "reflected method Error classification");
            assertTrue(
                    commands.canAcceptShotCommands(),
                    "reflected method Error leaked the shot slot");

            gameData.setShouldThrowOtherErrorFromFunction(false);
            gameData.setTimeTurnStarted(10_005L);
            state = request(server.getPort(), "GET", "/state", null, null).bodyText();
            String methodErrorRetryRequestId = uuidFor(407);
            request(
                    server.getPort(),
                    "POST",
                    "/shots",
                    createV3ShotBody(
                            methodErrorRetryRequestId,
                            extractJsonString(state, "gameInstanceId"),
                            extractJsonString(state, "turnToken"),
                            extractJsonString(state, "battleRevision"),
                            "x",
                            null),
                    "application/json");
            waitForCommandStatus(server.getPort(), methodErrorRetryRequestId, "submitted");
        } finally {
            gameData.setShouldThrowOtherErrorFromFunction(false);
            server.stop();
        }
    }

    /** Verifies a new active game clears old terminal records even before it has a valid turn. */
    private static void testNewGameCleanupWithoutTurnToken(
            int port, GameData gameData, String oldRequestId) throws IOException {
        gameData.setObstacle(new Obstacle());
        gameData.setCurrentTurn(-1);
        String state = request(port, "GET", "/state", null, null).bodyText();
        assertContains(state, "\"turnToken\":null", "new game without active turn");
        assertEquals(
                404,
                request(port, "GET", "/shots/" + oldRequestId, null, null).status,
                "old game terminal cleanup");
        gameData.setCurrentTurn(0);
    }

    /** Creates a deterministic canonical UUID for ledger-capacity assertions. */
    private static String uuidFor(int value) {
        return String.format("00000000-0000-0000-0000-%012d", Integer.valueOf(value));
    }

    /** Verifies unauthenticated health, bearer protection, and preallocation body rejection. */
    private static void testAuthenticationAndRequestLimit() throws Exception {
        GameData gameData = new GameData();
        configureActiveMatch(gameData);
        Graphwar graphwar = new Graphwar(gameData);
        GraphwarAgentConfig config = GraphwarAgentConfig.forTest(0, 0, 16_384, 1_024, "secret");
        GraphwarStateReader stateReader = new GraphwarStateReader(config, () -> graphwar);
        GraphwarShotCommandStore commands = new GraphwarShotCommandStore(stateReader);
        stateReader.setShotCommands(commands);
        GraphwarHttpServer server = GraphwarHttpServer.start(config, stateReader, commands);
        try {
            String health = request(server.getPort(), "GET", "/health", null, null).bodyText();
            assertContains(health, "\"isAuthenticationRequired\":true", "authenticated health");
            assertContains(health, "\"maxRequestHeaderBytes\":16384", "configured header limit");
            assertEquals(
                    431,
                    requestWithHeader(
                                    server.getPort(),
                                    "GET",
                                    "/health",
                                    null,
                                    null,
                                    "X-Fill",
                                    repeat('x', 16_384))
                            .status,
                    "request header limit");
            assertEquals(
                    405,
                    request(
                                    server.getPort(),
                                    "POST",
                                    "/health",
                                    repeat('x', 1_025),
                                    "application/json")
                            .status,
                    "unused health body bypasses allocation limit");
            HttpResponse missing = request(server.getPort(), "GET", "/state", null, null);
            assertEquals(401, missing.status, "missing bearer status");
            assertContains(
                    missing.bodyText(),
                    "\"code\":\"authentication-required\"",
                    "missing bearer code");
            assertEquals(
                    401,
                    request(
                                    server.getPort(),
                                    "POST",
                                    "/shots",
                                    repeat('x', 1_025),
                                    "application/json")
                            .status,
                    "authentication before body limit");
            assertEquals(
                    401,
                    requestWithHeader(
                                    server.getPort(),
                                    "GET",
                                    "/state",
                                    null,
                                    null,
                                    "Authorization",
                                    "Bearer wrong")
                            .status,
                    "wrong bearer status");
            assertEquals(
                    200,
                    requestWithHeader(
                                    server.getPort(),
                                    "GET",
                                    "/state",
                                    null,
                                    null,
                                    "Authorization",
                                    "Bearer secret")
                            .status,
                    "valid bearer status");
            assertEquals(
                    413,
                    requestWithHeader(
                                    server.getPort(),
                                    "POST",
                                    "/shots",
                                    repeat('x', 1_025),
                                    "application/json",
                                    "Authorization",
                                    "Bearer secret")
                            .status,
                    "request body limit");
        } finally {
            server.stop();
        }

        GraphwarAgentConfig raised =
                GraphwarAgentConfig.parse(
                        "maxRequestHeaderBytes=1048576,maxRequestBodyBytes=16777216,"
                                + "maxFunctionBytes=1048576,"
                                + "maxFunctionTokens=4432");
        assertEquals(1_048_576, raised.maxRequestHeaderBytes, "raised header limit");
        assertEquals(
                8_192,
                GraphwarAgentConfig.parse("maxRequestHeaderBytes=1024").maxRequestHeaderBytes,
                "undersized header limit");
        assertEquals(16_777_216, raised.maxRequestBodyBytes, "raised body limit");
        assertEquals(1_048_576, raised.maxFunctionBytes, "maximum function byte limit");
        assertEquals(
                32_768,
                GraphwarAgentConfig.parse("maxFunctionBytes=32768").maxFunctionBytes,
                "lower function byte limit");
        assertEquals(
                524_288,
                GraphwarAgentConfig.parse("maxRequestBodyBytes=524288,maxFunctionBytes=1048576")
                        .maxFunctionBytes,
                "function byte limit capped to request body");
        assertEquals(
                65_536,
                GraphwarAgentConfig.parse("maxRequestBodyBytes=16777216,maxFunctionBytes=1048577")
                        .maxFunctionBytes,
                "oversized function byte limit");
        assertEquals(4_432, raised.maxFunctionTokens, "maximum token limit");
        assertEquals(
                2_048,
                GraphwarAgentConfig.parse("maxFunctionTokens=2048").maxFunctionTokens,
                "lower token limit");
        assertEquals(
                3_072,
                GraphwarAgentConfig.parse("maxFunctionTokens=4433").maxFunctionTokens,
                "oversized token limit");
        boolean hasRejectedInvalidToken = false;
        try {
            GraphwarAgentConfig.parse("token=not valid");
        } catch (IllegalArgumentException expected) {
            hasRejectedInvalidToken = true;
        }
        assertTrue(hasRejectedInvalidToken, "invalid explicit token was accepted");
    }

    /** Creates bounded ASCII test input without relying on newer JDK String.repeat. */
    private static String repeat(char character, int count) {
        StringBuilder value = new StringBuilder(count);
        for (int index = 0; index < count; index += 1) {
            value.append(character);
        }
        return value.toString();
    }

    /** Verifies Graphwar-compatible tokens, aliases, replacements, and implicit products. */
    private static void testFunctionTokenCounting() throws Exception {
        assertEquals(1, GraphwarFunctionLimits.countTokens("x", 100), "single variable tokens");
        assertEquals(1, GraphwarFunctionLimits.countTokens("y'", 100), "original y token order");
        assertEquals(9, GraphwarFunctionLimits.countTokens("x+x*x/x^x", 100), "binary tokens");
        assertEquals(2, GraphwarFunctionLimits.countTokens("sqrt(x)", 100), "sqrt token");
        assertEquals(2, GraphwarFunctionLimits.countTokens("log(x)", 100), "log token");
        assertEquals(2, GraphwarFunctionLimits.countTokens("abs(x)", 100), "abs token");
        assertEquals(3, GraphwarFunctionLimits.countTokens("2x", 100), "implicit product tokens");
        assertEquals(
                5,
                GraphwarFunctionLimits.countTokens("2(x+1)", 100),
                "bracket implicit product tokens");
        assertEquals(
                2, GraphwarFunctionLimits.countTokens(")x", 100), "right bracket product tokens");
        assertEquals(4, GraphwarFunctionLimits.countTokens("xsin(x)", 100), "unary product tokens");
        assertEquals(2, GraphwarFunctionLimits.countTokens("sin(x)", 100), "unary tokens");
        assertEquals(2, GraphwarFunctionLimits.countTokens("sen(x)", 100), "alias tokens");
        assertEquals(3, GraphwarFunctionLimits.countTokens("tan(tg(x))", 100), "tan alias tokens");
        assertEquals(3, GraphwarFunctionLimits.countTokens("cos(ln(x))", 100), "cos ln tokens");
        assertEquals(3, GraphwarFunctionLimits.countTokens("e*pi", 100), "constant tokens");
        assertEquals(3, GraphwarFunctionLimits.countTokens("exp(x)", 100), "exp rewrite tokens");
        assertEquals(
                3, GraphwarFunctionLimits.countTokens("EXP(X)", 100), "uppercase rewrite tokens");
        assertEquals(
                7,
                GraphwarFunctionLimits.countTokens("PİPİPİX", 100),
                "Unicode lowercase expansion tokens");
        assertEquals(7, GraphwarFunctionLimits.countTokens("+++x", 100), "unary plus nodes");
        assertEquals(5, GraphwarFunctionLimits.countTokens("x+x+x", 100), "binary plus nodes");
        assertEquals(4, GraphwarFunctionLimits.countTokens("x-y", 100), "minus rewrite tokens");
        assertEquals(1, GraphwarFunctionLimits.countTokens("1,5", 100), "decimal rewrite tokens");
        assertEquals(1, GraphwarFunctionLimits.countTokens("???x???", 100), "ignored text tokens");
        assertEquals(
                1, GraphwarFunctionLimits.countTokens(" \t?x\n", 100), "ignored whitespace tokens");
        assertEquals(
                3_072,
                GraphwarFunctionLimits.countTokens(repeatedTerms("sin", "", 3_071) + "x", 3_072),
                "exact token limit");
        assertEquals(
                3_073,
                GraphwarFunctionLimits.countTokens(repeatedTerms("sin", "", 3_072) + "x", 3_072),
                "early token cutoff");

        new GraphwarFunctionLimits(3, 100).validate("界");
        new GraphwarFunctionLimits(4, 100).validate("😀");
        try {
            new GraphwarFunctionLimits(2, 100).validate("界");
            throw new AssertionError("UTF-8 byte limit was not independent from token count");
        } catch (GraphwarInvalidFunctionException expected) {
            assertEquals(
                    "Graphwar function exceeds the byte limit",
                    expected.getMessage(),
                    "UTF-8 byte rejection");
        }

        String unicodeBypass = repeatedTerms("Pİ", "", 21_845) + "X";
        try {
            new GraphwarFunctionLimits(65_536, 3_072).validate(unicodeBypass);
            throw new AssertionError("Unicode lowercase expansion bypassed the token limit");
        } catch (GraphwarInvalidFunctionException expected) {
            assertEquals(
                    "Graphwar function exceeds the token limit",
                    expected.getMessage(),
                    "Unicode expansion token rejection");
        }

        try {
            new GraphwarFunctionLimits(65_536, 3_072).validate(repeatedTerms("+", "", 3_071) + "x");
            throw new AssertionError("Unary plus nodes bypassed the token limit");
        } catch (GraphwarInvalidFunctionException expected) {
            assertEquals(
                    "Graphwar function exceeds the token limit",
                    expected.getMessage(),
                    "unary plus token rejection");
        }
    }

    /** Joins repeated terms without relying on newer JDK collection helpers. */
    private static String repeatedTerms(String term, String separator, int count) {
        StringBuilder value = new StringBuilder(count * (term.length() + separator.length()));
        for (int index = 0; index < count; index += 1) {
            if (index > 0) {
                value.append(separator);
            }
            value.append(term);
        }
        return value.toString();
    }

    /** Reads one compiled fixture class without assuming the resource length. */
    private static byte[] readClassBytes(String resourceName) throws IOException {
        try (InputStream input = GraphwarAgentApiTest.class.getResourceAsStream(resourceName)) {
            if (input == null) {
                throw new AssertionError("missing test class " + resourceName);
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int bytesRead;
            while ((bytesRead = input.read(buffer)) >= 0) {
                output.write(buffer, 0, bytesRead);
            }
            return output.toByteArray();
        }
    }

    /** Adds one current player whose public ID getter is compatible across fixture loaders. */
    private static void addTransformedCurrentPlayer(
            Class<?> gameDataClass, Object gameData, boolean isComputerPlayer) throws Exception {
        gameDataClass
                .getMethod("addPlayer", Player.class)
                .invoke(
                        gameData,
                        isComputerPlayer
                                ? new ComputerPlayer(new GameData(), 7, "Inbound", 1, false, 1)
                                : new Player(
                                        new GameData(), 7, "Inbound", 1, false, false, 1, false));
    }

    /** Builds one exact v3 shot payload with a stable caller-generated request ID. */
    private static String createV3ShotBody(
            String requestId,
            String gameInstanceId,
            String turnToken,
            String battleRevision,
            String function,
            String angleRadians) {
        return "{\"requestId\":\""
                + requestId
                + "\",\"gameInstanceId\":\""
                + gameInstanceId
                + "\",\"function\":\""
                + function
                + "\",\"turnToken\":\""
                + turnToken
                + "\",\"battleRevision\":\""
                + battleRevision
                + "\""
                + (angleRadians == null ? "" : ",\"angleRadians\":" + angleRadians)
                + "}";
    }

    /** Builds the exact mixed-ownership pre-game room used by room assertions. */
    private static void configureRoom(GameData gameData) {
        gameData.clearPlayers();
        gameData.setObstacle(null);
        gameData.setGameMode(2);
        gameData.setGameState(1);
        gameData.setLeader(true);
        gameData.addPlayer(new Player(gameData, 7, "Local \"Human\"", 1, true, false, 2, false));
        gameData.addPlayer(new ComputerPlayer(gameData, 8, "Local CPU", 2, true, 3));
        gameData.addPlayer(new Player(gameData, 9, "Remote\nPlayer", 2, false, true, 4, true));
    }

    /** Builds an active multi-local, multi-team match with one blocked world cell. */
    private static void configureActiveMatch(GameData gameData) {
        gameData.clearPlayers();
        gameData.addPlayer(new Player(gameData, 7, "Local Human", 1, true, false, 2, false));
        gameData.addPlayer(new ComputerPlayer(gameData, 8, "Local CPU", 2, true, 2));
        gameData.addPlayer(new Player(gameData, 9, "Remote", 2, false, true, 2, false));
        Obstacle obstacle = new Obstacle();
        obstacle.setBlocked(5, 6, true);
        gameData.setObstacle(obstacle);
        gameData.setCurrentTurn(0);
        gameData.setDrawingFunction(false);
        gameData.setExploding(false);
        gameData.setGameMode(0);
        gameData.setGameState(2);
        gameData.setRemainingTime(57_000L);
        gameData.setTerrainReversed(true);
        gameData.setTimeTurnStarted(1_000L);
    }

    /** Extracts one unescaped opaque string field from a JSON response. */
    private static String extractJsonString(String json, String field) {
        String marker = "\"" + field + "\":\"";
        int start = json.indexOf(marker);
        if (start < 0) {
            throw new AssertionError("missing JSON field " + field + ": " + json);
        }
        start += marker.length();
        int end = json.indexOf('"', start);
        if (end < 0) {
            throw new AssertionError("unterminated JSON field " + field + ": " + json);
        }
        return json.substring(start, end);
    }

    /** Sends one local HTTP request and retains its binary body and relevant headers. */
    private static HttpResponse request(
            int port, String method, String path, String body, String contentType)
            throws IOException {
        return requestWithHeader(port, method, path, body, contentType, null, null);
    }

    /** Sends one request with an optional contract header such as If-Match. */
    private static HttpResponse requestWithHeader(
            int port,
            String method,
            String path,
            String body,
            String contentType,
            String headerName,
            String headerValue)
            throws IOException {
        HttpURLConnection connection =
                (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(10_000);
        connection.setRequestMethod(method);
        connection.setUseCaches(false);
        if (headerName != null && headerValue != null) {
            connection.setRequestProperty(headerName, headerValue);
        }
        if (body != null) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(bytes.length);
            connection.setRequestProperty("Content-Type", contentType + "; charset=utf-8");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }

        int status = connection.getResponseCode();
        String entityTag = connection.getHeaderField("ETag");
        String exposedHeaders = connection.getHeaderField("Access-Control-Expose-Headers");
        String location = connection.getHeaderField("Location");
        String retryAfter = connection.getHeaderField("Retry-After");
        InputStream input =
                status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (input != null) {
            try (InputStream closeableInput = input) {
                byte[] buffer = new byte[4096];
                int bytesRead;
                while ((bytesRead = closeableInput.read(buffer)) >= 0) {
                    output.write(buffer, 0, bytesRead);
                }
            }
        }
        connection.disconnect();
        return new HttpResponse(
                status, output.toByteArray(), entityTag, exposedHeaders, location, retryAfter);
    }

    /** Polls one command resource until the expected terminal status is observable. */
    private static String waitForCommandStatus(int port, String requestId, String expectedStatus)
            throws IOException, InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5L);
        String body;
        do {
            HttpResponse response = request(port, "GET", "/shots/" + requestId, null, null);
            assertEquals(200, response.status, "polled command status");
            body = response.bodyText();
            if (body.contains("\"status\":\"" + expectedStatus + "\"")) {
                return body;
            }
            if (body.contains("\"status\":\"submitted\"")
                    || body.contains("\"status\":\"failed\"")
                    || body.contains("\"status\":\"unknown\"")) {
                throw new AssertionError(
                        "command reached an unexpected terminal status; expected "
                                + expectedStatus
                                + ": "
                                + body);
            }
            Thread.sleep(10L);
        } while (System.nanoTime() < deadline);
        throw new AssertionError(
                "command did not reach status " + expectedStatus + " before timeout: " + body);
    }

    /** Verifies a UTF-8 response status and body together for clearer failures. */
    private static void assertResponse(
            HttpResponse response, int expectedStatus, String expectedBody, String message) {
        assertEquals(expectedStatus, response.status, message + " status");
        assertEquals(expectedBody, response.bodyText(), message + " body");
    }

    /** Verifies that a larger value contains one exact contract fragment. */
    private static void assertContains(String actual, String expected, String message) {
        if (actual == null || !actual.contains(expected)) {
            throw new AssertionError(
                    message + ": expected fragment " + expected + ", got " + actual);
        }
    }

    /** Verifies equality while retaining both values in the assertion message. */
    private static void assertEquals(Object expected, Object actual, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }

    /** Verifies inequality while retaining the repeated value in the assertion message. */
    private static void assertNotEquals(Object first, Object second, String message) {
        if (first.equals(second)) {
            throw new AssertionError(message + ": both values were " + first);
        }
    }

    /** Verifies one boolean invariant. */
    private static void assertTrue(boolean isConditionMet, String message) {
        if (!isConditionMet) {
            throw new AssertionError(message);
        }
    }

    /** Binary-safe local HTTP response used by all assertions. */
    private static final class HttpResponse {
        final String battleRevision;
        final byte[] body;
        final String entityTag;
        final String exposedHeaders;
        final String location;
        final String retryAfter;
        final int status;

        /** Captures one completed local HTTP exchange. */
        HttpResponse(
                int status,
                byte[] body,
                String entityTag,
                String exposedHeaders,
                String location,
                String retryAfter) {
            this.battleRevision = entityTag == null ? null : entityTag.replace("\"", "");
            this.body = body;
            this.entityTag = entityTag;
            this.exposedHeaders = exposedHeaders;
            this.location = location;
            this.retryAfter = retryAfter;
            this.status = status;
        }

        /** Decodes text endpoints without corrupting binary mask assertions. */
        String bodyText() {
            return new String(body, StandardCharsets.UTF_8);
        }
    }

    /** Defines transformed fixtures without delegating their name to the parent loader. */
    private static final class TransformedClassLoader extends ClassLoader {
        /** Defines one already transformed class under its original binary name. */
        Class<?> define(String className, byte[] bytes) {
            return defineClass(className, bytes, 0, bytes.length);
        }
    }
}
