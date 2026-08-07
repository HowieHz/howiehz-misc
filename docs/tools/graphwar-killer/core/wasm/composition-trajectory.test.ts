import { describe, expect, it, vi } from "vitest";

import { compareGraphwarPathErrors, createGraphwarTrajectoryFormulaMode } from "../../formula/trajectory/sampling";
import { createGraphwarStepRouteModel } from "../../pathfinding/routing/step-route";
import { createGraphwarSmartPathfindingTrajectoryResult } from "../../pathfinding/smart/trajectory";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { graphwarToolDefaults } from "../tool/defaults";
import { createPixelPoint, type AlgorithmMode, type EquationMode } from "../types";
import { GraphwarWasmAdapterError } from "./abi";
import {
  runGraphwarWasmOneClickTrajectoryComposition,
  runGraphwarWasmSmartPathfinding,
  type GraphwarWasmSmartPathfindingInput,
} from "./composition-adapter";
import { runGraphwarWasmTrajectory } from "./formula-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { createGraphwarWasmRouteContext } from "./route-adapter";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "./runtime";
import type { GraphwarWasmFormulaInputDescriptor, GraphwarWasmPoint, GraphwarWasmStopPolicy } from "./task-adapter";

const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 } as const;
const boundsRect = { height: GRAPHWAR_PLANE_HEIGHT, width: GRAPHWAR_PLANE_LENGTH, x: 0, y: 0 } as const;
const kernelModulePromise = readGraphwarKernelBytes().then((bytes) => WebAssembly.compile(bytes));

const formulaModes = [
  ["step", "y"],
  ["step", "dy"],
  ["step", "ddy"],
  ["abs", "y"],
  ["abs", "dy"],
  ["abs", "ddy"],
  ["pchip", "y"],
  ["pchip", "dy"],
  ["pchip", "ddy"],
  ["akima", "y"],
  ["akima", "dy"],
  ["akima", "ddy"],
] as const satisfies readonly (readonly [AlgorithmMode, EquationMode])[];

