import { describe, expect, expectTypeOf, it } from "vitest";

import { createGraphPoint, createPixelPoint } from "../../core/types";
import type { GraphwarTrajectorySamplingState } from "../../formula/simulation/simulator";
import type { GraphwarStepGlitchFormulaPrefix } from "../../formula/trajectory/sampling";
import { createGraphwarTrajectoryFormulaMode } from "../../formula/trajectory/sampling";
import { createGraphwarStepGlitchPrefixEvidence } from "../../pathfinding/routing/step-glitch-scan";
import { copyGraphwarWasmBytes, copyGraphwarWasmFloat64Values, GraphwarWasmAdapterError } from "./abi";
import {
  createGraphwarWasmStepGlitchContextInput,
  createGraphwarWasmStepGlitchScanCommandInput,
  decodeGraphwarWasmStepGlitchBusinessStatus,
  packGraphwarWasmStepGlitchCommandInput,
  packGraphwarWasmStepGlitchContextInput,
  type GraphwarWasmStepGlitchFinalValidationInput,
  type GraphwarWasmStepGlitchPrefixEvidenceInput,
  type GraphwarWasmStepGlitchReplayOutput,
  type GraphwarWasmStepGlitchScanOutput,
} from "./step-glitch-adapter";

class TestGraphwarWasmArena {
  readonly arenaBase = 8;
  readonly memory = new WebAssembly.Memory({ initial: 1 });
  #cursor = 8;

  get arenaCursor() {
    return this.#cursor;
  }

  get buffer() {
    return this.memory.buffer;
  }

  reserveArena(byteLength: number, alignment: number) {
    this.#cursor = Math.ceil(this.#cursor / alignment) * alignment;
    while (this.#cursor + byteLength > this.memory.buffer.byteLength) {
      this.memory.grow(1);
    }
    const pointer = this.#cursor;
    this.#cursor += byteLength;
    return pointer;
  }
}

const bounds = { maxX: -4, maxY: 10, minX: -12, minY: -10 };
const boundsRect = { height: 450, width: 770, x: 0, y: 0 };

