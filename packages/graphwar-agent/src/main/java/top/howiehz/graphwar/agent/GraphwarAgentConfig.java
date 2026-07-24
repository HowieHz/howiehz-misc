package top.howiehz.graphwar.agent;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/** Parses and owns bounded Graphwar Agent startup configuration. */
final class GraphwarAgentConfig {
    // Keep input volume bounded independently from parser and evaluation complexity.
    static final int DEFAULT_MAX_FUNCTION_BYTES = 65_536;
    // Cold mixed-shape probes repeatedly pass at 4,432 tokens on a 1 MiB JDK 21 thread. Nearby
    // higher candidates vary across fresh JVM runs, so they are not treated as parser-safe.
    static final int DEFAULT_MAX_FUNCTION_TOKENS = 4_432;
    static final int DEFAULT_MAX_REQUEST_BODY_BYTES = 65_536;
    static final int DEFAULT_MAX_REQUEST_HEADER_BYTES = 8_192;
    static final int DEFAULT_PORT = 17_900;
    static final int DEFAULT_PORT_SEARCH_LIMIT = 100;
    // The byte ceiling passed the bracket-heavy parser probe. The token ceiling only bounds the
    // iterative pre-scan; values above the measured default are explicit, parser-unsafe opt-ins.
    private static final int MAX_CONFIGURED_FUNCTION_BYTES = 1_048_576;
    static final int MAX_CONFIGURED_FUNCTION_TOKENS = 40_960;
    private static final int MAX_CONFIGURED_REQUEST_BODY_BYTES = 16_777_216;
    private static final int MAX_CONFIGURED_REQUEST_HEADER_BYTES = 1_048_576;
    private static final int MAX_TOKEN_CHARACTERS = 4_096;

    final int fallbackPortCount;
    final int maxFunctionBytes;
    final int maxFunctionTokens;
    final int maxRequestBodyBytes;
    final int maxRequestHeaderBytes;
    final int port;
    final String token;

    /** Couples validated values so every module observes the same limits. */
    private GraphwarAgentConfig(
            int port,
            int fallbackPortCount,
            int maxRequestHeaderBytes,
            int maxRequestBodyBytes,
            int maxFunctionBytes,
            int maxFunctionTokens,
            String token) {
        this.fallbackPortCount = fallbackPortCount;
        this.maxFunctionBytes = maxFunctionBytes;
        this.maxFunctionTokens = maxFunctionTokens;
        this.maxRequestBodyBytes = maxRequestBodyBytes;
        this.maxRequestHeaderBytes = maxRequestHeaderBytes;
        this.port = port;
        this.token = token;
    }

