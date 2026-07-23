package Graphwar;

/** Runtime subtype used to verify the agent's local computer-player detection. */
public final class ComputerPlayer extends Player {
    /** Creates one local computer-player fixture. */
    public ComputerPlayer(
            GameData gameData, int id, String name, int team, boolean ready, int numSoldiers) {
        super(gameData, id, name, team, true, ready, numSoldiers, false);
    }

    /** Mirrors the official AI call site that submits a generated function. */
    public void fire(GameData gameData, String function) {
        gameData.sendFunction(function);
    }
}
