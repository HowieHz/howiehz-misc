package Graphwar;

/** Minimal soldier geometry reflected into an immutable agent snapshot. */
public final class Soldier {
    private boolean alive = true;
    private double angle;
    private boolean exploding;
    private int x;
    private int y;

    /** Creates one alive soldier at a world-space center. */
    Soldier(int x, int y) {
        this.x = x;
        this.y = y;
    }

    /** Mirrors the official launch-angle getter. */
    public double getAngle() {
        return angle;
    }

    /** Mirrors the official world-x getter. */
    public int getX() {
        return x;
    }

    /** Mirrors the official world-y getter. */
    public int getY() {
        return y;
    }

    /** Mirrors the official alive-state getter. */
    public boolean isAlive() {
        return alive;
    }

    /** Mirrors the official death-animation getter. */
    public boolean isExploding() {
        return exploding;
    }

    /** Applies the angle mutation made by GameData.setAngle. */
    public void setAngle(double angle) {
        this.angle = angle;
    }

    /** Changes whether pathfinding should consider this soldier alive. */
    public void setAlive(boolean alive) {
        this.alive = alive;
    }

    /** Changes whether the soldier death animation is rendered. */
    public void setExploding(boolean exploding) {
        this.exploding = exploding;
    }

    /** Moves the fixture in world space to change its battle revision. */
    public void setPosition(int x, int y) {
        this.x = x;
        this.y = y;
    }
}
