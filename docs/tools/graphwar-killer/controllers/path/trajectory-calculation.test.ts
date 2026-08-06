import { beforeAll, describe, expect, it } from "vitest";

import { graphToImagePoint } from "../../core/geometry";
import { roundGraphwarLaunchAngleToDisplayRadians } from "../../core/numbers";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import { createGraphPoint, createPixelPoint } from "../../core/types";
import { prepareGraphwarWasmFormulaLaunch } from "../../core/wasm/formula-adapter";
import { readGraphwarKernelBytes } from "../../core/wasm/kernel-test-fixture";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import { buildFormula } from "../../formula/generation/build";
import { createStepOverflowProtectionRange } from "../../formula/generation/step-numeric-strategy";
import { calculateGraphwarTrajectory, calculateGraphwarTrajectoryWithWasm } from "./trajectory-calculation";

const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect = { height: 450, width: 770, x: 0, y: 0 };
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("main trajectory calculation", () => {
  it("keeps smart target-stop policy identical across TS and WASM", async () => {
    const points = [createGraphPoint(-20, 0), createGraphPoint(-5, 4), createGraphPoint(10, 0)];
    const target = { hitRadiusPixels: 10_000, point: graphToImagePoint(points[2], bounds, boundsRect) };
    const input = {
      bounds,
      boundsRect,
      points,
      settings: {
        algorithm: "step" as const,
        decimalPlaces: 4,
        equation: "y" as const,
        steepness: 67,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      },
      target,
      type: "solver" as const,
    };
    const tsEarly = calculateGraphwarTrajectory({ ...input, shouldStopOnTargetsComplete: true });
    const wasmEarly = calculateGraphwarTrajectoryWithWasm(await createRuntime(), {
      ...input,
      shouldStopOnTargetsComplete: true,
    });
    const tsNatural = calculateGraphwarTrajectory({ ...input, shouldStopOnTargetsComplete: false });
    const wasmNatural = calculateGraphwarTrajectoryWithWasm(await createRuntime(), {
      ...input,
      shouldStopOnTargetsComplete: false,
    });
    const tsNaturalOmitted = calculateGraphwarTrajectory(input);
    const wasmNaturalOmitted = calculateGraphwarTrajectoryWithWasm(await createRuntime(), input);

    expect(
      tsEarly.ok && wasmEarly.ok && tsNatural.ok && wasmNatural.ok && tsNaturalOmitted.ok && wasmNaturalOmitted.ok,
    ).toBe(true);
    if (
      !tsEarly.ok ||
      !wasmEarly.ok ||
      !tsNatural.ok ||
      !wasmNatural.ok ||
      !tsNaturalOmitted.ok ||
      !wasmNaturalOmitted.ok
    ) {
      return;
    }
    expect(wasmEarly.result).toEqual(tsEarly.result);
    expect(tsEarly.result.trajectoryPoints.length).toBeLessThan(tsNatural.result.trajectoryPoints.length);
    expect(wasmEarly.result.trajectoryPoints.length).toBeLessThan(wasmNatural.result.trajectoryPoints.length);
    expect(wasmNatural.result).toEqual(tsNatural.result);
    expect(tsNaturalOmitted.result).toEqual(tsNatural.result);
    expect(wasmNaturalOmitted.result).toEqual(wasmNatural.result);
  });

  it("reports the WASM ABS pulse steepness reason without guessing from settings", async () => {
    const outcome = calculateGraphwarTrajectoryWithWasm(await createRuntime(), {
      bounds,
      boundsRect,
      points: [createGraphPoint(-10, 0), createGraphPoint(10, 0)],
      settings: {
        algorithm: "abs",
        decimalPlaces: 0,
        equation: "ddy",
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
        steepness: 0.4,
      },
      type: "solver",
    });

    expect(outcome).toEqual({
      message: "ABS second-order pulse steepness is not positive.",
      ok: false,
      stage: "formula",
    });
  });

  it("formats the WASM formula from refined launch evidence", async () => {
    const points = [
      createGraphPoint(-23.376623376623378, 2.5974025974025974),
      createGraphPoint(-19, 0),
      createGraphPoint(-17, -2),
    ];
    const settings = {
      algorithm: "step" as const,
      decimalPlaces: 4,
      equation: "dy" as const,
      formulaPathSteepness: 7.5,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      steepness: 210,
    };
    const descriptor = { bounds, points, settings, soldierCenter: points[0] };
    const runtime = await createRuntime();
    const launch = prepareGraphwarWasmFormulaLaunch(runtime, descriptor);
    expect(launch.status).toBe("success");
    if (launch.status !== "success") {
      return;
    }
    expect(launch.formulaPoints).not.toEqual(points);

    const outcome = calculateGraphwarTrajectoryWithWasm(runtime, {
      bounds,
      boundsRect,
      points,
      settings,
      type: "solver",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }

    expect(outcome.result.secondOrderLaunchAngle).toBeUndefined();
    expect(outcome.result.formulaResult).toEqual(
      buildFormula(
        launch.formulaPoints,
        settings.steepness,
        settings.equation,
        settings.algorithm,
        settings.decimalPlaces,
        {
          compiledMaterials: launch.compiledMaterials,
          isStepOverflowProtectionEnabled: settings.isStepOverflowProtectionEnabled,
          signProtection: launch.observedSignProtection,
          stepOverflowProtectionRange: createStepOverflowProtectionRange(bounds, launch.formulaPoints),
        },
      ),
    );
  });

  it("solves a y'' formula and returns its angle and visible trajectory atomically", () => {
    const start = createGraphPoint(-10, 0);
    const target = createGraphPoint(10, 0);
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points: [start, target],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 67,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      },
      target: { hitRadiusPixels: 7, point: graphToImagePoint(target, bounds, boundsRect) },
      type: "solver",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.formulaResult?.expression).toBeTruthy();
    expect(outcome.result.secondOrderLaunchAngle?.degrees).toBeCloseTo(0);
    expect(outcome.result.curvePoints.split(" ").length).toBeGreaterThan(1);
    expect(Number(outcome.result.curvePoints.split(" ").at(-1)?.split(",")[0])).toBeGreaterThan(
      graphToImagePoint(target, bounds, boundsRect).x,
    );
    expect(outcome.result.warningReason).toBeUndefined();
  });

  it("keeps the analytic ABS y'' launch angle at full precision", () => {
    const start = createGraphPoint(-10, 0);
    const target = createGraphPoint(-3, 4);
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points: [start, target, createGraphPoint(5, 4)],
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      type: "solver",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.formulaResult?.expression).toContain("exp(-abs(");
    const expectedAngle = Math.atan2(target.y - start.y, target.x - start.x);
    expect(Object.is(outcome.result.secondOrderLaunchAngle?.radians, expectedAngle)).toBe(true);
    expect(Object.is(outcome.result.secondOrderLaunchAngle?.degrees, (expectedAngle * 180) / Math.PI)).toBe(true);
  });

  it("replays and returns an explicitly requested two-decimal y'' launch angle", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points: [createGraphPoint(-10, 0), createGraphPoint(-3, 4), createGraphPoint(5, 4)],
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        secondOrderLaunchAngleMode: "display-rounded",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      type: "solver",
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const angle = outcome.result.secondOrderLaunchAngle?.degrees;
      expect(angle).toBeDefined();
      expect(angle).toBeCloseTo(Number(angle?.toFixed(2)), 12);
      expect(
        Object.is(
          outcome.result.secondOrderLaunchAngle?.radians,
          roundGraphwarLaunchAngleToDisplayRadians(Math.atan2(4, 7)),
        ),
      ).toBe(true);
    }
  });

  it.each(["y", "dy", "ddy"] as const)("rejects a final %s formula that misses its real target circle", (equation) => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points: [createGraphPoint(-10, 0), createGraphPoint(10, 0)],
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation,
        secondOrderLaunchAngleMode: "full-precision",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      target: { hitRadiusPixels: 1, point: graphToImagePoint(createGraphPoint(10, 10), bounds, boundsRect) },
      type: "solver",
    });

    expect(outcome).toMatchObject({ ok: false, stage: "trajectory" });
  });

  it("keeps the formula and visible prefix when an obstacle stops the trajectory before its final target", async () => {
    const points = [createGraphPoint(-10, 0), createGraphPoint(0, 0), createGraphPoint(10, 0)];
    const input = {
      bounds,
      boundsRect,
      points,
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "y",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      target: { hitRadiusPixels: 7, point: graphToImagePoint(points[2], bounds, boundsRect) },
      type: "solver",
    } satisfies Parameters<typeof calculateGraphwarTrajectory>[0];
    const baseline = calculateGraphwarTrajectory(input);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) {
      return;
    }

    const middlePixelX = graphToImagePoint(points[1], bounds, boundsRect).x;
    const collisionPixel = baseline.result.trajectoryPoints.find(
      (point) => point.x > middlePixelX + 2 && point.x < input.target.point.x - 2,
    );
    expect(collisionPixel).toBeDefined();
    if (!collisionPixel) {
      return;
    }
    const mask = new Uint8Array(boundsRect.width * boundsRect.height);
    mask[Math.floor(collisionPixel.y) * boundsRect.width + Math.floor(collisionPixel.x)] = 1;

    const outcome = calculateGraphwarTrajectory({ ...input, collision: { mask } });
    const wasmOutcome = calculateGraphwarTrajectoryWithWasm(await createRuntime(), { ...input, collision: { mask } });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.formulaResult?.expression).toBeTruthy();
    expect(outcome.result.curvePoints).not.toBe("");
    expect(outcome.result.trajectoryPoints.length).toBeLessThan(baseline.result.trajectoryPoints.length);
    expect(outcome.result.hasTargetMissWarning).toBeUndefined();
    expect(outcome.result.warningReason).toBe("obstacle");
    expect(outcome.result.obstacleHitPoint).toBeDefined();
    expect(wasmOutcome.ok).toBe(true);
    if (!wasmOutcome.ok) {
      return;
    }
    expect(wasmOutcome.result).toEqual(outcome.result);
  });

  it("rejects a target miss when an obstacle is hit at the target circle's forward boundary", () => {
    const input = {
      bounds,
      boundsRect,
      points: [createGraphPoint(-10, 0), createGraphPoint(10, 0)],
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "y",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      type: "solver",
    } satisfies Parameters<typeof calculateGraphwarTrajectory>[0];
    const baseline = calculateGraphwarTrajectory(input);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) {
      return;
    }

    const collisionPixel = baseline.result.trajectoryPoints.find(
      (point) => point.x > graphToImagePoint(createGraphPoint(10, 0), bounds, boundsRect).x + 2,
    );
    expect(collisionPixel).toBeDefined();
    if (!collisionPixel) {
      return;
    }
    const mask = new Uint8Array(boundsRect.width * boundsRect.height);
    mask[Math.floor(collisionPixel.y) * boundsRect.width + Math.floor(collisionPixel.x)] = 1;
    const obstacleOnly = calculateGraphwarTrajectory({ ...input, collision: { mask } });
    expect(obstacleOnly.ok && obstacleOnly.result.warningReason).toBe("obstacle");

    const targetHitRadiusPixels = 1;
    const targetPoint = createPixelPoint(
      collisionPixel.x - targetHitRadiusPixels,
      collisionPixel.y - targetHitRadiusPixels * 2,
    );

    expect(
      calculateGraphwarTrajectory({
        ...input,
        collision: { mask },
        target: { hitRadiusPixels: targetHitRadiusPixels, point: targetPoint },
      }),
    ).toMatchObject({ ok: false, stage: "trajectory" });
  });

  it.each(["dy", "ddy"] as const)("keeps a finite soft %s result when hard Step cannot improve it", (equation) => {
    const points = [
      createGraphPoint(-12, 0),
      createGraphPoint(-10, 0),
      createGraphPoint(-9.99999, 10),
      createGraphPoint(-5, 0),
    ];
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points,
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation,
        steepness: 210,
        isStepGlitchModeEnabled: true,
        isStepOverflowProtectionEnabled: true,
      },
      type: "solver",
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.pathError).toBeGreaterThan(graphwarToolDefaults.formulaPathQualityTargetPlanePixels);
    }
  });

  it("keeps only display-rounded y'' target misses as a non-blocking warning", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points: [createGraphPoint(-10, 0), createGraphPoint(10, 0)],
      settings: {
        algorithm: "abs",
        decimalPlaces: 4,
        equation: "ddy",
        secondOrderLaunchAngleMode: "display-rounded",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      target: { hitRadiusPixels: 1, point: graphToImagePoint(createGraphPoint(10, 10), bounds, boundsRect) },
      type: "solver",
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.formulaResult?.expression).toBeTruthy();
      expect(outcome.result.hasTargetMissWarning).toBe(true);
    }
  });

  it("returns a low-precision formula when its optional path-quality target is not reached", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points: [createGraphPoint(-10.2, -0.3), createGraphPoint(-3.37, 4.48), createGraphPoint(4.91, -2.26)],
      settings: {
        algorithm: "abs",
        decimalPlaces: 0,
        equation: "y",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: false,
      },
      type: "solver",
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.formulaResult?.expression).toBeTruthy();
      expect(outcome.result.pathError).toBeGreaterThan(1);
    }
  });

  it("uses the best finite launch-point state after the local residual stops improving", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      points: [createGraphPoint(-10, -1), createGraphPoint(-7, 2), createGraphPoint(-3, -2), createGraphPoint(1, 1)],
      settings: {
        algorithm: "pchip",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 210,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      },
      type: "solver",
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.formulaResult?.expression).toBeTruthy();
    }
  });

  it("simulates a user expression without producing solver-only fields", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      equation: "y",
      expression: "0",
      soldierCenter: createGraphPoint(-10, 0),
      type: "simulator",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.curvePoints.split(" ").length).toBeGreaterThan(1);
    expect(outcome.result.formulaResult).toBeUndefined();
    expect(outcome.result.secondOrderLaunchAngle).toBeUndefined();
    expect(outcome.result.warningReason).toBe("out-of-bounds");
  });

  it("returns normal sampling stop reasons as successful warnings", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      equation: "y",
      expression: "1/0",
      soldierCenter: createGraphPoint(-10, 0),
      type: "simulator",
    });

    expect(outcome).toEqual({
      ok: true,
      result: {
        curvePoints: "",
        trajectoryPoints: [createPixelPoint(231, 225)],
        warningReason: "invalid",
      },
    });
  });

  it("returns an obstacle stop as a successful warning", () => {
    const outcome = calculateGraphwarTrajectory({
      bounds,
      boundsRect,
      collision: { mask: new Uint8Array(770 * 450).fill(1) },
      equation: "y",
      expression: "0",
      soldierCenter: createGraphPoint(-10, 0),
      type: "simulator",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.warningReason).toBe("obstacle");
  });

  it("keeps a target hit when the same sample also reaches an obstacle", () => {
    const start = createGraphPoint(-10, 0);
    const target = createGraphPoint(10, 0);
    const input = {
      bounds,
      boundsRect,
      points: [start, target],
      settings: {
        algorithm: "step",
        decimalPlaces: 4,
        equation: "ddy",
        steepness: 67,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
      },
      type: "solver",
    } satisfies Parameters<typeof calculateGraphwarTrajectory>[0];
    const baseline = calculateGraphwarTrajectory(input);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) {
      return;
    }
    const sampledPixels = baseline.result.curvePoints.split(" ").map((point) => point.split(",").map(Number));
    const collisionPixel = sampledPixels.find(([x]) => Math.floor(x) >= Math.floor(sampledPixels[0][0]) + 2);
    expect(collisionPixel).toBeDefined();
    if (!collisionPixel) {
      return;
    }
    const [sampleX, sampleY] = collisionPixel;
    const mask = new Uint8Array(770 * 450);
    mask[Math.floor(sampleY) * 770 + Math.floor(sampleX)] = 1;
    const obstacleOnly = calculateGraphwarTrajectory({ ...input, collision: { mask } });
    expect(obstacleOnly.ok && obstacleOnly.result.warningReason).toBe("obstacle");
    const outcome = calculateGraphwarTrajectory({
      ...input,
      collision: { mask },
      target: { hitRadiusPixels: 0.01, point: createPixelPoint(sampleX, sampleY) },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    // 主轨迹一直按“先命中、后碰撞”结算；合并扫描不能把同点命中改成障碍警告。
    expect(outcome.result.warningReason).toBeUndefined();
    expect(outcome.result.curvePoints).toBe(obstacleOnly.ok ? obstacleOnly.result.curvePoints : undefined);
    expect(outcome.result.trajectoryPoints).toEqual(obstacleOnly.ok ? obstacleOnly.result.trajectoryPoints : undefined);
  });
});

async function createRuntime(): Promise<GraphwarWasmKernelRuntime> {
  return instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 65_536 });
}
