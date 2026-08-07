import {
  addQuantizedDecimalUnits,
  createSignedLimbState,
  getDecimalAccumulatorLimbCapacity,
  quantizeFormulaCoefficient,
  resetSignedLimbState,
  roundFormulaDecimal,
  signedLimbToF64,
} from "../core/decimal";
import {
  createSignedLimbStateFromMagnitude,
  getSignedLimbStateCount,
  getSignedLimbStatePointer,
  getSignedLimbStateSign,
} from "../core/limb-integer";
import { FORMULA_EQUATION_DY, FORMULA_EQUATION_Y } from "./layout";
import { reserveArena } from "../core/memory";

const STEP_RESOLUTION_ORIGIN_Y_OFFSET: u32 = 0;
const STEP_RESOLUTION_RESOLVED_Y_OFFSET: u32 = 8;
const STEP_RESOLUTION_FORMULA_STEEPNESS_OFFSET: u32 = 16;
const STEP_RESOLUTION_SCALE_OFFSET: u32 = 24;
const STEP_RESOLUTION_LIMB_STATE_POINTER_OFFSET: u32 = 32;
const STEP_RESOLUTION_HAS_EXACT_PLATEAU_OFFSET: u32 = 36;
const STEP_RESOLUTION_BYTE_LENGTH: u32 = 40;

export const STEP_TRANSITION_ACTIVE_COEFFICIENT_OFFSET: u32 = 0;
export const STEP_TRANSITION_EFFECTIVE_DELTA_Y_OFFSET: u32 = 8;
export const STEP_TRANSITION_RESOLVED_START_Y_OFFSET: u32 = 16;
export const STEP_TRANSITION_RESOLVED_END_Y_OFFSET: u32 = 24;
export const STEP_TRANSITION_Y_COEFFICIENT_OFFSET: u32 = 32;
export const STEP_TRANSITION_FIRST_COEFFICIENT_OFFSET: u32 = 40;
export const STEP_TRANSITION_SECOND_COEFFICIENT_OFFSET: u32 = 48;
export const STEP_TRANSITION_IS_VALID_OFFSET: u32 = 56;
export const STEP_TRANSITION_BYTE_LENGTH: u32 = 64;

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

@inline
function getEquationScale(equation: i32, steepness: f64): f64 {
  return equation == FORMULA_EQUATION_Y
    ? 1
    : equation == FORMULA_EQUATION_DY
      ? steepness
      : NativeMath.pow(steepness, 2);
}

/** Creates the single canonical Step plateau state shared by material building and launch-point adjustment. */
export function createStepFormulaResolution(
  rawSteepness: f64,
  decimalPlaces: i32,
  equation: i32,
  baseY: f64,
  segmentCount: u32,
): u32 {
  const formulaSteepness = roundFormulaDecimal(rawSteepness, decimalPlaces);
  const statePointer = reserveArena(STEP_RESOLUTION_BYTE_LENGTH, sizeof<f64>());
  store<f64>(statePointer + STEP_RESOLUTION_ORIGIN_Y_OFFSET, baseY);
  store<f64>(statePointer + STEP_RESOLUTION_RESOLVED_Y_OFFSET, baseY);
  store<f64>(statePointer + STEP_RESOLUTION_FORMULA_STEEPNESS_OFFSET, formulaSteepness);
  store<f64>(statePointer + STEP_RESOLUTION_SCALE_OFFSET, getEquationScale(equation, formulaSteepness));
  store<u32>(
    statePointer + STEP_RESOLUTION_LIMB_STATE_POINTER_OFFSET,
    createSignedLimbState(getDecimalAccumulatorLimbCapacity(decimalPlaces, segmentCount)),
  );
  store<u32>(statePointer + STEP_RESOLUTION_HAS_EXACT_PLATEAU_OFFSET, 1);
  return statePointer;
}

