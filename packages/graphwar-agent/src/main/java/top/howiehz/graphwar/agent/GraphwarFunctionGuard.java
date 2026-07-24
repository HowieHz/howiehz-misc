package top.howiehz.graphwar.agent;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.IllegalClassFormatException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URLDecoder;
import java.security.ProtectionDomain;

/** Guards official UI and inbound formula calls before recursive Graphwar processing. */
public final class GraphwarFunctionGuard implements ClassFileTransformer {
    private static final String COMPUTER_PLAYER = "Graphwar/ComputerPlayer";
    private static final String FIRE_FUNCTION_DESCRIPTOR = "([Ljava/lang/String;)V";
    private static final String FIRE_FUNCTION_METHOD = "fireFunctionMessage";
    private static final String GAME_DATA = "Graphwar/GameData";
    private static final String GAME_SCREEN = "Graphwar/GameScreen";
    private static final String HANDLER_CLASS = "top/howiehz/graphwar/agent/GraphwarFunctionGuard";
    private static final String RECEIVE_HANDLER = "receiveFunctionSafely";
    private static final String RECEIVE_HANDLER_DESCRIPTOR =
            "(Ljava/lang/Object;[Ljava/lang/String;)V";
    private static final String SEND_FUNCTION_DESCRIPTOR = "(Ljava/lang/String;)V";
    private static final String SEND_FUNCTION_METHOD = "sendFunction";
    private static final String SEND_HANDLER = "sendFunctionSafely";
    private static final String SEND_HANDLER_DESCRIPTOR = "(Ljava/lang/Object;Ljava/lang/String;)V";
    private static volatile GraphwarFunctionLimits limits =
            new GraphwarFunctionLimits(
                    GraphwarAgentConfig.DEFAULT_MAX_FUNCTION_BYTES,
                    GraphwarAgentConfig.DEFAULT_MAX_FUNCTION_TOKENS);

    /** Configures the shared handlers before the official classes are loaded. */
    GraphwarFunctionGuard(GraphwarAgentConfig config) {
        limits = new GraphwarFunctionLimits(config.maxFunctionBytes, config.maxFunctionTokens);
    }

    /** Redirects compatible official call sites to the bounded static handlers below. */
    @Override
    public byte[] transform(
            ClassLoader loader,
            String className,
            Class<?> classBeingRedefined,
            ProtectionDomain protectionDomain,
            byte[] classfileBuffer)
            throws IllegalClassFormatException {
        try {
            if (GAME_SCREEN.equals(className) || COMPUTER_PLAYER.equals(className)) {
                return changedOrWarn(
                        className,
                        classfileBuffer,
                        GraphwarMethodCallRedirector.redirect(
                                classfileBuffer,
                                new GraphwarMethodCallRedirector.Redirect(
                                        GraphwarMethodCallRedirector.INVOKEVIRTUAL,
                                        GAME_DATA,
                                        SEND_FUNCTION_METHOD,
                                        SEND_FUNCTION_DESCRIPTOR,
                                        HANDLER_CLASS,
                                        SEND_HANDLER,
                                        SEND_HANDLER_DESCRIPTOR)));
            }
            if (GAME_DATA.equals(className)) {
                return changedOrWarn(
                        className,
                        classfileBuffer,
                        GraphwarMethodCallRedirector.redirect(
                                classfileBuffer,
                                new GraphwarMethodCallRedirector.Redirect(
                                        GraphwarMethodCallRedirector.ANY_INSTANCE_OPCODE,
                                        GAME_DATA,
                                        FIRE_FUNCTION_METHOD,
                                        FIRE_FUNCTION_DESCRIPTOR,
                                        HANDLER_CLASS,
                                        RECEIVE_HANDLER,
                                        RECEIVE_HANDLER_DESCRIPTOR)));
            }
            return null;
        } catch (RuntimeException error) {
            System.err.println(
                    "[graphwar-agent] failed to guard Graphwar functions in "
                            + className
                            + ": "
                            + error.getMessage());
            return null;
        }
    }

