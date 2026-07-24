package Graphwar;

/** Runtime subtype used to verify the agent's local computer-player detection. */
public final class ComputerPlayer extends Player {
    /** Creates one local computer-player fixture. */
    public ComputerPlayer(
            GameData gameData, int id, String name, int team, boolean ready, int numSoldiers) {
        super(gameData, id, name, team, true, ready, numSoldiers, false);
    }

    /** Mirrors the official AI call order, including its non-transactional angle update. */
    public void fire(GameData gameData, double bestAngle, String function) {
        gameData.setAngle(bestAngle);
        gameData.sendFunction(function);
    }
}
