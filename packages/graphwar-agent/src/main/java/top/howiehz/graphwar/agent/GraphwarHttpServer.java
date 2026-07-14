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
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/** Dependency-free loopback HTTP server for the Graphwar Agent contract. */
final class GraphwarHttpServer {
    // Keep the server tiny and dependency-free. com.sun.net.httpserver.HttpServer is
    // convenient, but its non-daemon workers kept short validation JVMs alive.
    // Graphwar functions are short text inputs; cap request size so the local server
    // cannot be used as an unbounded memory sink.
    private static final int MAX_REQUEST_BODY_BYTES = 8192;
    private static final int MAX_REQUEST_HEADER_BYTES = 8192;
    private static final int MAX_PORT = 65535;
    private final ExecutorService executor;
    private final GraphwarStateReader stateReader;
    private final ServerSocket serverSocket;
    private volatile boolean running;

    private GraphwarHttpServer(
            ServerSocket serverSocket, ExecutorService executor, GraphwarStateReader stateReader) {
        this.executor = executor;
        this.serverSocket = serverSocket;
        this.stateReader = stateReader;
    }

    /** Binds the requested loopback port and optionally scans a bounded fallback range. */
    static GraphwarHttpServer start(
            int port, int fallbackPortCount, GraphwarStateReader stateReader) {
        IOException firstError = null;
        int lastPort = Math.min(MAX_PORT, port + Math.max(0, fallbackPortCount));

        // fallbackPortCount is 0 for explicit ports and 100 for the default port.
        for (int candidatePort = port; candidatePort <= lastPort; candidatePort += 1) {
            try {
                ServerSocket serverSocket = bindLoopback(candidatePort);
                ExecutorService executor = Executors.newCachedThreadPool(new AgentThreadFactory());
                GraphwarHttpServer httpServer =
                        new GraphwarHttpServer(serverSocket, executor, stateReader);
                httpServer.startAcceptThread();
                return httpServer;
            } catch (IOException error) {
                if (firstError == null) {
                    firstError = error;
                }
            }
        }

        throw new IllegalStateException("Failed to start graphwar-agent HTTP server", firstError);
    }

    /** Returns the actual bound port after fallback selection. */
    int getPort() {
        return serverSocket.getLocalPort();
    }

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

    /** Stops accepting requests and interrupts all daemon request workers. */
    void stop() {
        running = false;
        try {
            serverSocket.close();
        } catch (IOException ignored) {
            // Closing during shutdown is best-effort; the accept loop also observes running=false.
        }
        executor.shutdownNow();
    }

