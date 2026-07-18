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
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** Dependency-free regression tests for the complete localhost API contract. */
public final class GraphwarAgentApiTest {
    /** Prevents construction of the test entry-point class. */
    private GraphwarAgentApiTest() {}

    /** Runs every assertion and exits nonzero when any API contract regresses. */
    public static void main(String[] arguments) throws Exception {
        testShotJsonParser();
        testEquivalentFractionFunction();
        testGraphPlaneAlphaClamp();
        GameData gameData = new GameData();
        configureRoom(gameData);
        Graphwar graphwar = new Graphwar(gameData);
        GraphwarStateReader stateReader = new GraphwarStateReader(() -> graphwar);
        GraphwarHttpServer server = GraphwarHttpServer.start(0, 0, stateReader);
        try {
            testRoomSnapshot(server.getPort(), gameData);
            testReadyRequests(server.getPort(), gameData);
            testConcurrentReadyRequests(server.getPort(), gameData);
            configureActiveMatch(gameData);
            testActiveStateAndObstacleRevision(server.getPort(), gameData);
            testShotValidationAndModes(server.getPort(), gameData);
            testConcurrentShotClaim(server.getPort(), gameData);
            testAvailabilityAndRemovedRoute(server.getPort(), gameData, graphwar, stateReader);
        } finally {
            server.stop();
        }

        System.out.println("graphwar-agent API tests passed");
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
                        "{\"function\":\"x\\u002b1\",\"turnToken\":\"turn\","
                                + "\"battleRevision\":\"revision\",\"angleRadians\":-2.5e-1}");
        assertEquals("x+1", parsed.function, "unicode shot function");
        assertEquals("turn", parsed.turnToken, "parsed turn token");
        assertEquals("revision", parsed.battleRevision, "parsed battle revision");
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

    /** Verifies that opposite concurrent requests remain contiguous ready batches. */
    private static void testConcurrentReadyRequests(int port, GameData gameData) throws Exception {
        gameData.clearReadyCalls();
        gameData.setConcurrentReadyBarrier(true);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<HttpResponse> readyTrue =
                executor.submit(
                        () -> {
                            start.await();
                            return request(port, "POST", "/ready", "true", "text/plain");
                        });
        Future<HttpResponse> readyFalse =
                executor.submit(
                        () -> {
                            start.await();
                            return request(port, "POST", "/ready", "false", "text/plain");
                        });

        try {
            start.countDown();
            assertResponse(
                    readyTrue.get(5, TimeUnit.SECONDS),
                    200,
                    "{\"ok\":true,\"requestedReady\":true}\n",
                    "concurrent ready true");
            assertResponse(
                    readyFalse.get(5, TimeUnit.SECONDS),
                    200,
                    "{\"ok\":true,\"requestedReady\":false}\n",
                    "concurrent ready false");

            List<String> calls = gameData.getReadyCalls();
            assertTrue(
                    calls.equals(Arrays.asList("7:true", "8:true", "7:false", "8:false"))
                            || calls.equals(
                                    Arrays.asList("7:false", "8:false", "7:true", "8:true")),
                    "concurrent ready batches interleaved: " + calls);
        } finally {
            gameData.setConcurrentReadyBarrier(false);
            executor.shutdownNow();
        }
    }

    /** Verifies the exact room schema, JSON escaping, tri-state computer flag, and lock. */
    private static void testRoomSnapshot(int port, GameData gameData) throws IOException {
        gameData.setLockRequired(true);
        HttpResponse response;
        try {
            response = request(port, "GET", "/room", null, null);
        } finally {
            gameData.setLockRequired(false);
        }

        assertEquals(200, response.status, "room status");
        assertEquals(
                "{\"available\":true,\"gameState\":1,\"gameMode\":2,\"leader\":true,"
                        + "\"players\":[{\"index\":0,\"id\":7,\"name\":\"Local \\\"Human\\\"\","
                        + "\"team\":1,\"local\":true,\"computer\":false,\"ready\":false,"
                        + "\"numSoldiers\":2,\"disconnected\":false},{\"index\":1,\"id\":8,"
                        + "\"name\":\"Local CPU\",\"team\":2,\"local\":true,\"computer\":true,"
                        + "\"ready\":true,\"numSoldiers\":3,\"disconnected\":false},{\"index\":2,"
                        + "\"id\":9,\"name\":\"Remote\\nPlayer\",\"team\":2,\"local\":false,"
                        + "\"computer\":null,\"ready\":true,\"numSoldiers\":4,"
                        + "\"disconnected\":true}]}",
                response.bodyText(),
                "room body");
    }

