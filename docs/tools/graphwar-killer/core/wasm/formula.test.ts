import { beforeAll, describe, expect, it } from "vitest";

import {
  buildFormula,
  compileFormulaEvaluator,
  compileGraphwarFormulaMaterials,
  GraphwarSignRole,
} from "../../formula/generation/build";
import type {
  CompiledAbsConnectorSegment,
  CompiledAbsSecondDerivativePulse,
  CompiledGraphwarFormulaMaterials,
  CompiledSoftCubicSegment,
  CompiledStepTerm,
  FormulaEvaluationOptions,
} from "../../formula/generation/build";
import type { StepGlitchSegment } from "../../formula/generation/step-numeric-strategy";
import {
  createGraphwarTrajectoryFormulaMode,
  getGraphwarTrajectoryLaunchAngle,
  resolveGraphwarTrajectory,
} from "../../formula/trajectory/sampling";
import { createGraphwarGameConstantData, GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { graphwarToolDefaults } from "../tool/defaults";
import { createGraphPoint, type AlgorithmMode, type BoundsRect, type EquationMode, type GraphPoint } from "../types";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";

const FORMULA_INPUT_BYTE_LENGTH = 176;
const FORMULA_RESULT_BYTE_LENGTH = 48;
const STEP_MATERIAL_BYTE_LENGTH = 112;
const SOFT_MATERIAL_BYTE_LENGTH = 144;
const ABS_CONNECTOR_BYTE_LENGTH = 40;
const ABS_PULSE_BYTE_LENGTH = 16;
const FORMULA_LAUNCH_RESULT_BYTE_LENGTH = 80;
const STEP_GLITCH_RECORD_BYTE_LENGTH = 72;
const DEFAULT_MAX_ULP_DISTANCE = 64n;
// V8 12.x and the WASM-native pow implementation round the high powers used by
// soft-cubic ddy differently; cancellation can amplify that difference.
const SOFT_CUBIC_DDY_MAX_ULP_DISTANCE = 256n;
const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 };
const points = [
  createGraphPoint(-2, 1),
  createGraphPoint(-0.25, 2.5),
  createGraphPoint(1.5, -1.25),
  createGraphPoint(4, 3.75),
] as const satisfies readonly GraphPoint[];
const values = [
  { dy: -0.75, x: -3, y: 0.5 },
  { dy: 0, x: -0.25, y: 2.5 },
  { dy: 1.25, x: 0.75, y: -2 },
  { dy: -3, x: 5, y: 4 },
] as const;

interface FormulaKernelExports {
  getArenaCursor: () => number;
  initializeArena: (initialCapacity: number) => number;
  initializeGraphwarGameConstants: (pointer: number, count: number) => number;
  markArena: () => number;
  memory: WebAssembly.Memory;
  reserveArena: (byteLength: number, alignment: number) => number;
  resetArena: (markToken: number) => void;
  runFormula: (command: number, inputPointer: number, inputByteLength: number) => number;
}

interface WasmFormulaBatchResult {
  auxiliaryValue: number;
  flags: number;
  materialCount: number;
  materialPointer: number;
  materialStride: number;
  materialType: number;
  observedProtection: number[];
  values: number[];
}

interface WasmFormulaLaunchResult {
  angle: number;
  flags: number;
  formulaPointIterationCount: number;
  formulaPoints: GraphPoint[];
  initialDy: number;
  iterationCount: number;
  material?: WasmFormulaBatchResult;
  materialResultPointer: number;
  observedProtection: number[];
  status: number;
  x: number;
  y: number;
  yOffset: number;
}

