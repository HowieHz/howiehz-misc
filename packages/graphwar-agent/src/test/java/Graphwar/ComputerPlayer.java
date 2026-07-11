package Graphwar;

/** Runtime subtype used to verify the agent's local computer-player detection. */
public final class ComputerPlayer extends Player {
    /** Creates one local computer-player fixture. */
    public ComputerPlayer(
            GameData gameData, int id, String name, int team, boolean ready, int numSoldiers) {
        super(gameData, id, name, team, true, ready, numSoldiers, false);
    }
}
