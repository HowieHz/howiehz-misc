/** Slowest allowed speed multiplier. */
export const SPEED_MIN = 0.25;
/** Fastest allowed speed multiplier. */
export const SPEED_MAX = 3;
/** Default speed multiplier. */
export const DEFAULT_SPEED = 1;

/** Clamp a speed multiplier into the allowed range. */
export function clampSpeed(speed: number): number {
  return Math.min(Math.max(speed, SPEED_MIN), SPEED_MAX);
}

/** Effective tempo after applying the speed multiplier. */
export function effectiveBpm(baseBpm: number, speed: number): number {
  return baseBpm * speed;
}

/** Wall-clock time (seconds from play start) at which a note at `noteTime` should be hit. */
export function noteWallTime(noteTime: number, speed: number): number {
  return noteTime / speed;
}
