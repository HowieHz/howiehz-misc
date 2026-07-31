import { beforeAll, describe, expect, it, vi } from "vitest";

import { createGraphwarTrajectoryDebugMetrics } from "../../formula/debug-metrics";
import {
  createGraphwarTrajectoryFormulaMode,
  resolveGraphwarTrajectory,
  tryResolveGraphwarTrajectoryCandidate,
  type GraphwarStepGlitchXWindow,
  type GraphwarTrajectoryFormulaSettings,
  type GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import {
  createGraphwarStepGlitchPrefixEvidence,
  findGraphwarStepGlitchAcceptedPointAtOrAfterControlX,
} from "../../pathfinding/routing/step-glitch-scan";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import { graphToImagePoint, imageToGraphPoint } from "../geometry";
import { createGraphPoint, createPixelPoint } from "../types";
import type { BoundsRect, EquationMode, GraphBounds } from "../types";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime } from "./runtime";
import {
  createGraphwarWasmStepGlitchContextInput,
  createGraphwarWasmStepGlitchGeometryTestContext,
  type GraphwarWasmStepGlitchGeometryReplayOutcome,
  type GraphwarWasmStepGlitchRealReplayTestOutput,
} from "./step-glitch-adapter";
import { createGraphwarWasmTrajectoryPhysicalStateFromSamplingState } from "./trajectory-state-adapter";

