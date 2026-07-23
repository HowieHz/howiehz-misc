package Graphwar;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Minimal mutable state with the official GameData methods reflected by the agent. */
public final class GameData {
    private int currentTurn;
    private int currentFunctionPosition;
    private int functionNumSteps = 20_000;
    private boolean isDrawingFunction;
    private boolean isExploding;
    private int gameMode;
    private int gameState;
    private boolean isLeader;
    private boolean isLockRequired;
    private Obstacle obstacle;
    private final List<Player> players = new ArrayList<Player>();
    private final List<String> readyCalls = new ArrayList<String>();
    private long remainingTime = 57_000L;
    private final List<String> shotCalls = new ArrayList<String>();
    private boolean isTerrainReversed;
    // The production reader intentionally reflects this exact official field.
    private long timeTurnStarted = 1L;
    private volatile CountDownLatch concurrentReadyBarrier;
    private volatile CountDownLatch functionBlocker;
    private volatile CountDownLatch functionEntered;
    private volatile CountDownLatch stateReadBlocker;
    private volatile CountDownLatch stateReadEntered;
    private volatile boolean shouldThrowFromFunction;

    /** Mirrors the official current-turn index getter. */
    public int getCurrentTurnIndex() {
        assertRequiredLock();
        return currentTurn;
    }

    /** Mirrors the official game-mode getter. */
    public int getGameMode() {
        assertRequiredLock();
        return gameMode;
    }

    /** Mirrors the official game-state getter. */
    public int getGameState() {
        assertRequiredLock();
        CountDownLatch entered = stateReadEntered;
        if (entered != null) {
            entered.countDown();
        }
        awaitBlocker(stateReadBlocker, "state read");
        return gameState;
    }

    /** Exposes the fake terrain created when an active match begins. */
    public Obstacle getObstacle() {
        assertRequiredLock();
        return obstacle;
    }

    /** Exposes the live player list used by the reflection reader. */
    public List<Player> getPlayers() {
        assertRequiredLock();
        return players;
    }

    /** Mirrors the official turn timer getter. */
    public long getRemainingTime() {
        assertRequiredLock();
        return remainingTime;
    }

    /** Mirrors the official function-resolution flag. */
    public boolean isDrawingFunction() {
        assertRequiredLock();
        return isDrawingFunction;
    }

    /** Mirrors the official explosion phase flag. */
    public boolean isExploding() {
        assertRequiredLock();
        return isExploding;
    }

    /** Mirrors the official cursor getter, including its final-step explosion transition. */
    public int getCurrentFunctionPosition() {
        assertRequiredLock();
        if (isExploding) {
            return functionNumSteps;
        }
        if (isDrawingFunction && currentFunctionPosition > functionNumSteps) {
            currentFunctionPosition = functionNumSteps;
            isExploding = true;
            obstacle.setExplosion(700, 400, 10);
        }
        return currentFunctionPosition;
    }

    /** Mirrors the official room-leader getter. */
    public boolean isLeader() {
        assertRequiredLock();
        return isLeader;
    }

    /** Mirrors the official current-view orientation getter. */
    public boolean isTerrainReversed() {
        assertRequiredLock();
        return isTerrainReversed;
    }

    /** Records one original GameData.setAngle call and its local soldier mutation. */
    public void setAngle(double angle) {
        assertRequiredLock();
        players.get(currentTurn).getCurrentTurnSoldier().setAngle(angle);
        synchronized (shotCalls) {
            shotCalls.add("angle:" + angle);
        }
    }

    /** Records one original GameData.sendFunction call. */
    public void sendFunction(String function) {
        assertRequiredLock();
        synchronized (shotCalls) {
            shotCalls.add("function:" + function);
        }
        CountDownLatch entered = functionEntered;
        if (entered != null) {
            entered.countDown();
        }
        awaitBlocker(functionBlocker, "function");
        if (shouldThrowFromFunction) {
            throw new IllegalStateException("simulated original-client failure");
        }
    }

    /** Records one original GameData.setReady call without applying a server echo. */
    public void setReady(Player player, boolean isReady) {
        assertRequiredLock();
        synchronized (readyCalls) {
            readyCalls.add(player.id + ":" + isReady);
        }

        CountDownLatch barrier = concurrentReadyBarrier;
        if (barrier != null && player.id == 7) {
            barrier.countDown();
            try {
                barrier.await(250, TimeUnit.MILLISECONDS);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new AssertionError("concurrent ready test was interrupted", error);
            }
        }
    }

    /** Adds one player to the fake room or match. */
    public void addPlayer(Player player) {
        players.add(player);
    }

    /** Removes all players before rebuilding a fixture. */
    public void clearPlayers() {
        players.clear();
    }

    /** Clears recorded ready calls between independent assertions. */
    public void clearReadyCalls() {
        synchronized (readyCalls) {
            readyCalls.clear();
        }
    }

    /** Clears recorded angle and function calls between shot assertions. */
    public void clearShotCalls() {
        synchronized (shotCalls) {
            shotCalls.clear();
        }
    }

