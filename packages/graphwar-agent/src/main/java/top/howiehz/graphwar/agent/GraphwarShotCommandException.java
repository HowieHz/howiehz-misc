package top.howiehz.graphwar.agent;

/** Reports an HTTP-level failure before a shot command resource can be established. */
final class GraphwarShotCommandException extends Exception {
    final String code;
    final int status;

    /** Couples one HTTP status with its stable v3 error code. */
    GraphwarShotCommandException(int status, String code, String message) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
