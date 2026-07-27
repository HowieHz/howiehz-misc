import { requireArenaRange, reserveArena } from "./memory";

/**
 * Raw signed-limb state layout. Magnitudes use canonical little-endian base-2^32 limbs.
 * Callers choose a capacity from their job bounds; arithmetic traps instead of truncating it.
 */
const SIGNED_LIMB_STATE_SIGN_OFFSET: u32 = 0;
const SIGNED_LIMB_STATE_COUNT_OFFSET: u32 = 4;
const SIGNED_LIMB_STATE_CAPACITY_OFFSET: u32 = 8;
const SIGNED_LIMB_STATE_POINTER_OFFSET: u32 = 12;
const SIGNED_LIMB_STATE_BYTE_LENGTH: u32 = 16;
const LIMB_BYTE_LENGTH: u32 = sizeof<u32>();
const F64_SIGN_MASK: u64 = 0x8000_0000_0000_0000;
const F64_FRACTION_MASK: u64 = 0x000f_ffff_ffff_ffff;
const F64_POSITIVE_INFINITY_BITS: u64 = 0x7ff0_0000_0000_0000;
const F64_INTEGER_SIGNIFICAND_LIMIT: u64 = 0x0020_0000_0000_0000;

@inline
function trap(): void {
  unreachable();
}

@inline
function requireCanonicalSign(sign: i32, count: u32): void {
  if ((count == 0 && sign != 0) || (count != 0 && sign != -1 && sign != 1)) {
    trap();
  }
}

@inline
function checkedLimbByteLength(count: u32): u32 {
  const byteLength = <u64>count * LIMB_BYTE_LENGTH;
  if (byteLength > 0xffff_ffff) {
    trap();
  }
  return <u32>byteLength;
}

@inline
function requireLimbRange(pointer: u32, count: u32): void {
  requireArenaRange(count == 0 ? 0 : pointer, checkedLimbByteLength(count), LIMB_BYTE_LENGTH);
}

/** Removes high zero limbs and returns the canonical magnitude length. */
export function normalizeSignedLimbCount(pointer: u32, count: u32): u32 {
  requireLimbRange(pointer, count);
  while (count != 0 && load<u32>(pointer + (count - 1) * LIMB_BYTE_LENGTH) == 0) {
    count -= 1;
  }
  return count;
}

/** Compares two unsigned limb magnitudes and returns -1, 0, or 1. */
export function compareSignedLimbMagnitudes(
  leftPointer: u32,
  leftCount: u32,
  rightPointer: u32,
  rightCount: u32,
): i32 {
  leftCount = normalizeSignedLimbCount(leftPointer, leftCount);
  rightCount = normalizeSignedLimbCount(rightPointer, rightCount);
  if (leftCount != rightCount) {
    return leftCount < rightCount ? -1 : 1;
  }
  while (leftCount != 0) {
    const index = leftCount - 1;
    const left = load<u32>(leftPointer + index * LIMB_BYTE_LENGTH);
    const right = load<u32>(rightPointer + index * LIMB_BYTE_LENGTH);
    if (left != right) {
      return left < right ? -1 : 1;
    }
    leftCount = index;
  }
  return 0;
}

function addMagnitudes(
  leftPointer: u32,
  leftCount: u32,
  rightPointer: u32,
  rightCount: u32,
  resultPointer: u32,
  resultCapacity: u32,
): u32 {
  const maximumCount = leftCount > rightCount ? leftCount : rightCount;
  if (resultCapacity < maximumCount) {
    trap();
  }

  let carry: u64 = 0;
  let index: u32 = 0;
  while (index < maximumCount) {
    const left = index < leftCount ? <u64>load<u32>(leftPointer + index * LIMB_BYTE_LENGTH) : 0;
    const right = index < rightCount ? <u64>load<u32>(rightPointer + index * LIMB_BYTE_LENGTH) : 0;
    const sum = left + right + carry;
    store<u32>(resultPointer + index * LIMB_BYTE_LENGTH, <u32>sum);
    carry = sum >> 32;
    index += 1;
  }
  if (carry != 0) {
    if (index == resultCapacity) {
      trap();
    }
    store<u32>(resultPointer + index * LIMB_BYTE_LENGTH, <u32>carry);
    index += 1;
  }
  return index;
}

