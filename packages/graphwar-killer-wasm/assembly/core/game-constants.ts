import { requireArenaRange } from "./memory";

/** Fixed `createGraphwarGameConstantData()` layout shared with the TypeScript Adapter. */
const GRAPHWAR_GAME_CONSTANT_COUNT: u32 = 11;

let isGraphwarGameConstantDataInitialized = false;
let graphwarPlaneLength = 0.0;
let graphwarPlaneHeight = 0.0;
let graphwarPlaneGameLength = 0.0;
let graphwarSoldierRadius = 0.0;
let graphwarSoldierSelectionRadius = 0.0;
let graphwarStepSize = 0.0;
let graphwarFuncMaxSteps: u32 = 0;
let graphwarFuncMaxStepDistanceSquared = 0.0;
let graphwarFuncMinXStepDistance = 0.0;
let graphwarAngleError = 0.0;
let graphwarMaxAngleLoops: u32 = 0;
let graphwarGameSoldierRadius = 0.0;

@inline
function trap(): void {
  unreachable();
}

@inline
function isFiniteValue(value: f64): bool {
  return value == value && value != f64.POSITIVE_INFINITY && value != f64.NEGATIVE_INFINITY;
}

@inline
function isPositiveFiniteValue(value: f64): bool {
  return isFiniteValue(value) && value > 0;
}

@inline
function isPositiveU32Value(value: f64): bool {
  return isPositiveFiniteValue(value) && value <= 0xffff_ffff && NativeMath.floor(value) == value;
}

/** Mirrors the Adapter's byte-level FNV-1a handshake without allocating a managed buffer. */
function calculateGraphwarGameConstantAcknowledgment(pointer: u32): i32 {
  let hash: u32 = 0x811c9dc5;
  let offset: u32 = 0;
  const byteLength = GRAPHWAR_GAME_CONSTANT_COUNT * sizeof<f64>();
  while (offset < byteLength) {
    hash = (hash ^ <u32>load<u8>(pointer + offset)) * <u32>0x01000193;
    offset += 1;
  }
  return <i32>hash;
}

/**
 * Validates and snapshots the canonical TypeScript game constants exactly once.
 *
 * Every candidate stays local until the full record is valid, so a rejected boundary cannot leave partially
 * initialized globals. The stub runtime receives only scalar loads/stores and performs no managed allocation.
 */
export function initializeGraphwarGameConstants(pointer: u32, count: u32): i32 {
  if (isGraphwarGameConstantDataInitialized || count != GRAPHWAR_GAME_CONSTANT_COUNT) {
    trap();
  }
  requireArenaRange(pointer, GRAPHWAR_GAME_CONSTANT_COUNT * sizeof<f64>(), sizeof<f64>());

  const planeLength = load<f64>(pointer);
  const planeHeight = load<f64>(pointer + sizeof<f64>());
  const planeGameLength = load<f64>(pointer + 2 * sizeof<f64>());
  const soldierRadius = load<f64>(pointer + 3 * sizeof<f64>());
  const soldierSelectionRadius = load<f64>(pointer + 4 * sizeof<f64>());
  const stepSize = load<f64>(pointer + 5 * sizeof<f64>());
  const funcMaxSteps = load<f64>(pointer + 6 * sizeof<f64>());
  const funcMaxStepDistanceSquared = load<f64>(pointer + 7 * sizeof<f64>());
  const funcMinXStepDistance = load<f64>(pointer + 8 * sizeof<f64>());
  const angleError = load<f64>(pointer + 9 * sizeof<f64>());
  const maxAngleLoops = load<f64>(pointer + 10 * sizeof<f64>());
  const gameSoldierRadius = (soldierRadius * planeGameLength) / planeLength;

  if (
    !isPositiveU32Value(planeLength) ||
    !isPositiveU32Value(planeHeight) ||
    !isPositiveFiniteValue(planeGameLength) ||
    !isPositiveFiniteValue(soldierRadius) ||
    !isPositiveFiniteValue(soldierSelectionRadius) ||
    soldierRadius > soldierSelectionRadius ||
    !isPositiveFiniteValue(stepSize) ||
    !isPositiveU32Value(funcMaxSteps) ||
    !isPositiveFiniteValue(funcMaxStepDistanceSquared) ||
    !isPositiveFiniteValue(funcMinXStepDistance) ||
    funcMinXStepDistance > stepSize ||
    !isPositiveFiniteValue(angleError) ||
    angleError > NativeMath.PI ||
    !isPositiveU32Value(maxAngleLoops) ||
    !isPositiveFiniteValue(gameSoldierRadius)
  ) {
    trap();
  }

  const acknowledgment = calculateGraphwarGameConstantAcknowledgment(pointer);

  graphwarPlaneLength = planeLength;
  graphwarPlaneHeight = planeHeight;
  graphwarPlaneGameLength = planeGameLength;
  graphwarSoldierRadius = soldierRadius;
  graphwarSoldierSelectionRadius = soldierSelectionRadius;
  graphwarStepSize = stepSize;
  graphwarFuncMaxSteps = <u32>funcMaxSteps;
  graphwarFuncMaxStepDistanceSquared = funcMaxStepDistanceSquared;
  graphwarFuncMinXStepDistance = funcMinXStepDistance;
  graphwarAngleError = angleError;
  graphwarMaxAngleLoops = <u32>maxAngleLoops;
  graphwarGameSoldierRadius = gameSoldierRadius;
  isGraphwarGameConstantDataInitialized = true;
  return acknowledgment;
}

/** Algorithm commands reject direct use before the Adapter has installed the canonical snapshot. */
export function requireGraphwarGameConstantsInitialized(): void {
  if (!isGraphwarGameConstantDataInitialized) {
    trap();
  }
}

@inline
export function getGraphwarPlaneLength(): f64 {
  return graphwarPlaneLength;
}

@inline
export function getGraphwarPlaneHeight(): f64 {
  return graphwarPlaneHeight;
}

@inline
export function getGraphwarPlaneGameLength(): f64 {
  return graphwarPlaneGameLength;
}

@inline
export function getGraphwarSoldierRadius(): f64 {
  return graphwarSoldierRadius;
}

@inline
export function getGraphwarSoldierSelectionRadius(): f64 {
  return graphwarSoldierSelectionRadius;
}

@inline
export function getGraphwarStepSize(): f64 {
  return graphwarStepSize;
}

@inline
export function getGraphwarFuncMaxSteps(): u32 {
  return graphwarFuncMaxSteps;
}

@inline
export function getGraphwarFuncMaxStepDistanceSquared(): f64 {
  return graphwarFuncMaxStepDistanceSquared;
}

@inline
export function getGraphwarFuncMinXStepDistance(): f64 {
  return graphwarFuncMinXStepDistance;
}

@inline
export function getGraphwarAngleError(): f64 {
  return graphwarAngleError;
}

@inline
export function getGraphwarMaxAngleLoops(): u32 {
  return graphwarMaxAngleLoops;
}

@inline
export function getGraphwarGameSoldierRadius(): f64 {
  return graphwarGameSoldierRadius;
}