describe("Graphwar WASM Step-glitch descriptor Adapter", () => {
  it("keeps prefix evidence and final validation as atomic type branches", () => {
    type CandidateEvidence = Extract<GraphwarWasmStepGlitchPrefixEvidenceInput, { type: "candidate" }>;
    type FinalValidation = Extract<GraphwarWasmStepGlitchFinalValidationInput, { type: "validate" }>;
    type ReplayHit = Extract<GraphwarWasmStepGlitchReplayOutput, { status: "hit" }>;

    expectTypeOf<CandidateEvidence>().toHaveProperty("evidence");
    expectTypeOf<{ type: "candidate" }>().not.toMatchTypeOf<GraphwarWasmStepGlitchPrefixEvidenceInput>();
    expectTypeOf<FinalValidation>().toHaveProperty("simulationMaskCacheId");
    expectTypeOf<FinalValidation>().toHaveProperty("targetControlPoints");
    expectTypeOf<FinalValidation>().toHaveProperty("trackedTargets");
    expectTypeOf<
      Pick<FinalValidation, "simulationMaskCacheId" | "type">
    >().not.toMatchTypeOf<GraphwarWasmStepGlitchFinalValidationInput>();
    expectTypeOf<{
      acceptedPoint: { x: number; y: number };
      expandedStates: number;
      reachedTargetCount: number;
      status: "hit";
    }>().not.toMatchTypeOf<GraphwarWasmStepGlitchScanOutput>();
    expectTypeOf<Omit<ReplayHit, "path">>().not.toMatchTypeOf<GraphwarWasmStepGlitchReplayOutput>();
    expectTypeOf<{
      reachedTargetCount: number;
      replayEvidence: { unexpected: true };
      status: "miss";
    }>().not.toMatchTypeOf<GraphwarWasmStepGlitchReplayOutput>();
  });

  it("packs one complete retained context and the complete prefix evidence identity", () => {
    const arena = new TestGraphwarWasmArena();
    const fixture = createFixture();
    const result = packGraphwarWasmStepGlitchContextInput(arena, fixture.context, 8);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected a packed context");
    }
    expect([...copyGraphwarWasmFloat64Values(arena, result.input.values, 8)]).toEqual([
      -12,
      -4,
      -10,
      10,
      0,
      0,
      770,
      450,
      2,
      fixture.prefixTarget.x,
      fixture.prefixTarget.y,
      12,
      1,
      1,
    ]);
    expect(result.input.sourcePath.length).toBe(2);
    expect(result.input.requiredTargetRecords.length).toBe(3);
    expect(result.input.prefixEvidence.type).toBe("candidate");
    if (result.input.prefixEvidence.type !== "candidate") {
      throw new Error("expected packed prefix evidence");
    }
    expect([...copyGraphwarWasmFloat64Values(arena, result.input.prefixEvidence.values, 8)]).toEqual([
      -8.5,
      0,
      2,
      fixture.prefixTarget.x,
      fixture.prefixTarget.y,
      12,
      1,
    ]);
    expect(copyGraphwarWasmBytes(arena, result.input.prefixEvidence.identityMask, 8)).toEqual(fixture.mask);
    expect([...copyGraphwarWasmFloat64Values(arena, result.input.prefixEvidence.requiredTargetRecords, 8)]).toEqual([
      fixture.prefixTarget.x,
      fixture.prefixTarget.y,
      12,
    ]);
    expect(result.input.prefixEvidence.formulaEvidence.prefix.points.length).toBe(2);
    expect(result.input.prefixEvidence.formulaEvidence.prefix.stepGlitchRequirements.length).toBe(1);
    expect(result.input.formulaSettings.mask.type).toBe("context-mask");
    expect(result.input.prefixEvidence.formulaEvidence.prefix.settings.mask.type).toBe("evidence-mask");
    expect(result.input.prefixEvidence.formulaEvidence.boundaryState.type).toBe("none");
  });

  it("retains mismatched evidence mask bytes so WASM can choose the cold prefix path", () => {
    const arena = new TestGraphwarWasmArena();
    const fixture = createFixture();
    fixture.mask[0] = 1;
    const result = packGraphwarWasmStepGlitchContextInput(arena, fixture.context, 8);

    expect(result.status).toBe("ready");
    if (result.status !== "ready" || result.input.prefixEvidence.type !== "candidate") {
      throw new Error("expected packed mismatch evidence");
    }
    expect(copyGraphwarWasmBytes(arena, result.input.simulationMask, 8)[0]).toBe(1);
    expect(copyGraphwarWasmBytes(arena, result.input.prefixEvidence.identityMask, 8)[0]).toBe(0);
    expect(result.input.prefixEvidence.formulaEvidence.prefix.settings.mask.type).toBe("mismatch");
  });

  it("classifies wrong Formula Mode and mask identity as normal input outcomes", () => {
    const arena = new TestGraphwarWasmArena();
    const fixture = createFixture();
    const unsupported = {
      ...fixture.context,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        ...fixture.context.formulaMode.settings,
        equation: "y" as const,
      }),
    };
    expect(packGraphwarWasmStepGlitchContextInput(arena, unsupported, 8)).toEqual({ status: "unsupported" });

    const mismatchedMask = {
      ...fixture.context,
      formulaMode: createGraphwarTrajectoryFormulaMode({
        ...fixture.context.formulaMode.settings,
        stepGlitchObstacleMask: new Uint8Array(770 * 450),
      }),
    };
    expect(packGraphwarWasmStepGlitchContextInput(arena, mismatchedMask, 8)).toEqual({ status: "invalid-input" });
  });

  it("packs scan and replay commands while keeping malformed ranges as invalid-input", () => {
    const arena = new TestGraphwarWasmArena();
    const fixture = createFixture();
    const targetPoint = createPixelPoint(600, 180);
    const scan = createGraphwarWasmStepGlitchScanCommandInput({
      finalValidation: {
        simulationMaskCacheId: 7,
        targetControlPoints: [targetPoint],
        trackedTargets: [{ center: targetPoint, radius: 12 }],
      },
      hitTarget: { center: targetPoint, radius: 12 },
      targetPoint,
    });
    if (scan.type !== "scan" || scan.finalValidation.type !== "validate") {
      throw new Error("expected a scan command with final validation");
    }
    const finalValidation = scan.finalValidation;
    const packedScan = packGraphwarWasmStepGlitchCommandInput(arena, fixture.context, scan, 8);
    expect(packedScan.status).toBe("ready");
    if (packedScan.status === "ready" && packedScan.input.type === "scan") {
      expect([...copyGraphwarWasmFloat64Values(arena, packedScan.input.targetValues, 8)]).toEqual([
        600, 180, 12, 600, 180,
      ]);
      expect(packedScan.input.finalValidation).toMatchObject({ simulationMaskCacheId: 7, type: "validate" });
    }

    expect(
      packGraphwarWasmStepGlitchCommandInput(
        arena,
        fixture.context,
        { ...scan, hitTarget: { ...scan.hitTarget, radius: -1 } },
        8,
      ),
    ).toEqual({ status: "invalid-input" });
    expect(() =>
      packGraphwarWasmStepGlitchCommandInput(
        arena,
        fixture.context,
        {
          ...scan,
          finalValidation: {
            ...finalValidation,
            simulationMaskCacheId: -1,
            type: "validate",
          },
        },
        8,
      ),
    ).toThrowError(GraphwarWasmAdapterError);
    expect(() =>
      packGraphwarWasmStepGlitchCommandInput(
        arena,
        fixture.context,
        {
          ...scan,
          finalValidation: { ...finalValidation, simulationMaskCacheId: -1, type: "validate" },
          hitTarget: { ...scan.hitTarget, radius: -1 },
        },
        8,
      ),
    ).toThrowError(GraphwarWasmAdapterError);
    expect(() =>
      packGraphwarWasmStepGlitchCommandInput(
        arena,
        fixture.context,
        {
          ...scan,
          finalValidation: { ...finalValidation, simulationMaskCacheId: 1.5, type: "validate" },
          targetPoint: fixture.sourcePath[1],
        },
        8,
      ),
    ).toThrowError(GraphwarWasmAdapterError);
    expect(() =>
      packGraphwarWasmStepGlitchCommandInput(
        arena,
        fixture.context,
        {
          ...scan,
          finalValidation: {
            ...finalValidation,
            simulationMaskCacheId: -1,
            targetControlPoints: [createPixelPoint(Number.NaN, 0)],
            type: "validate",
          },
        },
        8,
      ),
    ).toThrowError(GraphwarWasmAdapterError);
    expect(
      packGraphwarWasmStepGlitchCommandInput(
        arena,
        fixture.context,
        { ...scan, targetPoint: createPixelPoint(10, Number.NaN) },
        8,
      ),
    ).toEqual({ status: "invalid-input" });
    expect(
      packGraphwarWasmStepGlitchCommandInput(
        arena,
        fixture.context,
        {
          controlX: -6,
          finalValidation: { type: "none" },
          path: [fixture.sourcePath[0]],
          targetSequence: [],
          type: "replay",
        },
        8,
      ),
    ).toEqual({ status: "invalid-input" });

    expect(
      packGraphwarWasmStepGlitchCommandInput(
        arena,
        fixture.context,
        {
          controlX: -6,
          finalValidation: { type: "none" },
          path: [createPixelPoint(97, 225), fixture.sourcePath[1]],
          targetSequence: [],
          type: "replay",
        },
        8,
      ),
    ).toEqual({ status: "invalid-input" });
  });

  it("rejects spliced or structurally incomplete prefix evidence", () => {
    const fixture = createFixture();
    if (fixture.context.prefixEvidence.type !== "candidate") {
      throw new Error("expected candidate evidence");
    }
    const evidence = fixture.context.prefixEvidence.evidence;
    const prefix = evidence.formulaEvidence.prefix;
    const splicedContext = {
      ...fixture.context,
      prefixEvidence: {
        evidence: {
          ...evidence,
          formulaEvidence: {
            boundaryState: {
              formulaMaterialsIdentity: "[]",
              prefix: { ...prefix },
              segmentCount: 1,
              state: { currentPoint: createGraphPoint(-8.5, 0), sampleIndex: 1 },
              stopX: -8.5,
            },
            prefix,
          },
        },
        type: "candidate" as const,
      },
    };
    expect(() => packGraphwarWasmStepGlitchContextInput(new TestGraphwarWasmArena(), splicedContext, 8)).toThrowError(
      GraphwarWasmAdapterError,
    );

    const incompleteContext = {
      ...fixture.context,
      prefixEvidence: {
        evidence: {
          ...evidence,
          formulaEvidence: {
            prefix: { ...prefix, stepGlitchRequirements: [] },
          },
        },
        type: "candidate" as const,
      },
    };
    expect(() =>
      packGraphwarWasmStepGlitchContextInput(new TestGraphwarWasmArena(), incompleteContext, 8),
    ).toThrowError(GraphwarWasmAdapterError);

    const contextWithSignProtection = (signProtection: readonly number[]) => ({
      ...fixture.context,
      prefixEvidence: {
        evidence: {
          ...evidence,
          formulaEvidence: { prefix: { ...prefix, signProtection } },
        },
        type: "candidate" as const,
      },
    });
    expect(
      packGraphwarWasmStepGlitchContextInput(new TestGraphwarWasmArena(), contextWithSignProtection([0, 0]), 8).status,
    ).toBe("ready");
    expect(() =>
      packGraphwarWasmStepGlitchContextInput(new TestGraphwarWasmArena(), contextWithSignProtection([0, 1]), 8),
    ).toThrowError(GraphwarWasmAdapterError);
    expect(() =>
      packGraphwarWasmStepGlitchContextInput(new TestGraphwarWasmArena(), contextWithSignProtection([0, 32]), 8),
    ).toThrowError(GraphwarWasmAdapterError);
  });

  it("packs only equation-coherent boundary sampling states", () => {
    const dyArena = new TestGraphwarWasmArena();
    const dyFixture = createBoundaryFixture("dy", {
      currentPoint: createGraphPoint(-8.5, 0),
      previousPoint: createGraphPoint(-8.6, 0),
      sampleIndex: 1,
    });
    const packedDy = packGraphwarWasmStepGlitchContextInput(dyArena, dyFixture.context, 8);
    expect(packedDy.status).toBe("ready");
    if (packedDy.status !== "ready" || packedDy.input.prefixEvidence.type !== "candidate") {
      throw new Error("expected packed dy boundary state");
    }
    const dyBoundaryState = packedDy.input.prefixEvidence.formulaEvidence.boundaryState;
    expect(dyBoundaryState.type).toBe("state");
    if (dyBoundaryState.type !== "state") {
      throw new Error("expected packed dy boundary state atom");
    }
    expect([...copyGraphwarWasmFloat64Values(dyArena, dyBoundaryState.state, 8)]).toEqual([
      -8.5, 1, 0.25, -8.5, 0, 0, -8.6, 0, 0, 1, 5,
    ]);

    const ddyArena = new TestGraphwarWasmArena();
    const ddyFixture = createBoundaryFixture("ddy", {
      currentPoint: createGraphPoint(-8.5, 0),
      dy: 1.25,
      previousDy: 1,
      previousPoint: createGraphPoint(-8.6, -0.1),
      sampleIndex: 1,
    });
    const packedDdy = packGraphwarWasmStepGlitchContextInput(ddyArena, ddyFixture.context, 8);
    expect(packedDdy.status).toBe("ready");
    if (packedDdy.status !== "ready" || packedDdy.input.prefixEvidence.type !== "candidate") {
      throw new Error("expected packed ddy boundary state");
    }
    const ddyBoundaryState = packedDdy.input.prefixEvidence.formulaEvidence.boundaryState;
    expect(ddyBoundaryState.type).toBe("state");
    if (ddyBoundaryState.type !== "state") {
      throw new Error("expected packed ddy boundary state atom");
    }
    expect([...copyGraphwarWasmFloat64Values(ddyArena, ddyBoundaryState.state, 8)]).toEqual([
      -8.5, 1, 0.25, -8.5, 0, 1.25, -8.6, -0.1, 1, 1, 15,
    ]);
  });

  it("rejects boundary sampling half-states and fractional boundary expansion", () => {
    const invalidStates: readonly ["ddy" | "dy", GraphwarTrajectorySamplingState][] = [
      [
        "ddy",
        {
          currentPoint: createGraphPoint(-8.5, 0),
          previousDy: 1,
          previousPoint: createGraphPoint(-8.6, 0),
          sampleIndex: 1,
        },
      ],
      [
        "ddy",
        {
          currentPoint: createGraphPoint(-8.5, 0),
          dy: 1,
          previousPoint: createGraphPoint(-8.6, 0),
          sampleIndex: 1,
        },
      ],
      ["ddy", { currentPoint: createGraphPoint(-8.5, 0), dy: 1, previousDy: 1, sampleIndex: 1 }],
      ["dy", { currentPoint: createGraphPoint(-8.5, 0), dy: 1, sampleIndex: 0 }],
      [
        "dy",
        {
          currentPoint: createGraphPoint(-8.5, 0),
          previousPoint: createGraphPoint(-8.6, 0),
          sampleIndex: 0,
        },
      ],
    ];
    for (const [equation, state] of invalidStates) {
      const fixture = createBoundaryFixture(equation, state);
      expect(() =>
        packGraphwarWasmStepGlitchContextInput(new TestGraphwarWasmArena(), fixture.context, 8),
      ).toThrowError(GraphwarWasmAdapterError);
    }

    const fixture = createFixture();
    expect(
      packGraphwarWasmStepGlitchContextInput(
        new TestGraphwarWasmArena(),
        { ...fixture.context, simulationBoundaryExpansion: 1.5 },
        8,
      ),
    ).toEqual({ status: "invalid-input" });
  });

  it("does not convert arena allocation faults into normal invalid-input results", () => {
    const fixture = createFixture();
    const arena = new TestGraphwarWasmArena();
    const failingArena = {
      get arenaBase() {
        return arena.arenaBase;
      },
      get arenaCursor() {
        return arena.arenaCursor;
      },
      get buffer() {
        return arena.buffer;
      },
      reserveArena() {
        throw new GraphwarWasmAdapterError("range-overflow", "injected allocation fault", "input");
      },
    };

    expect(() => packGraphwarWasmStepGlitchContextInput(failingArena, fixture.context, 8)).toThrowError(
      GraphwarWasmAdapterError,
    );
  });

  it("decodes every normal scanner failure without treating it as a typed fault", () => {
    expect([1, 2, 3, 4].map(decodeGraphwarWasmStepGlitchBusinessStatus)).toEqual([
      "hit",
      "no-path",
      "invalid-input",
      "unsupported",
    ]);
    expect(() => decodeGraphwarWasmStepGlitchBusinessStatus(99)).toThrowError(GraphwarWasmAdapterError);
  });
});

