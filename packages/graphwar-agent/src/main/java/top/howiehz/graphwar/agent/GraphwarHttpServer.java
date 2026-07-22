package top.howiehz.graphwar.agent;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Dependency-free bounded loopback HTTP server for the Graphwar Agent v3 contract. */
final class GraphwarHttpServer {
    private static final int HTTP_QUEUE_CAPACITY = 32;
    private static final int HTTP_RECOVERY_WORKER_RESERVE = 2;
    private static final int HTTP_WORKER_COUNT = 8;
    private static final int MAX_PORT = 65_535;
    private final GraphwarAgentConfig config;
    private final ExecutorService executor;
    private final Semaphore graphwarRequestSlots =
            new Semaphore(HTTP_WORKER_COUNT - HTTP_RECOVERY_WORKER_RESERVE);
    private final GraphwarShotCommandStore shotCommands;
    private final GraphwarStateReader stateReader;
    private final ServerSocket serverSocket;
    private volatile boolean isRunning;

    private GraphwarHttpServer(
            ServerSocket serverSocket,
            ExecutorService executor,
            GraphwarAgentConfig config,
            GraphwarStateReader stateReader,
            GraphwarShotCommandStore shotCommands) {
        this.config = config;
        this.executor = executor;
        this.serverSocket = serverSocket;
        this.shotCommands = shotCommands;
        this.stateReader = stateReader;
    }

    /** Binds the requested loopback port and optionally scans a bounded fallback range. */
    static GraphwarHttpServer start(
            GraphwarAgentConfig config,
            GraphwarStateReader stateReader,
            GraphwarShotCommandStore shotCommands) {
        IOException firstError = null;
        int lastPort = Math.min(MAX_PORT, config.port + Math.max(0, config.fallbackPortCount));
        for (int candidatePort = config.port; candidatePort <= lastPort; candidatePort += 1) {
            try {
                ServerSocket serverSocket = bindLoopback(candidatePort);
                ExecutorService executor =
                        new ThreadPoolExecutor(
                                HTTP_WORKER_COUNT,
                                HTTP_WORKER_COUNT,
                                0L,
                                TimeUnit.MILLISECONDS,
                                new ArrayBlockingQueue<Runnable>(HTTP_QUEUE_CAPACITY),
                                new AgentThreadFactory(),
                                new ThreadPoolExecutor.AbortPolicy());
                GraphwarHttpServer server =
                        new GraphwarHttpServer(
                                serverSocket, executor, config, stateReader, shotCommands);
                server.startAcceptThread();
                return server;
            } catch (IOException error) {
                if (firstError == null) {
                    firstError = error;
                }
            }
        }
        throw new IllegalStateException("Failed to start graphwar-agent HTTP server", firstError);
    }

    /** Retains the legacy test seam while exercising the same v3 modules. */
    static GraphwarHttpServer start(
            int port, int fallbackPortCount, GraphwarStateReader stateReader) {
        GraphwarAgentConfig config = GraphwarAgentConfig.forTest(port, fallbackPortCount);
        GraphwarShotCommandStore commands = new GraphwarShotCommandStore(stateReader);
        stateReader.setShotCommands(commands);
        return start(config, stateReader, commands);
    }

    /** Returns the actual bound loopback port. */
    int getPort() {
        return serverSocket.getLocalPort();
    }

    /** Stops accepting requests and interrupts bounded daemon workers. */
    void stop() {
        isRunning = false;
        try {
            serverSocket.close();
        } catch (IOException ignored) {
            // Best-effort close; the accept loop also observes isRunning=false.
        }
        executor.shutdownNow();
        shotCommands.stop();
    }

