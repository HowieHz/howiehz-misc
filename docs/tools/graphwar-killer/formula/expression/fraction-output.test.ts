import { describe, expect, it } from "vitest";

import { createGraphwarExpressionEvaluator } from "./evaluator";
import { convertGraphwarExpressionDecimalsToFractions } from "./fraction-output";

describe("convertGraphwarExpressionDecimalsToFractions", () => {
  it("converts Graphwar decimal literals to lowest-term fractions when their double values agree", () => {
    expect(convertGraphwarExpressionDecimalsToFractions("0.5*x+.25+1.2500-2.0+-0.125")).toEqual({
      expression: "1/2*x+1/4+5/4-2+-1/8",
      fullyConverted: true,
    });
  });

  it("falls back to the exact binary rational when decimal lowest terms change Graphwar's double value", () => {
    const original = "88.008750871454684";
    const converted = convertGraphwarExpressionDecimalsToFractions(original);

    expect(converted).toEqual({
      expression: "3096532637734579/35184372088832",
      fullyConverted: true,
    });
    expect(evaluateGraphwarNumericFraction(converted.expression)).toBe(Number(original));
  });

  it("adds parentheses only where Graphwar would otherwise change the operation order", () => {
    expect(convert("x/0.5")).toBe("x/1/2");
    expect(convert("0.5/x")).toBe("(1/2)/x");
    expect(convert("0.5/0.25/0.125")).toBe("(1/2)/(1/4)/1/8");
    expect(convert("0.5^x+x^1.5")).toBe("(1/2)^x+x^(3/2)");
  });

  it("keeps adjacent Graphwar numeric tokens separate after conversion", () => {
    const converted = convertGraphwarExpressionDecimalsToFractions(".5.5+1.0.5");
    const evaluateOriginal = createGraphwarExpressionEvaluator(".5.5+1.0.5");
    const evaluateConverted = createGraphwarExpressionEvaluator(converted.expression);

    expect(converted).toEqual({ expression: "(1/2)1/2+(1)1/2", fullyConverted: true });
    expect(evaluateConverted?.(0, 0, 0)).toBe(evaluateOriginal?.(0, 0, 0));
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
    const converted = convert(expression);
    const evaluateOriginal = createGraphwarExpressionEvaluator(expression);
    const evaluateConverted = createGraphwarExpressionEvaluator(converted);

    expect(evaluateOriginal).toBeDefined();
    expect(evaluateConverted).toBeDefined();
    expect(evaluateConverted?.(x, 0, 0)).toBe(evaluateOriginal?.(x, 0, 0));
  });

  it("keeps only decimal literals whose exact rational cannot survive Graphwar parsing", () => {
    const smallestSubnormal = `0.${"0".repeat(323)}49406564584124654`;
    const result = convertGraphwarExpressionDecimalsToFractions(`0.5+${smallestSubnormal}+.25`);
    const adjacentResult = convertGraphwarExpressionDecimalsToFractions(`${smallestSubnormal}.5`);

    expect(result).toEqual({ expression: `1/2+${smallestSubnormal}+1/4`, fullyConverted: false });
    expect(adjacentResult).toEqual({ expression: `(${smallestSubnormal})1/2`, fullyConverted: false });
    expect(Number(smallestSubnormal)).toBe(Number.MIN_VALUE);
  });

  it("handles finite double boundaries without emitting Infinity or changing zero", () => {
    const smallestNormal = `0.${"0".repeat(307)}22250738585072014`;
    const largestFiniteInteger = (((1n << 53n) - 1n) << 971n).toString();

    expect(convertGraphwarExpressionDecimalsToFractions("0.0")).toEqual({
      expression: "0",
      fullyConverted: true,
    });
    const negativeZeroResult = convertGraphwarExpressionDecimalsToFractions("-0.0");
    const evaluateNegativeZero = createGraphwarExpressionEvaluator(negativeZeroResult.expression);
    expect(negativeZeroResult).toEqual({ expression: "-0", fullyConverted: true });
    expect(Object.is(createGraphwarExpressionEvaluator("-0.0")?.(0, 0, 0), 0)).toBe(true);
    expect(Object.is(evaluateNegativeZero?.(0, 0, 0), 0)).toBe(true);
    const smallestNormalResult = convertGraphwarExpressionDecimalsToFractions(smallestNormal);
    expect(smallestNormalResult.fullyConverted).toBe(true);
    expect(evaluateGraphwarNumericFraction(smallestNormalResult.expression)).toBe(Number(smallestNormal));
    expect(convertGraphwarExpressionDecimalsToFractions(`${largestFiniteInteger}.0`)).toEqual({
      expression: largestFiniteInteger,
      fullyConverted: true,
    });
    const overflowedDecimal = `${largestFiniteInteger}0.0`;
    expect(convertGraphwarExpressionDecimalsToFractions(overflowedDecimal)).toEqual({
      expression: overflowedDecimal,
      fullyConverted: false,
    });
  });

  it("reports expressions without decimal literals as fully converted", () => {
    expect(convertGraphwarExpressionDecimalsToFractions("x+1/2")).toEqual({
      expression: "x+1/2",
      fullyConverted: true,
    });
  });
});

/** Extracts a simple fraction with the same two parses and one division used by Graphwar. */
function evaluateGraphwarNumericFraction(expression: string) {
  const [numerator, denominator] = expression.split("/");
  return Number(numerator) / Number(denominator);
}

/** Returns only the expression for operation-order assertions. */
function convert(expression: string) {
  return convertGraphwarExpressionDecimalsToFractions(expression).expression;
}
