package top.howiehz.graphwar.agent;

/** Reports a caller-correctable shot body or mode mismatch. */
final class GraphwarInvalidShotException extends GraphwarStateException {
    /** Creates one safe caller-visible validation message. */
    GraphwarInvalidShotException(String message) {
        super(message);
    }
}