const bounds: GraphBounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect: BoundsRect = {
  height: GRAPHWAR_PLANE_HEIGHT,
  width: GRAPHWAR_PLANE_LENGTH,
  x: 0,
  y: 0,
};
const graphPath = [
  createGraphPoint(-24, 12),
  createGraphPoint(-22.857142857142858, 13.571428571428571),
  createGraphPoint(-22.84714285714286, 1.7532467532467528),
];
const planeCellCount = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("Graphwar WASM Step-glitch real candidate replay", () => {
  it("drives a direct Step-glitch DFS candidate through one real WASM replay", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const trace = context.traceRealDfsForTest({
      hitTarget: { center: fixture.pixelPath[2], radius: 2 },
      targetPoint: fixture.pixelPath[2],
    });

    expect(trace.status).toBe("hit");
    expect(trace.expandedStates).toBe(1);
    expect(trace.candidates).toHaveLength(1);
    expect(trace.candidates[0]).toMatchObject({
      kind: "direct",
      replay: { launchStatus: "success", status: "hit" },
      windows: { type: "automatic" },
    });
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });

  it("keeps a duplicated required target out of the compact ordered-target state", async () => {
    const fixture = createFixture("dy");
    const requiredTarget = { center: fixture.pixelPath[2], radius: 2 } satisfies GraphwarTrajectoryTargetCircle;
    const requiredFixture = { ...fixture, requiredTargets: [requiredTarget] };
    const { context } = await createContext(requiredFixture);

    const trace = context.traceRealDfsForTest({ hitTarget: requiredTarget, targetPoint: fixture.pixelPath[2] });

    expect(trace.status).toBe("hit");
    expect(trace.candidates[0]?.replay).toMatchObject({
      reachedRequiredTargetCount: 1,
      reachedTargetCount: 0,
      status: "hit",
      targetHitIndex: -1,
    });
    if (trace.candidates[0]?.replay.launchStatus !== "success") {
      throw new Error("expected a launched required-target replay");
    }
    expect(trace.candidates[0].replay.requiredTargetsHitIndex).toBeGreaterThanOrEqual(0);
    context.dispose();
  });

  it("drives a mirrored boundary candidate through the same compact replay", async () => {
    const mirroredBounds = { ...bounds, maxX: bounds.minX, minX: bounds.maxX };
    const fixture = createFixture("ddy", new Uint8Array(planeCellCount), mirroredBounds);
    const { context } = await createContext(fixture);

    const trace = context.traceRealDfsForTest({
      hitTarget: { center: fixture.pixelPath[2], radius: 2 },
      targetPoint: fixture.pixelPath[2],
    });

    expect(context.isMirrored).toBe(true);
    expect(trace).toMatchObject({
      candidates: [{ kind: "direct", replay: { launchStatus: "success", status: "hit" } }],
      status: "hit",
    });
    context.dispose();
  });

  it("keeps lazy prefix replay and normal no-path as one owned trace", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const trace = context.traceRealDfsForTest({
      hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
      targetPoint: fixture.pixelPath[2],
    });

    expect(trace.status).toBe("no-path");
    expect(trace.candidates[0]?.kind).toBe("direct");
    expect(trace.candidates[1]?.kind).toBe("prefix");
    expect(trace.candidates[1]?.replay.status).toBe("hit");
    expect(trace.prefixPreparation).toBe("cold");
    expect(runtime.arenaCursor).toBe(retainedCursor);
    context.dispose();
  });

  it.each(["dy", "ddy"] satisfies readonly Extract<EquationMode, "ddy" | "dy">[])(
    "reuses only exact %s formula-prefix evidence while appended candidates stay cold",
    async (equation) => {
      const fixture = createFixture(equation);
      const { evidence, prefixTarget } = createCompatiblePrefixEvidence(fixture);
      const { context, runtime } = await createContext(fixture, { prefixEvidence: evidence, prefixTarget });
      const retainedCursor = runtime.arenaCursor;

      const trace = context.traceRealDfsForTest({
        hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
        targetPoint: fixture.pixelPath[2],
      });

      expect(trace.prefixPreparation).toBe("evidence");
      expect(trace.candidates.some((candidate) => candidate.kind === "prefix")).toBe(false);
      expect(trace.candidates.every((candidate) => candidate.replay.replayCount >= 1)).toBe(true);
      expect(runtime.arenaCursor).toBe(retainedCursor);
      expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
      context.dispose();
    },
  );

  it.each(["dy", "ddy"] satisfies readonly Extract<EquationMode, "ddy" | "dy">[])(
    "reuses evidence when the old prefix target transfers into required targets for %s",
    async (equation) => {
      const fixture = createFixture(equation);
      const { evidence, prefixTarget } = createCompatiblePrefixEvidence(fixture);
      const transitionedFixture = { ...fixture, requiredTargets: [prefixTarget] };
      const { context } = await createContext(transitionedFixture, { prefixEvidence: evidence });

      const trace = context.traceRealDfsForTest({
        hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
        targetPoint: fixture.pixelPath[2],
      });

      expect(trace.prefixPreparation).toBe("evidence");
      expect(trace.candidates.some((candidate) => candidate.kind === "prefix")).toBe(false);
      context.dispose();
    },
  );

  it("cold-prepares when retained required-target identity does not transfer", async () => {
    const fixture = createFixture("dy");
    const { evidence, prefixTarget } = createCompatiblePrefixEvidence(fixture);
    const wrongTarget = {
      center: createPixelPoint(prefixTarget.center.x + 1, prefixTarget.center.y),
      radius: prefixTarget.radius,
    };
    const { context } = await createContext(
      { ...fixture, requiredTargets: [wrongTarget] },
      { prefixEvidence: evidence },
    );

    const trace = context.traceRealDfsForTest({
      hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
      targetPoint: fixture.pixelPath[2],
    });

    expect(trace.prefixPreparation).toBe("cold");
    expect(trace.candidates.some((candidate) => candidate.kind === "prefix")).toBe(true);
    context.dispose();
  });

  it("cold-prepares the prefix when a valid evidence identity mismatches", async () => {
    const fixture = createFixture("dy");
    const { evidence, prefixTarget } = createCompatiblePrefixEvidence(fixture);
    const { context } = await createContext(fixture, {
      prefixEvidence: evidence,
      prefixTarget,
      simulationBoundaryExpansion: 1,
    });

    const trace = context.traceRealDfsForTest({
      hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
      targetPoint: fixture.pixelPath[2],
    });

    expect(trace.prefixPreparation).toBe("cold");
    expect(trace.candidates.some((candidate) => candidate.kind === "prefix")).toBe(true);
    context.dispose();
  });

  it.each(["dy", "ddy"] satisfies readonly Extract<EquationMode, "ddy" | "dy">[])(
    "cold-prepares when retained %s formula materials are modified",
    async (equation) => {
      const fixture = createFixture(equation);
      const { evidence, prefixTarget } = createCompatiblePrefixEvidence(fixture);
      const prefix = evidence.formulaEvidence.prefix;
      const modifiedPrefix = {
        ...prefix,
        refinedFormulaPoints: prefix.refinedFormulaPoints.map((point, index) =>
          index === prefix.refinedFormulaPoints.length - 1 ? createGraphPoint(point.x, point.y + 0.25) : point,
        ),
      };
      const modifiedEvidence = {
        ...evidence,
        formulaEvidence: {
          ...evidence.formulaEvidence,
          prefix: modifiedPrefix,
          ...(evidence.formulaEvidence.boundaryState
            ? { boundaryState: { ...evidence.formulaEvidence.boundaryState, prefix: modifiedPrefix } }
            : {}),
        },
      };
      const { context } = await createContext(fixture, { prefixEvidence: modifiedEvidence, prefixTarget });

      const trace = context.traceRealDfsForTest({
        hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
        targetPoint: fixture.pixelPath[2],
      });

      expect(trace.prefixPreparation).toBe("cold");
      expect(trace.candidates.some((candidate) => candidate.kind === "prefix")).toBe(true);
      context.dispose();
    },
  );

  it("cold-prepares when retained protection is modified", async () => {
    const fixture = createFixture("dy");
    const { evidence, prefixTarget } = createCompatiblePrefixEvidence(fixture);
    const prefix = evidence.formulaEvidence.prefix;
    const modifiedPrefix = {
      ...prefix,
      signProtection: Array.from(
        { length: prefix.points.length - 1 },
        (_value, index) => (prefix.signProtection[index] ?? 0) ^ 1,
      ),
    };
    const modifiedEvidence = {
      ...evidence,
      formulaEvidence: {
        ...evidence.formulaEvidence,
        prefix: modifiedPrefix,
        ...(evidence.formulaEvidence.boundaryState
          ? { boundaryState: { ...evidence.formulaEvidence.boundaryState, prefix: modifiedPrefix } }
          : {}),
      },
    };
    const { context } = await createContext(fixture, { prefixEvidence: modifiedEvidence, prefixTarget });

    const trace = context.traceRealDfsForTest({
      hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
      targetPoint: fixture.pixelPath[2],
    });

    expect(trace.prefixPreparation).toBe("cold");
    context.dispose();
  });

  it.each([
    {
      mutate(evidence: ReturnType<typeof createCompatiblePrefixEvidence>["evidence"]) {
        evidence.acceptedPoint.x += 1;
        return evidence.replayIdentity.prefixTarget;
      },
      name: "accepted point",
    },
    {
      mutate(evidence: ReturnType<typeof createCompatiblePrefixEvidence>["evidence"]) {
        evidence.replayIdentity.prefixTarget.center.x += 1;
        return evidence.replayIdentity.prefixTarget;
      },
      name: "replay target",
    },
    {
      mutate(evidence: ReturnType<typeof createCompatiblePrefixEvidence>["evidence"]) {
        evidence.replayIdentity.boundaryExpansion = -0;
        return evidence.replayIdentity.prefixTarget;
      },
      name: "signed-zero boundary identity",
    },
  ])("cold-prepares after a structured-clone $name mutation", async ({ mutate }) => {
    const fixture = createFixture("dy");
    const compatible = createCompatiblePrefixEvidence(fixture);
    const evidence = structuredClone(compatible.evidence);
    const prefixTarget = mutate(evidence);
    const { context } = await createContext(fixture, { prefixEvidence: evidence, prefixTarget });

    const trace = context.traceRealDfsForTest({
      hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
      targetPoint: fixture.pixelPath[2],
    });

    expect(trace.prefixPreparation).toBe("cold");
    expect(trace.candidates.some((candidate) => candidate.kind === "prefix")).toBe(true);
    context.dispose();
  });

  it("cold-prepares when structured-clone evidence and context masks are retargeted together", async () => {
    const fixture = createFixture("dy");
    const compatible = createCompatiblePrefixEvidence(fixture);
    const evidence = structuredClone(compatible.evidence);
    fixture.mask[0] = 1;
    evidence.replayIdentity.simulationMask[0] = 1;
    const { context } = await createContext(fixture, {
      prefixEvidence: evidence,
      prefixTarget: compatible.prefixTarget,
    });

    const trace = context.traceRealDfsForTest({
      hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
      targetPoint: fixture.pixelPath[2],
    });

    expect(trace.prefixPreparation).toBe("cold");
    context.dispose();
  });

  it("rejects an evidence provenance tag for a mismatched retained descriptor", async () => {
    const fixture = createFixture("dy");
    const { evidence, prefixTarget } = createCompatiblePrefixEvidence(fixture);
    const { context, runtime } = await createContext(fixture, {
      prefixEvidence: evidence,
      prefixTarget,
      simulationBoundaryExpansion: 1,
    });
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 17) {
        new DataView(runtime.buffer, resultPointer, 40).setUint32(20, 2, true);
      }
      return resultPointer;
    });

    expect(() =>
      context.traceRealDfsForTest({
        hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
        targetPoint: fixture.pixelPath[2],
      }),
    ).toThrowError();
    spy.mockRestore();
    context.dispose();
  });

  it("replays real gate candidates after a blocked direct path", async () => {
    const emptyFixture = createFixture("dy");
    const targetPoint = graphToImagePoint(createGraphPoint(10, 0), bounds, boundsRect);
    const hitTarget = { center: targetPoint, radius: 2 } satisfies GraphwarTrajectoryTargetCircle;
    const directPath = [...emptyFixture.pixelPath.slice(0, 2), targetPoint];
    const directControlX = imageToGraphPoint(targetPoint, bounds, boundsRect).x;
    const { context: baselineContext } = await createContext(emptyFixture);
    const baseline = baselineContext.replayCandidateForTest({
      controlX: directControlX,
      orderedTargets: [hitTarget],
      path: directPath,
      windows: { type: "automatic" },
    });
    baselineContext.dispose();
    if (baseline.launchStatus !== "success") {
      throw new Error("expected a launched direct baseline");
    }
    const sourceTailX = emptyFixture.pixelPath[1].x;
    const obstaclePixel = baseline.visiblePixels.find(
      (point) => point.x >= sourceTailX + 20 && point.x < targetPoint.x - 20,
    );
    if (!obstaclePixel) {
      throw new Error("expected a direct replay point before the target");
    }
    const mask = new Uint8Array(planeCellCount);
    mask[Math.trunc(obstaclePixel.y) * GRAPHWAR_PLANE_LENGTH + Math.trunc(obstaclePixel.x)] = 1;
    const fixture = createFixture("dy", mask);
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;

    const trace = context.traceRealDfsForTest({ hitTarget, targetPoint });

    const gateCandidate = trace.candidates.find((candidate) => candidate.kind === "gate");
    if (!gateCandidate) {
      throw new Error("expected a real gate candidate");
    }
    expect(gateCandidate.windows.type).toBe("explicit");
    if (gateCandidate.windows.type === "explicit") {
      expect(gateCandidate.windows.segments.at(-1)?.endX).toBe(gateCandidate.controlX);
    }
    const prefixCandidate = trace.candidates.find((candidate) => candidate.kind === "prefix");
    if (
      prefixCandidate?.replay.launchStatus !== "success" ||
      prefixCandidate.replay.status !== "hit" ||
      !prefixCandidate.replay.acceptedPoint
    ) {
      throw new Error("expected a successful lazy prefix replay");
    }
    const scriptedOutcomes: GraphwarWasmStepGlitchGeometryReplayOutcome[] = [];
    for (const candidate of trace.candidates) {
      if (candidate.kind === "prefix") continue;
      const replay = candidate.replay;
      const reachedTargetCount = replay.reachedTargetCount + replay.reachedRequiredTargetCount;
      if (replay.launchStatus === "success" && replay.status === "hit" && replay.acceptedPoint) {
        scriptedOutcomes.push({
          acceptedPoint: replay.acceptedPoint,
          ...(replay.blockedPoint ? { blockedX: replay.blockedPoint.x } : {}),
          reachedTargetCount,
          status: "hit",
        });
        continue;
      }
      scriptedOutcomes.push({
        ...(replay.launchStatus === "success" && replay.blockedPoint ? { blockedX: replay.blockedPoint.x } : {}),
        reachedTargetCount,
        status: "miss",
      });
    }
    const scriptedTrace = context.traceScriptedDfs({
      hitTargetCenter: hitTarget.center,
      prefixAcceptedPoint: prefixCandidate.replay.acceptedPoint,
      ...(prefixCandidate.replay.blockedPoint ? { prefixBlockedX: prefixCandidate.replay.blockedPoint.x } : {}),
      prefixReachedTargetCount:
        prefixCandidate.replay.reachedTargetCount + prefixCandidate.replay.reachedRequiredTargetCount,
      replayMode: { outcomes: scriptedOutcomes, type: "scripted" },
      targetPoint,
    });
    expect(
      trace.candidates.filter((candidate) => candidate.kind !== "prefix").map(({ kind, path }) => ({ kind, path })),
    ).toEqual(scriptedTrace.candidates.map(({ kind, path }) => ({ kind, path })));
    const gateHitIndex = trace.candidates.findIndex(
      (candidate) => candidate.kind === "gate" && candidate.replay.status === "hit",
    );
    expect(gateHitIndex).toBeGreaterThanOrEqual(0);
    expect(trace.candidates.slice(gateHitIndex + 1).some((candidate) => candidate.kind === "target")).toBe(true);
    const firstBlockedCandidate = trace.candidates.find(
      (candidate) => candidate.replay.launchStatus === "success" && candidate.replay.blockedPoint,
    );
    expect(firstBlockedCandidate?.replay.launchStatus).toBe("success");
    if (firstBlockedCandidate?.replay.launchStatus === "success") {
      expect(trace.blockedX).toBe(firstBlockedCandidate.replay.blockedPoint?.x);
    }
    const highWaterByteLength = runtime.buffer.byteLength;
    for (let index = 0; index < 20; index += 1) {
      expect(
        context
          .traceRealDfsForTest({ hitTarget, targetPoint })
          .candidates.some((candidate) => candidate.kind === "gate"),
      ).toBe(true);
      expect(runtime.arenaCursor).toBe(retainedCursor);
    }
    expect(runtime.buffer.byteLength).toBe(highWaterByteLength);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });

  it("returns normal no-path when a one-point source still has required targets", async () => {
    const fixture = createFixture("dy");
    const requiredTarget = {
      center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect),
      radius: 0.01,
    } satisfies GraphwarTrajectoryTargetCircle;
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const contextResult = createGraphwarWasmStepGlitchGeometryTestContext(
      runtime,
      createGraphwarWasmStepGlitchContextInput({
        bounds,
        boundsRect,
        formulaMode: fixture.formulaMode,
        requiredTargets: [requiredTarget],
        simulationMask: fixture.mask,
        sourcePath: fixture.pixelPath.slice(0, 1),
      }),
    );
    expect(contextResult.status).toBe("ready");
    if (contextResult.status !== "ready") {
      throw new Error("expected retained one-point Step-glitch context");
    }
    const retainedCursor = runtime.arenaCursor;

    const trace = contextResult.context.traceRealDfsForTest({
      hitTarget: requiredTarget,
      targetPoint: fixture.pixelPath[1],
    });

    expect(trace).toMatchObject({ expandedStates: 1, status: "no-path" });
    expect(trace.candidates.map((candidate) => candidate.kind)).toEqual(["direct"]);
    expect(runtime.arenaCursor).toBe(retainedCursor);
    contextResult.context.dispose();
  });

  it("rejects a target that does not advance from the retained source", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;

    expect(() =>
      context.traceRealDfsForTest({
        hitTarget: { center: fixture.pixelPath[1], radius: 2 },
        targetPoint: fixture.pixelPath[1],
      }),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    context.dispose();
  });

  it.each([
    {
      mutate(traceView: DataView) {
        traceView.setFloat64(32, traceView.getFloat64(32, true) + 1, true);
      },
      name: "control x",
    },
    {
      mutate(traceView: DataView) {
        traceView.setUint32(188, traceView.getUint32(188, true) & ~1, true);
      },
      name: "terminal previous-point flag",
    },
    {
      mutate(traceView: DataView) {
        traceView.setFloat64(152, 1, true);
      },
      name: "first-order derivative scalar",
    },
    {
      mutate(traceView: DataView) {
        traceView.setInt32(108, 0x7fff_ffff, true);
      },
      name: "obstacle index",
    },
    {
      mutate(traceView: DataView) {
        traceView.setUint32(192, 1, true);
      },
      name: "reserved field",
    },
    {
      mutate(traceView: DataView) {
        traceView.setUint32(48, 0, true);
      },
      name: "target completion",
    },
    {
      mutate(traceView: DataView) {
        traceView.setInt32(100, -1, true);
      },
      name: "target completion index",
    },
    {
      mutate(traceView: DataView) {
        traceView.setFloat64(64, -999, true);
      },
      name: "accepted frontier",
    },
  ])("rejects corrupted real DFS $name and preserves the retained context", async ({ mutate }) => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 17) {
        const resultView = new DataView(runtime.buffer, resultPointer, 40);
        mutate(new DataView(runtime.buffer, resultView.getUint32(24, true), 200));
      }
      return resultPointer;
    });

    expect(() =>
      context.traceRealDfsForTest({
        hitTarget: { center: fixture.pixelPath[2], radius: 2 },
        targetPoint: fixture.pixelPath[2],
      }),
    ).toThrowError();
    spy.mockRestore();

    expect(
      context.traceRealDfsForTest({
        hitTarget: { center: fixture.pixelPath[2], radius: 2 },
        targetPoint: fixture.pixelPath[2],
      }).status,
    ).toBe("hit");
    expect(runtime.arenaCursor).toBe(retainedCursor);
    context.dispose();
  });

  it("rejects a target index on a compact replay with no ordered targets", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 17) {
        const resultView = new DataView(runtime.buffer, resultPointer, 40);
        const tracePointer = resultView.getUint32(24, true);
        const traceCount = resultView.getUint32(28, true);
        for (let index = 0; index < traceCount; index += 1) {
          const traceView = new DataView(runtime.buffer, tracePointer + index * 200, 200);
          if (traceView.getUint32(0, true) === 1) {
            traceView.setInt32(100, 0, true);
            break;
          }
        }
      }
      return resultPointer;
    });

    expect(() =>
      context.traceRealDfsForTest({
        hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
        targetPoint: fixture.pixelPath[2],
      }),
    ).toThrowError();
    spy.mockRestore();
    context.dispose();
  });

  it("rejects compact success when target completion and obstacle share one point", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 17) {
        const resultView = new DataView(runtime.buffer, resultPointer, 40);
        const traceView = new DataView(runtime.buffer, resultView.getUint32(24, true), 200);
        const targetHitIndex = traceView.getInt32(100, true);
        traceView.setUint32(60, 1, true);
        traceView.setFloat64(80, traceView.getFloat64(64, true), true);
        traceView.setFloat64(88, traceView.getFloat64(72, true), true);
        traceView.setInt32(96, 6, true);
        traceView.setInt32(108, targetHitIndex, true);
      }
      return resultPointer;
    });

    expect(() =>
      context.traceRealDfsForTest({
        hitTarget: { center: fixture.pixelPath[2], radius: 2 },
        targetPoint: fixture.pixelPath[2],
      }),
    ).toThrowError();
    spy.mockRestore();
    context.dispose();
  });

  it.each([
    {
      mutate(inputView: DataView, runtime: Awaited<ReturnType<typeof instantiateGraphwarWasmRuntime>>) {
        const evidencePointer = inputView.getUint32(44, true);
        const evidenceView = new DataView(runtime.buffer, evidencePointer, 164);
        const metadataPointer = evidenceView.getUint32(52, true);
        const metadataView = new DataView(runtime.buffer, metadataPointer, 72);
        metadataView.setFloat64(32, 1, true);
        metadataView.setFloat64(56, metadataView.getFloat64(56, true) & ~1, true);
      },
      name: "absent launch metadata scalar",
    },
    {
      mutate(inputView: DataView, runtime: Awaited<ReturnType<typeof instantiateGraphwarWasmRuntime>>) {
        const valuesPointer = inputView.getUint32(0, true);
        new DataView(runtime.buffer, valuesPointer, 14 * 8).setFloat64(9 * 8, -0, true);
      },
      name: "absent prefix-target negative zero",
    },
    {
      mutate(inputView: DataView, runtime: Awaited<ReturnType<typeof instantiateGraphwarWasmRuntime>>) {
        const evidencePointer = inputView.getUint32(44, true);
        const evidenceView = new DataView(runtime.buffer, evidencePointer, 164);
        const valuesPointer = evidenceView.getUint32(12, true);
        new DataView(runtime.buffer, valuesPointer, 7 * 8).setFloat64(6 * 8, -0, true);
      },
      name: "negative-zero identity proof",
    },
  ])("rejects malformed raw prefix evidence $name and restores the context mark", async ({ mutate }) => {
    const fixture = createFixture("dy");
    const { evidence, prefixTarget } = createCompatiblePrefixEvidence(fixture);
    const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      if (command === 11) {
        mutate(new DataView(runtime.buffer, inputPointer, inputByteLength), runtime);
      }
      return runRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() =>
      createGraphwarWasmStepGlitchGeometryTestContext(
        runtime,
        createGraphwarWasmStepGlitchContextInput({
          bounds: fixture.bounds,
          boundsRect,
          formulaMode: fixture.formulaMode,
          prefixEvidence: evidence,
          requiredTargets: [prefixTarget],
          simulationMask: fixture.mask,
          sourcePath: fixture.pixelPath.slice(0, 2),
        }),
      ),
    ).toThrowError();
    expect(runtime.arenaCursor).toBe(retainedCursor);
  });

  it("rejects noncanonical compact invalid-launch scalars", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 17) {
        const resultView = new DataView(runtime.buffer, resultPointer, 40);
        resultView.setUint32(4, 0, true);
        resultView.setUint32(12, 0, true);
        const traceView = new DataView(runtime.buffer, resultView.getUint32(24, true), 200);
        traceView.setUint32(40, 0, true);
        traceView.setInt32(44, 0, true);
        traceView.setUint32(48, 0, true);
        traceView.setUint32(52, 0, true);
        traceView.setUint32(56, 0, true);
        traceView.setUint32(60, 0, true);
        traceView.setFloat64(72, 0, true);
        traceView.setFloat64(80, 0, true);
        traceView.setFloat64(88, 0, true);
        traceView.setInt32(96, 2, true);
        traceView.setInt32(100, -1, true);
        traceView.setInt32(104, -1, true);
        traceView.setInt32(108, -1, true);
        for (const offset of [112, 116, 120, 124, 128, 132, 184, 188]) {
          traceView.setUint32(offset, 0, true);
        }
        for (const offset of [136, 144, 152, 160, 168, 176]) {
          traceView.setFloat64(offset, 0, true);
        }
        // acceptedX intentionally retains the successful replay's nonzero value.
      }
      return resultPointer;
    });

    expect(() =>
      context.traceRealDfsForTest({
        hitTarget: { center: fixture.pixelPath[2], radius: 2 },
        targetPoint: fixture.pixelPath[2],
      }),
    ).toThrowError();
    spy.mockRestore();
    context.dispose();
  });

  it("rejects a compact result blocked X without its flag", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 17) {
        new DataView(runtime.buffer, resultPointer, 40).setFloat64(32, 1, true);
      }
      return resultPointer;
    });

    expect(() =>
      context.traceRealDfsForTest({
        hitTarget: { center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect), radius: 0.01 },
        targetPoint: fixture.pixelPath[2],
      }),
    ).toThrowError();
    spy.mockRestore();
    context.dispose();
  });

  it("rejects a command 17 hit whose target completes at the obstacle point", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 17) {
        const resultView = new DataView(runtime.buffer, resultPointer, 40);
        const traceView = new DataView(runtime.buffer, resultView.getUint32(24, true), 200);
        const lastPointIndex = traceView.getUint32(112, true) - 1;
        traceView.setInt32(100, lastPointIndex, true);
        traceView.setInt32(108, lastPointIndex, true);
        traceView.setUint32(60, 1, true);
        traceView.setInt32(96, 6, true);
        traceView.setFloat64(80, traceView.getFloat64(136, true), true);
        traceView.setFloat64(88, traceView.getFloat64(144, true), true);
        resultView.setUint32(16, 1, true);
        resultView.setFloat64(32, traceView.getFloat64(80, true), true);
      }
      return resultPointer;
    });

    expect(() =>
      context.traceRealDfsForTest({
        hitTarget: { center: fixture.pixelPath[2], radius: 2 },
        targetPoint: fixture.pixelPath[2],
      }),
    ).toThrowError();
    spy.mockRestore();
    context.dispose();
  });

  it.each(["dy", "ddy"] satisfies readonly EquationMode[])(
    "matches a cold TypeScript gate replay for %s",
    async (equation) => {
      const fixture = createFixture(equation);
      const controlX = graphPath[2].x;
      const expected = resolveFixtureReplay(fixture, controlX, [], { type: "automatic" });
      const { context, runtime } = await createContext(fixture);
      const retainedCursor = runtime.arenaCursor;

      const actual = context.replayCandidateForTest({
        controlX,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      });

      expectReplayToMatchTypeScript(actual, expected);
      expect(runtime.arenaCursor).toBe(retainedCursor);
      expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
      context.dispose();
    },
  );

  it("matches target replay with explicit WASM-owned Step-glitch windows", async () => {
    const fixture = createFixture("dy");
    const automatic = resolveGraphwarTrajectory({
      bounds,
      boundsRect,
      formulaMode: fixture.formulaMode,
      points: graphPath,
      soldierCenter: graphPath[0],
    });
    const segments = automatic.context.stepGlitchFormulaEvidence?.prefix.stepGlitchSegments;
    if (!segments) {
      throw new Error("expected Step-glitch formula evidence");
    }
    const windows = {
      segments: segments.map((segment) =>
        segment === undefined ? undefined : { endX: segment.endX, startX: segment.startX },
      ),
      type: "explicit",
    } as const;
    const baseline = resolveFixtureReplay(fixture, graphPath[2].x, [], windows);
    const targetPoint = baseline.resolution?.result.sample.points.find((point) => point.x >= graphPath[2].x);
    if (!targetPoint) {
      throw new Error("expected a targetable trajectory point");
    }
    const orderedTarget = {
      center: graphToImagePoint(targetPoint, bounds, boundsRect),
      radius: 2,
    } satisfies GraphwarTrajectoryTargetCircle;
    const expected = resolveFixtureReplay(fixture, targetPoint.x, [orderedTarget], windows);
    const { context } = await createContext(fixture);

    const actual = context.replayCandidateForTest({
      controlX: targetPoint.x,
      orderedTargets: [orderedTarget],
      path: fixture.pixelPath,
      windows,
    });

    expectReplayToMatchTypeScript(actual, expected);
    expect(actual.status).toBe("hit");
    expect(actual.reachedTargetCount).toBe(1);
    context.dispose();
  });

  it("keeps a target duplicated in required targets out of the ordered sequence", async () => {
    const fixture = createFixture("dy");
    const baseline = resolveFixtureReplay(fixture, graphPath[2].x, [], { type: "automatic" });
    const targetPoint = baseline.resolution?.result.sample.points.find((point) => point.x >= graphPath[2].x);
    if (!targetPoint) {
      throw new Error("expected a targetable trajectory point");
    }
    const requiredTarget = {
      center: graphToImagePoint(targetPoint, bounds, boundsRect),
      radius: 2,
    } satisfies GraphwarTrajectoryTargetCircle;
    const requiredFixture = { ...fixture, requiredTargets: [requiredTarget] };
    const expected = resolveFixtureReplay(requiredFixture, targetPoint.x, [], { type: "automatic" });
    const { context } = await createContext(requiredFixture);

    const actual = context.replayCandidateForTest({
      controlX: targetPoint.x,
      orderedTargets: [],
      path: fixture.pixelPath,
      windows: { type: "automatic" },
    });

    expectReplayToMatchTypeScript(actual, expected);
    expect(actual.reachedTargetCount).toBe(0);
    expect(actual.reachedRequiredTargetCount).toBe(1);
    expect(actual.status).toBe("hit");
    context.dispose();
  });

  it("returns invalid launch as a normal miss without terminal half-state", async () => {
    const fixture = createFixture("dy");
    const { context } = await createContext(fixture);
    const actual = context.replayCandidateForTest({
      controlX: graphPath[2].x,
      orderedTargets: [],
      path: fixture.pixelPath,
      windows: { segments: [undefined, { endX: -30, startX: -31 }], type: "explicit" },
    });

    expect(actual).toEqual(
      expect.objectContaining({
        launchStatus: "invalid",
        reachedRequiredTargetCount: 0,
        reachedTargetCount: 0,
        status: "miss",
        stopReason: 2,
      }),
    );
    expect("state" in actual).toBe(false);
    expect("points" in actual).toBe(false);
    context.dispose();
  });

  it("keeps a real obstacle stop as a business miss with the first blocked point", async () => {
    const emptyFixture = createFixture("dy");
    const { context: baselineContext } = await createContext(emptyFixture);
    const baseline = baselineContext.replayCandidateForTest({
      controlX: 100,
      orderedTargets: [],
      path: emptyFixture.pixelPath,
      windows: { type: "automatic" },
    });
    baselineContext.dispose();
    if (baseline.launchStatus !== "success") {
      throw new Error("expected a successful baseline replay");
    }
    const controlPixel = graphToImagePoint(graphPath[2], bounds, boundsRect);
    const obstaclePixel = baseline.visiblePixels.find((point) => point.x >= controlPixel.x + 5);
    if (!obstaclePixel) {
      throw new Error("expected a replay point beyond the control frontier");
    }
    const mask = new Uint8Array(planeCellCount);
    mask[Math.trunc(obstaclePixel.y) * GRAPHWAR_PLANE_LENGTH + Math.trunc(obstaclePixel.x)] = 1;
    const fixture = createFixture("dy", mask);
    const expected = resolveFixtureReplay(fixture, 100, [], { type: "automatic" });
    const { context } = await createContext(fixture);

    const actual = context.replayCandidateForTest({
      controlX: 100,
      orderedTargets: [],
      path: fixture.pixelPath,
      windows: { type: "automatic" },
    });

    expectReplayToMatchTypeScript(actual, expected);
    expect(actual.status).toBe("miss");
    if (actual.launchStatus !== "success") {
      throw new Error("expected a launched collision replay");
    }
    expect(actual.stopReason).toBe(6);
    expect(actual.blockedPoint).toBeDefined();
    if (!actual.blockedPoint) {
      throw new Error("expected a blocked point");
    }

    const safeTargetIndex = actual.obstacleHitIndex - 5;
    if (safeTargetIndex < 1) {
      throw new Error("expected a targetable point before the obstacle");
    }
    const targetBeforeObstacle = {
      center: actual.visiblePixels[safeTargetIndex],
      radius: 0.1,
    } satisfies GraphwarTrajectoryTargetCircle;
    const expectedSafeTargetReplay = resolveFixtureReplay(fixture, 100, [targetBeforeObstacle], {
      type: "automatic",
    });
    const safeTargetReplay = context.replayCandidateForTest({
      controlX: 100,
      orderedTargets: [targetBeforeObstacle],
      path: fixture.pixelPath,
      windows: { type: "automatic" },
    });
    expectReplayToMatchTypeScript(safeTargetReplay, expectedSafeTargetReplay);
    if (safeTargetReplay.launchStatus !== "success") {
      throw new Error("expected a launched target-before-collision replay");
    }
    expect(safeTargetReplay.targetHitIndex).toBeLessThan(safeTargetReplay.obstacleHitIndex);
    expect(safeTargetReplay.status).toBe("miss");

    const samePointTarget = {
      center: graphToImagePoint(actual.blockedPoint, bounds, boundsRect),
      radius: 0.1,
    } satisfies GraphwarTrajectoryTargetCircle;
    const expectedTargetReplay = resolveFixtureReplay(fixture, 100, [samePointTarget], {
      type: "automatic",
    });
    const targetReplay = context.replayCandidateForTest({
      controlX: 100,
      orderedTargets: [samePointTarget],
      path: fixture.pixelPath,
      windows: { type: "automatic" },
    });
    expectReplayToMatchTypeScript(targetReplay, expectedTargetReplay);
    if (targetReplay.launchStatus !== "success") {
      throw new Error("expected a launched target/collision replay");
    }
    expect(targetReplay.reachedTargetCount).toBe(1);
    expect(targetReplay.targetHitIndex).toBe(targetReplay.obstacleHitIndex);
    expect(targetReplay.status).toBe("miss");
    context.dispose();
  });

  it("returns an ordinary target miss without converting it to a WASM fault", async () => {
    const fixture = createFixture("ddy");
    const unreachableTarget = {
      center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect),
      radius: 0.01,
    } satisfies GraphwarTrajectoryTargetCircle;
    const expected = resolveFixtureReplay(fixture, graphPath[2].x, [unreachableTarget], { type: "automatic" });
    const { context } = await createContext(fixture);

    const actual = context.replayCandidateForTest({
      controlX: graphPath[2].x,
      orderedTargets: [unreachableTarget],
      path: fixture.pixelPath,
      windows: { type: "automatic" },
    });

    expectReplayToMatchTypeScript(actual, expected);
    expect(actual.launchStatus).toBe("success");
    expect(actual.reachedTargetCount).toBe(0);
    expect(actual.status).toBe("miss");
    context.dispose();
  });

  it("refreshes replay output views after command-owned growth and restores its nested mark", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const byteLengthBeforeCommand = runtime.buffer.byteLength;
    const remainingByteLength = byteLengthBeforeCommand - runtime.arenaCursor;
    runtime.reserveArena(remainingByteLength - 8, 1);
    const retainedCursor = runtime.arenaCursor;

    const actual = context.replayCandidateForTest({
      controlX: graphPath[2].x,
      orderedTargets: [],
      path: fixture.pixelPath,
      windows: { type: "automatic" },
    });

    expect(actual.launchStatus).toBe("success");
    expect(runtime.buffer.byteLength).toBeGreaterThan(byteLengthBeforeCommand);
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });

  it.each([
    {
      name: "reserved field",
      mutate(view: DataView) {
        view.setUint32(36, 1, true);
      },
    },
    {
      name: "target pointer/count half-state",
      mutate(view: DataView) {
        view.setUint32(32, 1, true);
      },
    },
  ])("rejects a malformed raw replay $name and preserves the retained context", async ({ mutate }) => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      if (command === 16) {
        mutate(new DataView(runtime.buffer, inputPointer, inputByteLength));
      }
      return runRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() =>
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }),
    ).toThrow();
    spy.mockRestore();

    expect(
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }).launchStatus,
    ).toBe("success");
    expect(runtime.arenaCursor).toBe(retainedCursor);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });

  it.each([
    { name: "negative target radius", value: -1 },
    { name: "non-finite target radius", value: Number.NaN },
  ])("rejects a raw $name and preserves the retained context", async ({ value }) => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      if (command === 16) {
        const inputView = new DataView(runtime.buffer, inputPointer, inputByteLength);
        const targetPointer = inputView.getUint32(28, true);
        new DataView(runtime.buffer).setFloat64(targetPointer + 16, value, true);
      }
      return runRouteTask(command, inputPointer, inputByteLength);
    });

    expect(() =>
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [{ center: fixture.pixelPath[0], radius: 1 }],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }),
    ).toThrow();
    spy.mockRestore();

    expect(
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }).launchStatus,
    ).toBe("success");
    expect(runtime.arenaCursor).toBe(retainedCursor);
    context.dispose();
  });

  it.each([
    {
      name: "magic",
      mutate(view: DataView) {
        view.setUint32(0, 0, true);
      },
    },
    {
      name: "status",
      mutate(view: DataView) {
        view.setUint32(4, 99, true);
      },
    },
    {
      name: "target index",
      mutate(view: DataView) {
        view.setInt32(68, 0x7fff_ffff, true);
      },
    },
    {
      name: "terminal state flags",
      mutate(view: DataView) {
        view.setUint32(164, 7, true);
      },
    },
  ])("rejects corrupted replay output $name and preserves the retained context", async ({ mutate }) => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 16) {
        mutate(new DataView(runtime.buffer, resultPointer, 180));
      }
      return resultPointer;
    });

    expect(() =>
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }),
    ).toThrow();
    spy.mockRestore();

    expect(
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }).launchStatus,
    ).toBe("success");
    expect(runtime.arenaCursor).toBe(retainedCursor);
    context.dispose();
  });

  it("rejects a correlated fake hit whose target state disagrees with the sampled pixels", async () => {
    const fixture = createFixture("dy");
    const unreachableTarget = {
      center: graphToImagePoint(createGraphPoint(24, -14), bounds, boundsRect),
      radius: 0.01,
    } satisfies GraphwarTrajectoryTargetCircle;
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command !== 16) {
        return resultPointer;
      }
      const resultView = new DataView(runtime.buffer, resultPointer, 180);
      const trajectoryPointer = resultView.getUint32(8, true);
      const trajectoryView = new DataView(runtime.buffer, trajectoryPointer, 224);
      const pointXPointer = trajectoryView.getUint32(24, true);
      const pointYPointer = trajectoryView.getUint32(28, true);
      const visibleXPointer = trajectoryView.getUint32(144, true);
      const visibleYPointer = trajectoryView.getUint32(148, true);
      const pointCount = resultView.getUint32(80, true);
      let acceptedIndex = -1;
      for (let index = 0; index < pointCount; index += 1) {
        if (new DataView(runtime.buffer).getFloat64(pointXPointer + index * 8, true) >= graphPath[2].x) {
          acceptedIndex = index;
          break;
        }
      }
      if (acceptedIndex < 0) {
        throw new Error("expected a sampled point beyond the control frontier");
      }
      resultView.setUint32(4, 1, true);
      resultView.setUint32(16, 1, true);
      resultView.setUint32(24, 1, true);
      resultView.setInt32(68, acceptedIndex, true);
      resultView.setFloat64(32, new DataView(runtime.buffer).getFloat64(pointXPointer + acceptedIndex * 8, true), true);
      resultView.setFloat64(40, new DataView(runtime.buffer).getFloat64(pointYPointer + acceptedIndex * 8, true), true);
      new DataView(runtime.buffer).setFloat64(visibleXPointer + acceptedIndex * 8, unreachableTarget.center.x, true);
      new DataView(runtime.buffer).setFloat64(visibleYPointer + acceptedIndex * 8, unreachableTarget.center.y, true);
      trajectoryView.setUint32(100, 1, true);
      trajectoryView.setInt32(108, acceptedIndex, true);
      return resultPointer;
    });

    expect(() =>
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [unreachableTarget],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }),
    ).toThrow();
    spy.mockRestore();

    expect(
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }).launchStatus,
    ).toBe("success");
    expect(runtime.arenaCursor).toBe(retainedCursor);
    context.dispose();
  });

  it("rejects mirrored terminal state that disagrees with the published samples", async () => {
    const fixture = createFixture("ddy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 16) {
        const resultView = new DataView(runtime.buffer, resultPointer, 180);
        const trajectoryView = new DataView(runtime.buffer, resultView.getUint32(8, true), 224);
        const corruptedSampleIndex = resultView.getUint32(160, true) + 5;
        resultView.setUint32(160, corruptedSampleIndex, true);
        trajectoryView.setUint32(192, corruptedSampleIndex, true);
      }
      return resultPointer;
    });

    expect(() =>
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }),
    ).toThrow();
    spy.mockRestore();

    expect(
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { type: "automatic" },
      }).launchStatus,
    ).toBe("success");
    expect(runtime.arenaCursor).toBe(retainedCursor);
    context.dispose();
  });

  it("rejects terminal state on an invalid launch and restores the retained context", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const runRouteTask = runtime.runRouteTask.bind(runtime);
    const spy = vi.spyOn(runtime, "runRouteTask").mockImplementation((command, inputPointer, inputByteLength) => {
      const resultPointer = runRouteTask(command, inputPointer, inputByteLength);
      if (command === 16) {
        new DataView(runtime.buffer, resultPointer, 180).setUint32(164, 1, true);
      }
      return resultPointer;
    });

    expect(() =>
      context.replayCandidateForTest({
        controlX: graphPath[2].x,
        orderedTargets: [],
        path: fixture.pixelPath,
        windows: { segments: [undefined, { endX: -30, startX: -31 }], type: "explicit" },
      }),
    ).toThrow();
    spy.mockRestore();
    expect(runtime.arenaCursor).toBe(retainedCursor);
    context.dispose();
  });

  it("stabilizes at the retained high-water mark across repeated cold replays", async () => {
    const fixture = createFixture("dy");
    const { context, runtime } = await createContext(fixture);
    const retainedCursor = runtime.arenaCursor;
    const replayInput = {
      controlX: graphPath[2].x,
      orderedTargets: [],
      path: fixture.pixelPath,
      windows: { type: "automatic" },
    } as const;

    context.replayCandidateForTest(replayInput);
    const highWaterByteLength = runtime.buffer.byteLength;
    for (let index = 0; index < 100; index += 1) {
      context.replayCandidateForTest(replayInput);
      expect(runtime.arenaCursor).toBe(retainedCursor);
    }

    expect(runtime.buffer.byteLength).toBe(highWaterByteLength);
    expect(runtime.getArenaDiagnostics().isCanaryIntact).toBe(true);
    context.dispose();
  });
});

