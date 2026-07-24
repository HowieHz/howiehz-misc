package top.howiehz.graphwar.agent;

/** Strictly parses the JSON object accepted by {@code PUT /room/ready}. */
final class GraphwarReadyRequest {
    final boolean isReady;

    /** Retains the validated target ready state. */
    private GraphwarReadyRequest(boolean isReady) {
        this.isReady = isReady;
    }

    /** Accepts exactly one isReady boolean while rejecting duplicate or unknown fields. */
    static GraphwarReadyRequest parse(String json) throws GraphwarInvalidShotException {
        GraphwarShotRequest.Parser parser =
                new GraphwarShotRequest.Parser(json == null ? "" : json);
        parser.skipWhitespace();
        parser.expect('{');
        parser.skipWhitespace();
        String name = parser.readString();
        if (!"isReady".equals(name)) {
            throw parser.error("unknown field " + name);
        }
        parser.skipWhitespace();
        parser.expect(':');
        parser.skipWhitespace();
        boolean isReady = parser.readBoolean();
        parser.skipWhitespace();
        parser.expect('}');
        parser.skipWhitespace();
        if (!parser.isFinished()) {
            throw parser.error("unexpected content after the JSON object");
        }
        return new GraphwarReadyRequest(isReady);
    }
}
