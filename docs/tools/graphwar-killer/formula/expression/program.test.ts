import { describe, expect, it } from "vitest";

import { createGraphwarExpressionEvaluator, parseGraphwarExpressionProgram } from "./evaluator";
import {
  createGraphwarExpressionProgram,
  createGraphwarExpressionProgramEvaluator,
  GraphwarExpressionOpcode,
  isGraphwarExpressionProgram,
} from "./program";

describe("Graphwar canonical expression programs", () => {
  it("pins the VM opcode ABI to the original Graphwar token numbers", () => {
    expect([
      GraphwarExpressionOpcode.Add,
      GraphwarExpressionOpcode.Negate,
      GraphwarExpressionOpcode.Multiply,
      GraphwarExpressionOpcode.Divide,
      GraphwarExpressionOpcode.Pow,
      GraphwarExpressionOpcode.Sqrt,
      GraphwarExpressionOpcode.Log10,
      GraphwarExpressionOpcode.Abs,
      GraphwarExpressionOpcode.Sin,
      GraphwarExpressionOpcode.Cos,
      GraphwarExpressionOpcode.Tan,
      GraphwarExpressionOpcode.Ln,
      GraphwarExpressionOpcode.X,
      GraphwarExpressionOpcode.Y,
      GraphwarExpressionOpcode.DY,
      GraphwarExpressionOpcode.Constant,
    ]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("keeps the stable prefix opcode and constant layout", () => {
    const program = parseGraphwarExpressionProgram("x/y^2");

    expect(program).toEqual({
      constants: new Float64Array([2]),
      maximumStackSize: 2,
      opcodes: new Uint8Array([
        GraphwarExpressionOpcode.Divide,
        GraphwarExpressionOpcode.X,
        GraphwarExpressionOpcode.Pow,
        GraphwarExpressionOpcode.Y,
        GraphwarExpressionOpcode.Constant,
      ]),
    });
  });

  it("computes the exact reverse-evaluation stack high-water mark", () => {
    const program = parseGraphwarExpressionProgram("(x+y)*y'");

    expect(program).toEqual({
      constants: new Float64Array(),
      maximumStackSize: 3,
      opcodes: new Uint8Array([
        GraphwarExpressionOpcode.Multiply,
        GraphwarExpressionOpcode.Add,
        GraphwarExpressionOpcode.X,
        GraphwarExpressionOpcode.Y,
        GraphwarExpressionOpcode.DY,
      ]),
    });
  });

  it.each([
    ["1+2", 3],
    ["-2", -2],
    ["2*3", 6],
    ["6/3", 2],
    ["2^3", 8],
    ["sqrt(9)", 3],
    ["log(100)", 2],
    ["abs(-3)", 3],
    ["sin(pi/2)", 1],
    ["sen(pi/2)", 1],
    ["cos(0)", 1],
    ["tan(0)", 0],
    ["tg(0)", 0],
    ["ln(e)", 1],
    ["x+y+y'", 6],
    ["exp(0)", 1],
  ])("evaluates %s with the existing Graphwar operator semantics", (expression, expected) => {
    expect(createGraphwarExpressionEvaluator(expression)?.(1, 2, 3)).toBeCloseTo(expected, 15);
  });

  it.each([
    ["2x", 6],
    ["2(x+1)", 8],
    ["(x)y", 12],
    ["2sin(x)", 2 * Math.sin(3)],
    ["1,5x", 4.5],
    [".5.5", 0.25],
  ])("preserves implicit multiplication and decimal compatibility for %s", (expression, expected) => {
    expect(createGraphwarExpressionEvaluator(expression)?.(3, 4, 5)).toBeCloseTo(expected, 15);
  });

  it("preserves the original right-associative token selection", () => {
    const rightAssociated = parseGraphwarExpressionProgram("1/2/4");
    const explicitlyLeftAssociated = parseGraphwarExpressionProgram("(1/2)/4");

    expect(rightAssociated?.maximumStackSize).toBe(2);
    expect(explicitlyLeftAssociated?.maximumStackSize).toBe(3);
    expect(rightAssociated && createGraphwarExpressionProgramEvaluator(rightAssociated)(0, 0, 0)).toBe(2);
    expect(
      explicitlyLeftAssociated && createGraphwarExpressionProgramEvaluator(explicitlyLeftAssociated)(0, 0, 0),
    ).toBe(0.125);
  });

  it("preserves both parser options without folding them into VM opcodes", () => {
    expect(
      createGraphwarExpressionEvaluator("y'", {
        shouldParseDerivativeAsY: false,
        shouldSkipUnknownCharacters: false,
      })?.(1, 2, 3),
    ).toBe(3);
    expect(
      createGraphwarExpressionEvaluator("y'", {
        shouldParseDerivativeAsY: true,
        shouldSkipUnknownCharacters: false,
      }),
    ).toBeUndefined();
    expect(
      createGraphwarExpressionEvaluator("y'", {
        shouldParseDerivativeAsY: true,
        shouldSkipUnknownCharacters: true,
      })?.(1, 2, 3),
    ).toBe(2);
    expect(
      createGraphwarExpressionEvaluator("x?", {
        shouldParseDerivativeAsY: false,
        shouldSkipUnknownCharacters: true,
      })?.(4, 0, 0),
    ).toBe(4);
    expect(
      createGraphwarExpressionEvaluator("x?", {
        shouldParseDerivativeAsY: false,
        shouldSkipUnknownCharacters: false,
      }),
    ).toBeUndefined();
  });

  it("preserves Java terminal non-finite values and permits finite recovery from an infinite constant", () => {
    const overflowingDecimal = "9".repeat(400);

    expect(createGraphwarExpressionEvaluator("1/0")?.(0, 0, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(createGraphwarExpressionEvaluator("-1/0")?.(0, 0, 0)).toBe(Number.NEGATIVE_INFINITY);
    expect(createGraphwarExpressionEvaluator("sqrt(-1)")?.(0, 0, 0)).toBeNaN();
    expect(createGraphwarExpressionEvaluator("2^1024")?.(0, 0, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(createGraphwarExpressionEvaluator(`1/${overflowingDecimal}`)?.(0, 0, 0)).toBe(0);
    expect(Object.is(createGraphwarExpressionEvaluator("-0.0")?.(0, 0, 0), 0)).toBe(true);
  });

  it("evaluates deeply nested valid input without a recursive program walk", () => {
    let expression = "1";
    for (let value = 2; value <= 128; value += 1) {
      expression = `(${expression}+${value})`;
    }

    const program = parseGraphwarExpressionProgram(expression);
    expect(program?.maximumStackSize).toBe(128);
    expect(program && createGraphwarExpressionProgramEvaluator(program)(0, 0, 0)).toBe((128 * 129) / 2);
  });

  it.each([
    {
      constants: new Float64Array(),
      maximumStackSize: 1,
      opcodes: new Uint8Array([0]),
    },
    {
      constants: new Float64Array(),
      maximumStackSize: 1,
      opcodes: new Uint8Array([GraphwarExpressionOpcode.Add, GraphwarExpressionOpcode.X]),
    },
    {
      constants: new Float64Array(),
      maximumStackSize: 2,
      opcodes: new Uint8Array([GraphwarExpressionOpcode.X, GraphwarExpressionOpcode.Y]),
    },
    {
      constants: new Float64Array(),
      maximumStackSize: 1,
      opcodes: new Uint8Array([GraphwarExpressionOpcode.Constant]),
    },
    {
      constants: new Float64Array([1]),
      maximumStackSize: 2,
      opcodes: new Uint8Array([GraphwarExpressionOpcode.Constant]),
    },
  ])("rejects malformed program structure at the runtime boundary", (program) => {
    expect(isGraphwarExpressionProgram(program)).toBe(false);
  });

  it("accepts canonical programs with Java-compatible non-finite constants and rejects forged metadata", () => {
    for (const expected of [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NaN]) {
      const program = createGraphwarExpressionProgram(
        new Uint8Array([GraphwarExpressionOpcode.Constant]),
        new Float64Array([expected]),
      );
      expect(program).toBeDefined();
      expect(isGraphwarExpressionProgram(program)).toBe(true);
      expect(Object.is(program && createGraphwarExpressionProgramEvaluator(program)(0, 0, 0), expected)).toBe(true);
      expect(program && isGraphwarExpressionProgram({ ...program, maximumStackSize: 2 })).toBe(false);
    }
  });

  it.each(["", " ", "+", "sin", "()", "x?"])("keeps invalid source %j outside the VM", (expression) => {
    expect(parseGraphwarExpressionProgram(expression)).toBeUndefined();
  });
});