let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Graphwar WASM formula kernel", () => {
  for (const algorithm of ["abs", "step", "pchip", "akima"] as const) {
    for (const equation of ["y", "dy", "ddy"] as const) {
      it(`builds and evaluates ${algorithm}:${equation} from the canonical path descriptor`, async () => {
        const decimalPlaces = 4;
        const steepness = 3.25;
        const signProtection = [
          GraphwarSignRole.StartX | GraphwarSignRole.EndX | GraphwarSignRole.CenterX,
          GraphwarSignRole.StartX | GraphwarSignRole.EndX | GraphwarSignRole.CenterX,
          GraphwarSignRole.StartX | GraphwarSignRole.EndX | GraphwarSignRole.CenterX,
        ];
        const formulaEvaluation = {
          equation,
          formulaDecimalPlaces: decimalPlaces,
          isStepOverflowProtectionEnabled: true,
          signProtection,
          stepOverflowProtectionRange: { maxX: bounds.maxX, minX: points[0].x },
        } satisfies FormulaEvaluationOptions;
        const expectedMaterials = compileGraphwarFormulaMaterials(points, steepness, algorithm, formulaEvaluation);
        const expectedEvaluator = compileFormulaEvaluator(
          points,
          steepness,
          algorithm,
          formulaEvaluation,
          expectedMaterials,
        );
        const expectedValues = values.map((value) =>
          equation === "y"
            ? expectedEvaluator.evaluateY(value.x)
            : equation === "dy"
              ? expectedEvaluator.evaluateFirstDerivativeY(value.x, value.y)
              : expectedEvaluator.evaluateSecondDerivativeY(value.x, value.y, value.dy),
        );

        const exports = await instantiateKernel();
        const mark = exports.markArena();
        try {
          const actual = runFormulaBatch(exports, {
            algorithm,
            decimalPlaces,
            equation,
            isStepOverflowProtectionEnabled: true,
            points,
            signProtection,
            steepness,
            values,
          });
          expectFormulaMaterialsEquivalent(
            decodeMaterials(exports, algorithm, equation, actual),
            getModeRelevantMaterials(expectedMaterials, algorithm, equation),
          );
          expect(actual.values).toHaveLength(expectedValues.length);
          for (let index = 0; index < expectedValues.length; index += 1) {
            expectFormulaValueEquivalent(
              actual.values[index],
              expectedValues[index],
              algorithm,
              equation,
              `${algorithm}:${equation} value ${index}`,
            );
          }
        } finally {
          exports.resetArena(mark);
        }
      });
    }
  }

  it.each([0, 15])("keeps all 12 material descriptors equivalent at %i decimal places", async (decimalPlaces) => {
    const exports = await instantiateKernel();
    for (const algorithm of ["abs", "step", "pchip", "akima"] as const) {
      for (const equation of ["y", "dy", "ddy"] as const) {
        const formulaEvaluation = {
          equation,
          formulaDecimalPlaces: decimalPlaces,
          isStepOverflowProtectionEnabled: true,
          stepOverflowProtectionRange: { maxX: bounds.maxX, minX: points[0].x },
        } satisfies FormulaEvaluationOptions;
        const expectedMaterials = compileGraphwarFormulaMaterials(points, 210, algorithm, formulaEvaluation);
        const expectedEvaluator = compileFormulaEvaluator(points, 210, algorithm, formulaEvaluation, expectedMaterials);
        const mark = exports.markArena();
        try {
          const actual = runFormulaBatch(exports, {
            algorithm,
            decimalPlaces,
            equation,
            isStepOverflowProtectionEnabled: true,
            points,
            signProtection: [],
            steepness: 210,
            values,
          });
          expectFormulaMaterialsEquivalent(
            decodeMaterials(exports, algorithm, equation, actual),
            getModeRelevantMaterials(expectedMaterials, algorithm, equation),
          );
          const expectedValues = values.map((value) =>
            equation === "y"
              ? expectedEvaluator.evaluateY(value.x)
              : equation === "dy"
                ? expectedEvaluator.evaluateFirstDerivativeY(value.x, value.y)
                : expectedEvaluator.evaluateSecondDerivativeY(value.x, value.y, value.dy),
          );
          expectedValues.forEach((expected, index) =>
            expectFormulaValueEquivalent(
              actual.values[index],
              expected,
              algorithm,
              equation,
              `${algorithm}:${equation}:${decimalPlaces}:${index}`,
            ),
          );
        } finally {
          exports.resetArena(mark);
        }
      }
    }
  });

  it("matches NaN, Infinity, and extreme exp/pow evaluator classifications in all 12 modes", async () => {
    const extremeValues = [
      { dy: Number.NaN, x: Number.NaN, y: Number.NaN },
      { dy: Number.POSITIVE_INFINITY, x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY },
      { dy: Number.NEGATIVE_INFINITY, x: Number.NEGATIVE_INFINITY, y: Number.POSITIVE_INFINITY },
      { dy: 1e308, x: 1e308, y: -1e308 },
      { dy: -1e308, x: -1e308, y: 1e308 },
    ] as const;
    const exports = await instantiateKernel();
    for (const algorithm of ["abs", "step", "pchip", "akima"] as const) {
      for (const equation of ["y", "dy", "ddy"] as const) {
        const formulaEvaluation = {
          equation,
          formulaDecimalPlaces: 15,
          isStepOverflowProtectionEnabled: true,
          stepOverflowProtectionRange: { maxX: bounds.maxX, minX: points[0].x },
        } satisfies FormulaEvaluationOptions;
        const expectedMaterials = compileGraphwarFormulaMaterials(points, 1_000, algorithm, formulaEvaluation);
        const expectedEvaluator = compileFormulaEvaluator(
          points,
          1_000,
          algorithm,
          formulaEvaluation,
          expectedMaterials,
        );
        const mark = exports.markArena();
        try {
          const actual = runFormulaBatch(exports, {
            algorithm,
            decimalPlaces: 15,
            equation,
            isStepOverflowProtectionEnabled: true,
            points,
            signProtection: [],
            steepness: 1_000,
            values: extremeValues,
          });
          const expectedValues = extremeValues.map((value) =>
            equation === "y"
              ? expectedEvaluator.evaluateY(value.x)
              : equation === "dy"
                ? expectedEvaluator.evaluateFirstDerivativeY(value.x, value.y)
                : expectedEvaluator.evaluateSecondDerivativeY(value.x, value.y, value.dy),
          );
          expectedValues.forEach((expected, index) =>
            expectFormulaValueEquivalent(
              actual.values[index],
              expected,
              algorithm,
              equation,
              `${algorithm}:${equation}:extreme:${index}`,
            ),
          );
        } finally {
          exports.resetArena(mark);
        }
      }
    }
  });

  it("preserves protected +0, unprotected NaN observation, and direct -0 for Step y''", async () => {
    const stepPoints = [createGraphPoint(-1, 0), createGraphPoint(0, 1)] as const;
    const protectedResult = await runOneStepCase(stepPoints, 1_000, [GraphwarSignRole.CenterX], true, 0);
    expect(Object.is(protectedResult.values[0], 0)).toBe(true);
    expect(protectedResult.observedProtection).toEqual([GraphwarSignRole.CenterX]);

    const unprotectedResult = await runOneStepCase(stepPoints, 1_000, [], true, 0);
    expect(unprotectedResult.values[0]).toBeNaN();
    expect(unprotectedResult.observedProtection).toEqual([GraphwarSignRole.CenterX]);

    const directResult = await runOneStepCase(stepPoints, 210, [], false, 4);
    expect(Object.is(directResult.values[0], -0)).toBe(true);
  });

  it.each(["dy", "ddy"] as const)("builds and evaluates canonical Step-glitch %s records", async (equation) => {
    const glitchPoints = [createGraphPoint(-2, 0), createGraphPoint(0.5, 3), createGraphPoint(3, -1)] as const;
    const glitchSegment: StepGlitchSegment =
      equation === "dy"
        ? {
            derivative: 123.456789,
            endX: 0.75,
            equation,
            formulaDecimalPlaces: 6,
            gateY: 2.625,
            startX: -0.5,
            targetY: 3,
          }
        : {
            acceleration: 987.654321,
            accelerationGateY: 2.625,
            braking: -345.678912,
            brakingGateY: 3.375,
            endX: 0.75,
            equation,
            formulaDecimalPlaces: 6,
            pulseEndX: 1,
            startX: -0.5,
            targetY: 3,
          };
    const signProtection = [
      GraphwarSignRole.StartX | GraphwarSignRole.EndX | GraphwarSignRole.GateY | GraphwarSignRole.BrakingGateY,
      0,
    ];
    const formulaEvaluation = {
      equation,
      formulaDecimalPlaces: 4,
      isStepOverflowProtectionEnabled: true,
      signProtection,
      stepGlitchSegments: [glitchSegment, undefined],
      stepOverflowProtectionRange: { maxX: bounds.maxX, minX: glitchPoints[0].x },
      stepSegmentDeltaYs: [3, undefined],
    } satisfies FormulaEvaluationOptions;
    const expectedMaterials = compileGraphwarFormulaMaterials(glitchPoints, 210, "step", formulaEvaluation);
    const expectedEvaluator = compileFormulaEvaluator(glitchPoints, 210, "step", formulaEvaluation, expectedMaterials);
    const glitchValues =
      glitchSegment.equation === "dy"
        ? [
            { dy: 0, x: glitchSegment.startX, y: glitchSegment.gateY },
            { dy: 0, x: glitchSegment.endX, y: 3.375 },
            { dy: 0, x: 0.125, y: 3 },
          ]
        : [
            { dy: 0, x: glitchSegment.startX, y: glitchSegment.accelerationGateY },
            { dy: 0, x: glitchSegment.pulseEndX, y: 3.375 },
            { dy: 0, x: 0.125, y: 3 },
          ];
    const exports = await instantiateKernel();
    const mark = exports.markArena();
    try {
      const actual = runFormulaBatch(exports, {
        algorithm: "step",
        decimalPlaces: 4,
        equation,
        formulaEvaluation,
        isStepOverflowProtectionEnabled: true,
        points: glitchPoints,
        signProtection,
        steepness: 210,
        values: glitchValues,
      });
      expectFormulaMaterialsEquivalent(decodeMaterials(exports, "step", equation, actual), expectedMaterials);
      const expectedValues = glitchValues.map((value) =>
        equation === "dy"
          ? expectedEvaluator.evaluateFirstDerivativeY(value.x, value.y)
          : expectedEvaluator.evaluateSecondDerivativeY(value.x, value.y, value.dy),
      );
      expectedValues.forEach((expected, index) =>
        expectFloatEquivalent(actual.values[index], expected, `step-glitch:${equation}:${index}`),
      );
      expect(actual.observedProtection[0]).toBeGreaterThan(0);
    } finally {
      exports.resetArena(mark);
    }
  });

  it("keeps Step decimal plateau accumulation above i64 equivalent to the TypeScript bigint state", async () => {
    const largePoints = [
      createGraphPoint(0, Math.PI),
      createGraphPoint(1, 10_000.1250000001),
      createGraphPoint(2, -4_000.8750000001),
      createGraphPoint(3, 10_000.1250000001),
    ] as const;
    const equation = "ddy" as const;
    const decimalPlaces = 15;
    const steepness = 67;
    const formulaEvaluation = {
      equation,
      formulaDecimalPlaces: decimalPlaces,
      isStepOverflowProtectionEnabled: true,
      stepOverflowProtectionRange: { maxX: bounds.maxX, minX: largePoints[0].x },
    } satisfies FormulaEvaluationOptions;
    const expected = compileGraphwarFormulaMaterials(largePoints, steepness, "step", formulaEvaluation);
    const exports = await instantiateKernel();
    const mark = exports.markArena();
    try {
      const actual = runFormulaBatch(exports, {
        algorithm: "step",
        decimalPlaces,
        equation,
        isStepOverflowProtectionEnabled: true,
        points: largePoints,
        signProtection: [],
        steepness,
        values: [{ dy: 0, x: 1.25, y: 0 }],
      });
      expectFormulaMaterialsEquivalent(decodeMaterials(exports, "step", equation, actual), expected);
    } finally {
      exports.resetArena(mark);
    }
  });

  for (const algorithm of ["abs", "step", "pchip", "akima"] as const) {
    for (const equation of ["y", "dy", "ddy"] as const) {
      it(`prepares the ${algorithm}:${equation} launch state from the canonical material snapshot`, async () => {
        const decimalPlaces = 4;
        const steepness = 3.25;
        const soldierCenter = points[0];
        const oracle = resolveGraphwarTrajectory({
          bounds,
          boundsRect,
          formulaMode: createGraphwarTrajectoryFormulaMode({
            algorithm,
            decimalPlaces,
            equation,
            isStepGlitchModeEnabled: false,
            isStepOverflowProtectionEnabled: true,
            secondOrderLaunchAngleMode: "full-precision",
            steepness,
          }),
          points,
          soldierCenter,
          start: { type: "cold" },
        });
        const formulaPoints = oracle.context.formulaPoints;
        const formulaEvaluation = oracle.context.formulaEvaluation;
        const expectedMaterials = oracle.context.compiledMaterials;
        const expectedAngle = getGraphwarTrajectoryLaunchAngle(oracle.context, soldierCenter);
        const expectedLaunchPoint = oracle.result.sample.points[0];
        if (!expectedLaunchPoint) {
          throw new Error("TypeScript launch oracle did not produce an initial point");
        }
        const expectedX = expectedLaunchPoint.x;
        const expectedY = expectedLaunchPoint.y;
        const expectedEvaluator = compileFormulaEvaluator(
          formulaPoints,
          steepness,
          algorithm,
          formulaEvaluation,
          expectedMaterials,
        );

        const exports = await instantiateKernel();
        const mark = exports.markArena();
        try {
          const actual = runFormulaLaunch(exports, {
            algorithm,
            decimalPlaces,
            equation,
            isDisplayRoundedAngle: false,
            isStepOverflowProtectionEnabled: true,
            points,
            signProtection: [],
            soldierCenter,
            steepness,
          });
          expect(actual.status).toBe(1);
          expect(actual.formulaPointIterationCount).toBeLessThanOrEqual(100);
          if (algorithm === "abs" && equation === "ddy") {
            expect(actual.formulaPointIterationCount).toBe(0);
          } else {
            expect(actual.formulaPointIterationCount).toBeGreaterThan(0);
          }
          expectFloatEquivalent(actual.angle, expectedAngle, `${algorithm}:${equation} launch angle`);
          expectFloatEquivalent(actual.x, expectedX, `${algorithm}:${equation} launch x`);
          expectFloatEquivalent(actual.y, expectedY, `${algorithm}:${equation} launch y`);
          if (equation === "ddy") {
            expect(actual.flags & 1).toBe(1);
            expectFloatEquivalent(actual.initialDy, Math.tan(expectedAngle), `${algorithm}:${equation} initial dy`);
          } else {
            expect(actual.flags & 1).toBe(0);
            expect(Object.is(actual.initialDy, 0)).toBe(true);
          }
          if (equation === "y") {
            expect(actual.flags & 2).toBe(2);
            expectFloatEquivalent(
              actual.yOffset,
              expectedY - expectedEvaluator.evaluateY(expectedX),
              `${algorithm}:${equation} y offset`,
            );
          } else {
            expect(actual.flags & 2).toBe(0);
            expect(Object.is(actual.yOffset, 0)).toBe(true);
          }
          expect(actual.materialResultPointer).toBeGreaterThan(0);
          expect(actual.materialResultPointer % 8).toBe(0);
          expect(actual.materialResultPointer + FORMULA_RESULT_BYTE_LENGTH).toBeLessThanOrEqual(
            exports.getArenaCursor(),
          );
          expect(actual.material).toBeDefined();
          expect(actual.observedProtection).toEqual(
            Array.from({ length: points.length - 1 }, (_, index) => oracle.context.signProtection[index] ?? 0),
          );
          expectStructuredFloatEquivalent(
            actual.formulaPoints,
            formulaPoints,
            `${algorithm}:${equation} formula points`,
          );
          const actualMaterials = decodeMaterials(exports, algorithm, equation, requireLaunchMaterial(actual));
          expectFormulaMaterialsEquivalent(
            actualMaterials,
            getModeRelevantMaterials(expectedMaterials, algorithm, equation),
          );
          const buildOptions = {
            isStepOverflowProtectionEnabled: true,
            signProtection: oracle.context.signProtection,
            stepOverflowProtectionRange: { maxX: bounds.maxX, minX: points[0].x },
          };
          expect(
            buildFormula(actual.formulaPoints, steepness, equation, algorithm, decimalPlaces, {
              ...buildOptions,
              compiledMaterials: actualMaterials,
            }),
          ).toEqual(
            buildFormula(formulaPoints, steepness, equation, algorithm, decimalPlaces, {
              ...buildOptions,
              compiledMaterials: expectedMaterials,
            }),
          );
        } finally {
          exports.resetArena(mark);
        }
      });
    }
  }

  it("uses an explicit y'' angle without applying display rounding", async () => {
    const exports = await instantiateKernel();
    const mark = exports.markArena();
    try {
      const userAngle = 0.12345678901234568;
      const actual = runFormulaLaunch(exports, {
        algorithm: "step",
        decimalPlaces: 15,
        equation: "ddy",
        isDisplayRoundedAngle: true,
        isStepOverflowProtectionEnabled: true,
        points,
        secondOrderLaunchAngle: userAngle,
        signProtection: [],
        soldierCenter: points[0],
        steepness: 210,
      });
      expect(actual.status).toBe(1);
      expect(actual.iterationCount).toBe(0);
      expect(actual.flags & 4).toBe(4);
      expect(Object.is(actual.angle, userAngle)).toBe(true);
      expectFloatEquivalent(actual.initialDy, Math.tan(userAngle), "user y'' initial dy");
    } finally {
      exports.resetArena(mark);
    }
  });

  it.each([Math.PI / 2 + 0.001, -Math.PI / 2 - 0.001])(
    "traps a raw explicit y'' angle outside the Graphwar launch range: %s",
    async (secondOrderLaunchAngle) => {
      const exports = await instantiateKernel();
      const mark = exports.markArena();
      try {
        expect(() =>
          runFormulaLaunch(exports, {
            algorithm: "step",
            decimalPlaces: 15,
            equation: "ddy",
            isDisplayRoundedAngle: false,
            isStepOverflowProtectionEnabled: true,
            points,
            secondOrderLaunchAngle,
            signProtection: [],
            soldierCenter: points[0],
            steepness: 210,
          }),
        ).toThrow(WebAssembly.RuntimeError);
      } finally {
        exports.resetArena(mark);
      }
    },
  );

  it("keeps the ABS formula-construction angle separate from an explicit execution angle", async () => {
    const equation = "ddy" as const;
    const oracle = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "abs",
        decimalPlaces: 15,
        equation,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        secondOrderLaunchAngleMode: "full-precision",
        steepness: 210,
      }),
      points,
      soldierCenter: points[0],
      start: { type: "cold" },
    });
    const userAngle = -0.2;
    const exports = await instantiateKernel();
    const mark = exports.markArena();
    try {
      const actual = runFormulaLaunch(exports, {
        algorithm: "abs",
        decimalPlaces: 15,
        equation,
        isDisplayRoundedAngle: false,
        isStepOverflowProtectionEnabled: true,
        points,
        secondOrderLaunchAngle: userAngle,
        signProtection: [],
        soldierCenter: points[0],
        steepness: 210,
      });
      expect(actual.status).toBe(1);
      expect(Object.is(actual.angle, userAngle)).toBe(true);
      expect(actual.material).toBeDefined();
      expectStructuredFloatEquivalent(
        actual.formulaPoints,
        oracle.context.formulaPoints,
        "abs:user-angle formula points",
      );
      expectFormulaMaterialsEquivalent(
        decodeMaterials(exports, "abs", equation, requireLaunchMaterial(actual)),
        getModeRelevantMaterials(oracle.context.compiledMaterials, "abs", equation),
      );
    } finally {
      exports.resetArena(mark);
    }
  });

  it.each(["abs", "pchip"] as const)("matches display-rounded %s:y'' formula and launch angles", async (algorithm) => {
    const equation = "ddy" as const;
    const oracle = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm,
        decimalPlaces: 15,
        equation,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        secondOrderLaunchAngleMode: "display-rounded",
        steepness: 210,
      }),
      points,
      soldierCenter: points[0],
      start: { type: "cold" },
    });
    const expectedAngle = getGraphwarTrajectoryLaunchAngle(oracle.context, points[0]);
    const exports = await instantiateKernel();
    const mark = exports.markArena();
    try {
      const actual = runFormulaLaunch(exports, {
        algorithm,
        decimalPlaces: 15,
        equation,
        isDisplayRoundedAngle: true,
        isStepOverflowProtectionEnabled: true,
        points,
        signProtection: [],
        soldierCenter: points[0],
        steepness: 210,
      });
      expect(actual.status).toBe(1);
      expectFloatEquivalent(actual.angle, expectedAngle, `${algorithm}:display-rounded angle`);
      expect(actual.material).toBeDefined();
      expectStructuredFloatEquivalent(
        actual.formulaPoints,
        oracle.context.formulaPoints,
        `${algorithm}:display-rounded formula points`,
      );
      expectFormulaMaterialsEquivalent(
        decodeMaterials(exports, algorithm, equation, requireLaunchMaterial(actual)),
        getModeRelevantMaterials(oracle.context.compiledMaterials, algorithm, equation),
      );
    } finally {
      exports.resetArena(mark);
    }
  });

  it("uses formulaPathSteepness only for Step launch-point refinement", async () => {
    const formulaPathSteepness = 7.5;
    const finalSteepness = 210;
    // This case isolates the two steepness roles. Second-order launch preparation can
    // legitimately reject this generic fixture before that contract is observable.
    const equation = "y" as const;
    const oracle = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        algorithm: "step",
        decimalPlaces: 15,
        equation,
        formulaPathSteepness,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        secondOrderLaunchAngleMode: "full-precision",
        steepness: finalSteepness,
      }),
      points,
      soldierCenter: points[0],
      start: { type: "cold" },
    });
    const exports = await instantiateKernel();
    const mark = exports.markArena();
    try {
      const actual = runFormulaLaunch(exports, {
        algorithm: "step",
        decimalPlaces: 15,
        equation,
        formulaPathSteepness,
        isDisplayRoundedAngle: false,
        isStepOverflowProtectionEnabled: true,
        points,
        signProtection: [],
        soldierCenter: points[0],
        steepness: finalSteepness,
      });
      expect(actual.status).toBe(1);
      expect(actual.material).toBeDefined();
      expectStructuredFloatEquivalent(actual.formulaPoints, oracle.context.formulaPoints, "Step path-steepness points");
      expectFormulaMaterialsEquivalent(
        decodeMaterials(exports, "step", equation, requireLaunchMaterial(actual)),
        oracle.context.compiledMaterials,
      );
    } finally {
      exports.resetArena(mark);
    }
  });
});

