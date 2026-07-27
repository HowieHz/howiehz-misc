import { beforeAll, describe, expect, it } from "vitest";

import {
  createGraphwarTrajectoryFormulaMode,
  getGraphwarTrajectoryLaunchAngle,
  resolveGraphwarTrajectory,
  type GraphwarTrajectoryFormulaSettings,
  type GraphwarTrajectoryResolution,
} from "../../formula/trajectory/sampling";
import { GRAPHWAR_GAME_SOLDIER_RADIUS, GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { graphToImagePoint } from "../geometry";
import { createGraphPoint, type BoundsRect, type GraphBounds, type GraphPoint } from "../types";
import { prepareGraphwarWasmFormulaLaunch, type GraphwarWasmFormulaLaunchResult } from "./formula-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "./runtime";
import type { GraphwarWasmFormulaInputDescriptor } from "./task-adapter";

const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};
const hardStepPoints = [
  createGraphPoint(-24, 12),
  createGraphPoint(-22.857142857142858, 13.571428571428571),
  createGraphPoint(-22.84714285714286, 1.7532467532467528),
  createGraphPoint(-20, 0),
] as const satisfies readonly GraphPoint[];

let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Graphwar WASM refined formula launch differential", () => {
  it("keeps a non-zero first-segment y'' hard-window launch angle bound to its replay state", async () => {
    const points = [
      createGraphPoint(-24, 12),
      createGraphPoint(-23.9, -14),
      createGraphPoint(-20, 0),
    ] as const satisfies readonly GraphPoint[];
    const descriptor = createDescriptor(points, {
      algorithm: "step",
      decimalPlaces: 4,
      equation: "ddy",
      isStepGlitchModeEnabled: true,
      isStepOverflowProtectionEnabled: true,
      secondOrderLaunchAngleMode: "full-precision",
      steepness: 210,
    });
    const oracle = resolveColdTypeScript(descriptor);
    const firstTerm = oracle.context.compiledMaterials.stepFormula?.terms.find((term) => term.sourceSegmentIndex === 0);
    const expectedAngle = -Math.acos((points[1].x - points[0].x) / (2 * GRAPHWAR_GAME_SOLDIER_RADIUS));

    expect(firstTerm?.glitchSegment?.equation).toBe("ddy");
    expectFloatEquivalent(
      getGraphwarTrajectoryLaunchAngle(oracle.context, points[0]),
      expectedAngle,
      "step:ddy first launch-window oracle angle",
    );
    await expectSuccessfulLaunchToMatchTypeScript(descriptor, oracle, "step:ddy:first-launch-window");
  });

  it("applies ABS y' segment-start compensation before compiling final launch materials", async () => {
    const points = [
      createGraphPoint(-10, -1),
      createGraphPoint(-7, 2),
      createGraphPoint(-3, -2),
      createGraphPoint(1, 1),
    ];
    const descriptor = createDescriptor(points, {
      algorithm: "abs",
      decimalPlaces: 4,
      equation: "dy",
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      secondOrderLaunchAngleMode: "full-precision",
      steepness: 210,
    });
    const oracle = resolveColdTypeScript(descriptor);
    const segmentStartPoints = oracle.context.formulaEvaluation.segmentStartPoints;
    const expectedSegments = oracle.context.compiledMaterials.absSegments;

    expect(segmentStartPoints?.[1]).toBeDefined();
    expect(segmentStartPoints?.[2]).toBeDefined();
    expect(expectedSegments).toHaveLength(points.length - 1);
    if (!expectedSegments) {
      throw new Error("The ABS y' oracle did not compile connector segments");
    }
    expect(expectedSegments[1]?.startX).not.toBe(points[1]?.x);
    expect(expectedSegments[2]?.startX).not.toBe(points[2]?.x);

    await expectSuccessfulLaunchToMatchTypeScript(descriptor, oracle, "abs:dy:segment-start-compensation");
  });

  it.each([
    { hasExpectedHardSegment: false, isStepGlitchModeEnabled: false },
    { hasExpectedHardSegment: true, isStepGlitchModeEnabled: true },
  ])(
    "matches production Step y'' refinement with glitch gate=$isStepGlitchModeEnabled",
    async ({ hasExpectedHardSegment, isStepGlitchModeEnabled }) => {
      const descriptor = createHardStepDescriptor(isStepGlitchModeEnabled);
      const oracle = resolveColdTypeScript(descriptor);
      const expectedSegment = oracle.context.compiledMaterials.stepFormula?.terms[1]?.glitchSegment;

      expect(expectedSegment !== undefined).toBe(hasExpectedHardSegment);
      if (hasExpectedHardSegment) {
        expect(expectedSegment?.equation).toBe("ddy");
      }

      const actual = await expectSuccessfulLaunchToMatchTypeScript(
        descriptor,
        oracle,
        `step:ddy:glitch-gate-${isStepGlitchModeEnabled ? "on" : "off"}`,
      );
      expectNumericTreeEquivalent(
        actual.compiledMaterials.stepFormula?.terms[1]?.glitchSegment,
        expectedSegment,
        "step:ddy exact hard-glitch descriptor",
      );
    },
  );

  it.each(["initial", "landing"] as const)(
    "rejects a Step y'' hard-glitch candidate whose %s accepted point hits the mask",
    async (caseName) => {
      const baselineDescriptor = createHardStepDescriptor(true);
      const baseline = resolveColdTypeScript(baselineDescriptor);
      const hardSegment = baseline.context.compiledMaterials.stepFormula?.terms[1]?.glitchSegment;
      expect(hardSegment?.equation).toBe("ddy");
      if (hardSegment?.equation !== "ddy") {
        return;
      }

      const acceptedPoint =
        caseName === "initial"
          ? findLastPointBeforeX(baseline.result.sample.points, hardSegment.startX)
          : baseline.result.sample.points.find((point) => point.x >= hardSegment.endX);
      expect(acceptedPoint, `${caseName} accepted point fixture`).toBeDefined();
      if (!acceptedPoint) {
        return;
      }

      const obstacleMask = createSinglePointObstacleMask(acceptedPoint);
      const descriptor = createHardStepDescriptor(true, obstacleMask);
      const oracle = resolveColdTypeScript(descriptor);
      const maskedSegment = oracle.context.compiledMaterials.stepFormula?.terms[1]?.glitchSegment;
      expect(maskedSegment, `${caseName} mask must reject the unmasked winning descriptor`).not.toEqual(hardSegment);
      if (caseName === "initial") {
        expect(maskedSegment?.equation).toBe("ddy");
      } else {
        expect(maskedSegment).toBeUndefined();
      }

      await expectSuccessfulLaunchToMatchTypeScript(descriptor, oracle, `step:ddy:${caseName}-accepted-point-mask`);
    },
  );
});