/** Subtracts right from left. The caller proves left is not smaller than right. */
function subtractMagnitudes(
  leftPointer: u32,
  leftCount: u32,
  rightPointer: u32,
  rightCount: u32,
  resultPointer: u32,
  resultCapacity: u32,
): u32 {
  if (resultCapacity < leftCount) {
    trap();
  }
  let borrow: u64 = 0;
  let index: u32 = 0;
  while (index < leftCount) {
    const left = <u64>load<u32>(leftPointer + index * LIMB_BYTE_LENGTH);
    const right = index < rightCount ? <u64>load<u32>(rightPointer + index * LIMB_BYTE_LENGTH) : 0;
    const subtrahend = right + borrow;
    store<u32>(resultPointer + index * LIMB_BYTE_LENGTH, <u32>(left - subtrahend));
    borrow = left < subtrahend ? 1 : 0;
    index += 1;
  }
  if (borrow != 0) {
    trap();
  }
  while (index != 0 && load<u32>(resultPointer + (index - 1) * LIMB_BYTE_LENGTH) == 0) {
    index -= 1;
  }
  return index;
}

/**
 * Adds two canonical signed values into distinct caller-provided storage.
 * The returned value is the result limb count; the canonical sign is stored at resultSignPointer.
 */
export function addSignedLimbs(
  leftSign: i32,
  leftPointer: u32,
  leftCount: u32,
  rightSign: i32,
  rightPointer: u32,
  rightCount: u32,
  resultSignPointer: u32,
  resultPointer: u32,
  resultCapacity: u32,
): u32 {
  leftCount = normalizeSignedLimbCount(leftPointer, leftCount);
  rightCount = normalizeSignedLimbCount(rightPointer, rightCount);
  requireCanonicalSign(leftSign, leftCount);
  requireCanonicalSign(rightSign, rightCount);
  requireArenaRange(resultSignPointer, sizeof<i32>(), sizeof<i32>());
  requireLimbRange(resultPointer, resultCapacity);

  let resultSign: i32 = 0;
  let resultCount: u32 = 0;
  if (leftCount == 0) {
    if (resultCapacity < rightCount) {
      trap();
    }
    memory.copy(resultPointer, rightPointer, checkedLimbByteLength(rightCount));
    resultSign = rightSign;
    resultCount = rightCount;
  } else if (rightCount == 0) {
    if (resultCapacity < leftCount) {
      trap();
    }
    memory.copy(resultPointer, leftPointer, checkedLimbByteLength(leftCount));
    resultSign = leftSign;
    resultCount = leftCount;
  } else if (leftSign == rightSign) {
    resultCount = addMagnitudes(leftPointer, leftCount, rightPointer, rightCount, resultPointer, resultCapacity);
    resultSign = leftSign;
  } else {
    const comparison = compareSignedLimbMagnitudes(leftPointer, leftCount, rightPointer, rightCount);
    if (comparison > 0) {
      resultCount = subtractMagnitudes(
        leftPointer,
        leftCount,
        rightPointer,
        rightCount,
        resultPointer,
        resultCapacity,
      );
      resultSign = resultCount == 0 ? 0 : leftSign;
    } else if (comparison < 0) {
      resultCount = subtractMagnitudes(
        rightPointer,
        rightCount,
        leftPointer,
        leftCount,
        resultPointer,
        resultCapacity,
      );
      resultSign = resultCount == 0 ? 0 : rightSign;
    }
  }
  store<i32>(resultSignPointer, resultSign);
  return resultCount;
}