function createFixture(
  equation: Extract<EquationMode, "ddy" | "dy">,
  mask = new Uint8Array(planeCellCount),
  fixtureBounds = bounds,
  pixelPath = graphPath.map((point) => graphToImagePoint(point, fixtureBounds, boundsRect)),
) {
  const settings = {
    algorithm: "step",
    decimalPlaces: 4,
    equation,
    isStepGlitchModeEnabled: true,
    isStepOverflowProtectionEnabled: true,
    secondOrderLaunchAngleMode: "full-precision",
    steepness: 210,
    stepGlitchObstacleMask: mask,
  } satisfies GraphwarTrajectoryFormulaSettings;
  return {
    bounds: fixtureBounds,
    formulaMode: createGraphwarTrajectoryFormulaMode(settings),
    mask,
    pixelPath,
    requiredTargets: [] as readonly GraphwarTrajectoryTargetCircle[],
  };
}

async function createContext(
  fixture: ReturnType<typeof createFixture>,
  options?: {
    prefixEvidence?: ReturnType<typeof createCompatiblePrefixEvidence>["evidence"];
    prefixTarget?: GraphwarTrajectoryTargetCircle;
    simulationBoundaryExpansion?: number;
    sourcePath?: ReturnType<typeof createFixture>["pixelPath"];
  },
) {
  const runtime = await instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 64 });
  const result = createGraphwarWasmStepGlitchGeometryTestContext(
    runtime,
    createGraphwarWasmStepGlitchContextInput({
      bounds: fixture.bounds,
      boundsRect,
      formulaMode: fixture.formulaMode,
      ...(options?.prefixEvidence ? { prefixEvidence: options.prefixEvidence } : {}),
      ...(options?.prefixTarget ? { prefixTarget: options.prefixTarget } : {}),
      requiredTargets: fixture.requiredTargets,
      simulationBoundaryExpansion: options?.simulationBoundaryExpansion,
      simulationMask: fixture.mask,
      sourcePath: options?.sourcePath ?? fixture.pixelPath.slice(0, 2),
    }),
  );
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error("expected retained Step-glitch context");
  }
  return { context: result.context, runtime };
}

