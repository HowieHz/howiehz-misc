package top.howiehz.graphwar.agent;

import Graphwar.ComputerPlayer;
import Graphwar.GameData;
import Graphwar.Graphwar;
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

/** Dependency-free regression tests for room state and ready HTTP control. */
public final class GraphwarAgentApiTest {
    /** Prevents construction of the test entry-point class. */
    private GraphwarAgentApiTest() {}

    /** Runs every assertion and exits nonzero when any API contract regresses. */
    public static void main(String[] arguments) throws Exception {
        GameData gameData = new GameData();
        gameData.setGameMode(2);
        gameData.setGameState(1);
        gameData.setLeader(true);
        gameData.addPlayer(new Player(gameData, 7, "Local \"Human\"", 1, true, false, 2, false));
        gameData.addPlayer(new ComputerPlayer(gameData, 8, "Local CPU", 2, true, 3));
        gameData.addPlayer(new Player(gameData, 9, "Remote\nPlayer", 2, false, true, 4, true));

        Graphwar graphwar = new Graphwar(gameData);
        GraphwarStateReader stateReader = new GraphwarStateReader(() -> graphwar);
        GraphwarHttpServer server = GraphwarHttpServer.start(0, 0, stateReader);
        try {
            testRoomSnapshot(server.getPort(), gameData);
            testReadyRequests(server.getPort(), gameData);
            testConcurrentReadyRequests(server.getPort(), gameData);
            testAvailabilityAndExistingRoutes(server.getPort(), gameData, graphwar, stateReader);
        } finally {
            server.stop();
        }

        System.out.println("graphwar-agent API tests passed");
    }

    /** Verifies that opposite concurrent HTTP requests remain contiguous ready batches. */
    private static void testConcurrentReadyRequests(int port, GameData gameData) throws Exception {
        gameData.clearReadyCalls();
        gameData.setConcurrentReadyBarrier(true);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<HttpResponse> readyTrue =
                executor.submit(
                        () -> {
                            start.await();
                            return request(port, "POST", "/ready", "true");
                        });
        Future<HttpResponse> readyFalse =
                executor.submit(
                        () -> {
                            start.await();
                            return request(port, "POST", "/ready", "false");
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
        HttpResponse response = request(port, "GET", "/room", null);
        gameData.setLockRequired(false);

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
                response.body,
                "room body");
    }

    /** Verifies strict bodies and original-button-equivalent calls for every local player. */
    private static void testReadyRequests(int port, GameData gameData) throws IOException {
        assertResponse(
                request(port, "POST", "/ready", "true"),
                200,
                "{\"ok\":true,\"requestedReady\":true}\n",
                "ready true");
        assertEquals(
                Arrays.asList("7:true", "8:true"), gameData.getReadyCalls(), "ready true calls");

        gameData.clearReadyCalls();
        assertResponse(
                request(port, "POST", "/ready", "false"),
                200,
                "{\"ok\":true,\"requestedReady\":false}\n",
                "ready false");
        assertEquals(
                Arrays.asList("7:false", "8:false"), gameData.getReadyCalls(), "ready false calls");

        for (String body : Arrays.asList("", "TRUE", " true", "false\n", "{\"ready\":true}")) {
            gameData.clearReadyCalls();
            assertResponse(
                    request(port, "POST", "/ready", body),
                    400,
                    "ready body must be exactly true or false\n",
                    "invalid ready body");
            assertEquals(Collections.emptyList(), gameData.getReadyCalls(), "invalid ready calls");
        }
    }

    /** Verifies polling reasons, 409 guards, and unchanged legacy route behavior. */
    private static void testAvailabilityAndExistingRoutes(
            int port, GameData gameData, Graphwar graphwar, GraphwarStateReader stateReader)
            throws Exception {
        gameData.setGameState(2);
        assertResponse(
                request(port, "GET", "/room", null),
                200,
                "{\"available\":false,\"reason\":\"not-in-pre-game-room\"}",
                "active game room");
        assertEquals(409, request(port, "POST", "/ready", "true").status, "active game ready");

        gameData.setGameState(1);
        gameData.clearPlayers();
        gameData.addPlayer(new Player(gameData, 9, "Remote", 2, false, false, 2, false));
        assertEquals(200, request(port, "GET", "/room", null).status, "room without locals");
        assertEquals(409, request(port, "POST", "/ready", "true").status, "ready without locals");

        assertResponse(request(port, "GET", "/health", null), 200, "ok\n", "health");
        assertTrue(
                request(port, "GET", "/state", null)
                        .body
                        .contains("\"reason\":\"game-not-started\""),
                "legacy state must remain unavailable before obstacle creation");
        assertEquals(
                409,
                request(port, "GET", "/obstacle-mask.bin", null).status,
                "legacy obstacle route");
        assertEquals(409, request(port, "POST", "/function", "x").status, "legacy function route");

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

    /** Sends one local HTTP request and returns its complete status and UTF-8 body. */
    private static HttpResponse request(int port, String method, String path, String body)
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
            connection.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }

        int status = connection.getResponseCode();
        InputStream input =
                status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (input != null) {
            try (InputStream closeableInput = input) {
                byte[] buffer = new byte[256];
                int bytesRead;
                while ((bytesRead = closeableInput.read(buffer)) >= 0) {
                    output.write(buffer, 0, bytesRead);
                }
            }
        }
        connection.disconnect();
        return new HttpResponse(status, new String(output.toByteArray(), StandardCharsets.UTF_8));
    }

    /** Verifies a response status and body together for clearer failures. */
    private static void assertResponse(
            HttpResponse response, int expectedStatus, String expectedBody, String message) {
        assertEquals(expectedStatus, response.status, message + " status");
        assertEquals(expectedBody, response.body, message + " body");
    }

    /** Verifies equality while retaining both values in the assertion message. */
    private static void assertEquals(Object expected, Object actual, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }

    /** Verifies one boolean invariant. */
    private static void assertTrue(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    /** Immutable local HTTP response used by the test helpers. */
    private static final class HttpResponse {
        final String body;
        final int status;

        /** Captures one completed local HTTP exchange. */
        HttpResponse(int status, String body) {
            this.body = body;
            this.status = status;
        }
    }
}
