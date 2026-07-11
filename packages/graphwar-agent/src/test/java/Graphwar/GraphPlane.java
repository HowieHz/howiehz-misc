package Graphwar;

import java.awt.AlphaComposite;

/** Minimal renderer that preserves the official crashing AlphaComposite call shape. */
public final class GraphPlane {
    /** Returns the accepted alpha, or throws exactly as the official renderer does. */
    public float renderAlpha(float alpha) {
        return AlphaComposite.getInstance(AlphaComposite.SRC_OVER, alpha).getAlpha();
    }
}
