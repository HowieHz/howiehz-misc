import { requireArenaInitialized } from "./memory";

/** Placeholder for a complete detection command; business behavior arrives in later slices. */
export function beginDetectionTask(): i32 {
  requireArenaInitialized();
  return 0;
}

/** Placeholder for resuming a detection session retained below its arena mark. */
export function resumeDetectionTask(): i32 {
  requireArenaInitialized();
  return 0;
}
