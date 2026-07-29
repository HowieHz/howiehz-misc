const MEMORY_PAGE_SIZE: u64 = 65_536;
const MAX_I32: u64 = 0x7fff_ffff;
const MAX_U32: u64 = 0xffff_ffff;

const ARENA_STATE_UNINITIALIZED: i32 = 0;
const ARENA_STATE_INITIALIZING: i32 = 1;
const ARENA_STATE_INITIALIZED: i32 = 2;

const RUNTIME_BLOCK_OVERHEAD: u32 = sizeof<u32>();
const RUNTIME_GUARD_ALLOCATION_SIZE: u32 = 16;
const RUNTIME_GUARD_SIZE: u32 = 16;
const RUNTIME_GUARD_CANARY_A: u64 = 0x4752_4150_4857_4152;
const RUNTIME_GUARD_CANARY_B: u64 = 0x4b45_524e_454c_4152;

const MARK_FRAME_SIZE: u32 = 24;
const MARK_MAGIC: u32 = 0x4d41_524b;
const MARK_TOKEN_OFFSET: u32 = 4;
const MARK_PREVIOUS_FRAME_OFFSET: u32 = 8;
const MARK_PREVIOUS_TOKEN_OFFSET: u32 = 12;
const MARK_PREVIOUS_CURSOR_OFFSET: u32 = 16;

let arenaState: i32 = ARENA_STATE_UNINITIALIZED;
let runtimeGuardBase: u32 = 0;
let arenaBase: u32 = 0;
let arenaCursor: u32 = 0;
let arenaPeak: u32 = 0;
let arenaCapacity: u32 = 0;
let arenaAllocatorCallCount: u32 = 0;
let arenaMarkFrame: u32 = 0;
let arenaMarkToken: u32 = 0;
let nextArenaMarkToken: u32 = 1;

@inline
function trap(): void {
  unreachable();
}

@inline
function getMemoryEnd(): u64 {
  return <u64>memory.size() * MEMORY_PAGE_SIZE;
}

function ensureMemoryEnd(requiredEnd: u64): u64 {
  let memoryEnd = getMemoryEnd();
  if (requiredEnd > memoryEnd) {
    const pageCount = (requiredEnd - memoryEnd + MEMORY_PAGE_SIZE - 1) / MEMORY_PAGE_SIZE;
    if (pageCount > MAX_I32 || memory.grow(<i32>pageCount) < 0) {
      trap();
    }
    memoryEnd = getMemoryEnd();
    if (requiredEnd > memoryEnd) {
      trap();
    }
  }
  return memoryEnd;
}

@inline
function hasValidRuntimeGuard(): bool {
  return (
    load<u64>(runtimeGuardBase) == RUNTIME_GUARD_CANARY_A &&
    load<u64>(runtimeGuardBase + sizeof<u64>()) == RUNTIME_GUARD_CANARY_B
  );
}

/** Rejects algorithm and arena operations until the Adapter establishes exclusive raw-memory ownership. */
export function requireArenaInitialized(): void {
  if (arenaState != ARENA_STATE_INITIALIZED || !hasValidRuntimeGuard()) {
    trap();
  }
}

/**
 * Permanently consumes initialization and advances the pinned AssemblyScript 0.28.20 stub allocator once.
 * The guard is placed at the stub allocator's next block header, so any later managed allocation corrupts it
 * before it can overlap the raw arena that starts immediately after the guard.
 */
export function initializeArena(initialCapacity: u32): u32 {
  if (arenaState != ARENA_STATE_UNINITIALIZED) {
    trap();
  }
  arenaState = ARENA_STATE_INITIALIZING;
  if (initialCapacity == 0) {
    trap();
  }

  arenaAllocatorCallCount += 1;
  const allocationBase = <u32>heap.alloc(RUNTIME_GUARD_ALLOCATION_SIZE);
  const allocationPayloadSize = load<u32>(allocationBase - RUNTIME_BLOCK_OVERHEAD);
  const guardBase = <u64>allocationBase + allocationPayloadSize;
  const rawBase = guardBase + RUNTIME_GUARD_SIZE;
  const requiredEnd = rawBase + initialCapacity;
  if (rawBase > MAX_U32 || requiredEnd > MAX_U32) {
    trap();
  }

  const memoryEnd = ensureMemoryEnd(requiredEnd);
  if (memoryEnd - rawBase > MAX_U32) {
    trap();
  }

  runtimeGuardBase = <u32>guardBase;
  store<u64>(runtimeGuardBase, RUNTIME_GUARD_CANARY_A);
  store<u64>(runtimeGuardBase + sizeof<u64>(), RUNTIME_GUARD_CANARY_B);
  arenaBase = <u32>rawBase;
  arenaCursor = arenaBase;
  arenaPeak = 0;
  arenaCapacity = <u32>(memoryEnd - rawBase);
  arenaMarkFrame = 0;
  arenaMarkToken = 0;
  nextArenaMarkToken = 1;
  arenaState = ARENA_STATE_INITIALIZED;
  return arenaBase;
}

/** Reserves aligned bytes from the raw arena, growing only WebAssembly linear memory when needed. */
export function reserveArena(byteLength: u32, alignment: u32): u32 {
  requireArenaInitialized();
  if (alignment == 0 || (alignment & (alignment - 1)) != 0) {
    trap();
  }

  const alignmentMask = alignment - 1;
  const alignedCursor = (<u64>arenaCursor + alignmentMask) & ~<u64>alignmentMask;
  const requiredEnd = alignedCursor + byteLength;
  if (requiredEnd > MAX_U32) {
    trap();
  }

  const memoryEnd = ensureMemoryEnd(requiredEnd);
  if (memoryEnd - arenaBase > MAX_U32) {
    trap();
  }
  arenaCapacity = <u32>(memoryEnd - arenaBase);

  const pointer = <u32>alignedCursor;
  arenaCursor = <u32>requiredEnd;
  const usedBytes = arenaCursor - arenaBase;
  if (usedBytes > arenaPeak) {
    arenaPeak = usedBytes;
  }
  return pointer;
}

