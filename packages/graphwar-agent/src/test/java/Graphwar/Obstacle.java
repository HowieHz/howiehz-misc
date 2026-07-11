package Graphwar;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;

/** Exact-size terrain fixture using Graphwar's white-versus-blocked pixel rule. */
public final class Obstacle {
    private final BufferedImage image = new BufferedImage(770, 450, BufferedImage.TYPE_INT_ARGB);

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
        return image;
    }

    /** Toggles one world-space terrain cell. */
    public void setBlocked(int x, int y, boolean blocked) {
        image.setRGB(x, y, blocked ? Color.BLACK.getRGB() : Color.WHITE.getRGB());
    }
}
