package Graphwar;

/** Minimal player state with the same public getters used from the official Player. */
public class Player {
    private int currentTurnSoldier;
    private final GameData gameData;
    final int id;
    private final String name;
    private final int team;
    private final boolean local;
    private final boolean ready;
    private final Soldier[] soldiers;
    private final boolean disconnected;

    /** Creates one reflected player fixture with deterministic soldier positions. */
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
        this.soldiers = new Soldier[numSoldiers];
        this.disconnected = disconnected;
        for (int index = 0; index < soldiers.length; index += 1) {
            soldiers[index] = new Soldier(100 + id + index * 20, 200 + index * 10);
        }
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
        return soldiers.length;
    }

    /** Mirrors the official team getter. */
    public int getTeam() {
        gameData.assertRequiredLock();
        return team;
    }

    /** Mirrors the official current-soldier index getter. */
    public int getCurrentTurnSoldierIndex() {
        gameData.assertRequiredLock();
        return currentTurnSoldier;
    }

    /** Mirrors the official current-soldier getter used by fake shot effects. */
    public Soldier getCurrentTurnSoldier() {
        gameData.assertRequiredLock();
        return soldiers[currentTurnSoldier];
    }

    /** Mirrors the official soldiers array getter. */
    public Soldier[] getSoldiers() {
        gameData.assertRequiredLock();
        return soldiers;
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

    /** Selects the soldier that will fire on this player's current turn. */
    public void setCurrentTurnSoldierIndex(int currentTurnSoldier) {
        this.currentTurnSoldier = currentTurnSoldier;
    }
}