    /** Verifies strict ready bodies and original-button-equivalent calls. */
    private static void testReadyRequests(int port, GameData gameData) throws IOException {
        assertResponse(
                request(port, "POST", "/ready", "true", "text/plain"),
                200,
                "{\"ok\":true,\"requestedReady\":true}\n",
                "ready true");
        assertEquals(
                Arrays.asList("7:true", "8:true"), gameData.getReadyCalls(), "ready true calls");

        gameData.clearReadyCalls();
        assertResponse(
                request(port, "POST", "/ready", "false", "text/plain"),
                200,
                "{\"ok\":true,\"requestedReady\":false}\n",
                "ready false");
        assertEquals(
                Arrays.asList("7:false", "8:false"), gameData.getReadyCalls(), "ready false calls");

        for (String body : Arrays.asList("", "TRUE", " true", "false\n", "{\"ready\":true}")) {
            gameData.clearReadyCalls();
            assertResponse(
                    request(port, "POST", "/ready", body, "text/plain"),
                    400,
                    "ready body must be exactly true or false\n",
                    "invalid ready body");
            assertEquals(Collections.emptyList(), gameData.getReadyCalls(), "invalid ready calls");
        }
    }

    /** Verifies snapshot metadata, ownership, world coordinates, locks, and mask headers. */
    private static void testActiveStateAndObstacleRevision(int port, GameData gameData)
            throws IOException {
        assertResponse(
                request(port, "GET", "/room", null, null),
                200,
                "{\"available\":false,\"reason\":\"not-in-pre-game-room\"}",
                "active game room");
        assertEquals(
                409,
                request(port, "POST", "/ready", "true", "text/plain").status,
                "active game ready");
        gameData.setLockRequired(true);
        HttpResponse state;
        HttpResponse worldMask;
        try {
            state = request(port, "GET", "/state", null, null);
            worldMask = request(port, "GET", "/obstacle-mask.bin?space=world", null, null);
        } finally {
            gameData.setLockRequired(false);
        }

        assertEquals(200, state.status, "active state status");
        String body = state.bodyText();
        assertContains(body, "\"apiVersion\":2", "API version");
        assertContains(
                body,
                "\"capabilities\":{\"shot\":true,\"room\":true,\"ready\":true,"
                        + "\"worldObstacleMask\":true}",
                "capabilities");
        assertContains(body, "\"remainingTurnMs\":57000", "remaining turn time");
        assertContains(body, "\"phase\":\"aiming\"", "aiming phase");
        assertContains(body, "\"currentTurnPlayerId\":7", "current player ID");
        assertContains(body, "\"playerId\":7", "player ID alias");
        assertContains(body, "\"team\":1,\"name\":\"Local Human\"", "player team");
        assertContains(body, "\"ready\":false", "active ready state");
        assertContains(body, "\"soldierIndex\":0", "soldier index alias");
        assertContains(body, "\"world\":{\"pixel\":{\"x\":107,\"y\":200}", "world coordinates");
        assertContains(body, "\"view\":{\"pixel\":{\"x\":663,\"y\":200}", "view coordinates");

        String revision = extractJsonString(body, "battleRevision");
        String turnToken = extractJsonString(body, "turnToken");
        String gameInstanceId = extractJsonString(body, "gameInstanceId");
        assertTrue(revision.startsWith("sha256:"), "battle revision algorithm");
        assertTrue(!turnToken.isEmpty(), "turn token");
        assertTrue(!gameInstanceId.isEmpty(), "game instance ID");
        assertEquals(770 * 450, worldMask.body.length, "world mask size");
        assertEquals(1, worldMask.body[6 * 770 + 5] & 0xff, "world blocked cell");
        assertEquals(revision, worldMask.battleRevision, "world mask response revision");
        assertContains(
                worldMask.exposedHeaders, "X-Graphwar-Battle-Revision", "exposed revision header");

        gameData.getObstacle().setBlocked(6, 6, true);
        String changedState = request(port, "GET", "/state", null, null).bodyText();
        String changedRevision = extractJsonString(changedState, "battleRevision");
        assertNotEquals(revision, changedRevision, "terrain mutation revision");
        assertEquals(
                turnToken,
                extractJsonString(changedState, "turnToken"),
                "terrain mutation must not change turn identity");

        byte[] unchangedWorldMask =
                request(port, "GET", "/obstacle-mask.bin?space=world", null, null).body;
        gameData.setTerrainReversed(false);
        String orientationState = request(port, "GET", "/state", null, null).bodyText();
        assertNotEquals(
                changedRevision,
                extractJsonString(orientationState, "battleRevision"),
                "view orientation revision");
        assertTrue(
                Arrays.equals(
                        unchangedWorldMask,
                        request(port, "GET", "/obstacle-mask.bin?space=world", null, null).body),
                "view orientation must not change world mask bytes");
        assertEquals(
                turnToken,
                extractJsonString(orientationState, "turnToken"),
                "view orientation must not change turn identity");

        gameData.setTimeTurnStarted(1_001L);
        String nextTurnState = request(port, "GET", "/state", null, null).bodyText();
        assertNotEquals(turnToken, extractJsonString(nextTurnState, "turnToken"), "new turn token");
        assertEquals(
                gameInstanceId,
                extractJsonString(nextTurnState, "gameInstanceId"),
                "same game instance");

        gameData.setObstacle(new Obstacle());
        String nextGameState = request(port, "GET", "/state", null, null).bodyText();
        assertNotEquals(
                gameInstanceId,
                extractJsonString(nextGameState, "gameInstanceId"),
                "new obstacle identifies a new game");
    }

