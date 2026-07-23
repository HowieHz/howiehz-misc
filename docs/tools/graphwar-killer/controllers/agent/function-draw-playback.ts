import { readonly, ref, type Ref } from "vue";

import { nowMs } from "../../core/time";
import type { PixelPoint } from "../../core/types";
import { formatSvgPolylinePointRange } from "../../presentation/stage/svg-polyline";
import type { GraphwarAgentState } from "./client";
import { createGraphwarAgentObservationOrder } from "./observation-order";

/** Identifies the exact game turn whose submitted function owns a trajectory. */
export interface GraphwarAgentFunctionDrawIdentity {
  gameInstanceId: string;
  turnToken: string;
}

/** Browser scheduling dependencies exposed for deterministic playback tests. */
interface GraphwarAgentFunctionDrawPlaybackOptions {
  cancelFrame?: (handle: number) => void;
  getEpochMs?: () => number;
  getMonotonicMs?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
}

/** Progressive curve override driven by authoritative Agent draw cursors. */
export interface GraphwarAgentFunctionDrawPlayback {
  /** Adds the exact trajectory points when asynchronous result publication finishes after submission. */
  attachTrajectory: (identity: GraphwarAgentFunctionDrawIdentity, points: readonly PixelPoint[]) => void;
  /** Hides the complete preview while waiting for the original client to enter drawing. */
  arm: (identity: GraphwarAgentFunctionDrawIdentity, points?: readonly PixelPoint[]) => void;
  /** Clears every retained identity, animation frame, and curve override. */
  clear: () => void;
  /** Clears only when the caller still owns the armed turn. */
  clearIdentity: (identity: GraphwarAgentFunctionDrawIdentity) => void;
  /** Undefined delegates to the normal full trajectory; an empty string intentionally hides it. */
  curvePoints: Readonly<Ref<string | undefined>>;
  /** True while waiting for drawing or locally advancing a partial trajectory. */
  isTracking: Readonly<Ref<boolean>>;
  /** Applies one newer live state as an authoritative playback anchor. */
  update: (state: GraphwarAgentState) => void;
}

