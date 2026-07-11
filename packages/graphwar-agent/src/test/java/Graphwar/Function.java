package Graphwar;

/** Minimal official parser fixture used to reject one known malformed expression. */
public final class Function {
    /** Accepts every non-test-sentinel function. */
    public Function(String function) throws MalformedFunction {
        if ("bad".equals(function)) {
            throw new MalformedFunction();
        }
    }
}
