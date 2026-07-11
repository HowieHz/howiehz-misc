package Graphwar;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Minimal mutable state with the official GameData methods reflected by the agent. */
public final class GameData {
    private int currentTurn;
    private boolean drawingFunction;
    private boolean exploding;
    private int gameMode;
    private int gameState;
    private boolean leader;
    private boolean lockRequired;
    private Obstacle obstacle;
    private final List<Player> players = new ArrayList<Player>();
    private final List<String> readyCalls = new ArrayList<String>();
    private long remainingTime = 57_000L;
    private final List<String> shotCalls = new ArrayList<String>();
    private boolean terrainReversed;
    // The production reader intentionally reflects this exact official field.
    private long timeTurnStarted = 1L;
    private volatile CountDownLatch concurrentReadyBarrier;

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
        return drawingFunction;
    }

    /** Mirrors the official explosion phase flag. */
    public boolean isExploding() {
        assertRequiredLock();
        return exploding;
    }

    /** Mirrors the official room-leader getter. */
    public boolean isLeader() {
        assertRequiredLock();
        return leader;
    }

    /** Mirrors the official current-view orientation getter. */
    public boolean isTerrainReversed() {
        assertRequiredLock();
        return terrainReversed;
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
    }

    /** Records one original GameData.setReady call without applying a server echo. */
    public void setReady(Player player, boolean ready) {
        assertRequiredLock();
        synchronized (readyCalls) {
            readyCalls.add(player.id + ":" + ready);
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
    public void setDrawingFunction(boolean drawingFunction) {
        this.drawingFunction = drawingFunction;
    }

    /** Sets whether the match is resolving an explosion. */
    public void setExploding(boolean exploding) {
        this.exploding = exploding;
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
    public void setLeader(boolean leader) {
        this.leader = leader;
    }

    /** Enables lock assertions while snapshots and submissions are performed. */
    public void setLockRequired(boolean lockRequired) {
        this.lockRequired = lockRequired;
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
    public void setTerrainReversed(boolean terrainReversed) {
        this.terrainReversed = terrainReversed;
    }

    /** Changes the exact official turn-start marker used to issue a fresh token. */
    public void setTimeTurnStarted(long timeTurnStarted) {
        this.timeTurnStarted = timeTurnStarted;
    }

    /** Enables a first-player barrier that exposes interleaved ready batches. */
    public void setConcurrentReadyBarrier(boolean enabled) {
        concurrentReadyBarrier = enabled ? new CountDownLatch(2) : null;
    }

    /** Fails when a reflected state getter runs outside the GameData monitor. */
    void assertRequiredLock() {
        if (lockRequired && !Thread.holdsLock(this)) {
            throw new AssertionError("state was read or changed without holding the GameData lock");
        }
    }
}
