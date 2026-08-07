package top.howiehz.graphwar.agent;

import java.lang.instrument.ClassFileTransformer;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.security.ProtectionDomain;
import java.util.List;
import java.util.UUID;

/** Withholds the post-explosion ready message until one local human submits a shot. */
public final class GraphwarEndlessTurnController implements ClassFileTransformer {
    private static final String GAME_DATA_CLASS = "Graphwar/GameData";
    private static volatile GraphwarEndlessTurnController installedController;
    private final boolean isEnabled;
    private EndlessTurn endlessTurn;

    GraphwarEndlessTurnController(GraphwarAgentConfig config) {
        isEnabled = config.isEndlessTurnEnabled;
        installedController = this;
    }

    @Override
    public byte[] transform(
            ClassLoader loader,
            String className,
            Class<?> classBeingRedefined,
            ProtectionDomain protectionDomain,
            byte[] classfileBuffer) {
        if (!GAME_DATA_CLASS.equals(className)) {
            return null;
        }
        byte[] redirected =
                GraphwarMethodCallRedirector.redirect(
                        classfileBuffer,
                        new GraphwarMethodCallRedirector.Redirect(
                                GraphwarMethodCallRedirector.INVOKESPECIAL,
                                GAME_DATA_CLASS,
                                "nextTurn",
                                "()V",
                                "top/howiehz/graphwar/agent/GraphwarEndlessTurnController",
                                "onPostExplosionNextTurn",
                                "(Ljava/lang/Object;)V",
                                "getTimeExploding",
                                "()J"));
        return GraphwarMethodCallRedirector.redirect(
                redirected,
                new GraphwarMethodCallRedirector.Redirect(
                        GraphwarMethodCallRedirector.INVOKESPECIAL,
                        GAME_DATA_CLASS,
                        "nextTurnMessage",
                        "([Ljava/lang/String;)V",
                        "top/howiehz/graphwar/agent/GraphwarEndlessTurnController",
                        "onNextTurnMessage",
                        "(Ljava/lang/Object;[Ljava/lang/String;)V",
                        "handleMessage",
                        "(Ljava/lang/String;)V"));
    }

    /** Bytecode redirect target for GameData.getTimeExploding's private nextTurn call. */
    public static void onPostExplosionNextTurn(Object gameData) {
        GraphwarEndlessTurnController controller = installedController;
        if (controller == null) {
            invokeNextTurn(gameData);
            return;
        }
        controller.handlePostExplosionNextTurn(gameData);
    }

    /** Runs the original server-message handler then wakes a released shot immediately. */
    public static void onNextTurnMessage(Object gameData, String[] info) {
        invokePrivate(
                gameData, "nextTurnMessage", new Class<?>[] {String[].class}, new Object[] {info});
        GraphwarEndlessTurnController controller = installedController;
        if (controller != null) {
            controller.observeNextTurn(gameData);
        }
    }

    /** Holds only the exact successor that the server will choose after READY_NEXT_TURN. */
    private void handlePostExplosionNextTurn(Object gameData) {
        synchronized (gameData) {
            if (!isEnabled || !isEligibleGame(gameData) || isGameFinished(gameData)) {
                invokeNextTurn(gameData);
                return;
            }
            Object obstacle = invoke(gameData, "getObstacle");
            List<?> players = players(gameData);
            int currentTurn = intValue(invoke(gameData, "getCurrentTurnIndex"));
            Target target = findTarget(players, currentTurn);
            if (target == null || !isLocalHuman(target.player) || isDisconnected(target.player)) {
                invokeNextTurn(gameData);
                return;
            }
            synchronized (this) {
                if (endlessTurn == null
                        || endlessTurn.gameData != gameData
                        || endlessTurn.obstacle != obstacle
                        || endlessTurn.phase == Phase.REAL) {
                    endlessTurn =
                            new EndlessTurn(
                                    gameData,
                                    obstacle,
                                    target,
                                    readTurnStartedAt(gameData),
                                    UUID.randomUUID().toString());
                }
            }
        }
    }

    synchronized Projection project(
            Object gameData,
            Object obstacle,
            String battleRevision,
            int currentTurn,
            List<?> players) {
        if (endlessTurn == null) {
            return null;
        }
        if (endlessTurn.gameData != gameData || endlessTurn.obstacle != obstacle) {
            clear();
            return null;
        }
        if (endlessTurn.phase == Phase.HELD) {
            endlessTurn.battleRevision = battleRevision;
        } else if (!endlessTurn.battleRevision.equals(battleRevision)) {
            clear();
            return null;
        }
        if (endlessTurn.phase == Phase.RELEASED_WAITING_FOR_NEXT_TURN
                && currentTurn == endlessTurn.target.playerIndex
                && currentSoldierIndex(players, currentTurn) == endlessTurn.target.soldierIndex
                && readTurnStartedAt(gameData) != endlessTurn.turnStartedAt) {
            endlessTurn.phase = Phase.REAL;
            endlessTurn.realTurnStartedAt = readTurnStartedAt(gameData);
            notifyAll();
            return null;
        }
        if (endlessTurn.phase == Phase.REAL) {
            if (readTurnStartedAt(gameData) != endlessTurn.realTurnStartedAt) {
                clear();
            }
            return null;
        }
        return new Projection(
                endlessTurn.target.playerIndex,
                endlessTurn.target.playerId,
                endlessTurn.target.soldierIndex,
                endlessTurn.turnToken);
    }

