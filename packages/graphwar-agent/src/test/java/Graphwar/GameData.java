package Graphwar;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Minimal room state with the same public methods used from the official GameData. */
public final class GameData {
    private int gameMode;
    private int gameState;
    private boolean leader;
    private boolean lockRequired;
    private final List<Player> players = new ArrayList<Player>();
    private final List<String> readyCalls = new ArrayList<String>();
    private volatile CountDownLatch concurrentReadyBarrier;

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

    /** Keeps legacy match state unavailable in these pre-game tests. */
    public Object getObstacle() {
        return null;
    }

    /** Exposes the live player list used by the reflection reader. */
    public List<Player> getPlayers() {
        assertRequiredLock();
        return players;
    }

    /** Mirrors the official room-leader getter. */
    public boolean isLeader() {
        assertRequiredLock();
        return leader;
    }

    /** Records one original GameData.setReady call without applying a server echo. */
    public void setReady(Player player, boolean ready) {
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

    /** Adds one player to the fake room. */
    public void addPlayer(Player player) {
        players.add(player);
    }

    /** Removes all players before testing the no-local-player guard. */
    public void clearPlayers() {
        players.clear();
    }

    /** Clears recorded ready calls between independent assertions. */
    public void clearReadyCalls() {
        synchronized (readyCalls) {
            readyCalls.clear();
        }
    }

    /** Returns a stable copy of the recorded ready call order. */
    public List<String> getReadyCalls() {
        synchronized (readyCalls) {
            return new ArrayList<String>(readyCalls);
        }
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

    /** Enables lock assertions while the room snapshot is read. */
    public void setLockRequired(boolean lockRequired) {
        this.lockRequired = lockRequired;
    }

    /** Enables a first-player barrier that exposes interleaved ready batches. */
    public void setConcurrentReadyBarrier(boolean enabled) {
        concurrentReadyBarrier = enabled ? new CountDownLatch(2) : null;
    }

    /** Fails when a room getter runs outside the GameData monitor. */
    void assertRequiredLock() {
        if (lockRequired && !Thread.holdsLock(this)) {
            throw new AssertionError("room state was read without holding the GameData lock");
        }
    }
}
