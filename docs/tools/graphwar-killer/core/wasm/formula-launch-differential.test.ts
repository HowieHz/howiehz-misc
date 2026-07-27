import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { compileFormulaEvaluator } from "../../formula/generation/build";
import {
  createGraphwarTrajectoryFormulaMode,
  getGraphwarTrajectoryLaunchAngle,
  resolveGraphwarTrajectory,
  type GraphwarTrajectoryFormulaSettings,
  type GraphwarTrajectoryResolution,
} from "../../formula/trajectory/sampling";
import { GRAPHWAR_GAME_SOLDIER_RADIUS, GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { graphToImagePoint } from "../geometry";
import {
  createGraphPoint,
  type AlgorithmMode,
  type BoundsRect,
  type EquationMode,
  type GraphBounds,
  type GraphPoint,
} from "../types";
import { prepareGraphwarWasmFormulaLaunch, type GraphwarWasmFormulaLaunchResult } from "./formula-adapter";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "./runtime";
import type { GraphwarWasmFormulaInputDescriptor } from "./task-adapter";

const kernelPath = resolve("packages/graphwar-killer-wasm/build/graphwar-kernel.wasm");
const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};
const basicPoints = [
  createGraphPoint(-10, -1),
  createGraphPoint(-7, 2),
  createGraphPoint(-3, -2),
  createGraphPoint(1, 1),
] as const satisfies readonly GraphPoint[];
const formulaModes = [
  ["abs", "y"],
  ["abs", "dy"],
  ["abs", "ddy"],
  ["step", "y"],
  ["step", "dy"],
  ["step", "ddy"],
  ["pchip", "y"],
  ["pchip", "dy"],
  ["pchip", "ddy"],
  ["akima", "y"],
  ["akima", "dy"],
  ["akima", "ddy"],
] as const satisfies readonly (readonly [AlgorithmMode, EquationMode])[];

let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readFile(kernelPath));
});