/** Restores the atomic canonical plateau state used by stateful Step routing. */
export function createStepFormulaResolutionFromPlateauState(
  formulaSteepness: f64,
  decimalPlaces: i32,
  equation: i32,
  originY: f64,
  resolvedY: f64,
  sign: i32,
  limbPointer: u32,
  limbCount: u32,
): u32 {
  const statePointer = reserveArena(STEP_RESOLUTION_BYTE_LENGTH, sizeof<f64>());
  store<f64>(statePointer + STEP_RESOLUTION_ORIGIN_Y_OFFSET, originY);
  store<f64>(statePointer + STEP_RESOLUTION_RESOLVED_Y_OFFSET, resolvedY);
  store<f64>(statePointer + STEP_RESOLUTION_FORMULA_STEEPNESS_OFFSET, formulaSteepness);
  store<f64>(statePointer + STEP_RESOLUTION_SCALE_OFFSET, getEquationScale(equation, formulaSteepness));
  const minimumCapacity = getDecimalAccumulatorLimbCapacity(decimalPlaces, 1);
  if (limbCount == u32.MAX_VALUE) {
    unreachable();
  }
  const capacity = limbCount >= minimumCapacity ? limbCount + 1 : minimumCapacity;
  store<u32>(
    statePointer + STEP_RESOLUTION_LIMB_STATE_POINTER_OFFSET,
    createSignedLimbStateFromMagnitude(sign, limbPointer, limbCount, capacity),
  );
  store<u32>(statePointer + STEP_RESOLUTION_HAS_EXACT_PLATEAU_OFFSET, 1);
  return statePointer;
}

@inline
export function getStepFormulaResolutionStateSign(statePointer: u32): i32 {
  return getSignedLimbStateSign(load<u32>(statePointer + STEP_RESOLUTION_LIMB_STATE_POINTER_OFFSET));
}

@inline
export function getStepFormulaResolutionStateCount(statePointer: u32): u32 {
  return getSignedLimbStateCount(load<u32>(statePointer + STEP_RESOLUTION_LIMB_STATE_POINTER_OFFSET));
}

@inline
export function getStepFormulaResolutionStatePointer(statePointer: u32): u32 {
  return getSignedLimbStatePointer(load<u32>(statePointer + STEP_RESOLUTION_LIMB_STATE_POINTER_OFFSET));
}

@inline
export function getStepFormulaResolutionSteepness(statePointer: u32): f64 {
  return load<f64>(statePointer + STEP_RESOLUTION_FORMULA_STEEPNESS_OFFSET);
}

