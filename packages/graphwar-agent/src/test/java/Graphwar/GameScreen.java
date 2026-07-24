package Graphwar;

/** Minimal UI call site used to verify same-size sendFunction redirection. */
public final class GameScreen {
    /** Mirrors the official fire button's direct GameData call. */
    public void fire(GameData gameData, String function) {
        gameData.sendFunction(function);
    }
}
