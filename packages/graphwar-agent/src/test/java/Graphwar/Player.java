package Graphwar;

/** Minimal player state with the same public getters used from the official Player. */
public class Player {
    private final GameData gameData;
    final int id;
    private final String name;
    private final int team;
    private final boolean local;
    private final boolean ready;
    private final int numSoldiers;
    private final boolean disconnected;

    /** Creates one reflected player fixture. */
    public Player(
            GameData gameData,
            int id,
            String name,
            int team,
            boolean local,
            boolean ready,
            int numSoldiers,
            boolean disconnected) {
        this.gameData = gameData;
        this.id = id;
        this.name = name;
        this.team = team;
        this.local = local;
        this.ready = ready;
        this.numSoldiers = numSoldiers;
        this.disconnected = disconnected;
    }

    /** Mirrors the official ready getter. */
    public boolean getReady() {
        gameData.assertRequiredLock();
        return ready;
    }

    /** Mirrors the official protocol-ID getter. */
    public int getID() {
        gameData.assertRequiredLock();
        return id;
    }

    /** Mirrors the official name getter. */
    public String getName() {
        gameData.assertRequiredLock();
        return name;
    }

    /** Mirrors the official soldier-count getter. */
    public int getNumSoldiers() {
        gameData.assertRequiredLock();
        return numSoldiers;
    }

    /** Mirrors the official team getter. */
    public int getTeam() {
        gameData.assertRequiredLock();
        return team;
    }

    /** Mirrors the official disconnection getter. */
    public boolean isDisconnected() {
        gameData.assertRequiredLock();
        return disconnected;
    }

    /** Mirrors the official local-ownership getter. */
    public boolean isLocalPlayer() {
        gameData.assertRequiredLock();
        return local;
    }
}
