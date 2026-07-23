package top.howiehz.graphwar.agent;

import java.lang.instrument.Instrumentation;

/** Installs Graphwar compatibility transformers and exposes the localhost control server. */
public final class GraphwarAgent {
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

        GraphwarAgentConfig config = GraphwarAgentConfig.parse(agentArgs);
        // Source: Graphwar's recursive formula parser and evaluator run on network/UI threads.
        instrumentation.addTransformer(new GraphwarFunctionGuard(config), false);
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
        GraphwarStateReader stateReader = new GraphwarStateReader(config);
        GraphwarShotCommandStore shotCommands = new GraphwarShotCommandStore(stateReader);
        stateReader.setShotCommands(shotCommands);
        server = GraphwarHttpServer.start(config, stateReader, shotCommands);

        if (server.getPort() != config.port) {
            System.err.println(
                    "[graphwar-agent] port "
                            + config.port
                            + " unavailable; selected "
                            + server.getPort());
        }
        System.err.println(
                "[graphwar-agent] request header limit " + config.maxRequestHeaderBytes + " bytes");
        System.err.println(
                "[graphwar-agent] request body limit " + config.maxRequestBodyBytes + " bytes");
        System.err.println(
                "[graphwar-agent] function limits "
                        + config.maxFunctionBytes
                        + " bytes, "
                        + config.maxFunctionTokens
                        + " tokens");
        if (config.isAuthenticationRequired()) {
            System.err.println("[graphwar-agent] access token " + config.token);
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
}