function createCompatiblePrefixEvidence(fixture: ReturnType<typeof createFixture>) {
  const sourcePath = fixture.pixelPath.slice(0, 2);
  const sourceGraphPath = sourcePath.map((point) => imageToGraphPoint(point, fixture.bounds, boundsRect));
  const prefixResolution = resolveGraphwarTrajectory({
    bounds: fixture.bounds,
    boundsRect,
    formulaMode: fixture.formulaMode,
    points: sourceGraphPath,
    soldierCenter: sourceGraphPath[0],
  });
  const formulaEvidence = prefixResolution.context.stepGlitchFormulaEvidence;
  const acceptedPoint = prefixResolution.result.sample.points.at(-1);
  const prefixTarget = { center: sourcePath[1], radius: 2 } satisfies GraphwarTrajectoryTargetCircle;
  if (!formulaEvidence || !acceptedPoint) {
    throw new Error("expected reusable Step-glitch prefix evidence");
  }
  return {
    evidence: createGraphwarStepGlitchPrefixEvidence({
      acceptedPoint,
      formulaEvidence,
      prefixTarget,
      requiredTargets: fixture.requiredTargets,
      simulationMask: fixture.mask,
    }),
    prefixTarget,
  };
}

function resolveFixtureReplay(
  fixture: ReturnType<typeof createFixture>,
  controlX: number,
  orderedTargets: readonly GraphwarTrajectoryTargetCircle[],
  windows: { type: "automatic" } | { segments: readonly (GraphwarStepGlitchXWindow | undefined)[]; type: "explicit" },
) {
  const debugMetrics = createGraphwarTrajectoryDebugMetrics();
  const fixtureGraphPath = fixture.pixelPath.map((point) => imageToGraphPoint(point, fixture.bounds, boundsRect));
  const resolution = tryResolveGraphwarTrajectoryCandidate({
    bounds: fixture.bounds,
    boundsRect,
    collectVisiblePixels: true,
    collision: { boundaryExpansion: 0, mask: fixture.mask },
    continueAfterTargetsUntilGraphX: controlX,
    debugMetrics,
    formulaMode: fixture.formulaMode,
    points: fixtureGraphPath,
    requiredTargets: fixture.requiredTargets,
    soldierCenter: fixtureGraphPath[0],
    ...(windows.type === "explicit" ? { stepGlitchXWindows: windows.segments } : {}),
    stopOnTargetsComplete: false,
    targetSequence: orderedTargets,
  });
  if (!resolution) {
    return { debugMetrics, resolution, status: "miss" as const };
  }
  const result = resolution.result;
  const hasHitTargets =
    result.reachedTargetCount >= orderedTargets.length &&
    result.reachedRequiredTargetCount >= fixture.requiredTargets.length;
  const lastSafeIndex = result.obstacleHitIndex >= 0 ? result.obstacleHitIndex - 1 : result.sample.points.length - 1;
  const completionIndex = Math.max(result.targetHitIndex, result.requiredTargetsHitIndex);
  const isCompletionSafe =
    orderedTargets.length === 0 && fixture.requiredTargets.length === 0
      ? true
      : completionIndex >= 0 && completionIndex <= lastSafeIndex;
  const acceptedPoint =
    hasHitTargets && isCompletionSafe
      ? findGraphwarStepGlitchAcceptedPointAtOrAfterControlX(
          result.sample.points,
          result.obstacleHitIndex,
          controlX,
          Math.max(result.targetHitIndex, 0),
        )
      : undefined;
  return {
    acceptedPoint,
    blockedPoint: result.obstacleHitIndex >= 0 ? result.sample.points[result.obstacleHitIndex] : undefined,
    debugMetrics,
    resolution,
    status: acceptedPoint ? ("hit" as const) : ("miss" as const),
  };
}