async function instantiateKernel() {
  const instance = await WebAssembly.instantiate(kernelModule);
  const exports = instance.exports as unknown as FormulaKernelExports;
  exports.initializeArena(65_536);
  const mark = exports.markArena();
  const constants = createGraphwarGameConstantData();
  const constantPointer = exports.reserveArena(constants.byteLength, Float64Array.BYTES_PER_ELEMENT);
  new Float64Array(exports.memory.buffer, constantPointer, constants.length).set(constants);
  if (
    exports.initializeGraphwarGameConstants(constantPointer, constants.length) !==
    calculateGameConstantAcknowledgment(new Uint8Array(constants.buffer, constants.byteOffset, constants.byteLength))
  ) {
    throw new Error("Graphwar game constants were not initialized");
  }
  exports.resetArena(mark);
  return exports;
}

function calculateGameConstantAcknowledgment(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  }
  return hash | 0;
}

function runFormulaBatch(
  exports: FormulaKernelExports,
  input: {
    algorithm: AlgorithmMode;
    decimalPlaces: number;
    equation: EquationMode;
    formulaPathSteepness?: number;
    formulaEvaluation?: FormulaEvaluationOptions;
    isStepOverflowProtectionEnabled: boolean;
    points: readonly GraphPoint[];
    signProtection: readonly number[];
    steepness: number;
    values: readonly { dy: number; x: number; y: number }[];
  },
): WasmFormulaBatchResult {
  const pointXPointer = writeFloat64Values(
    exports,
    input.points.map((point) => point.x),
  );
  const pointYPointer = writeFloat64Values(
    exports,
    input.points.map((point) => point.y),
  );
  const protectionPointer = writeUint32Values(exports, input.signProtection);
  const valueXPointer = writeFloat64Values(
    exports,
    input.values.map((value) => value.x),
  );
  const valueYPointer = writeFloat64Values(
    exports,
    input.values.map((value) => value.y),
  );
  const valueDyPointer = writeFloat64Values(
    exports,
    input.values.map((value) => value.dy),
  );
  const formulaEvaluationPointers = writeFormulaEvaluationState(exports, input.points.length, input.formulaEvaluation);
  const overflowRange =
    input.algorithm === "step"
      ? (input.formulaEvaluation?.stepOverflowProtectionRange ?? {
          maxX: Math.max(bounds.minX, bounds.maxX),
          minX: input.points[0].x,
        })
      : undefined;
  const overflowRangePointer =
    overflowRange === undefined ? 0 : writeFloat64Values(exports, [overflowRange.minX, overflowRange.maxX]);
  const inputPointer = exports.reserveArena(FORMULA_INPUT_BYTE_LENGTH, 8);
  const inputBytes = new Uint8Array(exports.memory.buffer, inputPointer, FORMULA_INPUT_BYTE_LENGTH);
  inputBytes.fill(0);
  const inputView = new DataView(exports.memory.buffer);
  inputView.setUint32(inputPointer, getAlgorithmTag(input.algorithm), true);
  inputView.setUint32(inputPointer + 4, getEquationTag(input.equation), true);
  inputView.setInt32(inputPointer + 8, input.decimalPlaces, true);
  inputView.setUint32(
    inputPointer + 12,
    input.algorithm === "step" && input.isStepOverflowProtectionEnabled ? 1 : 0,
    true,
  );
  inputView.setUint32(inputPointer + 16, input.points.length, true);
  inputView.setUint32(inputPointer + 20, pointXPointer, true);
  inputView.setUint32(inputPointer + 24, pointYPointer, true);
  inputView.setUint32(inputPointer + 28, protectionPointer, true);
  inputView.setUint32(inputPointer + 32, input.signProtection.length, true);
  inputView.setUint32(inputPointer + 36, input.values.length, true);
  inputView.setUint32(inputPointer + 40, valueXPointer, true);
  inputView.setUint32(inputPointer + 44, valueYPointer, true);
  inputView.setUint32(inputPointer + 48, valueDyPointer, true);
  inputView.setUint32(inputPointer + 52, overflowRangePointer, true);
  inputView.setFloat64(inputPointer + 56, input.steepness, true);
  inputView.setFloat64(inputPointer + 64, bounds.minX, true);
  inputView.setFloat64(inputPointer + 72, bounds.maxX, true);
  inputView.setFloat64(inputPointer + 80, bounds.minY, true);
  inputView.setFloat64(inputPointer + 88, bounds.maxY, true);
  inputView.setFloat64(inputPointer + 96, input.points[0].x, true);
  inputView.setFloat64(inputPointer + 104, input.points[0].y, true);
  inputView.setUint32(inputPointer + 120, formulaEvaluationPointers.disabledSegments, true);
  inputView.setUint32(inputPointer + 124, formulaEvaluationPointers.segmentStartX, true);
  inputView.setUint32(inputPointer + 128, formulaEvaluationPointers.segmentStartY, true);
  inputView.setUint32(inputPointer + 132, formulaEvaluationPointers.stepDeltaY, true);
  inputView.setUint32(inputPointer + 136, formulaEvaluationPointers.stepGlitchSegments, true);
  inputView.setUint32(inputPointer + 140, formulaEvaluationPointers.absPulseDeltaSlope, true);
  inputView.setUint32(inputPointer + 144, formulaEvaluationPointers.absPulseCenterX, true);
  inputView.setUint32(inputPointer + 148, overflowRange === undefined ? 0 : 2, true);
  inputView.setFloat64(inputPointer + 152, input.formulaPathSteepness ?? input.steepness, true);
  inputView.setFloat64(inputPointer + 168, graphwarToolDefaults.formulaPathQualityTargetPlanePixels, true);

  const resultPointer = exports.runFormula(input.algorithm === "step" ? 3 : 2, inputPointer, FORMULA_INPUT_BYTE_LENGTH);
  return readFormulaBatchResult(exports, resultPointer);
}