    synchronized boolean claimAndRelease(Object gameData, Object obstacle, String token) {
        if (endlessTurn == null
                || endlessTurn.gameData != gameData
                || endlessTurn.obstacle != obstacle
                || endlessTurn.phase != Phase.HELD
                || !endlessTurn.turnToken.equals(token)) {
            return false;
        }
        endlessTurn.phase = Phase.RELEASED_WAITING_FOR_NEXT_TURN;
        notifyAll();
        invokeNextTurn(gameData);
        return true;
    }

    /** Reconciles only the exact official NEXT_TURN transition; no state poll is required. */
    synchronized void observeNextTurn(Object gameData) {
        if (endlessTurn == null || endlessTurn.gameData != gameData) {
            return;
        }
        List<?> livePlayers = players(gameData);
        int playerIndex = intValue(invoke(gameData, "getCurrentTurnIndex"));
        int soldierIndex = currentSoldierIndex(livePlayers, playerIndex);
        if (endlessTurn.phase == Phase.RELEASED_WAITING_FOR_NEXT_TURN
                && playerIndex == endlessTurn.target.playerIndex
                && playerIndex >= 0
                && playerIndex < livePlayers.size()
                && intValue(invoke(livePlayers.get(playerIndex), "getID"))
                        == endlessTurn.target.playerId
                && soldierIndex == endlessTurn.target.soldierIndex
                && readTurnStartedAt(gameData) != endlessTurn.turnStartedAt) {
            endlessTurn.phase = Phase.REAL;
            endlessTurn.realTurnStartedAt = readTurnStartedAt(gameData);
        } else {
            endlessTurn = null;
        }
        notifyAll();
    }

