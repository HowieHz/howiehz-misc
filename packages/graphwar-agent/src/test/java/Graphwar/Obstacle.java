package Graphwar;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;

/** Exact-size terrain fixture using Graphwar's white-versus-blocked pixel rule. */
public final class Obstacle {
    private int explosionRadius;
    private int explosionX;
    private int explosionY;
    private final BufferedImage image = new BufferedImage(770, 450, BufferedImage.TYPE_INT_ARGB);
    private int imageReadCount;

    /** Creates an empty white battlefield. */
    public Obstacle() {
        Graphics2D graphics = image.createGraphics();
        try {
            graphics.setColor(Color.WHITE);
            graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
        } finally {
            graphics.dispose();
        }
    }

    /** Mirrors the official terrain image getter. */
    public BufferedImage getImage() {
        imageReadCount += 1;
        return image;
    }

    /** Mirrors the official latest-explosion radius getter used by the terrain cache. */
    public int getExplosionRadius() {
        return explosionRadius;
    }

    /** Mirrors the official latest-explosion x-coordinate getter used by the terrain cache. */
    public int getExplosionX() {
        return explosionX;
    }

    /** Mirrors the official latest-explosion y-coordinate getter used by the terrain cache. */
    public int getExplosionY() {
        return explosionY;
    }

    /** Exposes how often the production reader requested a full image rescan. */
    public int getImageReadCount() {
        return imageReadCount;
    }

    /** Mirrors the official explosion signature update before terrain pixels are cleared. */
    public void setExplosion(int x, int y, int radius) {
        explosionX = x;
        explosionY = y;
        explosionRadius = radius;
    }

    /** Toggles one world-space terrain cell. */
    public void setBlocked(int x, int y, boolean hasObstacle) {
        image.setRGB(x, y, hasObstacle ? Color.BLACK.getRGB() : Color.WHITE.getRGB());
    }
}
