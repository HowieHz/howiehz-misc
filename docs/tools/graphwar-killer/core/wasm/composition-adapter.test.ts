import { describe, expect, it, vi } from "vitest";

import {
  assignGraphwarWasmOneClickTargetRoutePoints,
  beginGraphwarWasmOneClickClear,
  internGraphwarWasmOneClickStepStates,
  runGraphwarWasmOneClickTrajectoryValidation,
  runGraphwarWasmSmartPathfinding,
  type GraphwarWasmOneClickEdgeResult,
} from "./composition-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime } from "./runtime";

const kernelModulePromise = readGraphwarKernelBytes().then((bytes) => WebAssembly.compile(bytes));

describe("Graphwar WASM composition adapter", () => {
  it("returns an empty Step state mapping without crossing the raw ABI", async () => {
    const runtime = await createRuntime();
    expect(internGraphwarWasmOneClickStepStates(runtime, [])).toEqual({ nodeCount: 0, nodeIds: [] });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("interns canonical Step state identities without truncating large keys", async () => {
    const runtime = await createRuntime();
    const result = internGraphwarWasmOneClickStepStates(runtime, [
      { resolvedStateKey: "0", resolvedY: 1, targetIndex: 2 },
      { resolvedStateKey: "18446744073709551616", resolvedY: 3, targetIndex: 2 },
      { resolvedStateKey: "0", resolvedY: 1, targetIndex: 2 },
      { resolvedStateKey: "0", resolvedY: 1, targetIndex: 3 },
    ]);

    expect(result).toEqual({ nodeCount: 3, nodeIds: [0, 1, 0, 2] });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it.each(["01", "-0", "+1", "1.0"])("rejects non-canonical Step state key %s", async (resolvedStateKey) => {
    const runtime = await createRuntime();
    expect(() =>
      internGraphwarWasmOneClickStepStates(runtime, [{ resolvedStateKey, resolvedY: 0, targetIndex: 0 }]),
    ).toThrow(/canonical/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("assigns stable source identities and route columns in the versioned WASM ABI", async () => {
    const runtime = await createRuntime();
    const result = assignGraphwarWasmOneClickTargetRoutePoints(runtime, {
      boundaryExpansion: 0,
      boundsRect: { height: 450, width: 770, x: 0, y: 0 },
      candidates: [
        { center: { x: 200, y: 225 }, hitRadius: 2, sourceIndex: 10 },
        { center: { x: 200, y: 300 }, hitRadius: 2, sourceIndex: 20 },
        { center: { x: 300, y: 225 }, hitRadius: 0, sourceIndex: 99 },
      ],
      isMirrored: false,
      pathTail: { x: 0, y: 225 },
      usableRect: { height: 450, width: 770, x: 0, y: 0 },
    });

    expect(result).toEqual([
      { routePoint: { x: 199, y: 300 }, sourceIndex: 20 },
      { routePoint: { x: 200, y: 225 }, sourceIndex: 10 },
    ]);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("matches the TS scale-aware half-column projection in both directions", async () => {
    const runtime = await createRuntime();
    const forward = assignGraphwarWasmOneClickTargetRoutePoints(runtime, {
      boundaryExpansion: 0,
      boundsRect: { height: 450, width: 770, x: 0, y: 0 },
      candidates: [{ center: { x: 1.4999999995, y: 225 }, hitRadius: 0.8, sourceIndex: 1 }],
      isMirrored: false,
      pathTail: { x: 0, y: 225 },
      usableRect: { height: 450, width: 770, x: 0, y: 0 },
    });
    const mirrored = assignGraphwarWasmOneClickTargetRoutePoints(runtime, {
      boundaryExpansion: 0,
      boundsRect: { height: 450, width: 770, x: 0, y: 0 },
      candidates: [{ center: { x: 767.5000000005, y: 225 }, hitRadius: 0.8, sourceIndex: 2 }],
      isMirrored: true,
      pathTail: { x: 769, y: 225 },
      usableRect: { height: 450, width: 770, x: 0, y: 0 },
    });

    expect(forward).toEqual([{ routePoint: { x: 1, y: 225 }, sourceIndex: 1 }]);
    expect(mirrored).toEqual([{ routePoint: { x: 768, y: 225 }, sourceIndex: 2 }]);
  });

  it("validates an ordinary one-click route with ordered multi-target stop state", async () => {
    const runtime = await createRuntime();
    const graphPoints = [
      { x: -20, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    const soldierCenter = graphPoints[0];
    if (!soldierCenter) {
      throw new Error("test fixture must contain a soldier center");
    }
    const result = runGraphwarWasmOneClickTrajectoryValidation(runtime, {
      descriptor: {
        bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
        points: graphPoints,
        settings: {
          algorithm: "abs",
          decimalPlaces: 4,
          equation: "y",
          isStepGlitchModeEnabled: false,
          isStepOverflowProtectionEnabled: true,
          steepness: 67,
        },
        soldierCenter,
      },
      stop: {
        boundsRect: { height: 450, width: 770, x: 0, y: 0 },
        collision: { type: "none" },
        continueAfterTargetsUntilGraphX: { type: "none" },
        orderedTargets: [
          { center: { x: 385, y: 225 }, radius: 30 },
          { center: { x: 693, y: 225 }, radius: 30 },
        ],
        qualityPoints: [],
        requiredTargets: [],
        shouldCollectVisiblePixels: true,
        shouldStopOnTargetsComplete: true,
        trackedTargets: [],
        type: "targets",
      },
    });

    expect(result?.trajectory.reachedTargetCount).toBe(2);
    expect(result?.trajectory.targetHitIndex).toBeGreaterThanOrEqual(0);
    expect(result?.trajectory.visiblePixels.length).toBeGreaterThan(0);
    expect(result?.formula.compiledMaterials.algorithm).toBe("abs");
    expect(result?.formula.observedSignProtection).toEqual(
      result?.trajectory.continuationEvidence.observedSignProtection,
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("round-trips smart path output and performs owned point deletion", async () => {
    const runtime = await createRuntime();

    const result = runGraphwarWasmSmartPathfinding(runtime, {
      isDeleteOptimizationEnabled: true,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      sourcePointCount: 1,
      target: { x: 2, y: 2 },
      targetRadius: 0,
      trajectoryValidation: { type: "route-only" },
    });

    expect(result).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ],
      removedPointCount: 1,
      status: "success",
      validation: {
        target: { center: { x: 2, y: 2 }, radius: 0 },
        type: "route-only",
      },
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("returns a normal smart no-candidate result without trapping", async () => {
    const runtime = await createRuntime();

    expect(
      runGraphwarWasmSmartPathfinding(runtime, {
        isDeleteOptimizationEnabled: false,
        points: [],
        sourcePointCount: 0,
        target: { x: 2, y: 2 },
        targetRadius: 1,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toEqual({ points: [], removedPointCount: 0, status: "failure" });

    expect(
      runGraphwarWasmSmartPathfinding(runtime, {
        isDeleteOptimizationEnabled: false,
        points: [{ x: 0, y: 0 }],
        sourcePointCount: 0,
        target: { x: 2, y: 2 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toEqual({ points: [], removedPointCount: 0, status: "failure" });
  });

  it("keeps route-only positive target radii closed while reserving zero for exact identity", async () => {
    const runtime = await createRuntime();

    expect(
      runGraphwarWasmSmartPathfinding(runtime, {
        isDeleteOptimizationEnabled: false,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        sourcePointCount: 1,
        target: { x: 2, y: 0 },
        targetRadius: 1,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ status: "success" });

    expect(
      runGraphwarWasmSmartPathfinding(runtime, {
        isDeleteOptimizationEnabled: false,
        points: [
          { x: 0, y: 0 },
          { x: 0.99, y: 0 },
        ],
        sourcePointCount: 1,
        target: { x: 2, y: 0 },
        targetRadius: 1,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toEqual({ points: [], removedPointCount: 0, status: "failure" });

    expect(
      runGraphwarWasmSmartPathfinding(runtime, {
        isDeleteOptimizationEnabled: false,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        sourcePointCount: 1,
        target: { x: 1, y: 0 },
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ status: "success" });
  });

  it("does not apply trajectory deletion semantics to a non-collinear route-only path", async () => {
    const runtime = await createRuntime();
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
    ];

    expect(
      runGraphwarWasmSmartPathfinding(runtime, {
        allowTerminalPointDeletion: true,
        isDeleteOptimizationEnabled: true,
        points,
        sourcePointCount: 1,
        target: points[3],
        targetRadius: 0,
        trajectoryValidation: { type: "route-only" },
      }),
    ).toMatchObject({ points, removedPointCount: 0, status: "success" });
  });

  it("deletes a terminal generated point only when trajectory validation opts in", async () => {
    const createInput = (allowTerminalPointDeletion?: boolean) => ({
      ...(allowTerminalPointDeletion === undefined ? {} : { allowTerminalPointDeletion }),
      isDeleteOptimizationEnabled: true,
      points: [
        { x: 77, y: 225 },
        { x: 385, y: 225 },
        { x: 693, y: 300 },
      ],
      sourcePointCount: 1,
      target: { x: 385, y: 225 },
      targetRadius: 30,
      trajectoryValidation: {
        descriptor: {
          bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
          points: [
            { x: -20, y: 0 },
            { x: 0, y: 0 },
            { x: 20, y: -5 },
          ],
          settings: {
            algorithm: "abs" as const,
            decimalPlaces: 4,
            equation: "y" as const,
            isStepGlitchModeEnabled: false,
            isStepOverflowProtectionEnabled: true,
            steepness: 67,
          },
          soldierCenter: { x: -20, y: 0 },
        },
        stop: {
          boundsRect: { height: 450, width: 770, x: 0, y: 0 },
          collision: { type: "none" as const },
          continueAfterTargetsUntilGraphX: { type: "none" as const },
          orderedTargets: [{ center: { x: 385, y: 225 }, radius: 30 }],
          qualityPoints: [{ x: 0, y: 0 }],
          requiredTargets: [],
          shouldCollectVisiblePixels: false,
          shouldStopOnTargetsComplete: true,
          trackedTargets: [],
          type: "targets" as const,
        },
        type: "trajectory" as const,
      },
    });

    const defaultRuntime = await createRuntime();
    const defaultResult = runGraphwarWasmSmartPathfinding(defaultRuntime, createInput());
    expect(defaultResult).toMatchObject({
      points: [
        { x: 77, y: 225 },
        { x: 385, y: 225 },
        { x: 693, y: 300 },
      ],
      removedPointCount: 0,
      status: "success",
    });
    expect(defaultRuntime.arenaCursor).toBe(defaultRuntime.arenaBase);

    const optimizedRuntime = await createRuntime();
    const optimizedResult = runGraphwarWasmSmartPathfinding(optimizedRuntime, createInput(true));
    expect(optimizedResult).toMatchObject({
      points: [
        { x: 77, y: 225 },
        { x: 385, y: 225 },
      ],
      removedPointCount: 1,
      status: "success",
    });
    expect(optimizedRuntime.arenaCursor).toBe(optimizedRuntime.arenaBase);
  });

  it("accepts multi-target smart deletion with required prefix targets", async () => {
    const runtime = await createRuntime();
    const descriptorPoints = [
      { x: -20, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: -5 },
    ];

    const result = runGraphwarWasmSmartPathfinding(runtime, {
      allowTerminalPointDeletion: true,
      isDeleteOptimizationEnabled: true,
      points: [
        { x: 77, y: 225 },
        { x: 385, y: 225 },
        { x: 693, y: 300 },
      ],
      sourcePointCount: 1,
      target: { x: 693, y: 300 },
      targetRadius: 1_000,
      trajectoryValidation: {
        descriptor: {
          bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
          points: descriptorPoints,
          settings: {
            algorithm: "abs",
            decimalPlaces: 4,
            equation: "y",
            isStepGlitchModeEnabled: false,
            isStepOverflowProtectionEnabled: true,
            steepness: 67,
          },
          soldierCenter: { x: -20, y: 0 },
        },
        stop: {
          boundsRect: { height: 450, width: 770, x: 0, y: 0 },
          collision: { type: "none" },
          continueAfterTargetsUntilGraphX: { type: "none" },
          orderedTargets: [{ center: { x: 693, y: 300 }, radius: 1_000 }],
          qualityPoints: [{ x: 0, y: 0 }],
          requiredTargets: [{ center: { x: 385, y: 225 }, radius: 1_000 }],
          shouldCollectVisiblePixels: false,
          shouldStopOnTargetsComplete: true,
          trackedTargets: [],
          type: "targets",
        },
        type: "trajectory",
      },
    });

    expect(result.status).toBe("success");
    expect(result.points[0]).toEqual({ x: 77, y: 225 });
    expect(result.points.at(-1)).toEqual({ x: 693, y: 300 });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("consumes one-click edge results by stable job id, independent of completion order", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    expect(started.targetOrder).toEqual([0, 1]);
    expect(started.edgeJobs.map(({ id, from, to }) => ({ from, id, to }))).toEqual([
      { from: -1, id: 0, to: 0 },
      { from: -1, id: 1, to: 1 },
      { from: 0, id: 2, to: 1 },
    ]);

    const result = started.handle.resume([
      {
        jobId: 2,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 0,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 1,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
    ]);
    expect(result).toEqual({
      path: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      selectedEdgeIds: [0, 2],
      selectedEdgeCount: 2,
      status: "complete",
      targetOrder: [0, 1],
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("does not let callers mutate the retained edge descriptors through the handle", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const exposedJob = started.handle.edgeJobs[0];
    if (exposedJob) exposedJob.targetPoint.x = 999;
    const result = started.handle.resume(createReachableEdgeResults(started.handle.nonce, started.handle.requestNonce));
    expect(result.status).toBe("complete");
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a begin result and retained target order that point back into the input command", async () => {
    const runtime = await createRuntime();
    const begin = runtime.beginOneClickClear.bind(runtime);
    vi.spyOn(runtime, "beginOneClickClear").mockImplementationOnce((commandPointer, byteLength) => {
      const resultPointer = begin(commandPointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      const sessionPointer = result.getUint32(8, true);
      result.setUint32(20, commandPointer, true);
      new DataView(runtime.buffer, sessionPointer, 112).setUint32(84, commandPointer, true);
      return resultPointer;
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow(/outside the current/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a begin waiting session whose source path changed", async () => {
    const runtime = await createRuntime();
    const begin = runtime.beginOneClickClear.bind(runtime);
    vi.spyOn(runtime, "beginOneClickClear").mockImplementationOnce((commandPointer, byteLength) => {
      const resultPointer = begin(commandPointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      if (result.getUint32(4, true) === 1) {
        const sessionPointer = result.getUint32(8, true);
        const session = new DataView(runtime.buffer, sessionPointer, 112);
        const pathXPointer = session.getUint32(32, true);
        new Float64Array(runtime.buffer, pathXPointer, session.getUint32(40, true))[0] += 1;
      }
      return resultPointer;
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow(
      /one-click session source path changed/u,
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects overlapping retained target arrays", async () => {
    const runtime = await createRuntime();
    const begin = runtime.beginOneClickClear.bind(runtime);
    vi.spyOn(runtime, "beginOneClickClear").mockImplementationOnce((commandPointer, byteLength) => {
      const resultPointer = begin(commandPointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      const sessionPointer = result.getUint32(8, true);
      const session = new DataView(runtime.buffer, sessionPointer, 112);
      session.setUint32(20, session.getUint32(16, true), true);
      return resultPointer;
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow(/overlapping ranges/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a resume result that reuses the previous result record", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    let previousResultPointer = 0;
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const resultPointer = resume(pointer, byteLength);
      if (previousResultPointer === 0) previousResultPointer = resultPointer;
      else return previousResultPointer;
      return resultPointer;
    });

    const partial = started.handle.resume([]);
    expect(partial.status).toBe("waiting-edge-batch");
    if (partial.status !== "waiting-edge-batch") return;
    expect(() => partial.handle.resume([])).toThrow(/outside the current/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a resume pending edge batch that reuses an older output range", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    let previousEdgeJobPointer = 0;
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const resultPointer = resume(pointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      if (previousEdgeJobPointer === 0) {
        previousEdgeJobPointer = result.getUint32(12, true);
      } else {
        result.setUint32(12, previousEdgeJobPointer, true);
      }
      return resultPointer;
    });

    const partial = started.handle.resume([]);
    expect(partial.status).toBe("waiting-edge-batch");
    if (partial.status !== "waiting-edge-batch") return;
    expect(() => partial.handle.resume([])).toThrow(/outside the current/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects retained target descriptor content mutation on resume", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    let targetXPointer = 0;
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const resultPointer = resume(pointer, byteLength);
      if (targetXPointer === 0) {
        const result = new DataView(runtime.buffer, resultPointer, 56);
        const sessionPointer = result.getUint32(8, true);
        targetXPointer = new DataView(runtime.buffer, sessionPointer, 112).getUint32(16, true);
      }
      return resultPointer;
    });

    const partial = started.handle.resume([]);
    expect(partial.status).toBe("waiting-edge-batch");
    if (partial.status !== "waiting-edge-batch") return;
    new Float64Array(runtime.buffer, targetXPointer, 2)[0] += 1;
    expect(() => partial.handle.resume([])).toThrow(/retained session content changed/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects retained source path content mutation on resume", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    let pathXPointer = 0;
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const resultPointer = resume(pointer, byteLength);
      if (pathXPointer === 0) {
        const result = new DataView(runtime.buffer, resultPointer, 56);
        const sessionPointer = result.getUint32(8, true);
        pathXPointer = new DataView(runtime.buffer, sessionPointer, 112).getUint32(32, true);
      }
      return resultPointer;
    });

    const partial = started.handle.resume([]);
    expect(partial.status).toBe("waiting-edge-batch");
    if (partial.status !== "waiting-edge-batch") return;
    new Float64Array(runtime.buffer, pathXPointer, 1)[0] += 1;
    expect(() => partial.handle.resume([])).toThrow(/retained session content changed/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("retains completed edges and returns only pending jobs for a partial batch", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const noProgress = started.handle.resume([]);
    expect(noProgress.status).toBe("waiting-edge-batch");
    if (noProgress.status !== "waiting-edge-batch") return;
    expect(noProgress.edgeJobs.map(({ id }) => id)).toEqual([0, 1, 2]);

    const partial = noProgress.handle.resume([
      {
        jobId: 0,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
    ]);
    expect(partial.status).toBe("waiting-edge-batch");
    if (partial.status !== "waiting-edge-batch") return;
    expect(partial.edgeJobs.map(({ id }) => id)).toEqual([1, 2]);

    const complete = partial.handle.resume([
      {
        jobId: 2,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 1,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
    ]);
    expect(complete.status).toBe("complete");
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a completed edge submitted again after a partial batch", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const partial = started.handle.resume([
      {
        jobId: 0,
        requestNonce: started.handle.requestNonce,
        reachable: false,
        sessionNonce: started.handle.nonce,
      },
    ]);
    expect(partial.status).toBe("waiting-edge-batch");
    if (partial.status !== "waiting-edge-batch") return;
    expect(() =>
      partial.handle.resume([
        {
          jobId: 0,
          requestNonce: started.handle.requestNonce,
          reachable: false,
          sessionNonce: started.handle.nonce,
        },
      ]),
    ).toThrow(/not in the session/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("treats an all-unreachable edge batch as a normal failure", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const result = started.handle.resume(
      started.edgeJobs.map((job) => ({
        jobId: job.id,
        requestNonce: started.handle.requestNonce,
        reachable: false,
        sessionNonce: started.handle.nonce,
      })),
    );
    expect(result).toEqual({
      path: [{ x: 0, y: 0 }],
      selectedEdgeIds: [],
      selectedEdgeCount: 0,
      status: "failure",
      targetOrder: [0, 1],
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("supports descending target order for mirrored x+ maps", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [
        { hitCenter: { x: 20, y: 0 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: true },
      ],
      isTargetOrderDescending: true,
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status === "waiting-edge-batch") {
      expect(started.targetOrder).toEqual([0, 1]);
      started.handle.cancel();
    }
  });

  it("matches TS longest-path point-count and vertical-variation tie-breaks", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      verticalVariationScale: 1 / 15,
      candidates: [
        { hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 20, y: 0 }, hitRadius: 1, isEnemy: true },
      ],
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const result = started.handle.resume([
      {
        jobId: 0,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 5, y: 8 },
          { x: 10, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 1,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 2,
        requestNonce: started.handle.requestNonce,
        reachable: false,
        sessionNonce: started.handle.nonce,
      },
    ]);

    expect(result).toEqual({
      path: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      selectedEdgeIds: [1],
      selectedEdgeCount: 1,
      status: "complete",
      targetOrder: [0, 1],
    });
  });

  it("keeps normal target ordering stable for equal x columns", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [
        { hitCenter: { x: 10, y: 2 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 10, y: 8 }, hitRadius: 1, isEnemy: true },
      ],
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    expect(started.targetOrder).toEqual([1, 0]);
    started.handle.cancel();
  });

  it("keeps equal-x ordering stable on mirrored maps", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [
        { hitCenter: { x: 10, y: 2 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 10, y: 8 }, hitRadius: 1, isEnemy: true },
      ],
      isTargetOrderDescending: true,
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status === "waiting-edge-batch") {
      expect(started.targetOrder).toEqual([1, 0]);
      started.handle.cancel();
    }
  });

  it("uses quantized forward columns instead of raw image x for target identity", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [
        { hitCenter: { x: 1.1, y: 2 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 1.4, y: 8 }, hitRadius: 1, isEnemy: true },
      ],
      targetOrderKeys: [0, 0],
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status === "waiting-edge-batch") {
      expect(started.targetOrder).toEqual([1, 0]);
      started.handle.cancel();
    }
  });

  it("accepts friendly-fire candidates as valid one-click targets", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [{ hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: false }],
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status === "waiting-edge-batch") {
      expect(started.targetOrder).toEqual([0]);
      started.handle.cancel();
    }
  });

  it("preserves explicit DAG node identities for duplicate target pairs", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      dagJobs: [
        {
          from: -1,
          fromNodeId: 0xffff_ffff,
          id: 0,
          startPoint: { x: 0, y: 0 },
          targetPoint: { x: 10, y: 0 },
          to: 0,
          toNodeId: 2,
        },
        {
          from: -1,
          fromNodeId: 0xffff_ffff,
          id: 1,
          startPoint: { x: 0, y: 0 },
          targetPoint: { x: 10, y: 0 },
          to: 0,
          toNodeId: 3,
        },
        {
          from: 0,
          fromNodeId: 2,
          id: 2,
          startPoint: { x: 10, y: 0 },
          targetPoint: { x: 20, y: 0 },
          to: 1,
          toNodeId: 4,
        },
        {
          from: 0,
          fromNodeId: 3,
          id: 3,
          startPoint: { x: 10, y: 0 },
          targetPoint: { x: 20, y: 0 },
          to: 1,
          toNodeId: 5,
        },
      ],
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;
    expect(started.handle.dagNodeCount).toBe(6);
    expect(started.edgeJobs.map(({ fromNodeId, id, toNodeId }) => ({ fromNodeId, id, toNodeId }))).toEqual([
      { fromNodeId: 0xffff_ffff, id: 0, toNodeId: 2 },
      { fromNodeId: 0xffff_ffff, id: 1, toNodeId: 3 },
      { fromNodeId: 2, id: 2, toNodeId: 4 },
      { fromNodeId: 3, id: 3, toNodeId: 5 },
    ]);

    const result = started.handle.resume(
      started.edgeJobs.map((job) => ({
        jobId: job.id,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [job.startPoint, job.targetPoint],
        sessionNonce: started.handle.nonce,
      })),
    );
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.path).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      expect(result.selectedEdgeIds).toEqual([0, 2]);
      expect(result.selectedEdgeCount).toBe(2);
    }
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("derives sparse explicit DAG node storage for a retained retry descriptor", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      dagJobs: [
        {
          from: -1,
          fromNodeId: 0xffff_ffff,
          id: 0,
          startPoint: { x: 0, y: 0 },
          targetPoint: { x: 10, y: 0 },
          to: 0,
          toNodeId: 2,
        },
      ],
      isStepStateful: true,
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status === "waiting-edge-batch") {
      expect(started.handle.dagNodeCount).toBe(3);
      started.handle.cancel();
    }
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects explicit DAG endpoints that do not match retained target descriptors", async () => {
    const runtime = await createRuntime();
    expect(() =>
      beginGraphwarWasmOneClickClear(runtime, {
        ...createOneClickInput(),
        dagJobs: [
          {
            from: -1,
            fromNodeId: 0xffff_ffff,
            id: 0,
            startPoint: { x: 0, y: 0 },
            targetPoint: { x: 999, y: 999 },
            to: 0,
            toNodeId: 1,
          },
        ],
        dagNodeCount: 2,
      }),
    ).toThrow(/endpoints do not match its target descriptors/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("resolves an explicit DAG whose child job precedes its parent", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      dagJobs: [
        {
          from: 0,
          fromNodeId: 2,
          id: 0,
          startPoint: { x: 10, y: 0 },
          targetPoint: { x: 20, y: 0 },
          to: 1,
          toNodeId: 4,
        },
        {
          from: -1,
          fromNodeId: 0xffff_ffff,
          id: 1,
          startPoint: { x: 0, y: 0 },
          targetPoint: { x: 10, y: 0 },
          to: 0,
          toNodeId: 2,
        },
        {
          from: -1,
          fromNodeId: 0xffff_ffff,
          id: 2,
          startPoint: { x: 0, y: 0 },
          targetPoint: { x: 20, y: 0 },
          to: 1,
          toNodeId: 3,
        },
      ],
      dagNodeCount: 5,
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;
    const result = started.handle.resume(
      started.edgeJobs.map((job) => ({
        jobId: job.id,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [job.startPoint, job.targetPoint],
        sessionNonce: started.handle.nonce,
      })),
    );
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.path).toEqual([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      expect(result.selectedEdgeIds).toEqual([1, 0]);
      expect(result.selectedEdgeCount).toBe(2);
    }
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects unknown or duplicate explicit DAG node identities at the adapter boundary", async () => {
    const runtime = await createRuntime();
    const createJob = (toNodeId: number) => ({
      from: -1,
      fromNodeId: 0xffff_ffff,
      id: 0,
      startPoint: { x: 0, y: 0 },
      targetPoint: { x: 10, y: 0 },
      to: 0,
      toNodeId,
    });
    expect(() =>
      beginGraphwarWasmOneClickClear(runtime, {
        ...createOneClickInput(),
        dagJobs: [createJob(2)],
        dagNodeCount: 2,
      }),
    ).toThrow(/unknown DAG node/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);

    const duplicateRuntime = await createRuntime();
    expect(() =>
      beginGraphwarWasmOneClickClear(duplicateRuntime, {
        ...createOneClickInput(),
        dagJobs: [createJob(1), { ...createJob(1), id: 1 }],
        dagNodeCount: 2,
      }),
    ).toThrow(/duplicates a DAG node identity/u);
    expect(duplicateRuntime.arenaCursor).toBe(duplicateRuntime.arenaBase);

    const selfLoopRuntime = await createRuntime();
    expect(() =>
      beginGraphwarWasmOneClickClear(selfLoopRuntime, {
        ...createOneClickInput(),
        dagJobs: [{ ...createJob(1), from: 0, fromNodeId: 1, to: 1 }],
        dagNodeCount: 2,
      }),
    ).toThrow(/invalid source identity/u);
    expect(selfLoopRuntime.arenaCursor).toBe(selfLoopRuntime.arenaBase);

    const emptyRuntime = await createRuntime();
    expect(() =>
      beginGraphwarWasmOneClickClear(emptyRuntime, {
        ...createOneClickInput(),
        dagJobs: [],
        dagNodeCount: 1,
      }),
    ).toThrow(/dagNodeCount must be zero/u);
    expect(emptyRuntime.arenaCursor).toBe(emptyRuntime.arenaBase);

    const targetBindingRuntime = await createRuntime();
    expect(() =>
      beginGraphwarWasmOneClickClear(targetBindingRuntime, {
        ...createOneClickInput(),
        isStepStateful: true,
        candidates: [
          { hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: true },
          { hitCenter: { x: 20, y: 0 }, hitRadius: 1, isEnemy: true },
          { hitCenter: { x: 30, y: 0 }, hitRadius: 1, isEnemy: true },
        ],
        dagJobs: [
          {
            from: -1,
            fromNodeId: 0xffff_ffff,
            id: 0,
            startPoint: { x: 0, y: 0 },
            targetPoint: { x: 10, y: 0 },
            to: 0,
            toNodeId: 1,
          },
          {
            from: 1,
            fromNodeId: 1,
            id: 1,
            startPoint: { x: 20, y: 0 },
            targetPoint: { x: 30, y: 0 },
            to: 2,
            toNodeId: 2,
          },
        ],
        dagNodeCount: 3,
      }),
    ).toThrow(/reuses DAG node 1/u);
    expect(targetBindingRuntime.arenaCursor).toBe(targetBindingRuntime.arenaBase);

    const cycleRuntime = await createRuntime();
    expect(() =>
      beginGraphwarWasmOneClickClear(cycleRuntime, {
        ...createOneClickInput(),
        candidates: [
          { hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: true },
          { hitCenter: { x: 20, y: 0 }, hitRadius: 1, isEnemy: true },
          { hitCenter: { x: 30, y: 0 }, hitRadius: 1, isEnemy: true },
        ],
        dagJobs: [
          {
            from: -1,
            fromNodeId: 0xffff_ffff,
            id: 0,
            startPoint: { x: 0, y: 0 },
            targetPoint: { x: 10, y: 0 },
            to: 0,
            toNodeId: 2,
          },
          {
            from: 0,
            fromNodeId: 2,
            id: 1,
            startPoint: { x: 10, y: 0 },
            targetPoint: { x: 20, y: 0 },
            to: 1,
            toNodeId: 3,
          },
          {
            from: 1,
            fromNodeId: 3,
            id: 2,
            startPoint: { x: 20, y: 0 },
            targetPoint: { x: 30, y: 0 },
            to: 2,
            toNodeId: 2,
          },
        ],
        dagNodeCount: 4,
      }),
    ).toThrow(/reuses DAG node 2/u);
    expect(cycleRuntime.arenaCursor).toBe(cycleRuntime.arenaBase);
  });

  it("rejects duplicate edge ids and invalidates the retained session", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const duplicateResults: GraphwarWasmOneClickEdgeResult[] = [
      { jobId: 0, requestNonce: started.handle.requestNonce, reachable: false, sessionNonce: started.handle.nonce },
      { jobId: 0, requestNonce: started.handle.requestNonce, reachable: false, sessionNonce: started.handle.nonce },
      { jobId: 1, requestNonce: started.handle.requestNonce, reachable: false, sessionNonce: started.handle.nonce },
    ];
    expect(() => started.handle.resume(duplicateResults)).toThrow(/duplicated/u);
    expect(() => started.handle.resume(duplicateResults)).toThrow(/no longer active/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects an edge result from another task identity before touching the kernel", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    expect(() =>
      started.handle.resume(createReachableEdgeResults(started.handle.nonce, started.handle.requestNonce + 1)),
    ).toThrow(/belongs to another one-click session/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a reachable route whose endpoints belong to another edge", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    expect(() =>
      started.handle.resume([
        {
          jobId: 0,
          requestNonce: started.handle.requestNonce,
          reachable: true,
          route: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
          ],
          sessionNonce: started.handle.nonce,
        },
        {
          jobId: 1,
          requestNonce: started.handle.requestNonce,
          reachable: false,
          sessionNonce: started.handle.nonce,
        },
        {
          jobId: 2,
          requestNonce: started.handle.requestNonce,
          reachable: false,
          sessionNonce: started.handle.nonce,
        },
      ]),
    ).toThrow(/endpoints do not match/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a terminal selected-edge chain that was mutated in linear memory", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const resultPointer = resume(pointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      if (result.getUint32(4, true) === 0 && result.getUint32(40, true) === 2) {
        const selectedEdgeIdsPointer = result.getUint32(52, true);
        new Uint32Array(runtime.buffer, selectedEdgeIdsPointer, 2)[1] = 0;
      }
      return resultPointer;
    });

    expect(() =>
      started.handle.resume(createReachableEdgeResults(started.handle.nonce, started.handle.requestNonce)),
    ).toThrow(/duplicated/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a terminal path whose final endpoint was mutated in linear memory", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const resultPointer = resume(pointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      if (result.getUint32(4, true) === 0) {
        const pathYPointer = result.getUint32(32, true);
        const pathCount = result.getUint32(36, true);
        new Float64Array(runtime.buffer, pathYPointer, pathCount)[pathCount - 1] += 1;
      }
      return resultPointer;
    });

    expect(() =>
      started.handle.resume(createReachableEdgeResults(started.handle.nonce, started.handle.requestNonce)),
    ).toThrow(/terminal path does not match/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects terminal point arrays that overlap each other", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const resultPointer = resume(pointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      if (result.getUint32(4, true) === 0) result.setUint32(32, result.getUint32(28, true), true);
      return resultPointer;
    });

    expect(() =>
      started.handle.resume(createReachableEdgeResults(started.handle.nonce, started.handle.requestNonce)),
    ).toThrow(/terminal output contains overlapping ranges/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects selected edge ids that alias the retained target order", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const sessionPointer = new DataView(runtime.buffer, pointer, 16).getUint32(0, true);
      const resultPointer = resume(pointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      if (result.getUint32(4, true) === 0) {
        const targetOrderPointer = runtime.reserveArena(8, 4);
        new Uint32Array(runtime.buffer, targetOrderPointer, 2).set([0, 1]);
        result.setUint32(20, targetOrderPointer, true);
        const retainedTargetOrderPointer = new DataView(runtime.buffer, sessionPointer, 112).getUint32(84, true);
        result.setUint32(52, retainedTargetOrderPointer, true);
      }
      return resultPointer;
    });

    expect(() =>
      started.handle.resume(createReachableEdgeResults(started.handle.nonce, started.handle.requestNonce)),
    ).toThrow(/terminal selected edge ids overlaps a live one-click range/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a completed route whose x/y pointer identity was replaced on resume", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [
        { hitCenter: { x: 10, y: 10 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 20, y: 20 }, hitRadius: 1, isEnemy: true },
      ],
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const resume = runtime.resumeOneClickClear.bind(runtime);
    let sessionPointer = 0;
    vi.spyOn(runtime, "resumeOneClickClear").mockImplementation((pointer, byteLength) => {
      const resultPointer = resume(pointer, byteLength);
      if (sessionPointer === 0) sessionPointer = new DataView(runtime.buffer, resultPointer, 56).getUint32(8, true);
      return resultPointer;
    });
    const partial = started.handle.resume([
      {
        jobId: 0,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        sessionNonce: started.handle.nonce,
      },
    ]);
    expect(partial.status).toBe("waiting-edge-batch");
    if (partial.status !== "waiting-edge-batch") return;
    const retained = partial.handle.resume([]);
    expect(retained.status).toBe("waiting-edge-batch");
    if (retained.status !== "waiting-edge-batch") return;
    const session = new DataView(runtime.buffer, sessionPointer, 112);
    const routeXByJobPointer = session.getUint32(72, true);
    const routeYByJobPointer = session.getUint32(80, true);
    const routeYPointer = new Uint32Array(runtime.buffer, routeYByJobPointer, 3)[0];
    new Uint32Array(runtime.buffer, routeXByJobPointer, 3)[0] = routeYPointer;

    expect(() => retained.handle.resume([])).toThrow(/route pointers changed while resuming/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("keeps a paused partial session valid across linear-memory growth and supports cancellation", async () => {
    const runtime = await createRuntime(2_048);
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const partial = started.handle.resume([
      {
        jobId: 0,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
    ]);
    expect(partial.status).toBe("waiting-edge-batch");
    if (partial.status !== "waiting-edge-batch") return;
    runtime.reserveArena(runtime.buffer.byteLength * 2, 8);
    const result = partial.handle.resume([
      {
        jobId: 2,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 1,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
    ]);
    expect(result.status).toBe("complete");

    const secondRuntime = await createRuntime();
    const secondStarted = beginGraphwarWasmOneClickClear(secondRuntime, createOneClickInput());
    expect(secondStarted.status).toBe("waiting-edge-batch");
    if (secondStarted.status !== "waiting-edge-batch") return;
    secondStarted.handle.cancel();
    expect(() =>
      secondStarted.handle.resume(
        createReachableEdgeResults(secondStarted.handle.nonce, secondStarted.handle.requestNonce),
      ),
    ).toThrow(/no longer active/u);
    expect(secondRuntime.arenaCursor).toBe(secondRuntime.arenaBase);
    const restarted = beginGraphwarWasmOneClickClear(secondRuntime, createOneClickInput());
    expect(restarted.status).toBe("waiting-edge-batch");
    if (restarted.status === "waiting-edge-batch") restarted.handle.cancel();
  });

  it("does not cancel an existing session when a later begin command fails", async () => {
    const runtime = await createRuntime();
    const first = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(first.status).toBe("waiting-edge-batch");
    if (first.status !== "waiting-edge-batch") return;

    expect(() =>
      beginGraphwarWasmOneClickClear(runtime, {
        ...createOneClickInput(),
        requestNonce: 43,
      }),
    ).toThrow();

    const result = first.handle.resume(createReachableEdgeResults(first.handle.nonce, first.handle.requestNonce));
    expect(result.status).toBe("complete");
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("retries after a begin trap without retaining a half-published session", async () => {
    const runtime = await createRuntime();
    const begin = vi.spyOn(runtime, "beginOneClickClear").mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError("synthetic allocation trap");
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow(/allocation trap/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);

    begin.mockRestore();
    const retried = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(retried.status).toBe("waiting-edge-batch");
    if (retried.status === "waiting-edge-batch") retried.handle.cancel();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("cancels a session published before a begin-boundary fault and permits restart", async () => {
    const runtime = await createRuntime();
    const begin = runtime.beginOneClickClear.bind(runtime);
    const cancel = vi.spyOn(runtime, "cancelOneClickClear");
    const beginSpy = vi.spyOn(runtime, "beginOneClickClear").mockImplementationOnce((pointer, byteLength) => {
      begin(pointer, byteLength);
      throw new Error("post-begin fault");
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow("post-begin fault");
    expect(cancel).toHaveBeenCalledOnce();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);

    beginSpy.mockRestore();
    const restarted = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(restarted.status).toBe("waiting-edge-batch");
    if (restarted.status === "waiting-edge-batch") {
      restarted.handle.cancel();
    }
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("reports an empty candidate set as a normal failure", async () => {
    const runtime = await createRuntime();
    const result = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [],
    });

    expect(result).toEqual({
      path: [{ x: 0, y: 0 }],
      selectedEdgeIds: [],
      selectedEdgeCount: 0,
      status: "failure",
      targetOrder: [],
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects an initial failure whose path differs from the owned input snapshot", async () => {
    const runtime = await createRuntime();
    const begin = runtime.beginOneClickClear.bind(runtime);
    vi.spyOn(runtime, "beginOneClickClear").mockImplementationOnce((commandPointer, byteLength) => {
      const resultPointer = begin(commandPointer, byteLength);
      const result = new DataView(runtime.buffer, resultPointer, 56);
      const pathXPointer = result.getUint32(28, true);
      new Float64Array(runtime.buffer, pathXPointer, 1)[0] = 999;
      return resultPointer;
    });

    expect(() =>
      beginGraphwarWasmOneClickClear(runtime, {
        ...createOneClickInput(),
        candidates: [],
      }),
    ).toThrow(/changed its retained source path/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a complete result whose selected edge count exceeds its target count", async () => {
    const runtime = await createRuntime();
    vi.spyOn(runtime, "beginOneClickClear").mockImplementation(() => {
      const pointer = runtime.reserveArena(56, 8);
      const view = new DataView(runtime.buffer, pointer, 56);
      view.setUint32(0, 0x4f43_5253, true);
      view.setUint32(4, 0, true);
      view.setUint32(8, 0, true);
      view.setUint32(12, 0, true);
      view.setUint32(16, 0, true);
      view.setUint32(20, 0, true);
      view.setUint32(24, 0, true);
      view.setUint32(28, 0, true);
      view.setUint32(32, 0, true);
      view.setUint32(36, 0, true);
      view.setUint32(40, 1, true);
      view.setUint32(44, 1, true);
      view.setUint32(48, 42, true);
      return pointer;
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow(
      /selected edge count exceeds target count/u,
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });
});

function createOneClickInput() {
  return {
    candidates: [
      { hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: true },
      { hitCenter: { x: 20, y: 0 }, hitRadius: 1, isEnemy: true },
    ],
    isDeleteOptimizationEnabled: true,
    isStepStateful: false,
    path: [{ x: 0, y: 0 }],
    requestNonce: 42,
  } as const;
}

function createReachableEdgeResults(sessionNonce: number, requestNonce: number): GraphwarWasmOneClickEdgeResult[] {
  return [
    {
      jobId: 0,
      requestNonce,
      reachable: true,
      route: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      sessionNonce,
    },
    {
      jobId: 1,
      requestNonce,
      reachable: true,
      route: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      sessionNonce,
    },
    {
      jobId: 2,
      requestNonce,
      reachable: true,
      route: [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      sessionNonce,
    },
  ];
}

async function createRuntime(initialArenaCapacity = 65_536) {
  return instantiateGraphwarWasmRuntime(await kernelModulePromise, { initialArenaCapacity });
}