    private void startAcceptThread() {
        running = true;
        Thread thread = new Thread(this::acceptLoop, "graphwar-agent-http-accept");
        thread.setDaemon(true);
        thread.start();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = serverSocket.accept();
                executor.execute(() -> handleSocket(socket));
            } catch (IOException error) {
                if (running) {
                    System.err.println(
                            "[graphwar-agent] HTTP accept failed: " + error.getMessage());
                }
            }
        }
    }

    private void handleSocket(Socket socket) {
        try (Socket closeableSocket = socket) {
            closeableSocket.setSoTimeout(5000);
            Request request = readRequest(closeableSocket);
            Response response = handleRequest(request);
            writeResponse(closeableSocket, response);
        } catch (IOException error) {
            System.err.println("[graphwar-agent] HTTP request failed: " + error.getMessage());
        }
    }

    private Request readRequest(Socket socket) throws IOException {
        // Read raw bytes instead of BufferedReader so header buffering cannot consume
        // bytes that belong to the UTF-8 POST body.
        InputStream input = socket.getInputStream();
        byte[] headerBytes = readHeaderBytes(input);
        if (headerBytes.length == 0) {
            return Request.invalid();
        }

        String headerText = new String(headerBytes, StandardCharsets.US_ASCII);
        String[] lines = headerText.split("\r\n");
        String requestLine = lines.length == 0 ? "" : lines[0];
        if (requestLine == null || requestLine.isEmpty()) {
            return Request.invalid();
        }

        int contentLength = readContentLength(lines);
        if (contentLength < 0 || contentLength > MAX_REQUEST_BODY_BYTES) {
            return Request.invalid();
        }
        String body = new String(readBodyBytes(input, contentLength), StandardCharsets.UTF_8);

        String[] parts = requestLine.split(" ", 3);
        if (parts.length < 2) {
            return Request.invalid();
        }

        try {
            URI uri = new URI(parts[1]);
            return new Request(parts[0], uri.getPath(), uri.getRawQuery(), body);
        } catch (URISyntaxException error) {
            return Request.invalid();
        }
    }

    private static byte[] readHeaderBytes(InputStream input) throws IOException {
        ByteArrayOutputStream headers = new ByteArrayOutputStream(1024);
        byte[] terminator = new byte[] {'\r', '\n', '\r', '\n'};
        int matched = 0;

        while (headers.size() < MAX_REQUEST_HEADER_BYTES) {
            int next = input.read();
            if (next < 0) {
                return new byte[0];
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

        return new byte[0];
    }

    private static int readContentLength(String[] headerLines) {
        int contentLength = 0;
        for (int index = 1; index < headerLines.length; index += 1) {
            String line = headerLines[index];
            int separator = line.indexOf(':');
            if (separator <= 0) {
                continue;
            }
            if (!"Content-Length".equalsIgnoreCase(line.substring(0, separator).trim())) {
                continue;
            }

            try {
                contentLength = Integer.parseInt(line.substring(separator + 1).trim());
            } catch (NumberFormatException error) {
                return -1;
            }
        }
        return contentLength;
    }

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

    /** Routes one parsed request and preserves the API's stable status-code semantics. */
    private Response handleRequest(Request request) {
        if (!request.valid) {
            return Response.text(400, "bad request\n");
        }
        if ("OPTIONS".equals(request.method)) {
            return Response.empty(204);
        }
        if ("POST".equals(request.method)) {
            if ("/shot".equals(request.path)) {
                try {
                    stateReader.submitShot(GraphwarShotRequest.parse(request.body));
                    return Response.json(200, "{\"ok\":true}\n");
                } catch (GraphwarInvalidFunctionException | GraphwarInvalidShotException error) {
                    return Response.text(400, error.getMessage() + "\n");
                } catch (GraphwarStateUnavailableException error) {
                    return Response.text(409, error.getMessage() + "\n");
                } catch (GraphwarStateException error) {
                    return Response.text(500, error.getMessage() + "\n");
                }
            }
            if ("/ready".equals(request.path)) {
                if (!"true".equals(request.body) && !"false".equals(request.body)) {
                    return Response.text(400, "ready body must be exactly true or false\n");
                }

                boolean ready = "true".equals(request.body);
                try {
                    stateReader.submitReady(ready);
                    return Response.json(200, "{\"ok\":true,\"requestedReady\":" + ready + "}\n");
                } catch (GraphwarStateUnavailableException error) {
                    return Response.text(409, error.getMessage() + "\n");
                } catch (GraphwarStateException error) {
                    return Response.text(500, error.getMessage() + "\n");
                }
            }
            return Response.text(404, "not found\n");
        }
        if (!"GET".equals(request.method)) {
            return Response.text(405, "method not allowed\n");
        }

        if ("/health".equals(request.path)) {
            return Response.text(200, "ok\n");
        }
        if ("/state".equals(request.path)) {
            try {
                return Response.json(200, stateReader.readStateJson());
            } catch (GraphwarStateException error) {
                return Response.text(500, error.getMessage() + "\n");
            }
        }
        if ("/room".equals(request.path)) {
            try {
                return Response.json(200, stateReader.readRoomJson());
            } catch (GraphwarStateException error) {
                return Response.text(500, error.getMessage() + "\n");
            }
        }
        if ("/obstacle-mask.bin".equals(request.path)) {
            String space = "view";
            if (request.query != null && !request.query.isEmpty()) {
                for (String part : request.query.split("&")) {
                    String[] pair = part.split("=", 2);
                    if (pair.length == 2 && "space".equals(pair[0])) {
                        space = "world".equals(pair[1]) ? "world" : "view";
                        break;
                    }
                }
            }

            try {
                GraphwarStateReader.ObstacleMaskSnapshot mask = stateReader.readObstacleMask(space);
                return Response.binary(200, mask.bytes, mask.battleRevision);
            } catch (GraphwarStateUnavailableException error) {
                return Response.text(409, error.getMessage() + "\n");
            } catch (GraphwarStateException error) {
                return Response.text(500, error.getMessage() + "\n");
            }
        }
        return Response.text(404, "not found\n");
    }

    /** Writes one complete response before the caller closes the connection. */
    private static void writeResponse(Socket socket, Response response) throws IOException {
        ByteArrayOutputStream headers = new ByteArrayOutputStream(256);
        writeAscii(headers, "HTTP/1.1 " + response.status + " ");
        switch (response.status) {
            case 200:
                writeAscii(headers, "OK\r\n");
                break;
            case 204:
                writeAscii(headers, "No Content\r\n");
                break;
            case 400:
                writeAscii(headers, "Bad Request\r\n");
                break;
            case 404:
                writeAscii(headers, "Not Found\r\n");
                break;
            case 405:
                writeAscii(headers, "Method Not Allowed\r\n");
                break;
            case 409:
                writeAscii(headers, "Conflict\r\n");
                break;
            default:
                writeAscii(headers, "Internal Server Error\r\n");
                break;
        }
        writeAscii(headers, "Content-Type: " + response.contentType + "\r\n");
        writeAscii(headers, "Content-Length: " + response.body.length + "\r\n");
        writeAscii(headers, "Access-Control-Allow-Origin: *\r\n");
        writeAscii(headers, "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        writeAscii(headers, "Access-Control-Allow-Headers: Content-Type\r\n");
        writeAscii(headers, "Access-Control-Expose-Headers: X-Graphwar-Battle-Revision\r\n");
        writeAscii(headers, "Access-Control-Allow-Private-Network: true\r\n");
        if (response.battleRevision != null) {
            writeAscii(headers, "X-Graphwar-Battle-Revision: " + response.battleRevision + "\r\n");
        }
        writeAscii(headers, "Cache-Control: no-store\r\n");
        writeAscii(headers, "Connection: close\r\n");
        writeAscii(headers, "\r\n");

        OutputStream output = socket.getOutputStream();
        output.write(headers.toByteArray());
        output.write(response.body);
        output.flush();
    }

    private static void writeAscii(OutputStream output, String value) throws IOException {
        output.write(value.getBytes(StandardCharsets.US_ASCII));
    }

    private static final class AgentThreadFactory implements ThreadFactory {
        private int index;

        @Override
        public synchronized Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "graphwar-agent-http-" + index);
            index += 1;
            thread.setDaemon(true);
            return thread;
        }
    }

    private static final class Request {
        final String method;
        final String path;
        final String query;
        final String body;
        final boolean valid;

        Request(String method, String path, String query, String body) {
            this.method = method;
            this.path = path;
            this.query = query;
            this.body = body;
            this.valid = true;
        }

        private Request() {
            this.method = "";
            this.path = "";
            this.query = "";
            this.body = "";
            this.valid = false;
        }

        /** Creates a sentinel request that always routes to HTTP 400. */
        static Request invalid() {
            return new Request();
        }
    }

    private static final class Response {
        final String battleRevision;
        final byte[] body;
        final String contentType;
        final int status;

        /** Couples optional verification metadata to one completed response body. */
        Response(int status, byte[] body, String contentType, String battleRevision) {
            this.battleRevision = battleRevision;
            this.body = body;
            this.contentType = contentType;
            this.status = status;
        }

        /** Builds a mask response whose header verifies its snapshot. */
        static Response binary(int status, byte[] body, String battleRevision) {
            return new Response(status, body, "application/octet-stream", battleRevision);
        }

        /** Creates a response with no body. */
        static Response empty(int status) {
            return new Response(status, new byte[0], "text/plain; charset=utf-8", null);
        }

        /** Encodes one UTF-8 JSON response. */
        static Response json(int status, String text) {
            return new Response(
                    status,
                    text.getBytes(StandardCharsets.UTF_8),
                    "application/json; charset=utf-8",
                    null);
        }

        /** Encodes one UTF-8 plain-text response. */
        static Response text(int status, String text) {
            return new Response(
                    status,
                    text.getBytes(StandardCharsets.UTF_8),
                    "text/plain; charset=utf-8",
                    null);
        }
    }
}
