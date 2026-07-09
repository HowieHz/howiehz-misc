package top.howiehz.graphwar.agent;

final class Coordinates {
    // Source: official GraphServer.Constants defines the Graphwar plane as 770x450
    // pixels and the mathematical x-axis length as 50 game units.
    static final int PLANE_WIDTH = 770;
    static final int PLANE_HEIGHT = 450;
    static final double PLANE_GAME_LENGTH = 50.0;

    private Coordinates() {
    }

    static int toViewPointX(int worldX, boolean terrainReversed) {
        // Source: GraphPlane mirrors soldiers and markers with x = PLANE_LENGTH - x.
        return terrainReversed ? PLANE_WIDTH - worldX : worldX;
    }

    static int toWorldMaskX(int outputX, boolean terrainReversed) {
        // Image pixels are cells, so mirrored view cell 0 reads world cell 769, not 770.
        return terrainReversed ? PLANE_WIDTH - 1 - outputX : outputX;
    }

    static double toGameX(int pixelX) {
        // Inverse of GraphPlane.convertX.
        return (pixelX - PLANE_WIDTH / 2.0) * PLANE_GAME_LENGTH / PLANE_WIDTH;
    }

    static double toGameY(int pixelY) {
        // Inverse of GraphPlane.convertY.
        return (PLANE_HEIGHT / 2.0 - pixelY) * PLANE_GAME_LENGTH / PLANE_WIDTH;
    }
}