    /** Binds one loopback-only server socket. */
    private static ServerSocket bindLoopback(int port) throws IOException {
        ServerSocket serverSocket = new ServerSocket();
        try {
            serverSocket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port));
            return serverSocket;
        } catch (IOException error) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // Best-effort cleanup after a failed bind.
            }
            throw error;
        }
    }

    /** Starts the single daemon accept loop after all server fields are initialized. */
    private void startAcceptThread() {
        isRunning = true;
        Thread thread = new Thread(this::acceptLoop, "graphwar-agent-http-accept");
        thread.setDaemon(true);
        thread.start();
    }

    /** Dispatches accepted sockets into the bounded HTTP worker pool. */
    private void acceptLoop() {
        while (isRunning) {
            Socket socket = null;
            try {
                socket = serverSocket.accept();
                final Socket acceptedSocket = socket;
                executor.execute(() -> handleSocket(acceptedSocket));
            } catch (RejectedExecutionException error) {
                closeQuietly(socket);
            } catch (IOException error) {
                if (isRunning) {
                    System.err.println(
                            "[graphwar-agent] HTTP accept failed: " + error.getMessage());
                }
            }
        }
    }

    /** Parses, admission-controls, routes, and closes one HTTP connection. */
    private void handleSocket(Socket socket) {
        try (Socket closeableSocket = socket) {
            closeableSocket.setSoTimeout(5_000);
            Response response;
            try {
                Request request = readRequest(closeableSocket);
                if (isRecoveryRequest(request)) {
                    response = handleRequest(request);
                } else if (!graphwarRequestSlots.tryAcquire()) {
                    response =
                            Response.error(
                                    503,
                                    "server-busy",
                                    "Graphwar-dependent request capacity is occupied");
                } else {
                    try {
                        response = handleRequest(request);
                    } finally {
                        graphwarRequestSlots.release();
                    }
                }
            } catch (RequestException error) {
                response = Response.error(error.status, error.code, error.getMessage());
                if (error.status == 401) {
                    response.header("WWW-Authenticate", "Bearer");
                }
            }
            writeResponse(closeableSocket, response);
        } catch (IOException error) {
            System.err.println("[graphwar-agent] HTTP request failed: " + error.getMessage());
        }
    }

    /** Parses bounded request metadata, authenticates, then allocates the bounded body. */
    private Request readRequest(Socket socket) throws IOException, RequestException {
        InputStream input = socket.getInputStream();
        byte[] headerBytes = readHeaderBytes(input);
        String headerText = new String(headerBytes, StandardCharsets.US_ASCII);
        String[] lines = headerText.split("\r\n");
        if (lines.length == 0 || lines[0].isEmpty()) {
            throw new RequestException(400, "bad-request", "The HTTP request line is missing");
        }
        String[] parts = lines[0].split(" ", 3);
        if (parts.length != 3 || !parts[2].startsWith("HTTP/1.")) {
            throw new RequestException(400, "bad-request", "The HTTP request line is invalid");
        }

        Map<String, String> headers = readHeaders(lines);
        if (headers.containsKey("transfer-encoding")) {
            throw new RequestException(400, "bad-request", "Transfer-Encoding is unsupported");
        }

        String path;
        try {
            path = new URI(parts[1]).getPath();
        } catch (URISyntaxException error) {
            throw new RequestException(400, "bad-request", "The request target is invalid");
        }
        if (!"OPTIONS".equals(parts[0])
                && !"/health".equals(path)
                && !config.isAuthorizationAccepted(headers.get("authorization"))) {
            throw new RequestException(
                    401, "authentication-required", "A valid bearer token is required");
        }

        String body = "";
        boolean shouldReadBody =
                ("POST".equals(parts[0]) && "/shots".equals(path))
                        || ("PUT".equals(parts[0]) && "/room/ready".equals(path));
        if (shouldReadBody) {
            String contentLengthText = headers.get("content-length");
            if (contentLengthText == null) {
                throw new RequestException(
                        411, "content-length-required", "Content-Length is required");
            }
            int contentLength = parseContentLength(contentLengthText);
            if (contentLength > config.maxRequestBodyBytes) {
                throw new RequestException(
                        413,
                        "request-body-too-large",
                        "The request body exceeds the configured limit");
            }
            body = decodeUtf8(readBodyBytes(input, contentLength));
        }
        return new Request(parts[0], path, body, headers);
    }

    /** Reads through the first CRLFCRLF without exceeding the configured header bound. */
    private byte[] readHeaderBytes(InputStream input) throws IOException, RequestException {
        ByteArrayOutputStream headers = new ByteArrayOutputStream(1_024);
        byte[] terminator = new byte[] {'\r', '\n', '\r', '\n'};
        int matched = 0;
        while (headers.size() < config.maxRequestHeaderBytes) {
            int next = input.read();
            if (next < 0) {
                throw new RequestException(400, "bad-request", "The request headers ended early");
            }
            headers.write(next);
            if (next == terminator[matched]) {
                matched += 1;
                if (matched == terminator.length) {
                    return headers.toByteArray();
                }
            } else {
                matched = next == terminator[0] ? 1 : 0;
            }
        }
        throw new RequestException(
                431,
                "request-headers-too-large",
                "The request headers exceed " + config.maxRequestHeaderBytes + " bytes");
    }

    /** Parses case-insensitive unique header names from the bounded header block. */
    private static Map<String, String> readHeaders(String[] lines) throws RequestException {
        Map<String, String> headers = new LinkedHashMap<String, String>();
        for (int index = 1; index < lines.length; index += 1) {
            if (lines[index].isEmpty()) {
                continue;
            }
            int separator = lines[index].indexOf(':');
            if (separator <= 0) {
                throw new RequestException(400, "bad-request", "A request header is invalid");
            }
            String name = lines[index].substring(0, separator).trim().toLowerCase(Locale.ROOT);
            String value = lines[index].substring(separator + 1).trim();
            if (headers.put(name, value) != null) {
                throw new RequestException(
                        400, "bad-request", "Duplicate request headers are unsupported");
            }
        }
        return headers;
    }

    /** Parses the nonnegative decimal body size used for exact allocation. */
    private static int parseContentLength(String text) throws RequestException {
        if (text == null) {
            return 0;
        }
        try {
            int value = Integer.parseInt(text);
            if (value < 0) {
                throw new NumberFormatException();
            }
            return value;
        } catch (NumberFormatException error) {
            throw new RequestException(400, "bad-request", "Content-Length is invalid");
        }
    }

    /** Reads exactly the advertised body bytes or reports a closed transport. */
    private static byte[] readBodyBytes(InputStream input, int contentLength) throws IOException {
        byte[] body = new byte[contentLength];
        int offset = 0;
        while (offset < body.length) {
            int bytesRead = input.read(body, offset, body.length - offset);
            if (bytesRead < 0) {
                throw new IOException("request body ended early");
            }
            offset += bytesRead;
        }
        return body;
    }

    /** Decodes request JSON with malformed UTF-8 rejection. */
    private static String decodeUtf8(byte[] bytes) throws RequestException {
        try {
            return StandardCharsets.UTF_8
                    .newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException error) {
            throw new RequestException(400, "bad-request", "The request body is not valid UTF-8");
        }
    }

    /** Routes one parsed request through the v3 contract. */
    private Response handleRequest(Request request) {
        if ("OPTIONS".equals(request.method)) {
            return Response.empty(204);
        }
        if ("/health".equals(request.path)) {
            if (!"GET".equals(request.method)) {
                return Response.methodNotAllowed("GET");
            }
            return Response.json(200, healthJson());
        }
        if ("/state".equals(request.path)) {
            if (!"GET".equals(request.method)) {
                return Response.methodNotAllowed("GET");
            }
            try {
                return Response.json(200, stateReader.readStateJson());
            } catch (GraphwarStateException error) {
                return internalError(error);
            }
        }
        if ("/room".equals(request.path)) {
            if (!"GET".equals(request.method)) {
                return Response.methodNotAllowed("GET");
            }
            try {
                return Response.json(200, stateReader.readRoomJson());
            } catch (GraphwarStateException error) {
                return internalError(error);
            }
        }
        if ("/room/ready".equals(request.path)) {
            if (!"PUT".equals(request.method)) {
                return Response.methodNotAllowed("PUT");
            }
            Response mediaTypeError = requireJson(request);
            if (mediaTypeError != null) {
                return mediaTypeError;
            }
            try {
                GraphwarReadyRequest ready = GraphwarReadyRequest.parse(request.body);
                stateReader.submitReady(ready.isReady);
                return Response.json(200, "{\"isReady\":" + ready.isReady + "}\n");
            } catch (GraphwarInvalidShotException error) {
                return Response.error(400, "invalid-ready-request", error.getMessage());
            } catch (GraphwarStateUnavailableException error) {
                return Response.error(409, "room-unavailable", error.getMessage());
            } catch (GraphwarStateException error) {
                return internalError(error);
            }
        }
        if ("/shots".equals(request.path)) {
            if (!"POST".equals(request.method)) {
                return Response.methodNotAllowed("POST");
            }
            Response mediaTypeError = requireJson(request);
            if (mediaTypeError != null) {
                return mediaTypeError;
            }
            try {
                GraphwarShotRequest shotRequest = GraphwarShotRequest.parse(request.body);
                GraphwarShotCommandStore.Submission submission = shotCommands.submit(shotRequest);
                int status = submission.isCreated ? 201 : 200;
                Response response =
                        Response.json(status, submission.json)
                                .header("Location", "/shots/" + shotRequest.requestId);
                if (submission.isPending) {
                    response.header("Retry-After", "1");
                }
                return response;
            } catch (GraphwarInvalidShotException error) {
                return Response.error(400, "invalid-shot-request", error.getMessage());
            } catch (GraphwarShotCommandException error) {
                return Response.error(error.status, error.code, error.getMessage());
            }
        }
        if (request.path.startsWith("/shots/")) {
            if (!"GET".equals(request.method)) {
                return Response.methodNotAllowed("GET");
            }
            String requestId = request.path.substring("/shots/".length());
            if (!isCanonicalUuid(requestId)) {
                return Response.error(400, "invalid-request-id", "The request ID is invalid");
            }
            try {
                return Response.json(200, shotCommands.read(requestId));
            } catch (GraphwarShotCommandException error) {
                return Response.error(error.status, error.code, error.getMessage());
            }
        }
        if ("/obstacle-masks/world.bin".equals(request.path)
                || "/obstacle-masks/view.bin".equals(request.path)) {
            if (!"GET".equals(request.method)) {
                return Response.methodNotAllowed("GET");
            }
            String ifMatch = request.headers.get("if-match");
            if (ifMatch == null) {
                return Response.error(428, "if-match-required", "If-Match is required");
            }
            try {
                GraphwarStateReader.ObstacleMaskSnapshot mask =
                        stateReader.readObstacleMask(
                                request.path.contains("/world.") ? "world" : "view");
                String entityTag = "\"" + mask.battleRevision + "\"";
                if (!entityTag.equals(ifMatch)) {
                    return Response.error(
                            412,
                            "battle-revision-changed",
                            "The battle revision no longer matches the obstacle mask");
                }
                return Response.binary(200, mask.bytes).header("ETag", entityTag);
            } catch (GraphwarStateUnavailableException error) {
                return Response.error(409, "obstacle-mask-unavailable", error.getMessage());
            } catch (GraphwarStateException error) {
                return internalError(error);
            }
        }
        return Response.error(404, "route-not-found", "The requested route was not found");
    }

    /** Serializes public deployment metadata without consulting Graphwar state. */
    private String healthJson() {
        StringBuilder json = new StringBuilder(384);
        json.append("{\"apiVersion\":3");
        json.append(",\"isAuthenticationRequired\":").append(config.isAuthenticationRequired());
        json.append(",\"limits\":{");
        json.append("\"maxRequestHeaderBytes\":").append(config.maxRequestHeaderBytes);
        json.append(",\"maxRequestBodyBytes\":").append(config.maxRequestBodyBytes);
        json.append(",\"maxFunctionBytes\":").append(config.maxFunctionBytes);
        json.append(",\"maxFunctionNestingDepth\":")
                .append(config.maxFunctionNestingDepth)
                .append('}');
        GraphwarStateReader.appendAgent(json);
        json.append("}\n");
        return json.toString();
    }

    /** Accepts only the application/json media type with optional parameters. */
    private static Response requireJson(Request request) {
        String contentType = request.headers.get("content-type");
        String mediaType = contentType == null ? null : contentType.split(";", 2)[0].trim();
        return "application/json".equalsIgnoreCase(mediaType)
                ? null
                : Response.error(
                        415, "unsupported-media-type", "Content-Type must be application/json");
    }

    /** Checks the exact lowercase UUID form used by command resource paths. */
    private static boolean isCanonicalUuid(String value) {
        try {
            return UUID.fromString(value).toString().equals(value);
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    /** Keeps health, preflight, and command recovery outside Graphwar's blocking slot limit. */
    private static boolean isRecoveryRequest(Request request) {
        return "OPTIONS".equals(request.method)
                || "/health".equals(request.path)
                || request.path.startsWith("/shots/");
    }

    /** Converts an unexpected official-client failure to the common JSON envelope. */
    private static Response internalError(Exception error) {
        return Response.error(500, "internal-error", error.getMessage());
    }

    /** Writes one complete close-delimited response with shared CORS headers. */
    private static void writeResponse(Socket socket, Response response) throws IOException {
        ByteArrayOutputStream headers = new ByteArrayOutputStream(512);
        writeAscii(
                headers,
                "HTTP/1.1 " + response.status + " " + reasonPhrase(response.status) + "\r\n");
        writeAscii(headers, "Content-Type: " + response.contentType + "\r\n");
        writeAscii(headers, "Content-Length: " + response.body.length + "\r\n");
        writeAscii(headers, "Access-Control-Allow-Origin: *\r\n");
        writeAscii(headers, "Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n");
        writeAscii(
                headers, "Access-Control-Allow-Headers: Content-Type, Authorization, If-Match\r\n");
        writeAscii(headers, "Access-Control-Expose-Headers: ETag, Location, Retry-After\r\n");
        writeAscii(headers, "Access-Control-Allow-Private-Network: true\r\n");
        for (Map.Entry<String, String> header : response.headers.entrySet()) {
            writeAscii(headers, header.getKey() + ": " + header.getValue() + "\r\n");
        }
        writeAscii(headers, "Cache-Control: no-store\r\n");
        writeAscii(headers, "Connection: close\r\n\r\n");
        OutputStream output = socket.getOutputStream();
        output.write(headers.toByteArray());
        output.write(response.body);
        output.flush();
    }

    /** Maps the server's bounded status set to HTTP/1.1 reason phrases. */
    private static String reasonPhrase(int status) {
        switch (status) {
            case 200:
                return "OK";
            case 201:
                return "Created";
            case 204:
                return "No Content";
            case 400:
                return "Bad Request";
            case 401:
                return "Unauthorized";
            case 404:
                return "Not Found";
            case 405:
                return "Method Not Allowed";
            case 409:
                return "Conflict";
            case 411:
                return "Length Required";
            case 412:
                return "Precondition Failed";
            case 413:
                return "Content Too Large";
            case 415:
                return "Unsupported Media Type";
            case 428:
                return "Precondition Required";
            case 431:
                return "Request Header Fields Too Large";
            case 503:
                return "Service Unavailable";
            default:
                return "Internal Server Error";
        }
    }

    /** Writes protocol metadata using its required ASCII encoding. */
    private static void writeAscii(OutputStream output, String value) throws IOException {
        output.write(value.getBytes(StandardCharsets.US_ASCII));
    }

    /** Closes rejected sockets without obscuring the overload path. */
    private static void closeQuietly(Socket socket) {
        if (socket == null) {
            return;
        }
        try {
            socket.close();
        } catch (IOException ignored) {
            // The server is already shedding excess load.
        }
    }

    private static final class AgentThreadFactory implements ThreadFactory {
        private int index;

        /** Creates numbered daemon HTTP workers. */
        @Override
        public synchronized Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "graphwar-agent-http-" + index);
            index += 1;
            thread.setDaemon(true);
            return thread;
        }
    }

    private static final class Request {
        final String body;
        final Map<String, String> headers;
        final String method;
        final String path;

        /** Retains one fully parsed request until its synchronous route completes. */
        Request(String method, String path, String body, Map<String, String> headers) {
            this.body = body;
            this.headers = headers;
            this.method = method;
            this.path = path;
        }
    }

    private static final class RequestException extends Exception {
        final String code;
        final int status;

        /** Couples an early parser/authentication failure with its HTTP response metadata. */
        RequestException(int status, String code, String message) {
            super(message);
            this.code = code;
            this.status = status;
        }
    }

    private static final class Response {
        final byte[] body;
        final String contentType;
        final Map<String, String> headers = new LinkedHashMap<String, String>();
        final int status;

        /** Owns one immutable response body and mutable pre-write headers. */
        private Response(int status, byte[] body, String contentType) {
            this.body = body;
            this.contentType = contentType;
            this.status = status;
        }

        /** Creates one binary obstacle response. */
        static Response binary(int status, byte[] body) {
            return new Response(status, body, "application/octet-stream");
        }

        /** Creates one empty JSON-compatible response. */
        static Response empty(int status) {
            return new Response(status, new byte[0], "application/json; charset=utf-8");
        }

        /** Creates one structured JSON error response. */
        static Response error(int status, String code, String message) {
            StringBuilder json = new StringBuilder(256);
            json.append("{\"error\":{\"code\":");
            GraphwarStateReader.appendJsonString(json, code);
            json.append(",\"message\":");
            GraphwarStateReader.appendJsonString(json, message == null ? "" : message);
            json.append("}}\n");
            return json(status, json.toString());
        }

        /** Creates one UTF-8 JSON response. */
        static Response json(int status, String body) {
            return new Response(
                    status,
                    body.getBytes(StandardCharsets.UTF_8),
                    "application/json; charset=utf-8");
        }

        /** Creates a method error with its required Allow header. */
        static Response methodNotAllowed(String allow) {
            return error(405, "method-not-allowed", "The HTTP method is not allowed")
                    .header("Allow", allow);
        }

        /** Adds one response header before the socket write. */
        Response header(String name, String value) {
            headers.put(name, value);
            return this;
        }
    }
}