@inline
function requireSignedLimbState(statePointer: u32): void {
  requireArenaRange(statePointer, SIGNED_LIMB_STATE_BYTE_LENGTH, sizeof<u32>());
  const sign = load<i32>(statePointer + SIGNED_LIMB_STATE_SIGN_OFFSET);
  const count = load<u32>(statePointer + SIGNED_LIMB_STATE_COUNT_OFFSET);
  const capacity = load<u32>(statePointer + SIGNED_LIMB_STATE_CAPACITY_OFFSET);
  const limbPointer = load<u32>(statePointer + SIGNED_LIMB_STATE_POINTER_OFFSET);
  if (capacity == 0 || count > capacity) {
    trap();
  }
  requireLimbRange(limbPointer, capacity);
  const normalizedCount = normalizeSignedLimbCount(limbPointer, count);
  if (normalizedCount != count) {
    trap();
  }
  requireCanonicalSign(sign, count);
}

/** Allocates a reusable canonical zero state with caller-derived limb capacity. */
export function createSignedLimbState(limbCapacity: u32): u32 {
  if (limbCapacity == 0) {
    trap();
  }
  const limbPointer = reserveArena(checkedLimbByteLength(limbCapacity), LIMB_BYTE_LENGTH);
  memory.fill(limbPointer, 0, checkedLimbByteLength(limbCapacity));
  const statePointer = reserveArena(SIGNED_LIMB_STATE_BYTE_LENGTH, sizeof<u32>());
  store<i32>(statePointer + SIGNED_LIMB_STATE_SIGN_OFFSET, 0);
  store<u32>(statePointer + SIGNED_LIMB_STATE_COUNT_OFFSET, 0);
  store<u32>(statePointer + SIGNED_LIMB_STATE_CAPACITY_OFFSET, limbCapacity);
  store<u32>(statePointer + SIGNED_LIMB_STATE_POINTER_OFFSET, limbPointer);
  return statePointer;
}

/** Clears a state while retaining its bounded storage for a new Step plateau origin. */
export function resetSignedLimbState(statePointer: u32): void {
  requireSignedLimbState(statePointer);
  const count = load<u32>(statePointer + SIGNED_LIMB_STATE_COUNT_OFFSET);
  const limbPointer = load<u32>(statePointer + SIGNED_LIMB_STATE_POINTER_OFFSET);
  memory.fill(limbPointer, 0, checkedLimbByteLength(count));
  store<i32>(statePointer + SIGNED_LIMB_STATE_SIGN_OFFSET, 0);
  store<u32>(statePointer + SIGNED_LIMB_STATE_COUNT_OFFSET, 0);
}

/** Adds a separate signed magnitude into a reusable state without narrowing through i64 or f64. */
export function addSignedMagnitudeToState(
  statePointer: u32,
  valueSign: i32,
  valuePointer: u32,
  valueCount: u32,
): void {
  requireSignedLimbState(statePointer);
  valueCount = normalizeSignedLimbCount(valuePointer, valueCount);
  requireCanonicalSign(valueSign, valueCount);

  const oldSign = load<i32>(statePointer + SIGNED_LIMB_STATE_SIGN_OFFSET);
  const oldCount = load<u32>(statePointer + SIGNED_LIMB_STATE_COUNT_OFFSET);
  const capacity = load<u32>(statePointer + SIGNED_LIMB_STATE_CAPACITY_OFFSET);
  const limbPointer = load<u32>(statePointer + SIGNED_LIMB_STATE_POINTER_OFFSET);
  let resultSign = oldSign;
  let resultCount = oldCount;
  if (valueCount == 0) {
    return;
  }
  if (oldCount == 0) {
    if (capacity < valueCount) {
      trap();
    }
    memory.copy(limbPointer, valuePointer, checkedLimbByteLength(valueCount));
    resultSign = valueSign;
    resultCount = valueCount;
  } else if (oldSign == valueSign) {
    resultCount = addMagnitudes(limbPointer, oldCount, valuePointer, valueCount, limbPointer, capacity);
  } else {
    const comparison = compareSignedLimbMagnitudes(limbPointer, oldCount, valuePointer, valueCount);
    if (comparison > 0) {
      resultCount = subtractMagnitudes(limbPointer, oldCount, valuePointer, valueCount, limbPointer, capacity);
    } else if (comparison < 0) {
      resultCount = subtractMagnitudes(valuePointer, valueCount, limbPointer, oldCount, limbPointer, capacity);
      resultSign = valueSign;
    } else {
      resultCount = 0;
      resultSign = 0;
    }
  }
  if (resultCount < oldCount) {
    memory.fill(limbPointer + resultCount * LIMB_BYTE_LENGTH, 0, (oldCount - resultCount) * LIMB_BYTE_LENGTH);
  }
  store<i32>(statePointer + SIGNED_LIMB_STATE_SIGN_OFFSET, resultSign);
  store<u32>(statePointer + SIGNED_LIMB_STATE_COUNT_OFFSET, resultCount);
}