/** Resolves one transition and advances the exact decimal plateau state without exposing parallel half-state fields. */
export function resolveStepFormulaTransition(
  statePointer: u32,
  targetY: f64,
  deltaYOverride: f64,
  hasDeltaYOverride: bool,
  decimalPlaces: i32,
  equation: i32,
  transitionPointer: u32,
): void {
  const formulaSteepness = load<f64>(statePointer + STEP_RESOLUTION_FORMULA_STEEPNESS_OFFSET);
  const scale = load<f64>(statePointer + STEP_RESOLUTION_SCALE_OFFSET);
  const limbStatePointer = load<u32>(statePointer + STEP_RESOLUTION_LIMB_STATE_POINTER_OFFSET);
  if (hasDeltaYOverride) {
    const originY = targetY - deltaYOverride;
    store<f64>(statePointer + STEP_RESOLUTION_ORIGIN_Y_OFFSET, originY);
    store<f64>(statePointer + STEP_RESOLUTION_RESOLVED_Y_OFFSET, originY);
    store<u32>(statePointer + STEP_RESOLUTION_HAS_EXACT_PLATEAU_OFFSET, 1);
    resetSignedLimbState(limbStatePointer);
  }

  let hasExactPlateau = load<u32>(statePointer + STEP_RESOLUTION_HAS_EXACT_PLATEAU_OFFSET) != 0;
  const plateauOriginY = load<f64>(statePointer + STEP_RESOLUTION_ORIGIN_Y_OFFSET);
  const resolvedStartY = hasExactPlateau
    ? plateauOriginY + signedLimbToF64(limbStatePointer) / NativeMath.pow(10, decimalPlaces) / scale
    : load<f64>(statePointer + STEP_RESOLUTION_RESOLVED_Y_OFFSET);
  const wantedDeltaY = targetY - resolvedStartY;
  const activeCoefficient = quantizeFormulaCoefficient(wantedDeltaY * scale, decimalPlaces);
  const hasUsableScale =
    isFiniteValue(resolvedStartY) &&
    isFiniteValue(targetY) &&
    isFiniteValue(formulaSteepness) &&
    formulaSteepness > 0 &&
    isFiniteValue(scale) &&
    scale != 0 &&
    isFiniteValue(activeCoefficient);
  const hasZeroSteepness =
    formulaSteepness == 0 &&
    isFiniteValue(resolvedStartY) &&
    isFiniteValue(targetY) &&
    isFiniteValue(activeCoefficient);
  const effectiveDeltaY = hasUsableScale ? activeCoefficient / scale : hasZeroSteepness ? 0 : f64.NaN;
  const isValid = hasUsableScale && isFiniteValue(effectiveDeltaY);
  let resolvedEndY = resolvedStartY + effectiveDeltaY;
  if (hasExactPlateau && isValid) {
    addQuantizedDecimalUnits(limbStatePointer, activeCoefficient, decimalPlaces);
    resolvedEndY = plateauOriginY + signedLimbToF64(limbStatePointer) / NativeMath.pow(10, decimalPlaces) / scale;
  } else {
    hasExactPlateau = false;
  }
  store<f64>(statePointer + STEP_RESOLUTION_RESOLVED_Y_OFFSET, resolvedEndY);
  store<u32>(statePointer + STEP_RESOLUTION_HAS_EXACT_PLATEAU_OFFSET, hasExactPlateau ? 1 : 0);

  let yCoefficient: f64;
  let firstCoefficient: f64;
  let secondCoefficient: f64;
  if (equation == FORMULA_EQUATION_Y) {
    yCoefficient = activeCoefficient;
    firstCoefficient = activeCoefficient * formulaSteepness;
    secondCoefficient = firstCoefficient * formulaSteepness;
  } else if (equation == FORMULA_EQUATION_DY) {
    firstCoefficient = activeCoefficient;
    yCoefficient = formulaSteepness == 0 ? 0 : activeCoefficient / formulaSteepness;
    secondCoefficient = activeCoefficient * formulaSteepness;
  } else {
    secondCoefficient = activeCoefficient;
    firstCoefficient = formulaSteepness == 0 ? 0 : activeCoefficient / formulaSteepness;
    yCoefficient = formulaSteepness == 0 ? 0 : firstCoefficient / formulaSteepness;
  }

  store<f64>(transitionPointer + STEP_TRANSITION_ACTIVE_COEFFICIENT_OFFSET, activeCoefficient);
  store<f64>(transitionPointer + STEP_TRANSITION_EFFECTIVE_DELTA_Y_OFFSET, effectiveDeltaY);
  store<f64>(transitionPointer + STEP_TRANSITION_RESOLVED_START_Y_OFFSET, resolvedStartY);
  store<f64>(transitionPointer + STEP_TRANSITION_RESOLVED_END_Y_OFFSET, resolvedEndY);
  store<f64>(transitionPointer + STEP_TRANSITION_Y_COEFFICIENT_OFFSET, yCoefficient);
  store<f64>(transitionPointer + STEP_TRANSITION_FIRST_COEFFICIENT_OFFSET, firstCoefficient);
  store<f64>(transitionPointer + STEP_TRANSITION_SECOND_COEFFICIENT_OFFSET, secondCoefficient);
  store<u32>(transitionPointer + STEP_TRANSITION_IS_VALID_OFFSET, isValid ? 1 : 0);
}