    /** Waits indefinitely, while still terminating when the official match leaves this turn. */
    boolean awaitRealTurn(Object gameData, Object obstacle, String token) {
        while (true) {
            synchronized (this) {
                if (!isReleasedTurn(gameData, obstacle, token)) {
                    return isRealTurn(gameData, obstacle, token);
                }
            }
            synchronized (gameData) {
                if (!isEligibleGame(gameData) || invoke(gameData, "getObstacle") != obstacle) {
                    clearMatchingTurn(gameData, obstacle, token);
                    return false;
                }
            }
            synchronized (this) {
                if (!isReleasedTurn(gameData, obstacle, token)) {
                    return isRealTurn(gameData, obstacle, token);
                }
                try {
                    // This only observes terminal GameData changes; no elapsed-time fallback fires.
                    wait(100L);
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
        }
    }

    /** Reports whether one exact held turn is still waiting for the server's NEXT_TURN. */
    private boolean isReleasedTurn(Object gameData, Object obstacle, String token) {
        return endlessTurn != null
                && endlessTurn.gameData == gameData
                && endlessTurn.obstacle == obstacle
                && endlessTurn.turnToken.equals(token)
                && endlessTurn.phase == Phase.RELEASED_WAITING_FOR_NEXT_TURN;
    }

    /** Reports whether one exact held turn has become its predicted official successor. */
    private boolean isRealTurn(Object gameData, Object obstacle, String token) {
        return endlessTurn != null
                && endlessTurn.gameData == gameData
                && endlessTurn.obstacle == obstacle
                && endlessTurn.turnToken.equals(token)
                && endlessTurn.phase == Phase.REAL;
    }

    /** Clears a released turn only when it still identifies the observed terminal match state. */
    private synchronized void clearMatchingTurn(Object gameData, Object obstacle, String token) {
        if (isReleasedTurn(gameData, obstacle, token)) {
            clear();
        }
    }

    synchronized String retainedToken(
            Object gameData,
            Object obstacle,
            int playerIndex,
            int playerId,
            int soldierIndex,
            long turnStartedAt) {
        return endlessTurn != null
                        && endlessTurn.gameData == gameData
                        && endlessTurn.obstacle == obstacle
                        && endlessTurn.phase == Phase.REAL
                        && endlessTurn.target.playerIndex == playerIndex
                        && endlessTurn.target.playerId == playerId
                        && endlessTurn.target.soldierIndex == soldierIndex
                        && endlessTurn.realTurnStartedAt == turnStartedAt
                ? endlessTurn.turnToken
                : null;
    }

    synchronized void clear() {
        endlessTurn = null;
        notifyAll();
    }

    synchronized void complete(Object gameData, Object obstacle, String token) {
        if (endlessTurn != null
                && endlessTurn.gameData == gameData
                && endlessTurn.obstacle == obstacle
                && endlessTurn.turnToken.equals(token)) {
            clear();
        }
    }

    private static boolean isEligibleGame(Object gameData) {
        return intValue(invoke(gameData, "getGameState")) == 2
                && invoke(gameData, "getObstacle") != null;
    }

    private static boolean isGameFinished(Object gameData) {
        return Boolean.TRUE.equals(
                invokePrivate(gameData, "checkGameFinished", new Class<?>[0], new Object[0]));
    }

    private static Target findTarget(List<?> players, int currentTurn) {
        for (int offset = 1; offset <= players.size(); offset += 1) {
            int playerIndex = Math.floorMod(currentTurn + offset, players.size());
            Object player = players.get(playerIndex);
            int soldierIndex = nextLivingSoldier(player, currentSoldierIndex(players, playerIndex));
            if (soldierIndex >= 0) {
                return new Target(
                        playerIndex, intValue(invoke(player, "getID")), soldierIndex, player);
            }
        }
        return null;
    }

    private static int currentSoldierIndex(List<?> players, int playerIndex) {
        return playerIndex >= 0 && playerIndex < players.size()
                ? intValue(invoke(players.get(playerIndex), "getCurrentTurnSoldierIndex"))
                : -1;
    }

    private static int nextLivingSoldier(Object player, int currentSoldier) {
        Object soldiers = invoke(player, "getSoldiers");
        int length = java.lang.reflect.Array.getLength(soldiers);
        for (int offset = 1; offset <= length; offset += 1) {
            int index = Math.floorMod(currentSoldier + offset, length);
            if (Boolean.TRUE.equals(
                    invoke(java.lang.reflect.Array.get(soldiers, index), "isAlive"))) {
                return index;
            }
        }
        return -1;
    }

    private static boolean isLocalHuman(Object player) {
        return Boolean.TRUE.equals(invoke(player, "isLocalPlayer"))
                && !"Graphwar.ComputerPlayer".equals(player.getClass().getName());
    }

    private static boolean isDisconnected(Object player) {
        return Boolean.TRUE.equals(invoke(player, "isDisconnected"));
    }

    @SuppressWarnings("unchecked")
    private static List<?> players(Object gameData) {
        return (List<?>) invoke(gameData, "getPlayers");
    }

    private static int intValue(Object value) {
        return ((Number) value).intValue();
    }

    private static Object invoke(Object receiver, String name) {
        try {
            Method method = receiver.getClass().getMethod(name);
            return method.invoke(receiver);
        } catch (IllegalAccessException | InvocationTargetException | NoSuchMethodException error) {
            throw new IllegalStateException("Cannot call Graphwar " + name, error);
        }
    }

    private static void invokeNextTurn(Object gameData) {
        invokePrivate(gameData, "nextTurn", new Class<?>[0], new Object[0]);
    }

    private static Object invokePrivate(
            Object gameData, String name, Class<?>[] parameterTypes, Object[] arguments) {
        try {
            Method method = gameData.getClass().getDeclaredMethod(name, parameterTypes);
            method.setAccessible(true);
            return method.invoke(gameData, arguments);
        } catch (IllegalAccessException | InvocationTargetException | NoSuchMethodException error) {
            throw new IllegalStateException("Cannot call Graphwar " + name, error);
        }
    }

    /** Reads the official marker that changes when the server NEXT_TURN is applied. */
    private static long readTurnStartedAt(Object gameData) {
        try {
            Field field = gameData.getClass().getDeclaredField("timeTurnStarted");
            field.setAccessible(true);
            return field.getLong(gameData);
        } catch (IllegalAccessException | NoSuchFieldException error) {
            throw new IllegalStateException("Cannot read Graphwar timeTurnStarted", error);
        }
    }

    private enum Phase {
        HELD,
        RELEASED_WAITING_FOR_NEXT_TURN,
        REAL
    }

    private static final class EndlessTurn {
        final Object gameData;
        final Object obstacle;
        final Target target;
        final long turnStartedAt;
        final String turnToken;
        String battleRevision;
        long realTurnStartedAt = Long.MIN_VALUE;
        Phase phase = Phase.HELD;

        EndlessTurn(
                Object gameData,
                Object obstacle,
                Target target,
                long turnStartedAt,
                String turnToken) {
            this.gameData = gameData;
            this.obstacle = obstacle;
            this.target = target;
            this.turnStartedAt = turnStartedAt;
            this.turnToken = turnToken;
        }
    }

    private static final class Target {
        final int playerIndex;
        final int playerId;
        final int soldierIndex;
        final Object player;

        Target(int playerIndex, int playerId, int soldierIndex, Object player) {
            this.playerIndex = playerIndex;
            this.playerId = playerId;
            this.soldierIndex = soldierIndex;
            this.player = player;
        }
    }

    static final class Projection {
        final int playerIndex;
        final int playerId;
        final int soldierIndex;
        final String turnToken;

        Projection(int playerIndex, int playerId, int soldierIndex, String turnToken) {
            this.playerIndex = playerIndex;
            this.playerId = playerId;
            this.soldierIndex = soldierIndex;
            this.turnToken = turnToken;
        }
    }
}
