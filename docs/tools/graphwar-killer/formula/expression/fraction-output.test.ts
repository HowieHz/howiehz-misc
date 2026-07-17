import { describe, expect, it } from "vitest";

import { createGraphwarExpressionEvaluator } from "./evaluator";
import { convertGraphwarExpressionDecimalsToFractions } from "./fraction-output";

describe("convertGraphwarExpressionDecimalsToFractions", () => {
  it("converts each exact decimal literal to a lowest-term fraction", () => {
    expect(convertGraphwarExpressionDecimalsToFractions("0.5*x+1.2500-2.0+-0.125")).toBe("1/2*x+5/4-2+-1/8");
    expect(convertGraphwarExpressionDecimalsToFractions("0.0000000000000002220446049250313")).toBe(
      "2220446049250313/10000000000000000000000000000000",
    );
    expect(convertGraphwarExpressionDecimalsToFractions("88.008750871454684")).toBe(
      "22002187717863671/250000000000000",
    );
  });

  it("adds parentheses only where Graphwar would otherwise change the operation order", () => {
    expect(convertGraphwarExpressionDecimalsToFractions("x/0.5")).toBe("x/1/2");
    expect(convertGraphwarExpressionDecimalsToFractions("0.5/x")).toBe("(1/2)/x");
    expect(convertGraphwarExpressionDecimalsToFractions("0.5/0.25/0.125")).toBe("(1/2)/(1/4)/1/8");
    expect(convertGraphwarExpressionDecimalsToFractions("0.5^x+x^1.5")).toBe("(1/2)^x+x^(3/2)");
  });

  it.each([
    ["1.5*x+0.25", 2],
    ["x/1.5", 3],
    ["1.5/x", 3],
    ["1.5/0.25/0.125", 3],
    ["1.5^x", 2],
    ["x^1.5", 4],
    ["0.0000000000000002220446049250313", 0],
  ])("preserves Graphwar operation order for %s", (expression, x) => {
    const converted = convertGraphwarExpressionDecimalsToFractions(expression);
    const evaluateOriginal = createGraphwarExpressionEvaluator(expression);
    const evaluateConverted = createGraphwarExpressionEvaluator(converted);

    expect(evaluateOriginal).toBeDefined();
    expect(evaluateConverted).toBeDefined();
    expect(evaluateConverted?.(x, 0, 0)).toBe(evaluateOriginal?.(x, 0, 0));
  });
});