/** Proves that a raw pointer range belongs to the caller-owned allocated arena prefix. */
export function requireArenaRange(pointer: u32, byteLength: u32, alignment: u32): void {
  requireArenaInitialized();
  if (alignment == 0 || (alignment & (alignment - 1)) != 0 || (pointer & (alignment - 1)) != 0) {
    trap();
  }
  if (byteLength == 0) {
    if (pointer != 0) {
      trap();
    }
    return;
  }
  const end = <u64>pointer + byteLength;
  if (pointer < arenaBase || pointer >= arenaCursor || end > arenaCursor || end > MAX_U32) {
    trap();
  }
}

/** Creates a provenance-bearing LIFO marker and returns its opaque reset token. */
export function markArena(): u32 {
  requireArenaInitialized();
  const token = nextArenaMarkToken;
  if (token == 0) {
    trap();
  }
  nextArenaMarkToken += 1;

  const previousCursor = arenaCursor;
  const frame = reserveArena(MARK_FRAME_SIZE, sizeof<u64>());
  store<u32>(frame, MARK_MAGIC);
  store<u32>(frame + MARK_TOKEN_OFFSET, token);
  store<u32>(frame + MARK_PREVIOUS_FRAME_OFFSET, arenaMarkFrame);
  store<u32>(frame + MARK_PREVIOUS_TOKEN_OFFSET, arenaMarkToken);
  store<u32>(frame + MARK_PREVIOUS_CURSOR_OFFSET, previousCursor);
  arenaMarkFrame = frame;
  arenaMarkToken = token;
  return token;
}

/** Pops one exact LIFO mark, optionally restoring the cursor for a discarded transactional scope. */
function closeArenaMark(markToken: u32, shouldResetCursor: bool): void {
  requireArenaInitialized();
  const frame = arenaMarkFrame;
  if (
    frame == 0 ||
    markToken != arenaMarkToken ||
    load<u32>(frame) != MARK_MAGIC ||
    load<u32>(frame + MARK_TOKEN_OFFSET) != markToken
  ) {
    trap();
  }

  const previousFrame = load<u32>(frame + MARK_PREVIOUS_FRAME_OFFSET);
  const previousToken = load<u32>(frame + MARK_PREVIOUS_TOKEN_OFFSET);
  const previousCursor = load<u32>(frame + MARK_PREVIOUS_CURSOR_OFFSET);
  if (
    previousCursor < arenaBase ||
    previousCursor > frame ||
    (previousFrame == 0 && previousToken != 0) ||
    (previousFrame != 0 && (previousToken == 0 || previousFrame < arenaBase || previousFrame >= frame))
  ) {
    trap();
  }

  memory.fill(frame, 0, MARK_FRAME_SIZE);
  arenaMarkFrame = previousFrame;
  arenaMarkToken = previousToken;
  if (shouldResetCursor) {
    arenaCursor = previousCursor;
  }
}

/** Releases the current nested scope only when the token proves exact LIFO mark ownership. */
export function resetArena(markToken: u32): void {
  closeArenaMark(markToken, true);
}

/**
 * Discards a faulted nested command and every mark it left above the caller-owned root mark.
 * A validation pass proves the target is an ancestor before any arena state is mutated.
 */
export function resetArenaAfterFault(markToken: u32): void {
  requireArenaInitialized();
  let frame = arenaMarkFrame;
  let token = arenaMarkToken;
  let hasTarget = false;
  while (frame != 0) {
    if (token == 0 || load<u32>(frame) != MARK_MAGIC || load<u32>(frame + MARK_TOKEN_OFFSET) != token) trap();
    const previousFrame = load<u32>(frame + MARK_PREVIOUS_FRAME_OFFSET);
    const previousToken = load<u32>(frame + MARK_PREVIOUS_TOKEN_OFFSET);
    const previousCursor = load<u32>(frame + MARK_PREVIOUS_CURSOR_OFFSET);
    if (
      previousCursor < arenaBase ||
      previousCursor > frame ||
      (previousFrame == 0 && previousToken != 0) ||
      (previousFrame != 0 && (previousToken == 0 || previousFrame < arenaBase || previousFrame >= frame))
    ) {
      trap();
    }
    if (token == markToken) {
      hasTarget = true;
      break;
    }
    frame = previousFrame;
    token = previousToken;
  }
  if (!hasTarget) trap();

  while (arenaMarkToken != markToken) {
    closeArenaMark(arenaMarkToken, true);
  }
  closeArenaMark(markToken, true);
}

/** Commits allocations made after the current mark while releasing its LIFO provenance frame. */
export function commitArena(markToken: u32): void {
  closeArenaMark(markToken, false);
}

export function getArenaBase(): u32 {
  requireArenaInitialized();
  return arenaBase;
}

export function getArenaCursor(): u32 {
  requireArenaInitialized();
  return arenaCursor;
}

export function getArenaPeak(): u32 {
  requireArenaInitialized();
  return arenaPeak;
}

export function getArenaCapacity(): u32 {
  requireArenaInitialized();
  return arenaCapacity;
}

export function getArenaAllocatorCallCount(): u32 {
  return arenaAllocatorCallCount;
}

export function getArenaCanaryStatus(): i32 {
  return arenaState == ARENA_STATE_INITIALIZED && hasValidRuntimeGuard() ? 1 : 0;
}