function readFormulaBatchResult(exports: FormulaKernelExports, resultPointer: number): WasmFormulaBatchResult {
  expect(resultPointer % 8).toBe(0);
  expect(resultPointer + FORMULA_RESULT_BYTE_LENGTH).toBeLessThanOrEqual(exports.getArenaCursor());
  const resultView = new DataView(exports.memory.buffer);
  const valuePointer = resultView.getUint32(resultPointer + 16, true);
  const valueCount = resultView.getUint32(resultPointer + 20, true);
  const observedPointer = resultView.getUint32(resultPointer + 32, true);
  const observedCount = resultView.getUint32(resultPointer + 36, true);
  return {
    auxiliaryValue: resultView.getFloat64(resultPointer + 24, true),
    flags: resultView.getUint32(resultPointer + 40, true),
    materialCount: resultView.getUint32(resultPointer + 8, true),
    materialPointer: resultView.getUint32(resultPointer + 4, true),
    materialStride: resultView.getUint32(resultPointer + 12, true),
    materialType: resultView.getUint32(resultPointer, true),
    observedProtection: readUint32Values(exports, observedPointer, observedCount),
    values: readFloat64Values(exports, valuePointer, valueCount),
  };
}

function runFormulaLaunch(
  exports: FormulaKernelExports,
  input: {
    algorithm: AlgorithmMode;
    decimalPlaces: number;
    equation: EquationMode;
    formulaPathSteepness?: number;
    isDisplayRoundedAngle: boolean;
    isStepOverflowProtectionEnabled: boolean;
    points: readonly GraphPoint[];
    secondOrderLaunchAngle?: number;
    signProtection: readonly number[];
    soldierCenter: GraphPoint;
    steepness: number;
  },
): WasmFormulaLaunchResult {
  const pointXPointer = writeFloat64Values(
    exports,
    input.points.map((point) => point.x),
  );
  const pointYPointer = writeFloat64Values(
    exports,
    input.points.map((point) => point.y),
  );
  const protectionPointer = writeUint32Values(exports, input.signProtection);
  const overflowRangePointer =
    input.algorithm === "step"
      ? writeFloat64Values(exports, [input.points[0].x, Math.max(bounds.minX, bounds.maxX)])
      : 0;
  const inputPointer = exports.reserveArena(FORMULA_INPUT_BYTE_LENGTH, 8);
  new Uint8Array(exports.memory.buffer, inputPointer, FORMULA_INPUT_BYTE_LENGTH).fill(0);
  const inputView = new DataView(exports.memory.buffer);
  inputView.setUint32(inputPointer, getAlgorithmTag(input.algorithm), true);
  inputView.setUint32(inputPointer + 4, getEquationTag(input.equation), true);
  inputView.setInt32(inputPointer + 8, input.decimalPlaces, true);
  inputView.setUint32(
    inputPointer + 12,
    (input.algorithm === "step" && input.isStepOverflowProtectionEnabled ? 1 : 0) |
      (input.isDisplayRoundedAngle ? 2 : 0) |
      (input.secondOrderLaunchAngle === undefined ? 0 : 4),
    true,
  );
  inputView.setUint32(inputPointer + 16, input.points.length, true);
  inputView.setUint32(inputPointer + 20, pointXPointer, true);
  inputView.setUint32(inputPointer + 24, pointYPointer, true);
  inputView.setUint32(inputPointer + 28, protectionPointer, true);
  inputView.setUint32(inputPointer + 32, input.signProtection.length, true);
  inputView.setUint32(inputPointer + 52, overflowRangePointer, true);
  inputView.setFloat64(inputPointer + 56, input.steepness, true);
  inputView.setFloat64(inputPointer + 64, bounds.minX, true);
  inputView.setFloat64(inputPointer + 72, bounds.maxX, true);
  inputView.setFloat64(inputPointer + 80, bounds.minY, true);
  inputView.setFloat64(inputPointer + 88, bounds.maxY, true);
  inputView.setFloat64(inputPointer + 96, input.soldierCenter.x, true);
  inputView.setFloat64(inputPointer + 104, input.soldierCenter.y, true);
  inputView.setFloat64(inputPointer + 112, input.secondOrderLaunchAngle ?? 0, true);
  inputView.setUint32(inputPointer + 148, input.algorithm === "step" ? 2 : 0, true);
  inputView.setFloat64(inputPointer + 152, input.formulaPathSteepness ?? input.steepness, true);
  inputView.setFloat64(inputPointer + 168, graphwarToolDefaults.formulaPathQualityTargetPlanePixels, true);

  const resultPointer = exports.runFormula(4, inputPointer, FORMULA_INPUT_BYTE_LENGTH);
  expect(resultPointer + FORMULA_LAUNCH_RESULT_BYTE_LENGTH).toBeLessThanOrEqual(exports.getArenaCursor());
  const resultView = new DataView(exports.memory.buffer);
  const materialResultPointer = resultView.getUint32(resultPointer + 48, true);
  const observedProtectionPointer = resultView.getUint32(resultPointer + 60, true);
  const protectionCount = resultView.getUint32(resultPointer + 64, true);
  const formulaPointCount = resultView.getUint32(resultPointer + 68, true);
  const formulaPointXPointer = resultView.getUint32(resultPointer + 72, true);
  const formulaPointYPointer = resultView.getUint32(resultPointer + 76, true);
  const formulaPointXs = readFloat64Values(exports, formulaPointXPointer, formulaPointCount);
  const formulaPointYs = readFloat64Values(exports, formulaPointYPointer, formulaPointCount);
  const formulaPoints: GraphPoint[] = [];
  for (let index = 0; index < formulaPointCount; index += 1) {
    const x = formulaPointXs[index];
    const y = formulaPointYs[index];
    if (x === undefined || y === undefined) {
      throw new Error("WASM launch formula-point arrays did not match their declared count");
    }
    formulaPoints.push(createGraphPoint(x, y));
  }
  return {
    angle: resultView.getFloat64(resultPointer + 8, true),
    flags: resultView.getUint32(resultPointer + 52, true),
    formulaPointIterationCount: resultView.getUint32(resultPointer + 56, true),
    formulaPoints,
    initialDy: resultView.getFloat64(resultPointer + 32, true),
    iterationCount: resultView.getUint32(resultPointer + 4, true),
    ...(materialResultPointer === 0 ? {} : { material: readFormulaBatchResult(exports, materialResultPointer) }),
    materialResultPointer,
    observedProtection: readUint32Values(exports, observedProtectionPointer, protectionCount),
    status: resultView.getInt32(resultPointer, true),
    x: resultView.getFloat64(resultPointer + 16, true),
    y: resultView.getFloat64(resultPointer + 24, true),
    yOffset: resultView.getFloat64(resultPointer + 40, true),
  };
}