function createHardStepDescriptor(isStepGlitchModeEnabled: boolean, stepGlitchObstacleMask?: Uint8Array) {
  return createDescriptor(hardStepPoints, {
    algorithm: "step",
    decimalPlaces: 4,
    equation: "ddy",
    isStepGlitchModeEnabled,
    isStepOverflowProtectionEnabled: true,
    secondOrderLaunchAngleMode: "full-precision",
    steepness: 210,
    ...(stepGlitchObstacleMask === undefined ? {} : { stepGlitchObstacleMask }),
  });
}

function createDescriptor(
  points: readonly GraphPoint[],
  settings: GraphwarTrajectoryFormulaSettings,
): GraphwarWasmFormulaInputDescriptor {
  const soldierCenter = points[0];
  if (!soldierCenter) {
    throw new Error("The refined launch fixture requires a soldier center");
  }
  return { bounds, points, settings, soldierCenter };
}

function createColdTypeScriptOptions(descriptor: GraphwarWasmFormulaInputDescriptor) {
  return {
    bounds: descriptor.bounds,
    boundsRect,
    formulaMode: createGraphwarTrajectoryFormulaMode(descriptor.settings),
    points: descriptor.points.map((point) => createGraphPoint(point.x, point.y)),
    soldierCenter: createGraphPoint(descriptor.soldierCenter.x, descriptor.soldierCenter.y),
    start: { type: "cold" as const },
  } satisfies Parameters<typeof resolveGraphwarTrajectory>[0];
}

