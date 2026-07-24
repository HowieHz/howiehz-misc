import { describe, expect, it } from "vitest";

import { createPixelPoint } from "../../core/types";
import type { GraphwarAgentAvailableState } from "./client";
import { useGraphwarAgentFunctionDrawPlayback } from "./function-draw-playback";

const identity = {
  gameInstanceId: "00000000-0000-4000-8000-000000000010",
  turnToken: "00000000-0000-4000-8000-000000000011",
};
const points = [createPixelPoint(0, 0), createPixelPoint(1, 1), createPixelPoint(2, 2), createPixelPoint(3, 3)];

describe("Graphwar Agent function draw playback", () => {
  it("hides the completed preview until drawing is observed, then advances by authoritative steps", () => {
    const epochMs = 10_000;
    let monotonicMs = 100;
    let pendingFrame: FrameRequestCallback | undefined;
    const playback = useGraphwarAgentFunctionDrawPlayback({
      cancelFrame: () => {
        pendingFrame = undefined;
      },
      getEpochMs: () => epochMs,
      getMonotonicMs: () => monotonicMs,
      requestFrame: (callback) => {
        pendingFrame = callback;
        return 1;
      },
    });

    playback.arm(identity, points);
    expect(playback.curvePoints.value).toBe("");
    playback.update(
      createDrawingState({ currentStep: 2, observationSequence: 1, observedAtEpochMs: epochMs, stepsPerSecond: 2 }),
    );
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00");

    monotonicMs += 1_000;
    pendingFrame?.(monotonicMs);
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00 2.00,2.00 3.00,3.00");
    expect(playback.isTracking.value).toBe(false);

    playback.update(
      createDrawingState({ currentStep: 2, observationSequence: 2, observedAtEpochMs: epochMs, stepsPerSecond: 2 }),
    );
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00");
    expect(playback.isTracking.value).toBe(true);
  });

  it("deducts response age and accepts a later backward calibration", () => {
    const monotonicMs = 0;
    const playback = useGraphwarAgentFunctionDrawPlayback({
      cancelFrame: () => undefined,
      getEpochMs: () => 2_000,
      getMonotonicMs: () => monotonicMs,
      requestFrame: () => 1,
    });
    playback.arm(identity, points);
    playback.update(
      createDrawingState({ currentStep: 1, observationSequence: 1, observedAtEpochMs: 1_000, stepsPerSecond: 2 }),
    );
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00 2.00,2.00");

    playback.update(
      createDrawingState({ currentStep: 2, observationSequence: 2, observedAtEpochMs: 2_000, stepsPerSecond: 2 }),
    );
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00");
  });

  it("can attach an asynchronously published trajectory after the draw cursor arrives", () => {
    let monotonicMs = 0;
    let pendingFrame: FrameRequestCallback | undefined;
    const playback = useGraphwarAgentFunctionDrawPlayback({
      cancelFrame: () => undefined,
      getEpochMs: () => 0,
      getMonotonicMs: () => monotonicMs,
      requestFrame: (callback) => {
        pendingFrame = callback;
        return 1;
      },
    });
    playback.arm(identity);
    playback.update(
      createDrawingState({ currentStep: 2, observationSequence: 1, observedAtEpochMs: 0, stepsPerSecond: 2 }),
    );
    expect(playback.curvePoints.value).toBe("");

    playback.attachTrajectory(identity, points);
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00");
    monotonicMs = 1000;
    pendingFrame?.(monotonicMs);
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00 2.00,2.00 3.00,3.00");
  });

  it("shows a late trajectory in full when the first observed state is already exploding", () => {
    const playback = useGraphwarAgentFunctionDrawPlayback();
    playback.arm(identity);
    playback.update(createState({ functionDraw: null, observationSequence: 1, phase: "exploding" }));
    playback.attachTrajectory(identity, points);

    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00 2.00,2.00 3.00,3.00");
  });

  it("finishes the matching trajectory during explosion and clears it for another turn", () => {
    const playback = useGraphwarAgentFunctionDrawPlayback();
    playback.arm(identity, points);
    playback.update(createState({ functionDraw: null, observationSequence: 1, phase: "exploding" }));
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00 2.00,2.00 3.00,3.00");

    playback.update(
      createState({
        functionDraw: null,
        observationSequence: 2,
        phase: "aiming",
        turnToken: "00000000-0000-4000-8000-000000000012",
      }),
    );
    expect(playback.curvePoints.value).toBeUndefined();
  });

  it("ignores older phases that arrive after a newer draw or explosion snapshot", () => {
    const playback = useGraphwarAgentFunctionDrawPlayback({
      cancelFrame: () => undefined,
      getEpochMs: () => 3000,
      getMonotonicMs: () => 0,
      requestFrame: () => 1,
    });
    playback.arm(identity, points);
    playback.update(
      createDrawingState({ currentStep: 2, observationSequence: 2, observedAtEpochMs: 2000, stepsPerSecond: 1 }),
    );
    playback.update(
      createState({ functionDraw: null, observationSequence: 1, observedAtEpochMs: 1500, phase: "aiming" }),
    );
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00 2.00,2.00");

    playback.update(
      createState({ functionDraw: null, observationSequence: 4, observedAtEpochMs: 4000, phase: "exploding" }),
    );
    playback.update(
      createDrawingState({ currentStep: 2, observationSequence: 3, observedAtEpochMs: 3500, stepsPerSecond: 1 }),
    );
    expect(playback.curvePoints.value).toBe("0.00,0.00 1.00,1.00 2.00,2.00 3.00,3.00");
  });
});

/** Builds the drawing branch while preserving strict phase/functionDraw correlation. */
function createDrawingState(functionDraw: {
  currentStep: number;
  observationSequence: number;
  observedAtEpochMs: number;
  stepsPerSecond: number;
}) {
  return createState({
    functionDraw: {
      currentStep: functionDraw.currentStep,
      stepsPerSecond: functionDraw.stepsPerSecond,
    },
    observationSequence: functionDraw.observationSequence,
    observedAtEpochMs: functionDraw.observedAtEpochMs,
    phase: "drawing",
  });
}

/** Creates the minimum authoritative state consumed by playback. */
function createState(overrides: Partial<GraphwarAgentAvailableState> = {}): GraphwarAgentAvailableState {
  return {
    agentInstanceId: "00000000-0000-4000-8000-000000000001",
    apiVersion: 3,
    battleRevision: `sha256:${"a".repeat(64)}`,
    canAcceptShotCommands: true,
    capabilities: {
      canReadRoom: true,
      canReadWorldObstacleMask: true,
      canSetReady: true,
      canSubmitShots: true,
    },
    currentPlayerId: 7,
    currentPlayerIndex: 0,
    equationMode: "y",
    functionDraw: null,
    gameInstanceId: identity.gameInstanceId,
    isAvailable: true,
    isTerrainReversed: false,
    observationSequence: 0,
    observedAtEpochMs: 0,
    obstacleMask: {
      blockedValue: 1,
      emptyValue: 0,
      height: 450,
      isViewMirrored: false,
      revision: `sha256:${"a".repeat(64)}`,
      viewUrl: "/obstacle-masks/view.bin",
      width: 770,
      worldUrl: "/obstacle-masks/world.bin",
    },
    phase: "aiming",
    plane: { gameLength: 50, height: 450, width: 770 },
    players: [],
    remainingTurnMs: 0,
    shotCommand: null,
    turnToken: identity.turnToken,
    ...overrides,
  };
}
