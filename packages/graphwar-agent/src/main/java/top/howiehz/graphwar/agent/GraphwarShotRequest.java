package top.howiehz.graphwar.agent;

/** Strictly parses the small JSON object accepted by {@code POST /shot}. */
final class GraphwarShotRequest {
    final Double angleRadians;
    final String battleRevision;
    final String function;
    final String turnToken;

    /** Retains validated JSON values without deriving any mutable game state. */
    private GraphwarShotRequest(
            String function, String turnToken, String battleRevision, Double angleRadians) {
        this.angleRadians = angleRadians;
        this.battleRevision = battleRevision;
        this.function = function;
        this.turnToken = turnToken;
    }

    /** Parses only the documented fields so misspelled safety tokens cannot be ignored. */
    static GraphwarShotRequest parse(String json) throws GraphwarInvalidShotException {
        Parser parser = new Parser(json == null ? "" : json);
        parser.skipWhitespace();
        parser.expect('{');

        String function = null;
        String turnToken = null;
        String battleRevision = null;
        Double angleRadians = null;
        boolean hasFunction = false;
        boolean hasTurnToken = false;
        boolean hasBattleRevision = false;
        boolean hasAngleRadians = false;

        parser.skipWhitespace();
        if (!parser.consume('}')) {
            while (true) {
                String name = parser.readString();
                parser.skipWhitespace();
                parser.expect(':');
                parser.skipWhitespace();

                if ("function".equals(name)) {
                    if (hasFunction) {
                        throw parser.error("duplicate field function");
                    }
                    function = parser.readString();
                    hasFunction = true;
                } else if ("turnToken".equals(name)) {
                    if (hasTurnToken) {
                        throw parser.error("duplicate field turnToken");
                    }
                    turnToken = parser.readString();
                    hasTurnToken = true;
                } else if ("battleRevision".equals(name)) {
                    if (hasBattleRevision) {
                        throw parser.error("duplicate field battleRevision");
                    }
                    battleRevision = parser.readString();
                    hasBattleRevision = true;
                } else if ("angleRadians".equals(name)) {
                    if (hasAngleRadians) {
                        throw parser.error("duplicate field angleRadians");
                    }
                    angleRadians = Double.valueOf(parser.readNumber());
                    hasAngleRadians = true;
                } else {
                    throw parser.error("unknown field " + name);
                }

                parser.skipWhitespace();
                if (parser.consume('}')) {
                    break;
                }
                parser.expect(',');
                parser.skipWhitespace();
            }
        }

        parser.skipWhitespace();
        if (!parser.isFinished()) {
            throw parser.error("unexpected content after the JSON object");
        }
        if (!hasFunction || !hasTurnToken || !hasBattleRevision) {
            throw parser.error("function, turnToken, and battleRevision are required");
        }
        return new GraphwarShotRequest(function, turnToken, battleRevision, angleRadians);
    }

    /** Minimal cursor parser for JSON strings and numbers used by the shot contract. */
    private static final class Parser {
        private final String input;
        private int index;

        /** Starts at the first UTF-16 code unit of one bounded HTTP body. */
        Parser(String input) {
            this.input = input;
        }

        /** Advances only when the next structural character matches. */
        boolean consume(char expected) {
            if (index < input.length() && input.charAt(index) == expected) {
                index += 1;
                return true;
            }
            return false;
        }

        /** Adds the cursor location without echoing caller-controlled function text. */
        GraphwarInvalidShotException error(String detail) {
            return new GraphwarInvalidShotException(
                    "Invalid shot JSON at character " + index + ": " + detail);
        }

        /** Requires one structural character at the current cursor. */
        void expect(char expected) throws GraphwarInvalidShotException {
            if (!consume(expected)) {
                throw error("expected " + expected);
            }
        }

        /** Reports whether all body characters were consumed. */
        boolean isFinished() {
            return index == input.length();
        }

        /** Parses the JSON number grammar before converting the angle to double. */
        double readNumber() throws GraphwarInvalidShotException {
            int start = index;
            consume('-');
            if (consume('0')) {
                if (index < input.length() && isDigit(input.charAt(index))) {
                    throw error("numbers cannot contain leading zeroes");
                }
            } else {
                readDigits("expected a number");
            }

            if (consume('.')) {
                readDigits("expected digits after the decimal point");
            }
            if (index < input.length()
                    && (input.charAt(index) == 'e' || input.charAt(index) == 'E')) {
                index += 1;
                if (index < input.length()
                        && (input.charAt(index) == '+' || input.charAt(index) == '-')) {
                    index += 1;
                }
                readDigits("expected an exponent");
            }

            try {
                return Double.parseDouble(input.substring(start, index));
            } catch (NumberFormatException error) {
                throw error("invalid number");
            }
        }

        /** Decodes one JSON string including standard and unicode escapes. */
        String readString() throws GraphwarInvalidShotException {
            expect('"');
            StringBuilder value = new StringBuilder();
            while (index < input.length()) {
                char character = input.charAt(index);
                index += 1;
                if (character == '"') {
                    return value.toString();
                }
                if (character == '\\') {
                    appendEscape(value);
                } else if (character < 0x20) {
                    throw error("strings cannot contain unescaped control characters");
                } else {
                    value.append(character);
                }
            }
            throw error("unterminated string");
        }

        /** Skips only the four whitespace characters permitted by JSON. */
        void skipWhitespace() {
            while (index < input.length()) {
                char character = input.charAt(index);
                if (character != ' '
                        && character != '\n'
                        && character != '\r'
                        && character != '\t') {
                    return;
                }
                index += 1;
            }
        }

        /** Decodes one escape after its leading backslash has been consumed. */
        private void appendEscape(StringBuilder value) throws GraphwarInvalidShotException {
            if (index >= input.length()) {
                throw error("unterminated string escape");
            }
            char escaped = input.charAt(index);
            index += 1;
            switch (escaped) {
                case '"':
                case '\\':
                case '/':
                    value.append(escaped);
                    return;
                case 'b':
                    value.append('\b');
                    return;
                case 'f':
                    value.append('\f');
                    return;
                case 'n':
                    value.append('\n');
                    return;
                case 'r':
                    value.append('\r');
                    return;
                case 't':
                    value.append('\t');
                    return;
                case 'u':
                    value.append(readUnicodeEscape());
                    return;
                default:
                    throw error("unsupported string escape");
            }
        }

        /** Requires and consumes one nonempty decimal digit run. */
        private void readDigits(String missingMessage) throws GraphwarInvalidShotException {
            int start = index;
            while (index < input.length() && isDigit(input.charAt(index))) {
                index += 1;
            }
            if (index == start) {
                throw error(missingMessage);
            }
        }

        /** Decodes exactly four hexadecimal digits as one Java UTF-16 code unit. */
        private char readUnicodeEscape() throws GraphwarInvalidShotException {
            if (index + 4 > input.length()) {
                throw error("incomplete unicode escape");
            }
            int value = 0;
            for (int offset = 0; offset < 4; offset += 1) {
                int digit = Character.digit(input.charAt(index + offset), 16);
                if (digit < 0) {
                    throw error("invalid unicode escape");
                }
                value = value * 16 + digit;
            }
            index += 4;
            return (char) value;
        }

        /** Avoids accepting non-ASCII Unicode digits in JSON numbers. */
        private static boolean isDigit(char character) {
            return character >= '0' && character <= '9';
        }
    }
}
