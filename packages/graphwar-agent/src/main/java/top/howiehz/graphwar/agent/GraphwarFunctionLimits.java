package top.howiehz.graphwar.agent;

/** Applies bounded, iterative checks that mirror Graphwar's accepted formula tokens. */
final class GraphwarFunctionLimits {
    private static final int ADD = 1;
    private static final int BINARY = 2;
    private static final int LEFT_BRACKET = 3;
    private static final int RIGHT_BRACKET = 4;
    private static final int UNARY = 5;
    private static final int VALUE = 6;
    private static final String[] WORD_TOKENS = {
        "sqrt", "log", "abs", "sin", "sen", "cos", "tan", "tg", "ln", "e", "pi"
    };
    private final int maxBytes;
    private final int maxTokens;

    /** Retains the two independent input-volume and evaluation-work limits. */
    GraphwarFunctionLimits(int maxBytes, int maxTokens) {
        this.maxBytes = maxBytes;
        this.maxTokens = maxTokens;
    }

    /** Rejects a formula before the recursive official parser or network protocol sees it. */
    void validate(String function) throws GraphwarInvalidFunctionException {
        if (countUtf8Bytes(function, maxBytes) > maxBytes) {
            throw new GraphwarInvalidFunctionException("Graphwar function exceeds the byte limit");
        }
        if (countTokens(function, maxTokens) > maxTokens) {
            throw new GraphwarInvalidFunctionException("Graphwar function exceeds the token limit");
        }
    }

    /** Counts Graphwar's effective evaluation tokens and stops immediately above the bound. */
    static int countTokens(String function, int maximum) {
        // Source: PolishNotationFunction.createRegularNotationTokens lowercases the input,
        // rewrites minus/exp/comma, then applies its fixed token regex and implicit products.
        // String lowercasing is intentionally retained because Unicode special casing can expand
        // one source character. Production callers enforce the configured byte limit first.
        String normalized = function.toLowerCase();
        int count = 0;
        int pendingType = 0;
        int previousType = 0;
        for (int index = 0; index < normalized.length() || pendingType != 0; ) {
            int tokenType;
            if (pendingType != 0) {
                tokenType = pendingType;
                pendingType = 0;
            } else {
                tokenType = 0;
                char character = normalizeCharacter(normalized.charAt(index));
                if (character == '-') {
                    // Graphwar rewrites each minus into a binary plus followed by unary minus.
                    tokenType = ADD;
                    pendingType = UNARY;
                    index += 1;
                } else if (startsWithToken(normalized, index, "exp")) {
                    // Graphwar rewrites exp into the constant e followed by exponentiation.
                    tokenType = VALUE;
                    pendingType = BINARY;
                    index += 3;
                } else if (isDigit(character)
                        || (character == '.'
                                && index + 1 < normalized.length()
                                && isDigit(normalized.charAt(index + 1)))) {
                    int cursor = index;
                    while (cursor < normalized.length() && isDigit(normalized.charAt(cursor))) {
                        cursor += 1;
                    }
                    if (cursor < normalized.length()
                            && normalizeCharacter(normalized.charAt(cursor)) == '.') {
                        int fractionStart = cursor + 1;
                        int fractionEnd = fractionStart;
                        while (fractionEnd < normalized.length()
                                && isDigit(normalized.charAt(fractionEnd))) {
                            fractionEnd += 1;
                        }
                        if (fractionEnd > fractionStart) {
                            cursor = fractionEnd;
                        }
                    }
                    tokenType = VALUE;
                    index = cursor;
                } else if (character == '(') {
                    tokenType = LEFT_BRACKET;
                    index += 1;
                } else if (character == ')') {
                    tokenType = RIGHT_BRACKET;
                    index += 1;
                } else if (character == 'x' || character == 'y') {
                    // The original regex lists y before y', so the apostrophe is ignored.
                    tokenType = VALUE;
                    index += 1;
                } else if (character == '+') {
                    tokenType = ADD;
                    index += 1;
                } else if (character == '*' || character == '/' || character == '^') {
                    tokenType = BINARY;
                    index += 1;
                } else {
                    for (String token : WORD_TOKENS) {
                        if (startsWithToken(normalized, index, token)) {
                            tokenType = "e".equals(token) || "pi".equals(token) ? VALUE : UNARY;
                            index += token.length();
                            break;
                        }
                    }
                    if (tokenType == 0) {
                        index += 1;
                    }
                }
            }

            if (tokenType == 0) {
                continue;
            }
            if (tokenType == ADD && previousType != VALUE) {
                // Graphwar permits unary plus by inserting a zero when ADD has no left operand.
                // A right bracket may be unmatched or empty, so only a direct value proves one.
                count += 1;
            }
            if ((previousType == VALUE || previousType == RIGHT_BRACKET)
                    && (tokenType == VALUE || tokenType == LEFT_BRACKET || tokenType == UNARY)) {
                count += 1;
            }
            if (tokenType != LEFT_BRACKET && tokenType != RIGHT_BRACKET) {
                count += 1;
            }
            if (count > maximum) {
                return count;
            }
            previousType = tokenType;
        }
        return count;
    }

    /** Counts UTF-8 bytes without allocating an encoded copy and stops above the bound. */
    private static int countUtf8Bytes(String value, int maximum) {
        int count = 0;
        for (int index = 0; index < value.length(); index += 1) {
            char character = value.charAt(index);
            int width;
            if (character <= 0x7f) {
                width = 1;
            } else if (character <= 0x7ff) {
                width = 2;
            } else if (Character.isHighSurrogate(character)
                    && index + 1 < value.length()
                    && Character.isLowSurrogate(value.charAt(index + 1))) {
                width = 4;
                index += 1;
            } else if (Character.isSurrogate(character)) {
                // StandardCharsets.UTF_8 replaces each unpaired surrogate with one '?' byte.
                width = 1;
            } else {
                width = 3;
            }
            count += width;
            if (count > maximum) {
                return count;
            }
        }
        return count;
    }

    /** Matches one Graphwar vocabulary token in the already-lowercased formula. */
    private static boolean startsWithToken(String function, int index, String token) {
        if (index + token.length() > function.length()) {
            return false;
        }
        for (int offset = 0; offset < token.length(); offset += 1) {
            if (function.charAt(index + offset) != token.charAt(offset)) {
                return false;
            }
        }
        return true;
    }

    /** Applies Graphwar's comma-to-decimal-point rewrite without copying the formula again. */
    private static char normalizeCharacter(char character) {
        return character == ',' ? '.' : character;
    }

    /** Keeps Graphwar number matching restricted to ASCII decimal digits. */
    private static boolean isDigit(char character) {
        return character >= '0' && character <= '9';
    }
}
