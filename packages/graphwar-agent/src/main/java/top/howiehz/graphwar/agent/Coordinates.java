package top.howiehz.graphwar.agent;

/** Centralizes official Graphwar plane dimensions and coordinate conventions. */
final class Coordinates {
    // Source: official GraphServer.Constants defines the Graphwar plane as 770x450
    // pixels and the mathematical x-axis length as 50 game units.
    static final int PLANE_WIDTH = 770;
    static final int PLANE_HEIGHT = 450;
    static final double PLANE_GAME_LENGTH = 50.0;

    private Coordinates() {}

    /** Maps a world point x to the renderer's point-coordinate mirroring convention. */
    static int toViewPointX(int worldX, boolean terrainReversed) {
        // Source: GraphPlane mirrors soldiers and markers with x = PLANE_LENGTH - x.
        return terrainReversed ? PLANE_WIDTH - worldX : worldX;
    }

    /** Maps an output mask cell x back to the authoritative world mask. */
    static int toWorldMaskX(int outputX, boolean terrainReversed) {
        // Image pixels are cells, so mirrored view cell 0 reads world cell 769, not 770.
        return terrainReversed ? PLANE_WIDTH - 1 - outputX : outputX;
    }

    /** Converts a native world pixel x to mathematical Graphwar x. */
    static double toGameX(int pixelX) {
        // Inverse of GraphPlane.convertX.
        return (pixelX - PLANE_WIDTH / 2.0) * PLANE_GAME_LENGTH / PLANE_WIDTH;
    }

    /** Converts a native world pixel y to mathematical Graphwar y. */
    static double toGameY(int pixelY) {
        // Inverse of GraphPlane.convertY.
        return (PLANE_HEIGHT / 2.0 - pixelY) * PLANE_GAME_LENGTH / PLANE_WIDTH;
    }
}