describe("Graphwar WASM cold formula launch differential", () => {
  it.each(formulaModes)("matches the TypeScript cold launch for %s:%s", async (algorithm, equation) => {
    const descriptor = createDescriptor(basicPoints, {
      algorithm,
      decimalPlaces: 4,
      equation,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      secondOrderLaunchAngleMode: "full-precision",
      steepness: 210,
    });

    await expectLaunchToMatchColdTypeScript(descriptor, algorithm, equation, `${algorithm}:${equation}`);
  });

  it.each([
    { equation: "dy", formulaPathSteepness: 7.5, steepness: 210 },
    { equation: "ddy", formulaPathSteepness: 7.5, steepness: 153 },
  ] as const)(
    "matches Step $equation position compensation with distinct path steepness",
    async ({ equation, formulaPathSteepness, steepness }) => {
      const points = [
        createGraphPoint(-23.376623376623378, 2.5974025974025974),
        createGraphPoint(-19, 0),
        createGraphPoint(-17, -2),
      ];
      const descriptor = createDescriptor(points, {
        algorithm: "step",
        decimalPlaces: 4,
        equation,
        formulaPathSteepness,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        secondOrderLaunchAngleMode: "full-precision",
        steepness,
      });
      const oracle = resolveColdTypeScript(descriptor);
      const equalSteepnessOracle = resolveColdTypeScript({
        ...descriptor,
        settings: { ...descriptor.settings, formulaPathSteepness: steepness },
      });

      expect(oracle.context.formulaPoints).not.toEqual(equalSteepnessOracle.context.formulaPoints);
      expect(oracle.context.formulaEvaluation.segmentStartPoints?.[1]).toBeDefined();
      expect(oracle.context.formulaEvaluation.stepSegmentDeltaYs?.some((value) => value !== undefined)).toBe(true);
      await expectLaunchToMatchColdTypeScript(
        descriptor,
        "step",
        equation,
        `step:${equation}:position-compensation:path-steepness`,
        oracle,
  );

  it("matches a refined ABS second-derivative pulse launch", async () => {
    const points = [
      createGraphPoint(-23.376623376623378, 2.5974025974025974),
      createGraphPoint(-19, 0),
      createGraphPoint(-17, -1.2),
      createGraphPoint(-15, 2),
      createGraphPoint(-13, -2),
    ];
    const descriptor = createDescriptor(points, {
      algorithm: "abs",
      decimalPlaces: 4,
      equation: "ddy",
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      secondOrderLaunchAngleMode: "full-precision",
      steepness: 10,
    });
    const oracle = resolveColdTypeScript(descriptor);
    const pulseDeltaSlopes = oracle.context.formulaEvaluation.absSecondDerivativePulseDeltaSlopes;
    const pulseCenterXs = oracle.context.formulaEvaluation.absSecondDerivativePulseCenterXs;

    expect(pulseDeltaSlopes?.some(Number.isFinite)).toBe(true);
    expect(pulseCenterXs?.some(Number.isFinite)).toBe(true);
    expect(oracle.context.compiledMaterials.absSecondDerivativeFormula?.pulses.length).toBeGreaterThan(0);
    await expectLaunchToMatchColdTypeScript(descriptor, "abs", "ddy", "abs:ddy:refined-pulse", oracle);
  });

  it("matches a Step-glitch mask winner", async () => {
    const obstacleMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const obstaclePixel = graphToImagePoint(createGraphPoint(-8, 0), bounds, boundsRect);
    obstacleMask[Math.floor(obstaclePixel.y) * GRAPHWAR_PLANE_LENGTH + Math.floor(obstaclePixel.x)] = 1;
    const points = [
      createGraphPoint(-11, 0),
      createGraphPoint(-6, 4),
      createGraphPoint(-5, 3),
      createGraphPoint(-4, 2),
    ];
    const descriptor = createDescriptor(points, {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "dy",
      isStepGlitchModeEnabled: true,
      isStepOverflowProtectionEnabled: true,
      secondOrderLaunchAngleMode: "full-precision",
      steepness: 67,
      stepGlitchObstacleMask: obstacleMask,
    });
    const oracle = resolveColdTypeScript(descriptor);

    expect(oracle.context.compiledMaterials.stepFormula?.terms.some((term) => term.glitchSegment !== undefined)).toBe(
      true,
    );
    await expectLaunchToMatchColdTypeScript(descriptor, "step", "dy", "step:dy:glitch-mask-winner", oracle);
  });
});

function createDescriptor(
  points: readonly GraphPoint[],
  settings: GraphwarTrajectoryFormulaSettings,
): GraphwarWasmFormulaInputDescriptor {
  const soldierCenter = points[0];
  if (!soldierCenter) {
    throw new Error("The differential fixture requires a soldier center");
  }
  return { bounds, points, settings, soldierCenter };
}

function resolveColdTypeScript(descriptor: GraphwarWasmFormulaInputDescriptor) {
  return resolveGraphwarTrajectory({
    bounds: descriptor.bounds,
    boundsRect,
    formulaMode: createGraphwarTrajectoryFormulaMode(descriptor.settings),
    points: descriptor.points.map((point) => createGraphPoint(point.x, point.y)),
    soldierCenter: createGraphPoint(descriptor.soldierCenter.x, descriptor.soldierCenter.y),
    start: { type: "cold" },
  });
}

async function expectLaunchToMatchColdTypeScript(
  descriptor: GraphwarWasmFormulaInputDescriptor,
  algorithm: AlgorithmMode,
  equation: EquationMode,
  label: string,
  oracle = resolveColdTypeScript(descriptor),
) {
  const maxUlpDistance =
    equation === "ddy" && (algorithm === "pchip" || algorithm === "akima")
      ? SOFT_CUBIC_DDY_MAX_ULP_DISTANCE
      : DEFAULT_MAX_ULP_DISTANCE;
  const runtime = await createRuntime();
  const actual = prepareGraphwarWasmFormulaLaunch(runtime, descriptor);
  const expectedStatus = getOracleLaunchStatus(oracle);

  expect(actual.status, `${label} status`).toBe(expectedStatus);
  if (actual.status !== "success" || expectedStatus !== "success") {
    return;
  }

  expectNumericTreeEquivalent(actual.formulaPoints, oracle.context.formulaPoints, `${label} formulaPoints`);
  expectNumericTreeEquivalent(
    actual.compiledMaterials,
    getExpectedCompiledMaterials(oracle),
    `${label} compiledMaterials`,
  );
  const finalSignProtection = normalizeSignProtection(oracle.context.signProtection, descriptor.points.length - 1);
  expect(
    normalizeSignProtection(oracle.context.formulaEvaluation.signProtection, descriptor.points.length - 1),
  ).toEqual(finalSignProtection);
  expect(actual.observedSignProtection, `${label} observed/final sign protection`).toEqual(finalSignProtection);
  expectLaunchStateEquivalent(actual, oracle, label, maxUlpDistance);
}

function getOracleLaunchStatus(_oracle: GraphwarTrajectoryResolution): GraphwarWasmFormulaLaunchResult["status"] {
  // Resolver 返回 context 表示 formula preparation 已经完成；后续完整轨迹的停止原因不属于 launch ABI 状态。
  return "success";
}

function getExpectedCompiledMaterials(oracle: GraphwarTrajectoryResolution) {
  return oracle.context.settings.algorithm === "abs" && oracle.context.settings.equation === "ddy"
    ? { ...oracle.context.compiledMaterials, absSegments: [] }
    : oracle.context.compiledMaterials;
}

function expectLaunchStateEquivalent(
  actual: Extract<GraphwarWasmFormulaLaunchResult, { status: "success" }>,
  oracle: GraphwarTrajectoryResolution,
  label: string,
  maxUlpDistance = DEFAULT_MAX_ULP_DISTANCE,
) {
  const equation = oracle.context.settings.equation;
  const soldierCenter = oracle.context.soldierCenter;
  if (!soldierCenter) {
    throw new Error(`${label} TypeScript launch context did not retain the soldier center`);
  }
  const expectedAngle = getGraphwarTrajectoryLaunchAngle(oracle.context, soldierCenter);
  const expectedPoint =
    equation === "y" && !Number.isFinite(expectedAngle)
      ? soldierCenter
      : createGraphPoint(
          soldierCenter.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(expectedAngle),
          soldierCenter.y + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.sin(expectedAngle),
        );
  expect(actual.launch.equation, `${label} launch equation`).toBe(equation);
  expectNumericTreeEquivalent(actual.launch.point, expectedPoint, `${label} launch point`);

  if (equation === "y") {
    expect(actual.launch.equation).toBe("y");
    if (actual.launch.equation !== "y") {
      return;
    }
    const evaluator = compileFormulaEvaluator(
      oracle.context.formulaPoints,
      oracle.context.settings.steepness,
      oracle.context.settings.algorithm,
      oracle.context.formulaEvaluation,
      oracle.context.compiledMaterials,
    );
    const expectedYOffset = expectedPoint.y - evaluator.evaluateY(expectedPoint.x);
    expectFloatEquivalent(actual.launch.yOffset, expectedYOffset, `${label} launch yOffset`);
    return;
  }

  if (equation === "dy") {
    expect(actual.launch.equation).toBe("dy");
    if (actual.launch.equation === "dy") {
      expectFloatEquivalent(actual.launch.angleRadians, expectedAngle, `${label} launch angle`);
    }
    return;
  }

  expect(actual.launch.equation).toBe("ddy");
  if (actual.launch.equation === "ddy") {
    expectFloatEquivalent(actual.launch.angleRadians, expectedAngle, `${label} launch angle`);
    expectFloatEquivalent(actual.launch.initialDy, Math.tan(expectedAngle), `${label} launch initialDy`);
    expect(actual.launch.isUserAngle, `${label} launch user-angle identity`).toBe(false);
  }
}

function normalizeSignProtection(values: readonly number[] | undefined, segmentCount: number) {
  return Array.from({ length: segmentCount }, (_, index) => values?.[index] ?? 0);
}

function expectNumericTreeEquivalent(actual: unknown, expected: unknown, label: string): void {
  if (typeof expected === "number") {
    expect(typeof actual, `${label} type`).toBe("number");
    if (typeof actual === "number") {
      expectFloatEquivalent(actual, expected, label);
    }
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${label} type`).toBe(true);
    if (!Array.isArray(actual)) {
      return;
    }
    expect(actual.length, `${label} length`).toBe(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      expectNumericTreeEquivalent(actual[index], expected[index], `${label}[${index}]`);
    }
    return;
  }
  if (isRecord(expected)) {
    expect(isRecord(actual), `${label} type`).toBe(true);
    if (!isRecord(actual)) {
      return;
    }
    const expectedKeys = Object.keys(expected).sort();
    expect(Object.keys(actual).sort(), `${label} keys`).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expectNumericTreeEquivalent(actual[key], expected[key], `${label}.${key}`);
    }
    return;
  }
  expect(actual, label).toEqual(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectFloatEquivalent(actual: number, expected: number, label: string, maxUlpDistance = DEFAULT_MAX_ULP_DISTANCE) {
  expect(Number.isNaN(actual), `${label} NaN classification`).toBe(Number.isNaN(expected));
  expect(actual === Number.POSITIVE_INFINITY, `${label} +Infinity classification`).toBe(
    expected === Number.POSITIVE_INFINITY,
  );
  expect(actual === Number.NEGATIVE_INFINITY, `${label} -Infinity classification`).toBe(
    expected === Number.NEGATIVE_INFINITY,
  );
  if (Number.isNaN(expected) || !Number.isFinite(expected)) {
    return;
  }
  if (expected === 0) {
    expect(Object.is(actual, expected), `${label} signed zero`).toBe(true);
    return;
  }
  expect(ulpDistance(actual, expected), `${label} ULP distance`).toBeLessThanOrEqual(maxUlpDistance);
}

function ulpDistance(left: number, right: number) {
  const leftBits = orderedFloatBits(left);
  const rightBits = orderedFloatBits(right);
  return leftBits > rightBits ? leftBits - rightBits : rightBits - leftBits;
}

function orderedFloatBits(value: number) {
  const buffer = new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT);
  new DataView(buffer).setFloat64(0, value, false);
  const bits = new DataView(buffer).getBigUint64(0, false);
  return bits >> 63n === 0n ? bits | (1n << 63n) : ~bits;
}

async function createRuntime(): Promise<GraphwarWasmKernelRuntime> {
  return instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 65_536 });
}