    /** Verifies JSON strictness, all angle rules, stale guards, and side-effect ordering. */
    private static void testShotValidationAndModes(int port, GameData gameData) throws IOException {
        gameData.setTerrainReversed(false);
        gameData.setCurrentTurn(0);
        gameData.setGameMode(0);
        gameData.setDrawingFunction(false);
        gameData.setExploding(false);
        gameData.setRemainingTime(57_000L);

        ShotContext normal = readFreshShotContext(port, gameData, 2_000L);
        assertEquals(
                400,
                request(port, "POST", "/shot", shotBody("x", normal, "0.25"), "application/json")
                        .status,
                "normal mode angle");
        assertEquals(
                400,
                request(
                                port,
                                "POST",
                                "/shot",
                                "{\"function\":\"x\",\"turnToken\":\""
                                        + normal.turnToken
                                        + "\",\"battleRevision\":\""
                                        + normal.battleRevision
                                        + "\",\"typo\":1}",
                                "application/json")
                        .status,
                "unknown shot field");
        gameData.clearShotCalls();
        assertResponse(
                request(port, "POST", "/shot", shotBody("x", normal, null), "application/json"),
                200,
                "{\"ok\":true}\n",
                "normal shot");
        assertEquals(
                Collections.singletonList("function:x"),
                gameData.getShotCalls(),
                "normal shot calls");
        assertEquals(
                409,
                request(port, "POST", "/shot", shotBody("x", normal, null), "application/json")
                        .status,
                "duplicate turn token");
        assertEquals(1, gameData.getShotCalls().size(), "duplicate shot effects");

        ShotContext malformed = readFreshShotContext(port, gameData, 2_001L);
        assertEquals(
                400,
                request(port, "POST", "/shot", shotBody("bad", malformed, null), "application/json")
                        .status,
                "malformed function");
        assertEquals(
                200,
                request(port, "POST", "/shot", shotBody("x+1", malformed, null), "application/json")
                        .status,
                "corrected function keeps claim available");

        gameData.setGameMode(1);
        ShotContext firstDerivative = readFreshShotContext(port, gameData, 2_002L);
        assertEquals(
                400,
                request(
                                port,
                                "POST",
                                "/shot",
                                shotBody("y", firstDerivative, "0"),
                                "application/json")
                        .status,
                "first derivative angle");

        gameData.setGameMode(2);
        ShotContext secondDerivative = readFreshShotContext(port, gameData, 2_003L);
        assertEquals(
                400,
                request(
                                port,
                                "POST",
                                "/shot",
                                shotBody("x", secondDerivative, null),
                                "application/json")
                        .status,
                "missing second derivative angle");
        assertEquals(
                400,
                request(
                                port,
                                "POST",
                                "/shot",
                                shotBody("x", secondDerivative, "1e309"),
                                "application/json")
                        .status,
                "infinite angle");
        assertEquals(
                400,
                request(
                                port,
                                "POST",
                                "/shot",
                                shotBody("x", secondDerivative, "1.5709"),
                                "application/json")
                        .status,
                "out-of-range angle");
        gameData.clearShotCalls();
        assertEquals(
                200,
                request(
                                port,
                                "POST",
                                "/shot",
                                shotBody("x", secondDerivative, "0.25"),
                                "application/json")
                        .status,
                "second derivative shot");
        assertEquals(
                Arrays.asList("angle:0.25", "function:x"),
                gameData.getShotCalls(),
                "angle before function");

        gameData.setGameMode(0);
        ShotContext staleTurn = readFreshShotContext(port, gameData, 2_004L);
        gameData.setTimeTurnStarted(2_005L);
        assertEquals(
                409,
                request(port, "POST", "/shot", shotBody("x", staleTurn, null), "application/json")
                        .status,
                "stale turn token");

        ShotContext staleBattle = readFreshShotContext(port, gameData, 2_006L);
        gameData.getObstacle().setBlocked(10, 10, true);
        assertEquals(
                409,
                request(port, "POST", "/shot", shotBody("x", staleBattle, null), "application/json")
                        .status,
                "stale battle revision");

        gameData.setCurrentTurn(2);
        ShotContext remoteTurn = readFreshShotContext(port, gameData, 2_007L);
        assertEquals(
                409,
                request(port, "POST", "/shot", shotBody("x", remoteTurn, null), "application/json")
                        .status,
                "remote turn");

        gameData.setCurrentTurn(1);
        ShotContext computerTurn = readFreshShotContext(port, gameData, 2_008L);
        assertEquals(
                409,
                request(
                                port,
                                "POST",
                                "/shot",
                                shotBody("x", computerTurn, null),
                                "application/json")
                        .status,
                "local computer turn");

        gameData.setCurrentTurn(0);
        gameData.setDrawingFunction(true);
        ShotContext drawing = readFreshShotContext(port, gameData, 2_009L);
        assertContains(drawing.stateBody, "\"phase\":\"drawing\"", "drawing phase");
        assertEquals(
                409,
                request(port, "POST", "/shot", shotBody("x", drawing, null), "application/json")
                        .status,
                "drawing conflict");
        gameData.setDrawingFunction(false);

        gameData.setExploding(true);
        ShotContext exploding = readFreshShotContext(port, gameData, 2_010L);
        assertContains(exploding.stateBody, "\"phase\":\"exploding\"", "exploding phase");
        gameData.setExploding(false);

        gameData.setRemainingTime(0L);
        ShotContext expired = readFreshShotContext(port, gameData, 2_011L);
        assertEquals(
                409,
                request(port, "POST", "/shot", shotBody("x", expired, null), "application/json")
                        .status,
                "expired turn");
        gameData.setRemainingTime(57_000L);
    }