@inline
function magnitudeBitLength(pointer: u32, count: u32): u32 {
  const high = load<u32>(pointer + (count - 1) * LIMB_BYTE_LENGTH);
  return (count - 1) * 32 + (32 - <u32>clz<u32>(high));
}

@inline
function magnitudeBit(pointer: u32, bitIndex: u32): u32 {
  return (load<u32>(pointer + (bitIndex >> 5) * LIMB_BYTE_LENGTH) >> (bitIndex & 31)) & 1;
}

function hasMagnitudeBitsBelow(pointer: u32, bitCount: u32): bool {
  const wholeLimbCount = bitCount >> 5;
  let index: u32 = 0;
  while (index < wholeLimbCount) {
    if (load<u32>(pointer + index * LIMB_BYTE_LENGTH) != 0) {
      return true;
    }
    index += 1;
  }
  const remainingBits = bitCount & 31;
  if (remainingBits == 0) {
    return false;
  }
  const mask = (<u32>1 << remainingBits) - 1;
  return (load<u32>(pointer + wholeLimbCount * LIMB_BYTE_LENGTH) & mask) != 0;
}

/** Converts a canonical signed integer exactly as ECMAScript Number(bigint), including ties-to-even. */
export function signedLimbMagnitudeToF64(sign: i32, pointer: u32, count: u32): f64 {
  count = normalizeSignedLimbCount(pointer, count);
  requireCanonicalSign(sign, count);
  if (count == 0) {
    return 0;
  }

  const bitLength = magnitudeBitLength(pointer, count);
  if (bitLength <= 53) {
    let magnitude = <u64>load<u32>(pointer);
    if (count > 1) {
      magnitude |= <u64>load<u32>(pointer + LIMB_BYTE_LENGTH) << 32;
    }
    const value = <f64>magnitude;
    return sign < 0 ? -value : value;
  }

  let significand: u64 = 0;
  let bitOffset: u32 = 0;
  while (bitOffset < 53) {
    significand = (significand << 1) | magnitudeBit(pointer, bitLength - 1 - bitOffset);
    bitOffset += 1;
  }
  const discardedBitCount = bitLength - 53;
  const halfwayBit = magnitudeBit(pointer, discardedBitCount - 1);
  const hasLowerBits = hasMagnitudeBitsBelow(pointer, discardedBitCount - 1);
  if (halfwayBit != 0 && (hasLowerBits || (significand & 1) != 0)) {
    significand += 1;
  }

  let exponent = bitLength - 1;
  if (significand == F64_INTEGER_SIGNIFICAND_LIMIT) {
    significand >>= 1;
    exponent += 1;
  }
  if (exponent > 1023) {
    return reinterpret<f64>((sign < 0 ? F64_SIGN_MASK : 0) | F64_POSITIVE_INFINITY_BITS);
  }
  const bits =
    (sign < 0 ? F64_SIGN_MASK : 0) |
    (<u64>(exponent + 1023) << 52) |
    (significand & F64_FRACTION_MASK);
  return reinterpret<f64>(bits);
}

/** Converts a validated reusable state with ECMAScript BigInt-to-Number semantics. */
export function signedLimbToF64(statePointer: u32): f64 {
  requireSignedLimbState(statePointer);
  return signedLimbMagnitudeToF64(
    load<i32>(statePointer + SIGNED_LIMB_STATE_SIGN_OFFSET),
    load<u32>(statePointer + SIGNED_LIMB_STATE_POINTER_OFFSET),
    load<u32>(statePointer + SIGNED_LIMB_STATE_COUNT_OFFSET),
  );
}