function requireLaunchMaterial(result: WasmFormulaLaunchResult) {
  if (!result.material) {
    throw new Error("Expected a successful WASM launch to include formula materials");
  }
  return result.material;
}

function decodeMaterials(
  exports: FormulaKernelExports,
  algorithm: AlgorithmMode,
  equation: EquationMode,
  result: WasmFormulaBatchResult,
): CompiledGraphwarFormulaMaterials {
  const view = new DataView(exports.memory.buffer);
  if (algorithm === "abs" && equation !== "ddy") {
    expect(result.materialType).toBe(1);
    expect(result.materialStride).toBe(ABS_CONNECTOR_BYTE_LENGTH);
    const absSegments: CompiledAbsConnectorSegment[] = [];
    for (let index = 0; index < result.materialCount; index += 1) {
      const pointer = result.materialPointer + index * result.materialStride;
      absSegments.push({
        coefficient: view.getFloat64(pointer, true),
        endX: view.getFloat64(pointer + 16, true),
        sourceSegmentIndex: view.getUint32(pointer + 32, true),
        startX: view.getFloat64(pointer + 8, true),
        width: view.getFloat64(pointer + 24, true),
      });
    }
    return { absSegments, algorithm };
  }
  if (algorithm === "abs") {
    expect(result.materialType).toBe(2);
    expect(result.materialStride).toBe(ABS_PULSE_BYTE_LENGTH);
    const pulses: CompiledAbsSecondDerivativePulse[] = [];
    for (let index = 0; index < result.materialCount; index += 1) {
      const pointer = result.materialPointer + index * result.materialStride;
      pulses.push({ coefficient: view.getFloat64(pointer, true), formulaCenterX: view.getFloat64(pointer + 8, true) });
    }
    return {
      absSecondDerivativeFormula: { formulaSteepness: result.auxiliaryValue, pulses },
      absSegments: [],
      algorithm,
    };
  }
  if (algorithm === "step") {
    expect(result.materialType).toBe(4);
    expect(result.materialStride).toBe(STEP_MATERIAL_BYTE_LENGTH);
    const terms: CompiledStepTerm[] = [];
    for (let index = 0; index < result.materialCount; index += 1) {
      const pointer = result.materialPointer + index * result.materialStride;
      const glitchEquation = view.getInt32(pointer + 40, true);
      let glitchSegment: StepGlitchSegment | undefined;
      if (glitchEquation === 2) {
        glitchSegment = {
          derivative: view.getFloat64(pointer + 72, true),
          endX: view.getFloat64(pointer + 56, true),
          equation: "dy",
          formulaDecimalPlaces: view.getInt32(pointer + 44, true),
          gateY: view.getFloat64(pointer + 80, true),
          startX: view.getFloat64(pointer + 48, true),
          targetY: view.getFloat64(pointer + 64, true),
        };
      } else if (glitchEquation === 3) {
        glitchSegment = {
          acceleration: view.getFloat64(pointer + 72, true),
          accelerationGateY: view.getFloat64(pointer + 80, true),
          braking: view.getFloat64(pointer + 88, true),
          brakingGateY: view.getFloat64(pointer + 96, true),
          endX: view.getFloat64(pointer + 56, true),
          equation: "ddy",
          formulaDecimalPlaces: view.getInt32(pointer + 44, true),
          pulseEndX: view.getFloat64(pointer + 104, true),
          startX: view.getFloat64(pointer + 48, true),
          targetY: view.getFloat64(pointer + 64, true),
        };
      }
      terms.push({
        firstDerivativeCoefficient: view.getFloat64(pointer + 8, true),
        formulaCenterX: view.getFloat64(pointer, true),
        ...(glitchSegment ? { glitchSegment } : {}),
        isDerivativeOverflowProtected: Boolean(view.getUint32(pointer + 36, true) & 1),
        secondDerivativeCoefficient: view.getFloat64(pointer + 16, true),
        sourceSegmentIndex: view.getUint32(pointer + 32, true),
        yCoefficient: view.getFloat64(pointer + 24, true),
      });
    }
    return { algorithm, stepFormula: { equation, formulaSteepness: result.auxiliaryValue, terms } };
  }

  expect(result.materialType).toBe(3);
  expect(result.materialStride).toBe(SOFT_MATERIAL_BYTE_LENGTH);
  const softCubicSegments: CompiledSoftCubicSegment[] = [];
  for (let index = 0; index < result.materialCount; index += 1) {
    const pointer = result.materialPointer + index * result.materialStride;
    softCubicSegments.push({
      cubicCoefficients: readTuple4(view, pointer),
      firstCubicCoefficients: readTuple4(view, pointer + 32),
      firstPowerCoefficient: view.getFloat64(pointer + 64, true),
      halfWidth: view.getFloat64(pointer + 72, true),
      secondCubicCoefficients: readTuple4(view, pointer + 80),
      secondPowerCoefficient: view.getFloat64(pointer + 112, true),
      softCenterX: view.getFloat64(pointer + 120, true),
      startX: view.getFloat64(pointer + 128, true),
      width: view.getFloat64(pointer + 136, true),
    });
  }
  return { algorithm, softCubicSegments };
}

