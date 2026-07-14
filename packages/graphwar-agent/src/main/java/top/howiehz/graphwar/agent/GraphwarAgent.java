package top.howiehz.graphwar.agent;

import java.lang.instrument.Instrumentation;

/** Installs Graphwar compatibility transformers and exposes the localhost control server. */
public final class GraphwarAgent {
    // Chosen outside common service ports. The default path can scan forward; an explicit
    // port stays strict so callers do not silently connect to the wrong endpoint.
    private static final int DEFAULT_PORT = 17900;
    private static final int DEFAULT_PORT_SEARCH_LIMIT = 100;
    private static GraphwarHttpServer server;

    private GraphwarAgent() {}

    /** Starts the Agent before the official client loads its classes. */
    public static void premain(String agentArgs, Instrumentation instrumentation) {
        start(agentArgs, instrumentation);
    }

    /** Starts the Agent through the JVM dynamic-attach entry point. */
    public static void agentmain(String agentArgs, Instrumentation instrumentation) {
        start(agentArgs, instrumentation);
    }

    /** Registers compatibility transformations, then binds the configured loopback HTTP port. */
    private static synchronized void start(String agentArgs, Instrumentation instrumentation) {
        // A JVM may load the agent through premain and agentmain; expose only one server.
        if (server != null) {
            return;
        }

        // Source: Graphwar's countdown helpers cancel sleep with Thread.interrupt() and
        // print the expected InterruptedException. Register before game classes load.
        instrumentation.addTransformer(new GraphwarInterruptedSleepSilencer(), false);
        // Source: Graphwar client/server connection threads can close sockets while their
        // read loops are blocked, then print the expected SocketException("Socket closed").
        instrumentation.addTransformer(new GraphwarSocketCloseSilencer(), false);
        // Source: Graphwar can receive duplicate REMOVE_PLAYER messages and then log a
        // NullPointerException while removing a player that is already absent.
        instrumentation.addTransformer(new GraphwarRemovePlayerMessageSilencer(), false);
        // Source: RoomBoard's failed-join cleanup calls GameData.disconnect(), but a
        // previous room kick has already nulled GameData.serverConnection.
        instrumentation.addTransformer(new GraphwarRoomJoinFailureFixer(), false);
        // Source: GraphPlane derives fade opacity from non-monotonic wall-clock timers,
        // but AlphaComposite rejects the resulting value when it briefly leaves [0, 1].
        instrumentation.addTransformer(new GraphwarAlphaCompositeFixer(), false);

        printBuildInfo();
        PortSelection portSelection = parsePort(agentArgs);
        server =
                GraphwarHttpServer.start(
                        portSelection.port,
                        portSelection.fallbackPortCount,
                        new GraphwarStateReader());

        if (server.getPort() != portSelection.port) {
            System.err.println(
                    "[graphwar-agent] port "
                            + portSelection.port
                            + " unavailable; selected "
                            + server.getPort());
        }
        System.err.println("[graphwar-agent] listening on http://127.0.0.1:" + server.getPort());
    }

    /** Prints the generated package version and source provenance for diagnostics. */
    private static void printBuildInfo() {
        System.err.println("[graphwar-agent] version " + GraphwarAgentBuildInfo.VERSION);
        System.err.println(
                "[graphwar-agent] source commit "
                        + GraphwarAgentBuildInfo.SOURCE_COMMIT_SHORT
                        + " ("
                        + GraphwarAgentBuildInfo.SOURCE_COMMIT_TIME
                        + ")");
    }

    /** Parses an exact explicit port or falls back to the default scanning policy. */
    private static PortSelection parsePort(String agentArgs) {
        if (agentArgs == null || agentArgs.trim().isEmpty()) {
            return defaultPortSelection();
        }

        String[] parts = agentArgs.split(",");
        for (String part : parts) {
            String[] pair = part.trim().split("=", 2);
            if (pair.length == 2 && "port".equals(pair[0].trim())) {
                try {
                    int port = Integer.parseInt(pair[1].trim());
                    if (port >= 1 && port <= 65535) {
                        // Valid user-specified ports are exact by design.
                        return new PortSelection(port, 0);
                    }
                } catch (NumberFormatException ignored) {
                    return defaultPortSelection();
                }
                return defaultPortSelection();
            }
        }
        return defaultPortSelection();
    }

    /** Creates the default port selection with bounded forward scanning. */
    private static PortSelection defaultPortSelection() {
        return new PortSelection(DEFAULT_PORT, DEFAULT_PORT_SEARCH_LIMIT);
    }

    private static final class PortSelection {
        final int fallbackPortCount;
        final int port;

        /** Couples the first port with the number of fallback ports allowed. */
        PortSelection(int port, int fallbackPortCount) {
            this.fallbackPortCount = fallbackPortCount;
            this.port = port;
        }
    }
}
