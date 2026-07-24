package Graphwar;

/** Measures the unmodified Graphwar parser in fresh JVMs launched with a 1 MiB thread stack. */
public final class GraphwarFunctionLimitProbe {
    /** Prevents construction of the manual probe entry point. */
    private GraphwarFunctionLimitProbe() {}

    /** Runs one mixed-shape safety, evaluation-cost, or bracket-volume measurement. */
    public static void main(String[] arguments) throws Exception {
        if (arguments.length == 3 && "mixed".equals(arguments[0])) {
            try {
                verifyMixed(Integer.parseInt(arguments[1]), Integer.parseInt(arguments[2]));
                System.out.println("pass");
            } catch (StackOverflowError error) {
                System.out.println("overflow");
                System.exit(1);
            }
            return;
        }
        if (arguments.length == 2 && "performance".equals(arguments[0])) {
            measurePerformance(Integer.parseInt(arguments[1]));
            return;
        }
        if (arguments.length == 3 && "combined".equals(arguments[0])) {
            measureCombinedBoundary(Integer.parseInt(arguments[1]), Integer.parseInt(arguments[2]));
            return;
        }
        if (arguments.length == 2 && "bracket".equals(arguments[0])) {
            measureBracketFormula(Integer.parseInt(arguments[1]));
            return;
        }
        throw new IllegalArgumentException(
                "expected mixed, performance, combined, or bracket mode");
    }

    /** Parses and evaluates every known worst shape repeatedly in the same cold JVM profile. */
    private static void verifyMixed(int maximumTokens, int repetitions) throws Exception {
        verifyShape("plus", (maximumTokens + 1) / 2, repetitions);
        verifyShape("power", (maximumTokens + 1) / 2, repetitions);
        verifyShape("unary", maximumTokens - 1, repetitions);
        verifyShape("implicit", (maximumTokens + 1) / 4, repetitions);
    }

    /** Recreates the original recursive parser and evaluator for one formula shape. */
    private static void verifyShape(String shape, int terms, int repetitions) throws Exception {
        String formula = createFormula(shape, terms);
        for (int repetition = 0; repetition < repetitions; repetition += 1) {
            new PolishNotationFunction(formula).evaluateFunction(1.25, 0.5, -0.25);
        }
    }

    /** Times 20,000 original recursive evaluations for each shape at the configured boundary. */
    private static void measurePerformance(int maximumTokens) throws Exception {
        measureShape("plus", (maximumTokens + 1) / 2);
        measureShape("power", (maximumTokens + 1) / 2);
        measureShape("unary", maximumTokens - 1);
        measureShape("implicit", (maximumTokens + 1) / 4);
    }

    /** Emits one bounded evaluation timing while retaining a checksum against dead-code removal. */
    private static void measureShape(String shape, int terms) throws Exception {
        PolishNotationFunction function = new PolishNotationFunction(createFormula(shape, terms));
        double checksum = 0.0;
        long startedAt = System.nanoTime();
        for (int iteration = 0; iteration < 20_000; iteration += 1) {
            checksum += function.evaluateFunction(1.25, 0.5, -0.25);
        }
        System.out.println(
                "shape="
                        + shape
                        + " evaluations=20000 ms="
                        + ((System.nanoTime() - startedAt) / 1_000_000L)
                        + " checksum="
                        + checksum);
    }

    /** Times parsing when both configured formula limits are reached by one worst-shape input. */
    private static void measureCombinedBoundary(int functionBytes, int maximumTokens)
            throws Exception {
        int unaryTokens = maximumTokens - 1;
        int ignoredBytes = (functionBytes - unaryTokens * 2 - 1) & 1;
        int bracketPairs = (functionBytes - unaryTokens * 2 - 1 - ignoredBytes) / 2;
        if (unaryTokens < 0 || bracketPairs < 0) {
            throw new IllegalArgumentException("combined boundary cannot fit in the byte limit");
        }

        StringBuilder formula = new StringBuilder(functionBytes);
        for (int index = 0; index < bracketPairs; index += 1) {
            formula.append('(');
        }
        for (int index = 0; index < unaryTokens; index += 1) {
            formula.append("tg");
        }
        formula.append('x');
        if (ignoredBytes != 0) {
            formula.append('?');
        }
        for (int index = 0; index < bracketPairs; index += 1) {
            formula.append(')');
        }
        if (formula.length() != functionBytes) {
            throw new AssertionError("combined boundary byte count changed");
        }

        long startedAt = System.nanoTime();
        new PolishNotationFunction(formula.toString());
        System.out.println(
                "combinedBytes="
                        + functionBytes
                        + " combinedTokens="
                        + maximumTokens
                        + " parseMs="
                        + ((System.nanoTime() - startedAt) / 1_000_000L));
    }

    /** Times the original parser on a valid one-token formula dominated by bracket objects. */
    private static void measureBracketFormula(int functionBytes) throws Exception {
        if ((functionBytes & 1) == 0) {
            throw new IllegalArgumentException("bracket formula byte count must be odd");
        }
        int bracketPairs = (functionBytes - 1) / 2;
        StringBuilder formula = new StringBuilder(functionBytes);
        for (int index = 0; index < bracketPairs; index += 1) {
            formula.append('(');
        }
        formula.append('x');
        for (int index = 0; index < bracketPairs; index += 1) {
            formula.append(')');
        }
        long startedAt = System.nanoTime();
        new PolishNotationFunction(formula.toString());
        System.out.println(
                "functionBytes="
                        + functionBytes
                        + " parseMs="
                        + ((System.nanoTime() - startedAt) / 1_000_000L));
    }

    /** Builds one formula whose effective token count is at or immediately below the target. */
    private static String createFormula(String shape, int terms) {
        StringBuilder formula = new StringBuilder(terms * 4);
        if ("unary".equals(shape)) {
            for (int index = 0; index < terms; index += 1) {
                formula.append("sin");
            }
            return formula.append('x').toString();
        }
        for (int index = 0; index < terms; index += 1) {
            if (index > 0 && !"implicit".equals(shape)) {
                formula.append("plus".equals(shape) ? '+' : '^');
            }
            formula.append("implicit".equals(shape) ? "2x" : "x");
        }
        return formula.toString();
    }
}