    /** Verifies that two simultaneous requests can consume a turn token only once. */
    private static void testConcurrentShotClaim(int port, GameData gameData) throws Exception {
        gameData.setCurrentTurn(0);
        gameData.setGameMode(0);
        gameData.setDrawingFunction(false);
        gameData.setExploding(false);
        gameData.clearShotCalls();
        ShotContext context = readFreshShotContext(port, gameData, 3_000L);
        String body = shotBody("x", context, null);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<HttpResponse> first =
                    executor.submit(
                            () -> {
                                start.await();
                                return request(port, "POST", "/shot", body, "application/json");
                            });
            Future<HttpResponse> second =
                    executor.submit(
                            () -> {
                                start.await();
                                return request(port, "POST", "/shot", body, "application/json");
                            });
            start.countDown();
            int firstStatus = first.get(5, TimeUnit.SECONDS).status;
            int secondStatus = second.get(5, TimeUnit.SECONDS).status;
            assertTrue(
                    (firstStatus == 200 && secondStatus == 409)
                            || (firstStatus == 409 && secondStatus == 200),
                    "concurrent shot statuses: " + firstStatus + ", " + secondStatus);
            assertEquals(
                    Collections.singletonList("function:x"),
                    gameData.getShotCalls(),
                    "concurrent shot effects");
        } finally {
            executor.shutdownNow();
        }
    }

    /** Verifies polling reasons, guards, metadata, and removal of the old route. */
    private static void testAvailabilityAndRemovedRoute(
            int port, GameData gameData, Graphwar graphwar, GraphwarStateReader stateReader)
            throws Exception {
        gameData.setGameState(1);
        assertResponse(
                request(port, "GET", "/room", null, null),
                200,
                "{\"available\":true,\"gameState\":1,\"gameMode\":0,\"leader\":true,"
                        + "\"players\":[{\"index\":0,\"id\":7,\"name\":\"Local Human\","
                        + "\"team\":1,\"local\":true,\"computer\":false,\"ready\":false,"
                        + "\"numSoldiers\":2,\"disconnected\":false},{\"index\":1,\"id\":8,"
                        + "\"name\":\"Local CPU\",\"team\":2,\"local\":true,\"computer\":true,"
                        + "\"ready\":true,\"numSoldiers\":2,\"disconnected\":false},{\"index\":2,"
                        + "\"id\":9,\"name\":\"Remote\",\"team\":2,\"local\":false,"
                        + "\"computer\":null,\"ready\":true,\"numSoldiers\":2,"
                        + "\"disconnected\":false}]}",
                "pre-game room after match");
        assertResponse(request(port, "GET", "/health", null, null), 200, "ok\n", "health");
        String unavailableState = request(port, "GET", "/state", null, null).bodyText();
        assertContains(unavailableState, "\"apiVersion\":2", "unavailable API version");
        assertContains(
                unavailableState, "\"reason\":\"game-not-started\"", "unavailable state reason");
        assertEquals(
                409,
                request(port, "GET", "/obstacle-mask.bin", null, null).status,
                "unavailable obstacle route");
        assertEquals(
                404,
                request(port, "POST", "/function", "x", "text/plain").status,
                "removed function route");

        gameData.clearPlayers();
        gameData.addPlayer(new Player(gameData, 9, "Remote", 2, false, false, 2, false));
        assertEquals(200, request(port, "GET", "/room", null, null).status, "room without locals");
        assertEquals(
                409,
                request(port, "POST", "/ready", "true", "text/plain").status,
                "ready without locals");

        graphwar.setGameData(null);
        assertEquals(
                "{\"available\":false,\"reason\":\"game-data-not-initialized\"}",
                stateReader.readRoomJson(),
                "missing GameData");
        assertEquals(
                "{\"available\":false,\"reason\":\"graphwar-window-not-found\"}",
                new GraphwarStateReader(() -> null).readRoomJson(),
                "missing Graphwar window");
    }

    /** Starts a fresh fake turn and captures the safety values from its state response. */
    private static ShotContext readFreshShotContext(int port, GameData gameData, long turnStartedAt)
            throws IOException {
        gameData.setTimeTurnStarted(turnStartedAt);
        String stateBody = request(port, "GET", "/state", null, null).bodyText();
        return new ShotContext(
                extractJsonString(stateBody, "turnToken"),
                extractJsonString(stateBody, "battleRevision"),
                stateBody);
    }

    /** Builds the strict shot request while keeping angle JSON numeric. */
    private static String shotBody(String function, ShotContext context, String angleRadians) {
        return "{\"function\":\""
                + function
                + "\",\"turnToken\":\""
                + context.turnToken
                + "\",\"battleRevision\":\""
                + context.battleRevision
                + "\""
                + (angleRadians == null ? "" : ",\"angleRadians\":" + angleRadians)
                + "}";
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
        HttpURLConnection connection =
                (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        connection.setRequestMethod(method);
        connection.setUseCaches(false);
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
        String battleRevision = connection.getHeaderField("X-Graphwar-Battle-Revision");
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
        return new HttpResponse(status, output.toByteArray(), battleRevision, exposedHeaders);
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
        final String exposedHeaders;
        final int status;

        /** Captures one completed local HTTP exchange. */
        HttpResponse(int status, byte[] body, String battleRevision, String exposedHeaders) {
            this.battleRevision = battleRevision;
            this.body = body;
            this.exposedHeaders = exposedHeaders;
            this.status = status;
        }

        /** Decodes text endpoints without corrupting binary mask assertions. */
        String bodyText() {
            return new String(body, StandardCharsets.UTF_8);
        }
    }

    /** Safety values read from one exact state snapshot. */
    private static final class ShotContext {
        final String battleRevision;
        final String stateBody;
        final String turnToken;

        /** Captures the values a caller must echo to POST /shot. */
        ShotContext(String turnToken, String battleRevision, String stateBody) {
            this.battleRevision = battleRevision;
            this.stateBody = stateBody;
            this.turnToken = turnToken;
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
