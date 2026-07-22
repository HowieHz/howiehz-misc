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
        testOutOfOrderStateObservation();
        testEquivalentFractionFunction();
        testGraphPlaneAlphaClamp();
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
        byte[] originalClass;
        try (InputStream input =
                GraphwarAgentApiTest.class.getResourceAsStream("/Graphwar/GraphPlane.class")) {
            if (input == null) {
                throw new AssertionError("missing Graphwar.GraphPlane test class");
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int bytesRead;
            while ((bytesRead = input.read(buffer)) >= 0) {
                output.write(buffer, 0, bytesRead);
            }
            originalClass = output.toByteArray();
        }

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

    /** Verifies the v3 wire contract, idempotent commands, conditions, and renamed fields. */
    private static void testV3HttpContract(
            int port, GameData gameData, Graphwar graphwar, GraphwarStateReader stateReader)
            throws Exception {
        String health = request(port, "GET", "/health", null, null).bodyText();
        assertContains(health, "\"apiVersion\":3", "health API version");
        assertContains(health, "\"version\":\"2.0.0\"", "Agent version");
        assertContains(health, "\"isAuthenticationRequired\":false", "health auth flag");

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
        assertContains(stateBody, "\"isAvailable\":true", "state availability");
        assertContains(
                stateBody,
                "\"capabilities\":{\"canSubmitShots\":true,\"canReadRoom\":true,"
                        + "\"canSetReady\":true,\"canReadWorldObstacleMask\":true}",
                "v3 capabilities");
        assertContains(stateBody, "\"equationMode\":\"y\"", "equation mode");
        assertContains(stateBody, "\"currentPlayerIndex\":0", "current player index");
        assertContains(stateBody, "\"currentPlayerId\":7", "current player ID");
        assertContains(stateBody, "\"isTerrainReversed\":true", "orientation");
        assertContains(stateBody, "\"playerIndex\":0,\"playerId\":7", "player identity");
        assertContains(stateBody, "\"isConnected\":true", "connection state");
        assertContains(stateBody, "\"soldierIndex\":0,\"isAlive\":true", "soldier state");
        assertContains(stateBody, "\"shotCommand\":null", "empty shot summary");

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
                428,
                request(port, "GET", "/obstacle-masks/world.bin", null, null).status,
                "missing If-Match");

        String gameInstanceId = extractJsonString(stateBody, "gameInstanceId");
        String turnToken = extractJsonString(stateBody, "turnToken");
        String shotBody =
                createV3ShotBody(REQUEST_ID, gameInstanceId, turnToken, revision, "x", null);
        gameData.clearShotCalls();
        HttpResponse created = request(port, "POST", "/shots", shotBody, "application/json");
        assertEquals(201, created.status, "created command status");
        assertContains(created.bodyText(), "\"status\":\"submitted\"", "submitted command");
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
        assertContains(usedToken.bodyText(), "\"status\":\"failed\"", "failed command");
        assertContains(usedToken.bodyText(), "\"code\":\"turn-token-used\"", "stable error code");

        testStuckShotRecoveryAndLedgerBound(port, gameData);
        String unknownRequestId = testUnknownAfterClaim(port, gameData);
        testNewGameCleanupWithoutTurnToken(port, gameData, unknownRequestId);

        gameData.setGameState(1);
        assertContains(
                request(port, "GET", "/state", null, null).bodyText(),
                "\"isAvailable\":false",
                "unavailable state");
        graphwar.setGameData(null);
        assertEquals(
                "{\"isAvailable\":false,\"reason\":\"game-data-not-initialized\"}",
                stateReader.readRoomJson(),
                "missing GameData room");
    }

    /** Verifies concurrent replay, a stuck single slot, busy failures, and 50-record eviction. */
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
        gameData.setFunctionBlocked(true);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        Future<HttpResponse> first =
                executor.submit(() -> request(port, "POST", "/shots", body, "application/json"));
        try {
            assertTrue(
                    gameData.awaitFunctionCall(2, TimeUnit.SECONDS),
                    "shot worker did not enter the blocked original call");
            HttpResponse replay = request(port, "POST", "/shots", body, "application/json");
            assertEquals(200, replay.status, "concurrent replay status");
            assertContains(replay.bodyText(), "\"status\":\"claimed\"", "concurrent replay state");

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
            HttpResponse timedOut = first.get(7, TimeUnit.SECONDS);
            assertEquals(201, timedOut.status, "timed-out initial command status");
            assertContains(
                    timedOut.bodyText(), "\"status\":\"claimed\"", "timed-out command state");

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
                gameData.setFunctionBlocked(false);
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
            gameData.setFunctionBlocked(false);
            executor.shutdownNow();
        }

        long deadline = System.currentTimeMillis() + 2_000L;
        String completed;
        do {
            completed = request(port, "GET", "/shots/" + activeRequestId, null, null).bodyText();
            if (completed.contains("\"status\":\"submitted\"")) {
                return;
            }
            Thread.sleep(10L);
        } while (System.currentTimeMillis() < deadline);
        throw new AssertionError("released blocked command did not become submitted: " + completed);
    }

    /** Verifies that an exception after claim is retained as unknown rather than retried. */
    private static String testUnknownAfterClaim(int port, GameData gameData) throws IOException {
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
            assertContains(response.bodyText(), "\"status\":\"unknown\"", "unknown command status");
            assertContains(
                    response.bodyText(), "\"code\":\"graphwar-call-failed\"", "unknown error code");
            return requestId;
        } finally {
            gameData.setShouldThrowFromFunction(false);
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
        GraphwarAgentConfig config = GraphwarAgentConfig.forTest(0, 0, 1_024, "secret");
        GraphwarStateReader stateReader = new GraphwarStateReader(config, () -> graphwar);
        GraphwarShotCommandStore commands = new GraphwarShotCommandStore(stateReader);
        stateReader.setShotCommands(commands);
        GraphwarHttpServer server = GraphwarHttpServer.start(config, stateReader, commands);
        try {
            String health = request(server.getPort(), "GET", "/health", null, null).bodyText();
            assertContains(health, "\"isAuthenticationRequired\":true", "authenticated health");
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
                        "maxRequestBodyBytes=16777216,maxFunctionBytes=1048576,"
                                + "maxFunctionNestingDepth=4096");
        assertEquals(16_777_216, raised.maxRequestBodyBytes, "raised body limit");
        assertEquals(1_048_576, raised.maxFunctionBytes, "raised function limit");
        assertEquals(4_096, raised.maxFunctionNestingDepth, "raised nesting limit");
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
        // The v3 shot endpoint deliberately waits up to five seconds before returning claimed.
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
        return new HttpResponse(status, output.toByteArray(), entityTag, exposedHeaders);
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
    private static void assertTrue(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    /** Binary-safe local HTTP response used by all assertions. */
    private static final class HttpResponse {
        final String battleRevision;
        final byte[] body;
        final String entityTag;
        final String exposedHeaders;
        final int status;

        /** Captures one completed local HTTP exchange. */
        HttpResponse(int status, byte[] body, String entityTag, String exposedHeaders) {
            this.battleRevision = entityTag == null ? null : entityTag.replace("\"", "");
            this.body = body;
            this.entityTag = entityTag;
            this.exposedHeaders = exposedHeaders;
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