async function runOneStepCase(
  stepPoints: readonly GraphPoint[],
  steepness: number,
  signProtection: readonly number[],
  isStepOverflowProtectionEnabled: boolean,
  x: number,
) {
  const exports = await instantiateKernel();
  return runFormulaBatch(exports, {
    algorithm: "step",
    decimalPlaces: 4,
    equation: "ddy",
    isStepOverflowProtectionEnabled,
    points: stepPoints,
    signProtection,
    steepness,
    values: [{ dy: 0, x, y: 0 }],
  });
}

function writeFormulaEvaluationState(
  exports: FormulaKernelExports,
  pointCount: number,
  options: FormulaEvaluationOptions | undefined,
) {
  const segmentCount = pointCount - 1;
  const disabledSegments = options?.disabledSegments
    ? writeUint8Values(
        exports,
        Uint8Array.from({ length: segmentCount }, (_, index) => (options.disabledSegments?.[index] ? 1 : 0)),
      )
    : 0;
  let segmentStartX = 0;
  let segmentStartY = 0;
  if (options?.segmentStartPoints !== undefined) {
    const x = new Float64Array(pointCount).fill(Number.NaN);
    const y = new Float64Array(pointCount).fill(Number.NaN);
    for (let index = 0; index < Math.min(pointCount, options.segmentStartPoints.length); index += 1) {
      const point = options.segmentStartPoints[index];
      if (point) {
        x[index] = point.x;
        y[index] = point.y;
      }
    }
    segmentStartX = writeFloat64Values(exports, x);
    segmentStartY = writeFloat64Values(exports, y);
  }
  const stepDeltaY =
    options?.stepSegmentDeltaYs === undefined
      ? 0
      : writeFloat64Values(
          exports,
          Float64Array.from({ length: segmentCount }, (_, index) => options.stepSegmentDeltaYs?.[index] ?? Number.NaN),
        );
  const absPulseDeltaSlope =
    options?.absSecondDerivativePulseDeltaSlopes === undefined
      ? 0
      : writeFloat64Values(
          exports,
          Float64Array.from(
            { length: segmentCount },
            (_, index) => options.absSecondDerivativePulseDeltaSlopes?.[index] ?? Number.NaN,
          ),
        );
  const absPulseCenterX =
    options?.absSecondDerivativePulseCenterXs === undefined
      ? 0
      : writeFloat64Values(
          exports,
          Float64Array.from(
            { length: segmentCount },
            (_, index) => options.absSecondDerivativePulseCenterXs?.[index] ?? Number.NaN,
          ),
        );
  let stepGlitchSegments = 0;
  if (options?.stepGlitchSegments !== undefined) {
    const bytes = new Uint8Array(segmentCount * STEP_GLITCH_RECORD_BYTE_LENGTH);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < segmentCount; index += 1) {
      const segment = options.stepGlitchSegments[index];
      if (!segment) {
        continue;
      }
      const offset = index * STEP_GLITCH_RECORD_BYTE_LENGTH;
      view.setInt32(offset, segment.equation === "dy" ? 2 : 3, true);
      view.setInt32(offset + 4, segment.formulaDecimalPlaces ?? -1, true);
      view.setFloat64(offset + 8, segment.startX, true);
      view.setFloat64(offset + 16, segment.endX, true);
      view.setFloat64(offset + 24, segment.targetY, true);
      if (segment.equation === "dy") {
        view.setFloat64(offset + 32, segment.derivative, true);
        view.setFloat64(offset + 40, segment.gateY, true);
      } else {
        view.setFloat64(offset + 32, segment.acceleration, true);
        view.setFloat64(offset + 40, segment.accelerationGateY, true);
        view.setFloat64(offset + 48, segment.braking, true);
        view.setFloat64(offset + 56, segment.brakingGateY, true);
        view.setFloat64(offset + 64, segment.pulseEndX, true);
      }
    }
    stepGlitchSegments = writeAlignedBytes(exports, bytes, 8);
  }
  return {
    absPulseCenterX,
    absPulseDeltaSlope,
    disabledSegments,
    segmentStartX,
    segmentStartY,
    stepDeltaY,
    stepGlitchSegments,
  };
}