    /** Parses comma-separated javaagent options without accepting unbounded resource values. */
    static GraphwarAgentConfig parse(String agentArgs) {
        int port = DEFAULT_PORT;
        int fallbackPortCount = DEFAULT_PORT_SEARCH_LIMIT;
        int maxRequestHeaderBytes = DEFAULT_MAX_REQUEST_HEADER_BYTES;
        int maxRequestBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES;
        int maxFunctionBytes = DEFAULT_MAX_FUNCTION_BYTES;
        int maxFunctionTokens = DEFAULT_MAX_FUNCTION_TOKENS;
        String token = null;

        if (agentArgs != null && !agentArgs.trim().isEmpty()) {
            for (String part : agentArgs.split(",")) {
                String[] pair = part.trim().split("=", 2);
                if (pair.length != 2) {
                    continue;
                }
                String name = pair[0].trim();
                String value = pair[1].trim();
                if ("port".equals(name)) {
                    Integer parsed = parseBoundedInteger(value, 1, 65_535);
                    if (parsed != null) {
                        port = parsed.intValue();
                        fallbackPortCount = 0;
                    }
                } else if ("maxRequestHeaderBytes".equals(name)) {
                    Integer parsed =
                            parseBoundedInteger(
                                    value,
                                    DEFAULT_MAX_REQUEST_HEADER_BYTES,
                                    MAX_CONFIGURED_REQUEST_HEADER_BYTES);
                    if (parsed != null) {
                        maxRequestHeaderBytes = parsed.intValue();
                    }
                } else if ("maxRequestBodyBytes".equals(name)) {
                    Integer parsed =
                            parseBoundedInteger(value, 1_024, MAX_CONFIGURED_REQUEST_BODY_BYTES);
                    if (parsed != null) {
                        maxRequestBodyBytes = parsed.intValue();
                    }
                } else if ("maxFunctionBytes".equals(name)) {
                    Integer parsed = parseBoundedInteger(value, 1, MAX_CONFIGURED_FUNCTION_BYTES);
                    if (parsed != null) {
                        maxFunctionBytes = parsed.intValue();
                    }
                } else if ("maxFunctionTokens".equals(name)) {
                    Integer parsed = parseBoundedInteger(value, 1, MAX_CONFIGURED_FUNCTION_TOKENS);
                    if (parsed != null) {
                        maxFunctionTokens = parsed.intValue();
                    }
                } else if ("token".equals(name)) {
                    if ("auto".equals(value)) {
                        token = createToken();
                    } else if (value.isEmpty()) {
                        token = null;
                    } else if (isValidToken(value)) {
                        token = value;
                    } else {
                        throw new IllegalArgumentException(
                                "token must contain 1 to 4096 visible ASCII characters excluding"
                                        + " comma");
                    }
                }
            }
        }

        if (maxFunctionBytes > maxRequestBodyBytes) {
            maxFunctionBytes = maxRequestBodyBytes;
        }
        return new GraphwarAgentConfig(
                port,
                fallbackPortCount,
                maxRequestHeaderBytes,
                maxRequestBodyBytes,
                maxFunctionBytes,
                maxFunctionTokens,
                token);
    }

    /** Creates default limits around one exact test port. */
    static GraphwarAgentConfig forTest(int port, int fallbackPortCount) {
        return new GraphwarAgentConfig(
                port,
                fallbackPortCount,
                DEFAULT_MAX_REQUEST_HEADER_BYTES,
                DEFAULT_MAX_REQUEST_BODY_BYTES,
                DEFAULT_MAX_FUNCTION_BYTES,
                DEFAULT_MAX_FUNCTION_TOKENS,
                null);
    }

    /** Creates one authenticated test configuration with exact HTTP request limits. */
    static GraphwarAgentConfig forTest(
            int port,
            int fallbackPortCount,
            int maxRequestHeaderBytes,
            int maxRequestBodyBytes,
            String token) {
        return new GraphwarAgentConfig(
                port,
                fallbackPortCount,
                maxRequestHeaderBytes,
                maxRequestBodyBytes,
                Math.min(DEFAULT_MAX_FUNCTION_BYTES, maxRequestBodyBytes),
                DEFAULT_MAX_FUNCTION_TOKENS,
                token);
    }

    /** Reports whether one Authorization header carries the configured token. */
    boolean isAuthorizationAccepted(String authorization) {
        if (token == null) {
            return true;
        }
        String expected = "Bearer " + token;
        return authorization != null
                && MessageDigest.isEqual(
                        expected.getBytes(StandardCharsets.UTF_8),
                        authorization.getBytes(StandardCharsets.UTF_8));
    }

    /** Reports whether protected endpoints require the optional bearer token. */
    boolean isAuthenticationRequired() {
        return token != null;
    }

    /** Generates one printable 256-bit base64url bearer token. */
    private static String createToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Keeps the startup token representable inside the server's bounded ASCII headers. */
    private static boolean isValidToken(String value) {
        if (value.length() > MAX_TOKEN_CHARACTERS) {
            return false;
        }
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            if (character < 0x21 || character > 0x7e || character == ',') {
                return false;
            }
        }
        return true;
    }

    /** Parses a decimal integer only when it lies within the advertised hard bounds. */
    private static Integer parseBoundedInteger(String text, int minimum, int maximum) {
        try {
            int value = Integer.parseInt(text);
            return value >= minimum && value <= maximum ? Integer.valueOf(value) : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }
}
