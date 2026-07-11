package Graphwar;

/** Minimal official-client facade used by the agent API tests. */
public final class Graphwar {
    private GameData gameData;

    /** Starts the facade with the supplied fake game state. */
    public Graphwar(GameData gameData) {
        this.gameData = gameData;
    }

    /** Mirrors the official client getter used by the agent. */
    public GameData getGameData() {
        return gameData;
    }

    /** Replaces game state to exercise initialization failures. */
    public void setGameData(GameData gameData) {
        this.gameData = gameData;
    }
}