function createFixture() {
  const mask = new Uint8Array(770 * 450);
  const sourcePath = [createPixelPoint(96, 225), createPixelPoint(337, 225)];
  const prefixTarget = createPixelPoint(337, 225);
  const graphPoints = [createGraphPoint(-11, 0), createGraphPoint(-8.5, 0)];
  const settings = {
    algorithm: "step" as const,
    decimalPlaces: 4,
    equation: "dy" as const,
    steepness: 67,
    isStepGlitchModeEnabled: true,
    stepGlitchObstacleMask: mask,
    isStepOverflowProtectionEnabled: true,
  };
  const formulaEvidence = {
    prefix: {
      bounds,
      initialFormulaPoints: graphPoints,
      points: graphPoints,
      refinedFormulaPoints: graphPoints,
      segmentStartPoints: [undefined],
      settings,
      signProtection: [0],
      soldierCenter: graphPoints[0],
      stepGlitchRequirements: [false],
      stepGlitchSegments: [undefined],
      stepSegmentDeltaYs: [undefined],
    } satisfies GraphwarStepGlitchFormulaPrefix,
  };
  const prefixEvidence = createGraphwarStepGlitchPrefixEvidence({
    acceptedPoint: createGraphPoint(-8.5, 0),
    formulaEvidence,
    prefixTarget: { center: prefixTarget, radius: 12 },
    requiredTargets: [{ center: prefixTarget, radius: 12 }],
    simulationBoundaryExpansion: 2,
    simulationMask: mask,
  });
  const context = createGraphwarWasmStepGlitchContextInput({
    bounds,
    boundsRect,
    formulaMode: createGraphwarTrajectoryFormulaMode(settings),
    prefixEvidence,
    prefixTarget: { center: prefixTarget, radius: 12 },
    requiredTargets: [{ center: prefixTarget, radius: 12 }],
    simulationBoundaryExpansion: 2,
    simulationMask: mask,
    sourcePath,
  });
  return { context, mask, prefixTarget, sourcePath };
}

