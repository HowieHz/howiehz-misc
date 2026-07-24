package Graphwar;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Minimal official parser fixture covering malformed input, JVM errors, and numeric tokens. */
public final class Function {
    private static final Pattern NUMBER_PATTERN = Pattern.compile("[0-9]*\\.?[0-9]+");

    /** Applies the original numeric token rule while retaining explicit failure sentinels. */
    public Function(String function) throws MalformedFunction {
        if ("bad".equals(function)) {
            throw new MalformedFunction();
        }
        if ("error".equals(function)) {
            throw new AssertionError("simulated official parser error");
        }
        Matcher numbers = NUMBER_PATTERN.matcher(function);
        while (numbers.find()) {
            Double.parseDouble(numbers.group());
        }
    }
}
