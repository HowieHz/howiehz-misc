package top.howiehz.graphwar.agent;

class GraphwarStateException extends Exception {
    GraphwarStateException(String message) {
        super(message);
    }

    GraphwarStateException(String message, Throwable cause) {
        super(message, cause);
    }
}