function resolveColdTypeScript(descriptor: GraphwarWasmFormulaInputDescriptor) {
  return resolveGraphwarTrajectory(createColdTypeScriptOptions(descriptor));
}

async function expectSuccessfulLaunchToMatchTypeScript(
  descriptor: GraphwarWasmFormulaInputDescriptor,
  oracle: GraphwarTrajectoryResolution,
  label: string,
) {
  const actual = prepareGraphwarWasmFormulaLaunch(await createRuntime(), descriptor);
  expect(actual.status, `${label} status`).toBe("success");
  if (actual.status !== "success") {
    throw new Error(`${label} did not produce a successful WASM launch`);
  }

  expectNumericTreeEquivalent(actual.formulaPoints, oracle.context.formulaPoints, `${label} formulaPoints`);
  expectNumericTreeEquivalent(actual.compiledMaterials, oracle.context.compiledMaterials, `${label} compiledMaterials`);
  expect(actual.observedSignProtection, `${label} sign protection`).toEqual(
    normalizeSignProtection(oracle.context.signProtection, descriptor.points.length - 1),
  );
  expectLaunchStateEquivalent(actual, oracle, label);
  return actual;
}

function expectLaunchStateEquivalent(
  actual: Extract<GraphwarWasmFormulaLaunchResult, { status: "success" }>,
  oracle: GraphwarTrajectoryResolution,
  label: string,
) {
  const equation = oracle.context.settings.equation;
  const soldierCenter = oracle.context.soldierCenter;
  if (!soldierCenter) {
    throw new Error(`${label} TypeScript launch context did not retain the soldier center`);
  }
  const expectedAngle = getGraphwarTrajectoryLaunchAngle(oracle.context, soldierCenter);
  const expectedPoint = createGraphPoint(
    soldierCenter.x + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.cos(expectedAngle),
    soldierCenter.y + GRAPHWAR_GAME_SOLDIER_RADIUS * Math.sin(expectedAngle),
  );
  expect(actual.launch.equation, `${label} launch equation`).toBe(equation);
  expectNumericTreeEquivalent(actual.launch.point, expectedPoint, `${label} launch point`);

  if (equation === "y") {
    throw new Error(`${label} refined-launch fixture unexpectedly used the direct equation`);
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

function createSinglePointObstacleMask(point: GraphPoint) {
  const pixel = graphToImagePoint(point, bounds, boundsRect);
  const x = Math.floor(pixel.x);
  const y = Math.floor(pixel.y);
  if (x < 0 || x >= GRAPHWAR_PLANE_LENGTH || y < 0 || y >= GRAPHWAR_PLANE_HEIGHT) {
    throw new Error(`Accepted point (${point.x}, ${point.y}) is outside the obstacle-mask fixture`);
  }
  const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  mask[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
  return mask;
}

function findLastPointBeforeX(points: readonly GraphPoint[], x: number) {
  let candidate: GraphPoint | undefined;
  for (const point of points) {
    if (point.x >= x) {
      break;
    }
    candidate = point;
  }
  return candidate;
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

function expectFloatEquivalent(actual: number, expected: number, label: string) {
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
    const actualZero = actual === 0 ? (Object.is(actual, -0) ? "-0" : "+0") : String(actual);
    const expectedZero = Object.is(expected, -0) ? "-0" : "+0";
    expect(Object.is(actual, expected), `${label} signed zero: actual=${actualZero}, expected=${expectedZero}`).toBe(
      true,
    );
    return;
  }
  expect(
    ulpDistance(actual, expected),
    `${label} ULP distance: actual=${actual}, expected=${expected}`,
  ).toBeLessThanOrEqual(64n);
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