/** Keeps browser rendering continuous between Agent snapshots without guessing geometric path speed. */
export function useGraphwarAgentFunctionDrawPlayback(
  options: GraphwarAgentFunctionDrawPlaybackOptions = {},
): GraphwarAgentFunctionDrawPlayback {
  const curvePoints = ref<string>();
  const isTracking = ref(false);
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const getEpochMs = options.getEpochMs ?? Date.now;
  const getMonotonicMs = options.getMonotonicMs ?? nowMs;
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const observationOrder = createGraphwarAgentObservationOrder();
  let anchorMonotonicMs = 0;
  let anchorStep = 0;
  let frame: number | undefined;
  let isFinished = false;
  let hasObservedDrawing = false;
  let identity: GraphwarAgentFunctionDrawIdentity | undefined;
  let points: readonly PixelPoint[] = [];
  let renderedPointCount = 0;
  let stepsPerSecond = 0;

  /** Arms one submitted turn and immediately removes its already-complete preview. */
  function arm(nextIdentity: GraphwarAgentFunctionDrawIdentity, nextPoints: readonly PixelPoint[] = []) {
    clear();
    identity = nextIdentity;
    points = nextPoints;
    curvePoints.value = "";
    isTracking.value = true;
  }

  /** Attaches a late trajectory only if it still belongs to the armed game turn. */
  function attachTrajectory(nextIdentity: GraphwarAgentFunctionDrawIdentity, nextPoints: readonly PixelPoint[]) {
    if (!hasMatchingIdentity(nextIdentity)) {
      return;
    }
    points = nextPoints;
    if (isFinished) {
      renderedPointCount = points.length;
      curvePoints.value = points.length < 2 ? "" : formatSvgPolylinePointRange(points, 0, points.length);
      return;
    }
    renderedPointCount = 0;
    renderCurrentStep();
    scheduleFrame();
  }

  /** Reanchors local advancement from one state whose cursor time is explicitly known. */
  function update(state: GraphwarAgentState) {
    if (!identity) {
      return;
    }
    if (!observationOrder.accept(state)) {
      return;
    }
    if (
      !state.isAvailable ||
      state.gameInstanceId !== identity.gameInstanceId ||
      state.turnToken !== identity.turnToken
    ) {
      clear();
      return;
    }
    if (state.phase === "exploding") {
      finish();
      return;
    }
    if (state.phase !== "drawing") {
      if (hasObservedDrawing) {
        clear();
      }
      return;
    }
    const functionDraw = state.functionDraw;
    if (!functionDraw) {
      clear();
      return;
    }

    isFinished = false;
    hasObservedDrawing = true;
    isTracking.value = true;
    anchorStep =
      functionDraw.currentStep +
      (Math.max(0, getEpochMs() - state.observedAtEpochMs) * functionDraw.stepsPerSecond) / 1000;
    anchorMonotonicMs = getMonotonicMs();
    stepsPerSecond = functionDraw.stepsPerSecond;
    renderCurrentStep();
    scheduleFrame();
  }

  /** Formats only newly visible steps; a backward Agent correction rebuilds the shorter prefix. */
  function renderCurrentStep() {
    if (!hasObservedDrawing || points.length === 0) {
      return;
    }
    const pointCount = Math.min(
      points.length,
      Math.max(0, Math.floor(anchorStep + ((getMonotonicMs() - anchorMonotonicMs) * stepsPerSecond) / 1000)),
    );
    if (pointCount === renderedPointCount) {
      return;
    }
    if (pointCount < 2) {
      curvePoints.value = "";
    } else if (renderedPointCount >= 2 && pointCount > renderedPointCount) {
      const currentCurvePoints = curvePoints.value;
      curvePoints.value =
        currentCurvePoints === undefined
          ? formatSvgPolylinePointRange(points, 0, pointCount)
          : `${currentCurvePoints} ${formatSvgPolylinePointRange(points, renderedPointCount, pointCount)}`;
    } else {
      curvePoints.value = formatSvgPolylinePointRange(points, 0, pointCount);
    }
    renderedPointCount = pointCount;
    if (pointCount >= points.length) {
      isTracking.value = false;
      cancelPendingFrame();
    }
  }

  /** Continues local advancement at display refresh rate while unrendered steps remain. */
  function scheduleFrame() {
    if (!isTracking.value || frame !== undefined || points.length === 0) {
      return;
    }
    frame = requestFrame(() => {
      frame = undefined;
      renderCurrentStep();
      scheduleFrame();
    });
  }

  /** Shows the submitted trajectory in full once Graphwar enters explosion resolution. */
  function finish() {
    if (isFinished) {
      return;
    }
    cancelPendingFrame();
    isFinished = true;
    isTracking.value = false;
    hasObservedDrawing = true;
    renderedPointCount = points.length;
    curvePoints.value = points.length < 2 ? "" : formatSvgPolylinePointRange(points, 0, points.length);
  }

  /** Clears an abandoned observation only when no later shot has replaced it. */
  function clearIdentity(expectedIdentity: GraphwarAgentFunctionDrawIdentity) {
    if (hasMatchingIdentity(expectedIdentity)) {
      clear();
    }
  }

  /** Compares opaque v3 identities without deriving lifecycle from mutable page state. */
  function hasMatchingIdentity(expectedIdentity: GraphwarAgentFunctionDrawIdentity) {
    return (
      identity?.gameInstanceId === expectedIdentity.gameInstanceId && identity.turnToken === expectedIdentity.turnToken
    );
  }

  /** Releases the current frame before removing all playback state. */
  function clear() {
    cancelPendingFrame();
    anchorMonotonicMs = 0;
    anchorStep = 0;
    curvePoints.value = undefined;
    isFinished = false;
    hasObservedDrawing = false;
    identity = undefined;
    isTracking.value = false;
    observationOrder.clear();
    points = [];
    renderedPointCount = 0;
    stepsPerSecond = 0;
  }

  /** Cancels the one scheduled frame without assuming browser globals exist in tests. */
  function cancelPendingFrame() {
    if (frame === undefined) {
      return;
    }
    cancelFrame(frame);
    frame = undefined;
  }

  return {
    arm,
    attachTrajectory,
    clear,
    clearIdentity,
    curvePoints: readonly(curvePoints),
    isTracking: readonly(isTracking),
    update,
  };
}