function writeAlignedBytes(exports: FormulaKernelExports, values: Uint8Array, alignment: number) {
  if (values.length === 0) {
    return 0;
  }
  const pointer = exports.reserveArena(values.length, alignment);
  new Uint8Array(exports.memory.buffer, pointer, values.length).set(values);
  return pointer;
}

function writeFloat64Values(exports: FormulaKernelExports, values: ArrayLike<number>) {
  if (values.length === 0) {
    return 0;
  }
  const pointer = exports.reserveArena(values.length * 8, 8);
  new Float64Array(exports.memory.buffer, pointer, values.length).set(values);
  return pointer;
}

function writeUint8Values(exports: FormulaKernelExports, values: Uint8Array) {
  return writeAlignedBytes(exports, values, 1);
}

function writeUint32Values(exports: FormulaKernelExports, values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }
  const pointer = exports.reserveArena(values.length * 4, 4);
  new Uint32Array(exports.memory.buffer, pointer, values.length).set(values);
  return pointer;
}

function readFloat64Values(exports: FormulaKernelExports, pointer: number, length: number) {
  return length === 0 ? [] : [...new Float64Array(exports.memory.buffer, pointer, length)];
}

function readUint32Values(exports: FormulaKernelExports, pointer: number, length: number) {
  return length === 0 ? [] : [...new Uint32Array(exports.memory.buffer, pointer, length)];
}