    /** Returns a stable copy of the recorded ready call order. */
    public List<String> getReadyCalls() {
        synchronized (readyCalls) {
            return new ArrayList<String>(readyCalls);
        }
    }

    /** Returns a stable copy of calls that can produce a shot side effect. */
    public List<String> getShotCalls() {
        synchronized (shotCalls) {
            return new ArrayList<String>(shotCalls);
        }
    }

    /** Selects the active player list index. */
    public void setCurrentTurn(int currentTurn) {
        this.currentTurn = currentTurn;
    }

    /** Sets whether a function is already being drawn. */
    public void setDrawingFunction(boolean isDrawingFunction) {
        this.isDrawingFunction = isDrawingFunction;
    }

    /** Sets the raw official cursor returned while drawing. */
    public void setCurrentFunctionPosition(int currentFunctionPosition) {
        this.currentFunctionPosition = currentFunctionPosition;
    }

    /** Sets the fixture's official function length used by the transition test. */
    public void setFunctionNumSteps(int functionNumSteps) {
        this.functionNumSteps = functionNumSteps;
    }

    /** Sets whether the match is resolving an explosion. */
    public void setExploding(boolean isExploding) {
        this.isExploding = isExploding;
    }

    /** Sets the reflected game mode. */
    public void setGameMode(int gameMode) {
        this.gameMode = gameMode;
    }

    /** Sets the reflected lifecycle phase. */
    public void setGameState(int gameState) {
        this.gameState = gameState;
    }

    /** Sets the reflected room-leader flag. */
    public void setLeader(boolean isLeader) {
        this.isLeader = isLeader;
    }

    /** Enables lock assertions while snapshots and submissions are performed. */
    public void setLockRequired(boolean isLockRequired) {
        this.isLockRequired = isLockRequired;
    }

    /** Replaces the active terrain object, which also identifies a new game instance. */
    public void setObstacle(Obstacle obstacle) {
        this.obstacle = obstacle;
    }

    /** Sets the authoritative remaining turn time returned to the agent. */
    public void setRemainingTime(long remainingTime) {
        this.remainingTime = remainingTime;
    }

    /** Sets the current client view orientation. */
    public void setTerrainReversed(boolean isTerrainReversed) {
        this.isTerrainReversed = isTerrainReversed;
    }

    /** Changes the exact official turn-start marker used to issue a fresh token. */
    public void setTimeTurnStarted(long timeTurnStarted) {
        this.timeTurnStarted = timeTurnStarted;
    }

    /** Enables a first-player barrier that exposes interleaved ready batches. */
    public void setConcurrentReadyBarrier(boolean isEnabled) {
        concurrentReadyBarrier = isEnabled ? new CountDownLatch(2) : null;
    }

    /** Makes the next and subsequent function calls wait until the test releases them. */
    public void setShouldBlockFunction(boolean shouldBlockFunction) {
        if (shouldBlockFunction) {
            functionEntered = new CountDownLatch(1);
            functionBlocker = new CountDownLatch(1);
            return;
        }
        CountDownLatch blocker = functionBlocker;
        functionBlocker = null;
        functionEntered = null;
        if (blocker != null) {
            blocker.countDown();
        }
    }

    /** Waits until the dedicated shot worker has entered the original function call. */
    public boolean awaitFunctionCall(long timeout, TimeUnit unit) throws InterruptedException {
        CountDownLatch entered = functionEntered;
        return entered != null && entered.await(timeout, unit);
    }

    /** Blocks or releases reflected state reads at a deterministic point for replacement races. */
    public void setShouldBlockStateRead(boolean shouldBlockStateRead) {
        if (shouldBlockStateRead) {
            stateReadEntered = new CountDownLatch(1);
            stateReadBlocker = new CountDownLatch(1);
            return;
        }
        CountDownLatch blocker = stateReadBlocker;
        stateReadBlocker = null;
        stateReadEntered = null;
        if (blocker != null) {
            blocker.countDown();
        }
    }

    /** Waits until a state reader reaches the fixture's deterministic replacement barrier. */
    public boolean awaitStateRead(long timeout, TimeUnit unit) throws InterruptedException {
        CountDownLatch entered = stateReadEntered;
        return entered != null && entered.await(timeout, unit);
    }

    /** Selects whether the original function call throws after the irreversible claim. */
    public void setShouldThrowFromFunction(boolean shouldThrow) {
        shouldThrowFromFunction = shouldThrow;
    }

    /** Fails when a reflected state getter runs outside the GameData monitor. */
    void assertRequiredLock() {
        if (isLockRequired && !Thread.holdsLock(this)) {
            throw new AssertionError("state was read or changed without holding the GameData lock");
        }
    }

    /** Waits on one optional fixture blocker without duplicating interruption handling. */
    private static void awaitBlocker(CountDownLatch blocker, String operation) {
        if (blocker == null) {
            return;
        }
        try {
            blocker.await();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("blocked " + operation + " was interrupted", error);
        }
    }
}