function createBoundaryFixture(equation: "ddy" | "dy", state: GraphwarTrajectorySamplingState) {
  const fixture = createFixture();
  if (fixture.context.prefixEvidence.type !== "candidate") {
    throw new Error("expected candidate evidence");
  }
  const existingEvidence = fixture.context.prefixEvidence.evidence;
  const settings = { ...existingEvidence.formulaEvidence.prefix.settings, equation };
  const prefix = { ...existingEvidence.formulaEvidence.prefix, settings } satisfies GraphwarStepGlitchFormulaPrefix;
  const formulaEvidence = {
    boundaryState: {
      formulaMaterialsIdentity: "[]",
      launchAngleRadians: 0.25,
      prefix,
      segmentCount: 1,
      state,
      stopX: -8.5,
    },
    prefix,
  };
  const prefixEvidence = createGraphwarStepGlitchPrefixEvidence({
    acceptedPoint: existingEvidence.acceptedPoint,
    formulaEvidence,
    prefixTarget: existingEvidence.replayIdentity.prefixTarget,
    requiredTargets: existingEvidence.replayIdentity.requiredTargets,
    simulationBoundaryExpansion: existingEvidence.replayIdentity.boundaryExpansion,
    simulationMask: existingEvidence.replayIdentity.simulationMask,
  });
  const context = createGraphwarWasmStepGlitchContextInput({
    bounds,
    boundsRect,
    formulaMode: createGraphwarTrajectoryFormulaMode(settings),
    prefixEvidence,
    prefixTarget: { center: fixture.prefixTarget, radius: 12 },
    requiredTargets: [{ center: fixture.prefixTarget, radius: 12 }],
    simulationBoundaryExpansion: 2,
    simulationMask: fixture.mask,
    sourcePath: fixture.sourcePath,
  });
  return { context };
}