describe("Graphwar WASM smart trajectory composition", () => {
  it.each(formulaModes)("validates the ordinary %s/%s candidate inside WASM", async (algorithm, equation) => {
    const runtime = await createRuntime();
    const path = [
      graphToPixelPoint({ x: -2, y: 1 }),
      graphToPixelPoint({ x: -0.25, y: 2.5 }),
      graphToPixelPoint({ x: 1.5, y: -1.25 }),
      graphToPixelPoint({ x: 4, y: 3.75 }),
    ];
    const target = { x: 0, y: 0 };
    const targetRadius = 10_000;
    const smartInput = createSmartTrajectoryInput({
      algorithm,
      equation,
      isDeleteOptimizationEnabled: false,
      path,
      target,
      targetRadius,
    });
    const typescriptResult = createGraphwarSmartPathfindingTrajectoryResult({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      formulaMode: createGraphwarTrajectoryFormulaMode(createDescriptor(algorithm, equation, path).settings),
      hitTarget: { center: createPixelPoint(target.x, target.y), radius: targetRadius },
      obstacleMask: undefined,
      points: path.map(({ x, y }) => createPixelPoint(x, y)),
      targetHitRadiusPixels: undefined,
    });
    const result = runGraphwarWasmSmartPathfinding(runtime, smartInput);

    expect(typescriptResult.reachesTargetBeforeObstacle).toBe(true);
    expect(result).toEqual({
      points: path,
      reachedRequiredTargetCount: 0,
      reachedTargetCount: 1,
      removedPointCount: 0,
      sourcePointIndexes: [0, 1, 2, 3],
      status: "success",
      validation: { target: { center: { x: 0, y: 0 }, radius: 10_000 }, type: "trajectory" },
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("combines ordinary validation and deletion into one owned result", async () => {
    const runtime = await createRuntime();
    const path = [
      { x: 100, y: 225 },
      { x: 170, y: 205 },
      { x: 240, y: 245 },
      { x: 310, y: 210 },
      { x: 380, y: 225 },
    ];
    const result = runGraphwarWasmOneClickTrajectoryComposition(runtime, {
      allowTerminalPointDeletion: true,
      isDeleteOptimizationEnabled: true,
      points: path,
      sourcePointCount: 1,
      trajectoryValidation: {
        descriptor: createDescriptor("pchip", "y", path),
        stop: {
          ...createTargetStop(path, { x: 0, y: 0 }, 10_000),
          shouldCollectVisiblePixels: true,
        },
        type: "trajectory",
      },
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.path[0]).toEqual(path[0]);
      expect(result.removedPointCount).toBe(path.length - result.path.length);
      expect(result.formula.observedSignProtection).toEqual(
        result.trajectory.continuationEvidence.observedSignProtection,
      );
      expect(result.targetOrder).toEqual([{ x: 0, y: 0 }]);
      expect(result.incumbentEvidence.path).toEqual(result.path);
      expect(result.incumbentEvidence.trajectory).toBe(result.trajectory);
      expect(result.incumbentEvidence.formulaContext.compiledMaterials).toBe(result.formula.compiledMaterials);
      expect(result.incumbentEvidence.formulaContext.formulaResult.expression).toBeTruthy();
      expect(result.incumbentEvidence.trajectoryPoints.length).toBe(result.trajectory.visiblePixels.length);
    }
  });

  it("preserves intermediate target anchors while deleting other controls", async () => {
    const runtime = await createRuntime();
    const path = [
      { x: 100, y: 225 },
      { x: 160, y: 210 },
      { x: 220, y: 225 },
      { x: 280, y: 240 },
      { x: 340, y: 225 },
    ];
    const anchor = path[2];
    const result = runGraphwarWasmOneClickTrajectoryComposition(runtime, {
      allowTerminalPointDeletion: true,
      isDeleteOptimizationEnabled: true,
      points: path,
      sourcePointCount: 1,
      targetAnchors: [anchor],
      targetAnchorIndexes: [2],
      trajectoryValidation: {
        descriptor: createDescriptor("pchip", "y", path),
        stop: {
          ...createTargetStop(path, { x: 0, y: 0 }, 10_000),
          requiredTargets: [{ center: anchor, radius: 1 }],
          shouldCollectVisiblePixels: true,
        },
        type: "trajectory",
      },
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.path).toContainEqual(anchor);
      expect(result.targetAnchors).toEqual([anchor]);
      expect(result.sourcePointIndexes).toContain(2);
    }
  });

  it("rejects a target anchor index bound to a different source point", async () => {
    const runtime = await createRuntime();
    const path = [
      { x: 100, y: 225 },
      { x: 160, y: 210 },
      { x: 220, y: 225 },
      { x: 280, y: 240 },
      { x: 340, y: 225 },
    ];
    const anchor = path[2];
    if (!anchor) {
      throw new Error("Expected an intermediate target anchor");
    }
    expect(() =>
      runGraphwarWasmOneClickTrajectoryComposition(runtime, {
        isDeleteOptimizationEnabled: false,
        points: path,
        sourcePointCount: 1,
        targetAnchorIndexes: [1],
        targetAnchors: [anchor],
        trajectoryValidation: {
          descriptor: createDescriptor("pchip", "y", path),
          stop: {
            ...createTargetStop(path, path.at(-1) ?? anchor, 10_000),
            orderedTargets: [
              { center: anchor, radius: 1 },
              { center: path.at(-1) ?? anchor, radius: 10_000 },
            ],
            requiredTargets: [{ center: anchor, radius: 1 }],
          },
          type: "trajectory",
        },
      }),
    ).toThrowError(GraphwarWasmAdapterError);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("uses smart replay progress without a second trajectory probe", async () => {
    const runtime = await createRuntime();
    const path = createFlatPath();
    const anchor = path[1];
    const target = path.at(-1);
    if (!anchor || !target) {
      throw new Error("Expected an anchor and terminal target");
    }
    const runTrajectory = vi.spyOn(runtime, "runTrajectory");
    const result = runGraphwarWasmOneClickTrajectoryComposition(runtime, {
      isDeleteOptimizationEnabled: false,
      points: path,
      prefixTargetCount: 1,
      runSmartPathfinding: () => ({
        failureReason: "trajectory",
        points: [],
        reachedRequiredTargetCount: 1,
        reachedTargetCount: 1,
        removedPointCount: 0,
        status: "failure" as const,
      }),
      sourcePointCount: 1,
      targetAnchors: [anchor],
      trajectoryValidation: {
        descriptor: createDescriptor("pchip", "y", path),
        stop: {
          ...createTargetStop(path, target, 10_000),
          orderedTargets: [
            { center: anchor, radius: 1 },
            { center: target, radius: 10_000 },
          ],
        },
        type: "trajectory",
      },
    });

    expect(result).toEqual({ reachedTargetCount: 1, reason: "trajectory", status: "failure" });
    expect(runTrajectory).not.toHaveBeenCalled();
  });

  it("keeps a deletion candidate rejected by the trajectory/obstacle proof", async () => {
    const runtime = await createRuntime();
    const path = [
      graphToPixelPoint({ x: -20, y: 0 }),
      graphToPixelPoint({ x: -15, y: 4 }),
      graphToPixelPoint({ x: -10, y: 4 }),
    ];
    const target = path.at(-1);
    if (!target) {
      throw new Error("Expected a terminal target point");
    }
    const obstacle = graphToPixelPoint({ x: -10.7, y: 2.3 });
    const collisionMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    collisionMask[Math.trunc(obstacle.y) * GRAPHWAR_PLANE_LENGTH + Math.trunc(obstacle.x)] = 1;
    const stepRouteModel = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 7.5,
      steepness: 3.25,
    });
    if (!stepRouteModel) {
      throw new Error("Expected a valid Step route model");
    }
    const routeContext = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      routeOriginPoint: pixelToGraphPoint(path[0]),
      routeTolerancePlanePixels: 0,
      sourceMask: collisionMask,
      sourceMaskType: "route",
      stepRouteModel: {
        ...stepRouteModel,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });
    try {
      const result = runGraphwarWasmOneClickTrajectoryComposition(runtime, {
        allowTerminalPointDeletion: false,
        isDeleteOptimizationEnabled: true,
        points: path,
        runSmartPathfinding: (smartInput) => routeContext.runSmartPathfinding(smartInput),
        sourcePointCount: 1,
        trajectoryValidation: {
          descriptor: createDescriptor("step", "y", path),
          stop: {
            ...createTargetStop(path, target, 2, collisionMask),
            shouldCollectVisiblePixels: true,
          },
          type: "trajectory",
        },
      });

      expect(result).toMatchObject({ path, removedPointCount: 0, status: "success" });
    } finally {
      routeContext.dispose();
    }
  });

  it("retains target-before-obstacle ordering in the final evidence", async () => {
    const runtime = await createRuntime();
    const path = [
      { x: 100, y: 300 },
      { x: 220, y: 100 },
      { x: 280, y: 150 },
      { x: 400, y: 300 },
    ];
    const target = { x: 400, y: 300 };
    const collisionMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    fillMaskRectangle(collisionMask, { maxX: 320, maxY: 315, minX: 180, minY: 285 });
    const result = runGraphwarWasmOneClickTrajectoryComposition(runtime, {
      allowTerminalPointDeletion: true,
      isDeleteOptimizationEnabled: true,
      points: path,
      sourcePointCount: 1,
      trajectoryValidation: {
        descriptor: createDescriptor("pchip", "y", path),
        stop: {
          ...createTargetStop(path, target, 10, collisionMask),
          shouldCollectVisiblePixels: true,
        },
        type: "trajectory",
      },
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.trajectory.targetHitIndex).toBeGreaterThanOrEqual(0);
      expect(
        result.trajectory.obstacle.type === "none" ||
          result.trajectory.targetHitIndex <= result.trajectory.obstacle.sampleIndex,
      ).toBe(true);
    }
  });

  it("rejects malformed smart provenance before final evidence is exposed", async () => {
    const runtime = await createRuntime();
    const runSmartPathfinding = runtime.runSmartPathfinding.bind(runtime);
    vi.spyOn(runtime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runSmartPathfinding(inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      view.setUint32(resultPointer + 32, view.getUint32(inputPointer + 72, true), true);
      return resultPointer;
    });

    expectGraphwarWasmOutputFault(
      () =>
        runGraphwarWasmOneClickTrajectoryComposition(runtime, {
          isDeleteOptimizationEnabled: false,
          points: createFlatPath(),
          sourcePointCount: 1,
          trajectoryValidation: {
            descriptor: createDescriptor("pchip", "y", createFlatPath()),
            stop: createTargetStop(createFlatPath(), { x: 0, y: 0 }, 10_000),
            type: "trajectory",
          },
        }),
      "range-out-of-bounds",
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("lets ordinary stateless trajectory validation decide even when the retained route mask blocks the shortcut", async () => {
    const runtime = await createRuntime();
    const routeMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    fillMaskRectangle(routeMask, { maxX: 240, maxY: 230, minX: 200, minY: 220 });
    const path = createFlatPath();
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      routeOriginPoint: pixelToGraphPoint(path[0]),
      routeTolerancePlanePixels: 0,
      sourceMask: routeMask,
      sourceMaskType: "route",
    });

    const result = context.runSmartPathfinding(
      createSmartTrajectoryInput({
        isDeleteOptimizationEnabled: false,
        path,
        target: { x: 0, y: 0 },
        targetRadius: 10_000,
      }),
    );

    expect(result).toMatchObject({ status: "success", validation: { type: "trajectory" } });
    context.dispose();
  });

  it("keeps a point whose deletion violates the Step-stateful transition", async () => {
    const runtime = await createRuntime();
    const routeMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const path = [
      graphToPixelPoint({ x: -20, y: 0 }),
      graphToPixelPoint({ x: -15, y: 4 }),
      graphToPixelPoint({ x: -10, y: 4 }),
    ];
    const obstacle = graphToPixelPoint({ x: -10.1, y: 2 });
    routeMask[Math.trunc(obstacle.y) * GRAPHWAR_PLANE_LENGTH + Math.trunc(obstacle.x)] = 1;
    const model = createGraphwarStepRouteModel(0, {
      decimalPlaces: 4,
      equation: "y",
      formulaPathSteepness: 7.5,
      steepness: 3.25,
    });
    if (!model) {
      throw new Error("Expected a valid Step route model");
    }
    const context = createGraphwarWasmRouteContext(runtime, {
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      routeOriginPoint: pixelToGraphPoint(path[0]),
      routeTolerancePlanePixels: 0,
      sourceMask: routeMask,
      sourceMaskType: "route",
      stepRouteModel: {
        ...model,
        qualityTargetPlanePixels: graphwarToolDefaults.formulaPathQualityTargetPlanePixels,
      },
    });

    const result = context.runSmartPathfinding(
      createSmartTrajectoryInput({
        algorithm: "step",
        equation: "y",
        isDeleteOptimizationEnabled: true,
        path,
        target: { x: 0, y: 0 },
        targetRadius: 10_000,
      }),
    );

    expect(result).toMatchObject({ points: path, removedPointCount: 0, status: "success" });
    context.dispose();
  });

  it("deletes non-collinear points only after their trajectory replays succeed", async () => {
    const runtime = await createRuntime();
    const path = [
      { x: 100, y: 225 },
      { x: 170, y: 205 },
      { x: 240, y: 245 },
      { x: 310, y: 210 },
      { x: 380, y: 225 },
    ];
    const result = runGraphwarWasmSmartPathfinding(
      runtime,
      createSmartTrajectoryInput({
        isDeleteOptimizationEnabled: true,
        path,
        target: { x: 0, y: 0 },
        targetRadius: 10_000,
      }),
    );
    const finalPoint = path.at(-1);
    if (!finalPoint) {
      throw new Error("Expected a final smart path point");
    }
    const finalReplay = runGraphwarWasmTrajectory(runtime, {
      descriptor: createDescriptor("pchip", "y", [path[0], finalPoint]),
      start: { type: "cold" },
      stop: createTargetStop([path[0], finalPoint], { x: 0, y: 0 }, 10_000),
    });

    expect(finalReplay?.pathError).toBeUndefined();
    expect(result).toEqual({
      points: [path[0], path.at(-1)],
      reachedRequiredTargetCount: 0,
      reachedTargetCount: 1,
      removedPointCount: 3,
      sourcePointIndexes: [0, 4],
      status: "success",
      validation: { target: { center: { x: 0, y: 0 }, radius: 10_000 }, type: "trajectory" },
    });
  });

  it("uses pathError to choose one valid deletion and keeps it when the next replay hits an obstacle", async () => {
    const runtime = await createRuntime();
    const path = [
      { x: 100, y: 300 },
      { x: 220, y: 100 },
      { x: 280, y: 150 },
      { x: 400, y: 300 },
    ];
    const target = { x: 400, y: 300 };
    const targetRadius = 10;
    const collisionMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    fillMaskRectangle(collisionMask, { maxX: 320, maxY: 315, minX: 180, minY: 285 });
    const candidates = [path.filter((_, index) => index !== 1), path.filter((_, index) => index !== 2)];
    const candidateResults = candidates.map((candidate) =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y", candidate),
        start: { type: "cold" },
        stop: createTargetStop(candidate, target, targetRadius, collisionMask),
      }),
    );
    expect(candidateResults.every((result) => result?.targetHitIndex !== -1 && result?.obstacle.type === "none")).toBe(
      true,
    );
    const [firstError, secondError] = candidateResults.map((result) => result?.pathError);
    expect(firstError).toBeDefined();
    expect(secondError).toBeDefined();
    const typescriptCandidateResults = candidates.map((candidate) =>
      createGraphwarSmartPathfindingTrajectoryResult({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        formulaMode: createGraphwarTrajectoryFormulaMode(createDescriptor("pchip", "y", candidate).settings),
        hitTarget: { center: createPixelPoint(target.x, target.y), radius: targetRadius },
        obstacleMask: collisionMask,
        points: candidate.map(({ x, y }) => createPixelPoint(x, y)),
        targetHitRadiusPixels: undefined,
      }),
    );
    expect(typescriptCandidateResults.map(({ reachesTargetBeforeObstacle }) => reachesTargetBeforeObstacle)).toEqual([
      true,
      true,
    ]);
    expect(candidateResults.map((candidateResult) => candidateResult?.pathError)).toEqual(
      typescriptCandidateResults.map(({ pathError }) => pathError),
    );
    const expectedWinner = compareGraphwarPathErrors(secondError, firstError) < 0 ? candidates[1] : candidates[0];
    const expectedFinalPoint = expectedWinner.at(-1);
    if (!expectedFinalPoint) {
      throw new Error("Expected a retained candidate endpoint");
    }
    const rejectedNextCandidate = [expectedWinner[0], expectedFinalPoint];
    const rejectedNextReplay = runGraphwarWasmTrajectory(runtime, {
      descriptor: createDescriptor("pchip", "y", rejectedNextCandidate),
      start: { type: "cold" },
      stop: createTargetStop(rejectedNextCandidate, target, targetRadius, collisionMask),
    });
    expect(rejectedNextReplay?.targetHitIndex).toBe(-1);
    expect(rejectedNextReplay?.obstacle.type).toBe("hit");

    const result = runGraphwarWasmSmartPathfinding(
      runtime,
      createSmartTrajectoryInput({
        collisionMask,
        isDeleteOptimizationEnabled: true,
        path,
        target,
        targetRadius,
      }),
    );

    expect(result).toEqual({
      points: expectedWinner,
      reachedRequiredTargetCount: 0,
      reachedTargetCount: 1,
      removedPointCount: 1,
      sourcePointIndexes: expectedWinner.map((point) => path.indexOf(point)),
      status: "success",
      validation: { target: { center: target, radius: targetRadius }, type: "trajectory" },
    });
  });

  it("prefers a finite pathError to an earlier Infinity candidate", async () => {
    const runtime = await createRuntime();
    const path = [
      { x: 100, y: 260 },
      { x: 175, y: 120 },
      { x: 250, y: 330 },
      { x: 325, y: 130 },
      { x: 400, y: 260 },
    ];
    const candidates = [1, 2, 3].map((removedIndex) => path.filter((_, index) => index !== removedIndex));
    const target = { x: 255.84951021434424, y: 329.5839044469151 };
    const targetRadius = 3;
    const candidateResults = candidates.map((candidate) =>
      runGraphwarWasmTrajectory(runtime, {
        descriptor: createDescriptor("pchip", "y", candidate),
        start: { type: "cold" },
        stop: createTargetStop(candidate, target, targetRadius),
      }),
    );
    const typescriptCandidateResults = candidates.map((candidate) =>
      createGraphwarSmartPathfindingTrajectoryResult({
        boundaryExpansion: 0,
        bounds,
        boundsRect,
        formulaMode: createGraphwarTrajectoryFormulaMode(createDescriptor("pchip", "y", candidate).settings),
        hitTarget: { center: createPixelPoint(target.x, target.y), radius: targetRadius },
        obstacleMask: undefined,
        points: candidate.map(({ x, y }) => createPixelPoint(x, y)),
        targetHitRadiusPixels: undefined,
      }),
    );
    const wasmPathErrors = candidateResults.map((result) => result?.pathError);
    const typescriptPathErrors = typescriptCandidateResults.map(({ pathError }) => pathError);
    expect(wasmPathErrors).toEqual(typescriptPathErrors);
    expect(wasmPathErrors.map(classifyPathError)).toEqual(typescriptPathErrors.map(classifyPathError));
    for (const [index, pathError] of wasmPathErrors.entries()) {
      expect(compareGraphwarPathErrors(pathError, typescriptPathErrors[index])).toBe(0);
    }
    expect(wasmPathErrors[0]).toBe(Number.POSITIVE_INFINITY);
    expect(wasmPathErrors.slice(1).every((pathError) => pathError !== undefined && Number.isFinite(pathError))).toBe(
      true,
    );
    expect(candidateResults.map((result) => result?.targetHitIndex !== -1)).toEqual(
      typescriptCandidateResults.map(({ reachesTargetBeforeObstacle }) => reachesTargetBeforeObstacle),
    );
    expect(compareGraphwarPathErrors(wasmPathErrors[2], wasmPathErrors[0])).toBeLessThan(0);

    const result = runGraphwarWasmSmartPathfinding(
      runtime,
      createSmartTrajectoryInput({ isDeleteOptimizationEnabled: true, path, target, targetRadius }),
    );

    expect(result).toMatchObject({ points: [path[0], path[2], path[4]], removedPointCount: 2, status: "success" });
  });

  it("keeps the earliest candidate when every pathError is positive Infinity", async () => {
    const runtime = await createRuntime();
    const path = [
      { x: 100, y: 260 },
      { x: 175, y: 120 },
      { x: 250, y: 330 },
      { x: 325, y: 130 },
      { x: 400, y: 260 },
    ];
    const candidates = [1, 2].map((removedIndex) => path.filter((_, index) => index !== removedIndex));
    const target = path[0];
    const targetRadius = 10_000;
    const collisionMask = undefined;
    const wasmPathErrors = candidates.map(
      (candidate) =>
        runGraphwarWasmTrajectory(runtime, {
          descriptor: createDescriptor("pchip", "y", candidate),
          start: { type: "cold" },
          stop: createTargetStop(candidate, target, targetRadius, collisionMask),
        })?.pathError,
    );
    expect(wasmPathErrors).toEqual([Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
    expect(compareGraphwarPathErrors(wasmPathErrors[0], wasmPathErrors[1])).toBe(0);

    const result = runGraphwarWasmSmartPathfinding(
      runtime,
      createSmartTrajectoryInput({
        collisionMask,
        isDeleteOptimizationEnabled: true,
        path,
        target,
        targetRadius,
      }),
    );

    expect(result).toMatchObject({ points: [path[0], path[4]], removedPointCount: 3, status: "success" });
  });

  it("accepts a target before an obstacle at the same sampled point", async () => {
    const runtime = await createRuntime();
    const path = createFlatPath();
    const sampledPixel = getAcceptedSamplePixel(runtime, path);
    const collisionMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    collisionMask[Math.trunc(sampledPixel.y) * GRAPHWAR_PLANE_LENGTH + Math.trunc(sampledPixel.x)] = 1;

    const result = runGraphwarWasmSmartPathfinding(
      runtime,
      createSmartTrajectoryInput({
        collisionMask,
        isDeleteOptimizationEnabled: false,
        path,
        target: sampledPixel,
        targetRadius: 0.01,
      }),
    );

    expect(result).toMatchObject({ status: "success", validation: { type: "trajectory" } });
  });

  it("matches the TypeScript blocked point at a trajectory obstacle", async () => {
    const path = createFlatPath();
    const sampledPixel = getAcceptedSamplePixel(await createRuntime(), path);
    const collisionMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    collisionMask[Math.trunc(sampledPixel.y) * GRAPHWAR_PLANE_LENGTH + Math.trunc(sampledPixel.x)] = 1;
    const target = path.at(-1);
    if (!target) {
      throw new Error("Test trajectory requires a target point");
    }
    const formulaMode = createGraphwarTrajectoryFormulaMode({
      algorithm: "pchip",
      decimalPlaces: 4,
      equation: "y",
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      steepness: 3.25,
    });
    const typescriptResult = createGraphwarSmartPathfindingTrajectoryResult({
      boundaryExpansion: 0,
      bounds,
      boundsRect,
      formulaMode,
      hitTarget: { center: createPixelPoint(target.x, target.y), radius: 1 },
      obstacleMask: collisionMask,
      points: path.map(({ x, y }) => createPixelPoint(x, y)),
      targetHitRadiusPixels: 1,
    });

    const result = runGraphwarWasmSmartPathfinding(
      await createRuntime(),
      createSmartTrajectoryInput({
        collisionMask,
        isDeleteOptimizationEnabled: false,
        path,
        target,
        targetRadius: 1,
      }),
    );

    expect(typescriptResult.reachesTargetBeforeObstacle).toBe(false);
    expect(typescriptResult.blockedPoint).toBeDefined();
    expect(result).toEqual({
      blockedPoint: typescriptResult.blockedPoint,
      failureReason: "trajectory",
      points: [],
      reachedRequiredTargetCount: 0,
      reachedTargetCount: 0,
      removedPointCount: 0,
      status: "failure",
    });
    if (result.status !== "failure") {
      throw new Error("Expected a trajectory failure");
    }
    expect(result.blockedPoint).toEqual(sampledPixel);
  });

  it("uses a strict positive-radius boundary and never treats zero radius as a trajectory hit", async () => {
    const path = createFlatPath();
    const sampleRuntime = await createRuntime();
    const sampledPixel = getAcceptedSamplePixel(sampleRuntime, path);
    const boundaryRuntime = await createRuntime();
    const boundaryResult = runGraphwarWasmSmartPathfinding(
      boundaryRuntime,
      createSmartTrajectoryInput({
        isDeleteOptimizationEnabled: false,
        path,
        target: { x: sampledPixel.x, y: sampledPixel.y + 1 },
        targetRadius: 1,
      }),
    );
    const zeroRuntime = await createRuntime();
    const zeroResult = runGraphwarWasmSmartPathfinding(
      zeroRuntime,
      createSmartTrajectoryInput({
        isDeleteOptimizationEnabled: false,
        path,
        target: sampledPixel,
        targetRadius: 0,
      }),
    );

    expect(boundaryResult).toEqual({
      failureReason: "trajectory",
      points: [],
      reachedRequiredTargetCount: 0,
      reachedTargetCount: 0,
      removedPointCount: 0,
      status: "failure",
    });
    expect(zeroResult).toEqual(boundaryResult);
  });

  it("refreshes result views after memory grows between the export and Adapter copy", async () => {
    const input = createSmartTrajectoryInput({
      isDeleteOptimizationEnabled: true,
      path: createFlatPath(),
      target: { x: 0, y: 0 },
      targetRadius: 10_000,
    });
    const baseline = runGraphwarWasmSmartPathfinding(await createRuntime(), input);
    const runtime = await createRuntime(2_048);
    const runSmartPathfinding = runtime.runSmartPathfinding.bind(runtime);
    vi.spyOn(runtime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runSmartPathfinding(inputPointer, inputByteLength);
      const previousBuffer = runtime.buffer;
      runtime.reserveArena(previousBuffer.byteLength, 8);
      expect(runtime.buffer).not.toBe(previousBuffer);
      return resultPointer;
    });

    expect(runGraphwarWasmSmartPathfinding(runtime, input)).toEqual(baseline);
  });

  it("reuses the arena after a candidate trajectory grows memory inside the export", { timeout: 30_000 }, async () => {
    const pointCount = 32;
    const path = Array.from({ length: pointCount }, (_, index) => ({
      x: 100 + (240 * index) / (pointCount - 1),
      y: 225 + Math.sin(index / 16) * 20,
    }));
    const input = createSmartTrajectoryInput({
      isDeleteOptimizationEnabled: true,
      path,
      target: { x: 0, y: 0 },
      targetRadius: 10_000,
    });
    const runtime = await createRuntime(2_048);
    const runSmartPathfinding = runtime.runSmartPathfinding.bind(runtime);
    let hasGrownInsideExport = false;
    vi.spyOn(runtime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const previousBuffer = runtime.buffer;
      const resultPointer = runSmartPathfinding(inputPointer, inputByteLength);
      hasGrownInsideExport ||= runtime.buffer !== previousBuffer;
      return resultPointer;
    });

    const first = runGraphwarWasmSmartPathfinding(runtime, input);
    const highWaterByteLength = runtime.buffer.byteLength;
    const second = runGraphwarWasmSmartPathfinding(runtime, input);

    expect(hasGrownInsideExport).toBe(true);
    expect(first).toMatchObject({ status: "success" });
    expect(first.removedPointCount).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(runtime.buffer.byteLength).toBe(highWaterByteLength);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects trajectory success whose graph provenance points back into its input template", async () => {
    const runtime = await createRuntime();
    const runSmartPathfinding = runtime.runSmartPathfinding.bind(runtime);
    vi.spyOn(runtime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runSmartPathfinding(inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      view.setUint32(resultPointer + 32, view.getUint32(inputPointer + 72, true), true);
      return resultPointer;
    });

    expectGraphwarWasmOutputFault(
      () =>
        runGraphwarWasmSmartPathfinding(
          runtime,
          createSmartTrajectoryInput({
            isDeleteOptimizationEnabled: false,
            path: createFlatPath(),
            target: { x: 0, y: 0 },
            targetRadius: 10_000,
          }),
        ),
      "range-out-of-bounds",
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects trajectory success whose point array overlaps its result record", async () => {
    const runtime = await createRuntime();
    const runSmartPathfinding = runtime.runSmartPathfinding.bind(runtime);
    vi.spyOn(runtime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runSmartPathfinding(inputPointer, inputByteLength);
      const view = new DataView(runtime.buffer);
      view.setUint32(resultPointer + 8, resultPointer + 56, true);
      view.setUint32(resultPointer + 12, resultPointer + 64, true);
      return resultPointer;
    });

    expectGraphwarWasmOutputFault(
      () =>
        runGraphwarWasmSmartPathfinding(
          runtime,
          createSmartTrajectoryInput({
            isDeleteOptimizationEnabled: false,
            path: createFlatPath(),
            target: { x: 0, y: 0 },
            targetRadius: 10_000,
          }),
        ),
      "range-out-of-bounds",
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects trajectory success whose validation role or target echo does not match its request", async () => {
    const createInput = () =>
      createSmartTrajectoryInput({
        isDeleteOptimizationEnabled: false,
        path: createFlatPath(),
        target: { x: 0, y: 0 },
        targetRadius: 10_000,
      });
    const roleRuntime = await createRuntime();
    const runWithRoleRuntime = roleRuntime.runSmartPathfinding.bind(roleRuntime);
    vi.spyOn(roleRuntime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runWithRoleRuntime(inputPointer, inputByteLength);
      new DataView(roleRuntime.buffer).setUint32(resultPointer + 48, 1, true);
      return resultPointer;
    });
    expectGraphwarWasmOutputFault(
      () => runGraphwarWasmSmartPathfinding(roleRuntime, createInput()),
      "invalid-session-identity",
    );
    expect(roleRuntime.arenaCursor).toBe(roleRuntime.arenaBase);

    const targetRuntime = await createRuntime();
    const runWithTargetRuntime = targetRuntime.runSmartPathfinding.bind(targetRuntime);
    vi.spyOn(targetRuntime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runWithTargetRuntime(inputPointer, inputByteLength);
      new DataView(targetRuntime.buffer).setFloat64(resultPointer + 56, 1, true);
      return resultPointer;
    });
    expectGraphwarWasmOutputFault(
      () => runGraphwarWasmSmartPathfinding(targetRuntime, createInput()),
      "invalid-session-identity",
    );
    expect(targetRuntime.arenaCursor).toBe(targetRuntime.arenaBase);
  });

  it.each([
    [0, "none"],
    [1, "target"],
    [3, "route-obstacle"],
  ] as const)("rejects trajectory failure reason %s (%s) from another validation role", async (reason, _label) => {
    const runtime = await createRuntime();
    const runSmartPathfinding = runtime.runSmartPathfinding.bind(runtime);
    vi.spyOn(runtime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runSmartPathfinding(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setUint32(resultPointer + 28, reason, true);
      return resultPointer;
    });
    const path = createFlatPath();
    const sampledPixel = getAcceptedSamplePixel(await createRuntime(), path);

    expectGraphwarWasmOutputFault(
      () =>
        runGraphwarWasmSmartPathfinding(
          runtime,
          createSmartTrajectoryInput({
            isDeleteOptimizationEnabled: false,
            path,
            target: sampledPixel,
            targetRadius: 0,
          }),
        ),
      "invalid-session-state",
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects trajectory failure that retains a graph provenance pointer", async () => {
    const runtime = await createRuntime();
    const runSmartPathfinding = runtime.runSmartPathfinding.bind(runtime);
    vi.spyOn(runtime, "runSmartPathfinding").mockImplementation((inputPointer, inputByteLength) => {
      const resultPointer = runSmartPathfinding(inputPointer, inputByteLength);
      new DataView(runtime.buffer).setUint32(resultPointer + 32, resultPointer, true);
      return resultPointer;
    });
    const path = createFlatPath();
    const sampledPixel = getAcceptedSamplePixel(await createRuntime(), path);

    expectGraphwarWasmOutputFault(
      () =>
        runGraphwarWasmSmartPathfinding(
          runtime,
          createSmartTrajectoryInput({
            isDeleteOptimizationEnabled: false,
            path,
            target: sampledPixel,
            targetRadius: 0,
          }),
        ),
      "invalid-session-state",
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });
});

function expectGraphwarWasmOutputFault(operation: () => unknown, code: GraphwarWasmAdapterError["code"]) {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(GraphwarWasmAdapterError);
  expect(thrown).toMatchObject({ code, faultDomain: "output" });
}

function classifyPathError(pathError: number | undefined) {
  if (pathError === undefined) return "omitted";
  if (pathError === Number.POSITIVE_INFINITY) return "positive-infinity";
  return Number.isFinite(pathError) ? "finite" : "invalid";
}

interface SmartTrajectoryInputOptions {
  readonly algorithm?: AlgorithmMode;
  readonly collisionMask?: Uint8Array;
  readonly equation?: EquationMode;
  readonly isDeleteOptimizationEnabled: boolean;
  readonly path: readonly GraphwarWasmPoint[];
  readonly target: GraphwarWasmPoint;
  readonly targetRadius: number;
}

function createSmartTrajectoryInput(options: SmartTrajectoryInputOptions): GraphwarWasmSmartPathfindingInput {
  const algorithm = options.algorithm ?? "pchip";
  const equation = options.equation ?? "y";
  return {
    isDeleteOptimizationEnabled: options.isDeleteOptimizationEnabled,
    points: options.path,
    sourcePointCount: 1,
    target: options.target,
    targetRadius: options.targetRadius,
    trajectoryValidation: {
      descriptor: createDescriptor(algorithm, equation, options.path),
      stop: createTargetStop(options.path, options.target, options.targetRadius, options.collisionMask),
      type: "trajectory",
    },
  };
}

function createDescriptor(
  algorithm: AlgorithmMode,
  equation: EquationMode,
  path: readonly GraphwarWasmPoint[],
): GraphwarWasmFormulaInputDescriptor {
  const points = path.map(pixelToGraphPoint);
  return {
    bounds,
    points,
    settings: {
      algorithm,
      decimalPlaces: 4,
      equation,
      formulaPathSteepness: algorithm === "step" ? 7.5 : undefined,
      isStepGlitchModeEnabled: false,
      isStepOverflowProtectionEnabled: true,
      secondOrderLaunchAngleMode: "full-precision",
      steepness: 3.25,
    },
    soldierCenter: points[0],
  };
}

function createTargetStop(
  path: readonly GraphwarWasmPoint[],
  target: GraphwarWasmPoint,
  targetRadius: number,
  collisionMask?: Uint8Array,
): Extract<GraphwarWasmStopPolicy, { type: "targets" }> {
  const graphPoints = path.map(pixelToGraphPoint);
  return {
    boundsRect,
    collision: collisionMask ? { boundaryExpansion: 0, mask: collisionMask, type: "mask" } : { type: "none" },
    continueAfterTargetsUntilGraphX: { type: "none" },
    orderedTargets: [{ center: target, radius: targetRadius }],
    qualityPoints: graphPoints.slice(1, -1),
    requiredTargets: [],
    shouldCollectVisiblePixels: false,
    shouldStopOnTargetsComplete: true,
    trackedTargets: [],
    type: "targets",
  };
}

function getAcceptedSamplePixel(runtime: GraphwarWasmKernelRuntime, path: readonly GraphwarWasmPoint[]) {
  const descriptor = createDescriptor("pchip", "y", path);
  const stopX = descriptor.points[1]?.x;
  if (stopX === undefined) {
    throw new Error("Test trajectory requires an internal control point");
  }
  const baseline = runGraphwarWasmTrajectory(runtime, {
    descriptor,
    start: { type: "cold" },
    stop: { observationXs: [], stopX, type: "stop-x-observations" },
  });
  const acceptedPoint = baseline?.points.at(-1);
  if (!acceptedPoint) {
    throw new Error("Expected a finite accepted trajectory point");
  }
  return graphToPixelPoint(acceptedPoint);
}

function createFlatPath() {
  return [
    { x: 100, y: 225 },
    { x: 180, y: 225 },
    { x: 260, y: 225 },
    { x: 340, y: 225 },
  ] as const satisfies readonly GraphwarWasmPoint[];
}

function pixelToGraphPoint(point: GraphwarWasmPoint): GraphwarWasmPoint {
  return {
    x: bounds.minX + ((point.x - boundsRect.x) / boundsRect.width) * (bounds.maxX - bounds.minX),
    y: bounds.maxY - ((point.y - boundsRect.y) / boundsRect.height) * (bounds.maxY - bounds.minY),
  };
}

function graphToPixelPoint(point: GraphwarWasmPoint): GraphwarWasmPoint {
  return {
    x: boundsRect.x + ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * boundsRect.width,
    y: boundsRect.y + ((bounds.maxY - point.y) / (bounds.maxY - bounds.minY)) * boundsRect.height,
  };
}

function fillMaskRectangle(
  mask: Uint8Array,
  rectangle: { readonly maxX: number; readonly maxY: number; readonly minX: number; readonly minY: number },
) {
  for (let y = rectangle.minY; y <= rectangle.maxY; y += 1) {
    for (let x = rectangle.minX; x <= rectangle.maxX; x += 1) {
      mask[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
    }
  }
}

async function createRuntime(initialArenaCapacity = 65_536) {
  return instantiateGraphwarWasmRuntime(await kernelModulePromise, { initialArenaCapacity });
}