    /** Validates UI/AI output and contains the official parser's stack overflow. */
    public static void sendFunctionSafely(Object gameData, String function) {
        try {
            limits.validate(function);
            invoke(gameData, SEND_FUNCTION_METHOD, new Class<?>[] {String.class}, function);
        } catch (GraphwarInvalidFunctionException error) {
            logRejection("outbound", error.getMessage());
        } catch (StackOverflowError error) {
            logRejection("outbound", "Graphwar parser exhausted its thread stack");
        }
    }

    /** Rejects unsafe broadcasts or contains stack overflow by leaving the current match. */
    public static void receiveFunctionSafely(Object gameData, String[] fields) {
        try {
            if (shouldValidateInboundFunction(gameData, fields)) {
                limits.validate(URLDecoder.decode(fields[2], "UTF-8"));
            }
            invoke(
                    gameData,
                    FIRE_FUNCTION_METHOD,
                    new Class<?>[] {String[].class},
                    new Object[] {fields});
        } catch (GraphwarInvalidFunctionException error) {
            leaveUnsafeMatch(gameData, error.getMessage());
        } catch (StackOverflowError error) {
            leaveUnsafeMatch(gameData, "Graphwar parser exhausted its thread stack");
        } catch (java.io.UnsupportedEncodingException error) {
            throw new IllegalStateException("UTF-8 is unavailable", error);
        }
    }

    /** Preserves Graphwar's cheap no-op gates before treating a broadcast as a real shot. */
    private static boolean shouldValidateInboundFunction(Object gameData, String[] fields) {
        if (fields.length != 3
                || ((Boolean) invoke(gameData, "isDrawingFunction", new Class<?>[0]))
                        .booleanValue()) {
            return false;
        }
        return Integer.parseInt(fields[1])
                == ((Integer)
                                invoke(
                                        invoke(gameData, "getCurrentTurnPlayer", new Class<?>[0]),
                                        "getID",
                                        new Class<?>[0]))
                        .intValue();
    }

    /** Invokes one official method while preserving stack overflow as a precise recovery signal. */
    private static Object invoke(
            Object target, String methodName, Class<?>[] parameterTypes, Object... arguments) {
        try {
            Method method = null;
            Class<?> type = target.getClass();
            while (type != null && method == null) {
                try {
                    method = type.getDeclaredMethod(methodName, parameterTypes);
                } catch (NoSuchMethodException error) {
                    type = type.getSuperclass();
                }
            }
            if (method == null) {
                throw new NoSuchMethodException(methodName);
            }
            method.setAccessible(true);
            return method.invoke(target, arguments);
        } catch (IllegalAccessException | NoSuchMethodException error) {
            throw new IllegalStateException("cannot call Graphwar method " + methodName, error);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof StackOverflowError) {
                throw (StackOverflowError) cause;
            }
            if (cause instanceof RuntimeException) {
                throw (RuntimeException) cause;
            }
            if (cause instanceof Error) {
                throw (Error) cause;
            }
            throw new IllegalStateException("Graphwar method " + methodName + " failed", cause);
        }
    }

    /** Disconnects an already-broadcast unsafe shot instead of continuing a divergent match. */
    private static void leaveUnsafeMatch(Object gameData, String reason) {
        logRejection("inbound", reason);
        try {
            invoke(gameData, "disconnectKick", new Class<?>[0]);
        } catch (RuntimeException error) {
            invoke(gameData, "kickFromGame", new Class<?>[0]);
        }
    }

    /** Logs bounded metadata without echoing the caller-controlled formula. */
    private static void logRejection(String direction, String reason) {
        System.err.println(
                "[graphwar-agent] rejected " + direction + " Graphwar function: " + reason);
    }

    /** Warns when a known Graphwar class no longer contains the expected compatible call. */
    private static byte[] changedOrWarn(String className, byte[] original, byte[] patched) {
        if (original != patched) {
            return patched;
        }
        System.err.println(
                "[graphwar-agent] could not find a compatible function call in " + className);
        return null;
    }
}