function readTuple4(view: DataView, pointer: number): readonly [number, number, number, number] {
  return [
    view.getFloat64(pointer, true),
    view.getFloat64(pointer + 8, true),
    view.getFloat64(pointer + 16, true),
    view.getFloat64(pointer + 24, true),
  ];
}

function getAlgorithmTag(algorithm: AlgorithmMode) {
  return algorithm === "abs" ? 1 : algorithm === "step" ? 2 : algorithm === "pchip" ? 3 : 4;
}

function getEquationTag(equation: EquationMode) {
  return equation === "y" ? 1 : equation === "dy" ? 2 : 3;
}

function expectFormulaMaterialsEquivalent(
  actual: CompiledGraphwarFormulaMaterials,
  expected: CompiledGraphwarFormulaMaterials,
) {
  expectStructuredFloatEquivalent(actual, expected, "materials");
}

function getModeRelevantMaterials(
  materials: CompiledGraphwarFormulaMaterials,
  algorithm: AlgorithmMode,
  equation: EquationMode,
) {
  return algorithm === "abs" && equation === "ddy"
    ? { absSecondDerivativeFormula: materials.absSecondDerivativeFormula, absSegments: [], algorithm }
    : materials;
}

function expectStructuredFloatEquivalent(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    expectFloatEquivalent(actual as number, expected, path);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect(actual as unknown[], path).toHaveLength(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      expectStructuredFloatEquivalent((actual as unknown[])[index], expected[index], `${path}[${index}]`);
    }
    return;
  }
  if (typeof expected === "object" && expected !== null) {
    expect(typeof actual, path).toBe("object");
    expect(actual, path).not.toBeNull();
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    expect(Object.keys(actualRecord).sort(), path).toEqual(Object.keys(expectedRecord).sort());
    for (const key of Object.keys(expectedRecord)) {
      expectStructuredFloatEquivalent(actualRecord[key], expectedRecord[key], `${path}.${key}`);
    }
    return;
  }
  expect(actual, path).toBe(expected);
}

const floatBits = new DataView(new ArrayBuffer(8));

function expectFloatEquivalent(
  actual: number,
  expected: number,
  context: string,
  maxUlpDistance = DEFAULT_MAX_ULP_DISTANCE,
) {
  if (Number.isNaN(expected)) {
    expect(actual, context).toBeNaN();
    return;
  }
  if (!Number.isFinite(expected)) {
    expect(actual, context).toBe(expected);
    return;
  }
  if (expected === 0) {
    expect(Object.is(actual, expected), context).toBe(true);
    return;
  }
  const detail = `${context}: actual=${actual}, expected=${expected}`;
  expect(Number.isFinite(actual), detail).toBe(true);
  expect(ulpDistance(actual, expected), detail).toBeLessThanOrEqual(maxUlpDistance);
}

function expectFormulaValueEquivalent(
  actual: number,
  expected: number,
  algorithm: AlgorithmMode,
  equation: EquationMode,
  context: string,
) {
  const maxUlpDistance =
    equation === "ddy" && (algorithm === "pchip" || algorithm === "akima")
      ? SOFT_CUBIC_DDY_MAX_ULP_DISTANCE
      : DEFAULT_MAX_ULP_DISTANCE;
  expectFloatEquivalent(actual, expected, context, maxUlpDistance);
}

function ulpDistance(left: number, right: number) {
  const leftBits = orderedFloatBits(left);
  const rightBits = orderedFloatBits(right);
  return leftBits >= rightBits ? leftBits - rightBits : rightBits - leftBits;
}

function orderedFloatBits(value: number) {
  floatBits.setFloat64(0, value, false);
  const bits = floatBits.getBigUint64(0, false);
  return bits & 0x8000_0000_0000_0000n ? (~bits + 1n) & 0xffff_ffff_ffff_ffffn : bits | 0x8000_0000_0000_0000n;
}