function expectReplayToMatchTypeScript(
  actual: GraphwarWasmStepGlitchRealReplayTestOutput,
  expected: ReturnType<typeof resolveFixtureReplay>,
) {
  expect(actual.status).toBe(expected.status);
  if (actual.launchStatus !== "success" || !expected.resolution) {
    return;
  }
  const expectedResult = expected.resolution.result;
  expect(actual.points).toEqual(expectedResult.sample.points);
  expect(actual.acceptedPoint).toEqual(expected.acceptedPoint);
  expect(actual.blockedPoint).toEqual(expected.blockedPoint);
  expect(actual.reachedTargetCount).toBe(expectedResult.reachedTargetCount);
  expect(actual.reachedRequiredTargetCount).toBe(expectedResult.reachedRequiredTargetCount);
  expect(actual.obstacleHitIndex).toBe(expectedResult.obstacleHitIndex);
  if (!expectedResult.sample.endState) {
    throw new Error("expected a terminal sampling state");
  }
  expect(actual.state).toEqual(
    createGraphwarWasmTrajectoryPhysicalStateFromSamplingState(
      expectedResult.sample.endState,
      expected.resolution.context.settings.equation,
      "expected.state",
    ),
  );
  expect(actual.observedSignProtection).toEqual(
    Array.from(
      { length: expected.resolution.context.formulaPoints.length - 1 },
      (_value, index) => expected.resolution?.context.signProtection[index] ?? 0,
    ),
  );
  expect({
    acceptedSamplePointCount: actual.acceptedSamplePointCount,
    bisectionCount: actual.bisectionCount,
    replayCount: actual.replayCount,
  }).toEqual({
    acceptedSamplePointCount: expected.debugMetrics.counters.acceptedSamplePointCount,
    bisectionCount: expected.debugMetrics.counters.stepBisectionCount,
    replayCount: expected.debugMetrics.counters.trajectoryReplayCount,
  });
  expect(actual.rk4StepCount).toBeGreaterThan(actual.bisectionCount);
  expect(actual.visiblePixels).toEqual(expectedResult.visiblePixels);
}
