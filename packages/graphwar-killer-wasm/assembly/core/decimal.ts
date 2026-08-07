import {
  DECIMAL_INPUT_BYTE_LENGTH,
  DECIMAL_INPUT_DECIMAL_PLACES_OFFSET,
  DECIMAL_INPUT_VALUE_OFFSET,
  DECIMAL_RESULT_BYTE_LENGTH,
  DECIMAL_RESULT_DECIMAL_PLACES_OFFSET,
  DECIMAL_RESULT_DIGIT_COUNT_OFFSET,
  DECIMAL_RESULT_DIGIT_POINTER_OFFSET,
  DECIMAL_RESULT_LIMB_COUNT_OFFSET,
  DECIMAL_RESULT_LIMB_POINTER_OFFSET,
  DECIMAL_RESULT_ROUNDED_VALUE_OFFSET,
  DECIMAL_RESULT_SIGN_OFFSET,
} from "../formula/layout";
import {
  addSignedMagnitudeToState,
  signedLimbMagnitudeToF64,
} from "./limb-integer";
export {
  createSignedLimbState,
  resetSignedLimbState,
  signedLimbToF64,
} from "./limb-integer";
import {
  markArena,
  requireArenaRange,
  reserveArena,
  resetArena,
} from "./memory";
import { dtoa_buffered, MAX_DOUBLE_LENGTH } from "~lib/util/number";

const LIMB_BYTE_LENGTH: u32 = sizeof<u32>();
const MAX_DECIMAL_PLACES: i32 = 15;
const F64_FRACTION_MASK: u64 = 0x000f_ffff_ffff_ffff;
const F64_EXPONENT_MASK: u64 = 0x7ff0_0000_0000_0000;
const F64_HIDDEN_BIT: u64 = 0x0010_0000_0000_0000;
const F64_SIGN_MASK: u64 = 0x8000_0000_0000_0000;
const F64_POSITIVE_INFINITY_BITS: u64 = 0x7ff0_0000_0000_0000;
const F64_INTEGER_SIGNIFICAND_LIMIT: u64 = 0x0020_0000_0000_0000;
const FIXED_NOTATION_MAGNITUDE_LIMIT: f64 = 1e21;
const ASCII_ZERO: u8 = 48;
const UTF16_PLUS: u16 = 43;
const UTF16_MINUS: u16 = 45;
const UTF16_DOT: u16 = 46;
const UTF16_EXPONENT: u16 = 101;

@inline
function trap(): void {
  unreachable();
}

@inline
function safeDecimalPlaces(decimalPlaces: i32): i32 {
  return decimalPlaces < 0 ? 0 : decimalPlaces > MAX_DECIMAL_PLACES ? MAX_DECIMAL_PLACES : decimalPlaces;
}

@inline
function decimalScale(decimalPlaces: i32): f64 {
  let scale: f64 = 1;
  let index: i32 = 0;
  while (index < decimalPlaces) {
    scale *= 10;
    index += 1;
  }
  return scale;
}

@inline
function isFiniteValue(value: f64): bool {
  return (reinterpret<u64>(value) & F64_EXPONENT_MASK) != F64_EXPONENT_MASK;
}

@inline
function absoluteValue(value: f64): f64 {
  return reinterpret<f64>(reinterpret<u64>(value) & ~F64_SIGN_MASK);
}

/** Matches the current TypeScript strict threshold and always canonicalizes zero to positive zero. */
export function normalizeFormulaZero(value: f64, decimalPlaces: i32): f64 {
  const places = safeDecimalPlaces(decimalPlaces);
  return absoluteValue(value) < 0.5 / decimalScale(places) ? 0 : value;
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
function magnitudeBitLength(pointer: u32, count: u32): u32 {
  const high = load<u32>(pointer + (count - 1) * LIMB_BYTE_LENGTH);
  return (count - 1) * 32 + (32 - <u32>clz<u32>(high));
}

@inline
function normalizeMagnitudeCount(pointer: u32, count: u32): u32 {
  while (count != 0 && load<u32>(pointer + (count - 1) * LIMB_BYTE_LENGTH) == 0) {
    count -= 1;
  }
  return count;
}

function multiplyMagnitudeSmall(pointer: u32, count: u32, capacity: u32, factor: u32): u32 {
  let carry: u64 = 0;
  let index: u32 = 0;
  while (index < count) {
    const product = <u64>load<u32>(pointer + index * LIMB_BYTE_LENGTH) * factor + carry;
    store<u32>(pointer + index * LIMB_BYTE_LENGTH, <u32>product);
    carry = product >> 32;
    index += 1;
  }
  if (carry != 0) {
    if (index == capacity) {
      trap();
    }
    store<u32>(pointer + index * LIMB_BYTE_LENGTH, <u32>carry);
    index += 1;
  }
  return index;
}

function addMagnitudeOne(pointer: u32, count: u32, capacity: u32): u32 {
  let index: u32 = 0;
  while (index < count) {
    const value = load<u32>(pointer + index * LIMB_BYTE_LENGTH) + 1;
    store<u32>(pointer + index * LIMB_BYTE_LENGTH, value);
    if (value != 0) {
      return count;
    }
    index += 1;
  }
  if (index == capacity) {
    trap();
  }
  store<u32>(pointer + index * LIMB_BYTE_LENGTH, 1);
  return index + 1;
}

function shiftMagnitudeLeft(pointer: u32, count: u32, capacity: u32, shift: u32): u32 {
  if (count == 0 || shift == 0) {
    return count;
  }
  const wordShift = shift >> 5;
  const bitShift = shift & 31;
  const requiredCount = (magnitudeBitLength(pointer, count) + shift + 31) >> 5;
  if (requiredCount > capacity) {
    trap();
  }

  let index = count;
  while (index != 0) {
    index -= 1;
    store<u32>(pointer + (index + wordShift) * LIMB_BYTE_LENGTH, load<u32>(pointer + index * LIMB_BYTE_LENGTH));
  }
  if (wordShift != 0) {
    memory.fill(pointer, 0, checkedLimbByteLength(wordShift));
  }
  count += wordShift;
  if (bitShift != 0) {
    let carry: u32 = 0;
    index = wordShift;
    while (index < count) {
      const value = load<u32>(pointer + index * LIMB_BYTE_LENGTH);
      store<u32>(pointer + index * LIMB_BYTE_LENGTH, (value << bitShift) | carry);
      carry = value >> (32 - bitShift);
      index += 1;
    }
    if (carry != 0) {
      store<u32>(pointer + count * LIMB_BYTE_LENGTH, carry);
      count += 1;
    }
  }
  return count;
}

@inline
function magnitudeBit(pointer: u32, count: u32, bitIndex: u32): u32 {
  const limbIndex = bitIndex >> 5;
  return limbIndex < count
    ? (load<u32>(pointer + limbIndex * LIMB_BYTE_LENGTH) >> (bitIndex & 31)) & 1
    : 0;
}

/** Divides by a power of two and rounds a positive exact rational tie away from zero. */
function roundShiftMagnitudeRight(pointer: u32, count: u32, shift: u32, capacity: u32): u32 {
  if (count == 0 || shift == 0) {
    return count;
  }
  const shouldRoundUp = magnitudeBit(pointer, count, shift - 1) != 0;
  const wordShift = shift >> 5;
  const bitShift = shift & 31;
  if (wordShift >= count) {
    count = 0;
  } else {
    const remainingCount = count - wordShift;
    let index: u32 = 0;
    while (index < remainingCount) {
      const sourceIndex = index + wordShift;
      let value = load<u32>(pointer + sourceIndex * LIMB_BYTE_LENGTH) >> bitShift;
      if (bitShift != 0 && sourceIndex + 1 < count) {
        value |= load<u32>(pointer + (sourceIndex + 1) * LIMB_BYTE_LENGTH) << (32 - bitShift);
      }
      store<u32>(pointer + index * LIMB_BYTE_LENGTH, value);
      index += 1;
    }
    count = normalizeMagnitudeCount(pointer, remainingCount);
  }
  return shouldRoundUp ? addMagnitudeOne(pointer, count, capacity) : count;
}

/** Derives raw storage from the actual IEEE-754 exponent and the requested 0..15 decimal scale. */
function decimalUnitCapacity(value: f64, decimalPlaces: i32): u32 {
  const bits = reinterpret<u64>(value);
  const exponentBits = <i32>((bits & F64_EXPONENT_MASK) >> 52);
  const significand = exponentBits == 0 ? bits & F64_FRACTION_MASK : (bits & F64_FRACTION_MASK) | F64_HIDDEN_BIT;
  const significandBits = 64 - <u32>clz<u64>(significand);
  const binaryExponent = exponentBits == 0 ? -1074 : exponentBits - 1023 - 52;
  const binaryShift = binaryExponent + decimalPlaces;
  const maximumBits = significandBits + <u32>(decimalPlaces * 3) + <u32>(binaryShift > 0 ? binaryShift : 0) + 1;
  return (maximumBits + 31) >> 5;
}

/** Returns the exact per-value scratch bound used by canonical decimal conversion. */
export function getDecimalUnitLimbCapacity(value: f64, decimalPlaces: i32): u32 {
  if (!isFiniteValue(value) || value == 0) {
    return 1;
  }
  return decimalUnitCapacity(absoluteValue(value), safeDecimalPlaces(decimalPlaces));
}

/**
 * Bounds a sum of termCount arbitrary finite f64 coefficients without imposing a fixed term limit.
 * Four bits per decimal digit conservatively cover multiplication by 10^places.
 */
export function getDecimalAccumulatorLimbCapacity(decimalPlaces: i32, termCount: u32): u32 {
  const places = safeDecimalPlaces(decimalPlaces);
  const termBits = termCount <= 1 ? 0 : 32 - <u32>clz<u32>(termCount - 1);
  return (<u32>(1024 + places * 4) + termBits + 31) >> 5;
}

/** Builds abs(value) * 10^places rounded exactly as positive Number.prototype.toFixed. */
function buildRoundedDecimalUnits(
  value: f64,
  decimalPlaces: i32,
  pointer: u32,
  capacity: u32,
): u32 {
  const bits = reinterpret<u64>(value);
  const exponentBits = <i32>((bits & F64_EXPONENT_MASK) >> 52);
  const significand = exponentBits == 0 ? bits & F64_FRACTION_MASK : (bits & F64_FRACTION_MASK) | F64_HIDDEN_BIT;
  const binaryExponent = exponentBits == 0 ? -1074 : exponentBits - 1023 - 52;
  store<u32>(pointer, <u32>significand);
  store<u32>(pointer + LIMB_BYTE_LENGTH, <u32>(significand >> 32));
  let count: u32 = significand >> 32 == 0 ? 1 : 2;

  let index: i32 = 0;
  while (index < decimalPlaces) {
    count = multiplyMagnitudeSmall(pointer, count, capacity, 5);
    index += 1;
  }
  const binaryShift = binaryExponent + decimalPlaces;
  return binaryShift >= 0
    ? shiftMagnitudeLeft(pointer, count, capacity, <u32>binaryShift)
    : roundShiftMagnitudeRight(pointer, count, <u32>-binaryShift, capacity);
}

function buildDecimalInteger(significand: u64, zeroCount: u32, pointer: u32, capacity: u32): u32 {
  memory.fill(pointer, 0, checkedLimbByteLength(capacity));
  store<u32>(pointer, <u32>significand);
  store<u32>(pointer + LIMB_BYTE_LENGTH, <u32>(significand >> 32));
  let count: u32 = significand >> 32 == 0 ? 1 : 2;
  while (zeroCount != 0) {
    count = multiplyMagnitudeSmall(pointer, count, capacity, 10);
    zeroCount -= 1;
  }
  return count;
}

/**
 * Parses the stdlib's allocation-free shortest f64 representation and expands its exponent into
 * the exact integer units used by formatDecimal(...).padEnd(places, zero).
 */
function buildShortestDecimalUnits(
  value: f64,
  decimalPlaces: i32,
  pointer: u32,
  capacity: u32,
): u32 {
  const formattingMark = markArena();
  const bufferPointer = reserveArena(MAX_DOUBLE_LENGTH * sizeof<u16>(), sizeof<u16>());
  const characterCount = dtoa_buffered<f64>(bufferPointer, value);
  let decimalSignificand: u64 = 0;
  let digitCount: u32 = 0;
  let digitsBeforeDot: u32 = 0;
  let hasDot = false;
  let index: u32 = 0;
  while (index < characterCount) {
    const character = load<u16>(bufferPointer + index * sizeof<u16>());
    if (character == UTF16_EXPONENT) {
      break;
    }
    if (character == UTF16_DOT) {
      hasDot = true;
    } else if (character >= ASCII_ZERO && character <= ASCII_ZERO + 9) {
      decimalSignificand =
        decimalSignificand * <u64>10 + <u64>(character - ASCII_ZERO);
      digitCount += 1;
      if (!hasDot) {
        digitsBeforeDot += 1;
      }
    } else {
      trap();
    }
    index += 1;
  }

  let exponent: i32 = 0;
  if (index < characterCount) {
    index += 1;
    let exponentSign: i32 = 1;
    const signCharacter = load<u16>(bufferPointer + index * sizeof<u16>());
    if (signCharacter == UTF16_PLUS || signCharacter == UTF16_MINUS) {
      exponentSign = signCharacter == UTF16_MINUS ? -1 : 1;
      index += 1;
    }
    if (index == characterCount) {
      trap();
    }
    while (index < characterCount) {
      const character = load<u16>(bufferPointer + index * sizeof<u16>());
      if (character < ASCII_ZERO || character > ASCII_ZERO + 9) {
        trap();
      }
      exponent = exponent * 10 + character - ASCII_ZERO;
      index += 1;
    }
    exponent *= exponentSign;
  }

  const decimalIndex = <i32>digitsBeforeDot + exponent;
  if (digitCount == 0 || decimalIndex < <i32>digitCount) {
    trap();
  }
  const exponentZeroCount = <u32>(decimalIndex - <i32>digitCount);
  const exactPointer = reserveArena(checkedLimbByteLength(capacity), LIMB_BYTE_LENGTH);
  const candidatePointer = reserveArena(checkedLimbByteLength(capacity), LIMB_BYTE_LENGTH);
  const neighborPointer = reserveArena(checkedLimbByteLength(capacity), LIMB_BYTE_LENGTH);
  const candidateDistancePointer = reserveArena(checkedLimbByteLength(capacity), LIMB_BYTE_LENGTH);
  const neighborDistancePointer = reserveArena(checkedLimbByteLength(capacity), LIMB_BYTE_LENGTH);
  memory.fill(exactPointer, 0, checkedLimbByteLength(capacity));
  const exactCount = buildRoundedDecimalUnits(value, 0, exactPointer, capacity);
  while (true) {
    const candidateCount = buildDecimalInteger(decimalSignificand, exponentZeroCount, candidatePointer, capacity);
    const exactComparison = compareMagnitudeToShifted(exactPointer, exactCount, candidatePointer, candidateCount, 0);
    if (exactComparison == 0) {
      break;
    }
    const shouldTryLower = exactComparison < 0;
    let neighborLow: u32 = <u32>decimalSignificand;
    let neighborHigh: u32 = <u32>(decimalSignificand >> 32);
    if (shouldTryLower) {
      neighborLow = neighborLow - <u32>1;
      if (neighborLow == 0xffff_ffff) {
        neighborHigh = neighborHigh - <u32>1;
      }
    } else {
      neighborLow = neighborLow + <u32>1;
      if (neighborLow == 0) {
        neighborHigh = neighborHigh + <u32>1;
      }
    }
    const neighborSignificand = (<u64>neighborHigh << 32) | <u64>neighborLow;
    if (neighborSignificand == 0) {
      break;
    }
    const neighborCount = buildDecimalInteger(
      neighborSignificand,
      exponentZeroCount,
      neighborPointer,
      capacity,
    );
    if (reinterpret<u64>(signedLimbMagnitudeToF64(1, neighborPointer, neighborCount)) != reinterpret<u64>(value)) {
      break;
    }
    const candidateDistanceCount = absoluteMagnitudeDifference(
      candidatePointer,
      candidateCount,
      exactPointer,
      exactCount,
      candidateDistancePointer,
      capacity,
    );
    const neighborDistanceCount = absoluteMagnitudeDifference(
      neighborPointer,
      neighborCount,
      exactPointer,
      exactCount,
      neighborDistancePointer,
      capacity,
    );
    const distanceComparison = compareMagnitudeToShifted(
      neighborDistancePointer,
      neighborDistanceCount,
      candidateDistancePointer,
      candidateDistanceCount,
      0,
    );
    const shouldUseNeighbor = distanceComparison < 0 || (distanceComparison == 0 && (neighborLow & 1) == 0);
    if (!shouldUseNeighbor) {
      break;
    }
    decimalSignificand = neighborSignificand;
  }
  const resultCount = buildDecimalInteger(
    decimalSignificand,
    exponentZeroCount + <u32>decimalPlaces,
    pointer,
    capacity,
  );
  resetArena(formattingMark);
  return resultCount;
}

@inline
function buildCanonicalDecimalUnits(
  value: f64,
  decimalPlaces: i32,
  pointer: u32,
  capacity: u32,
): u32 {
  return value >= FIXED_NOTATION_MAGNITUDE_LIMIT
    ? buildShortestDecimalUnits(value, decimalPlaces, pointer, capacity)
    : buildRoundedDecimalUnits(value, decimalPlaces, pointer, capacity);
}

@inline
function shiftedMagnitudeLimb(pointer: u32, count: u32, shift: u32, resultIndex: u32): u32 {
  const wordShift = shift >> 5;
  if (resultIndex < wordShift) {
    return 0;
  }
  const sourceIndex = resultIndex - wordShift;
  const bitShift = shift & 31;
  let value: u32 = sourceIndex < count ? load<u32>(pointer + sourceIndex * LIMB_BYTE_LENGTH) << bitShift : 0;
  if (bitShift != 0 && sourceIndex != 0 && sourceIndex - 1 < count) {
    value |= load<u32>(pointer + (sourceIndex - 1) * LIMB_BYTE_LENGTH) >> (32 - bitShift);
  }
  return value;
}

function compareMagnitudeToShifted(
  leftPointer: u32,
  leftCount: u32,
  rightPointer: u32,
  rightCount: u32,
  rightShift: u32,
): i32 {
  leftCount = normalizeMagnitudeCount(leftPointer, leftCount);
  rightCount = normalizeMagnitudeCount(rightPointer, rightCount);
  if (rightCount == 0) {
    return leftCount == 0 ? 0 : 1;
  }
  if (leftCount == 0) {
    return -1;
  }
  const leftBits = magnitudeBitLength(leftPointer, leftCount);
  const rightBits = magnitudeBitLength(rightPointer, rightCount) + rightShift;
  if (leftBits != rightBits) {
    return leftBits < rightBits ? -1 : 1;
  }
  let index = (leftBits + 31) >> 5;
  while (index != 0) {
    index -= 1;
    const left = load<u32>(leftPointer + index * LIMB_BYTE_LENGTH);
    const right = shiftedMagnitudeLimb(rightPointer, rightCount, rightShift, index);
    if (left != right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

function copyShiftedMagnitude(
  sourcePointer: u32,
  sourceCount: u32,
  shift: u32,
  resultPointer: u32,
  resultCapacity: u32,
): u32 {
  memory.fill(resultPointer, 0, checkedLimbByteLength(resultCapacity));
  const resultBits = magnitudeBitLength(sourcePointer, sourceCount) + shift;
  const resultCount = (resultBits + 31) >> 5;
  if (resultCount > resultCapacity) {
    trap();
  }
  let index: u32 = 0;
  while (index < resultCount) {
    store<u32>(
      resultPointer + index * LIMB_BYTE_LENGTH,
      shiftedMagnitudeLimb(sourcePointer, sourceCount, shift, index),
    );
    index += 1;
  }
  return resultCount;
}

function subtractShiftedMagnitude(
  leftPointer: u32,
  leftCount: u32,
  rightPointer: u32,
  rightCount: u32,
  rightShift: u32,
): u32 {
  let borrow: u64 = 0;
  let index: u32 = 0;
  while (index < leftCount) {
    const left = <u64>load<u32>(leftPointer + index * LIMB_BYTE_LENGTH);
    const right = <u64>shiftedMagnitudeLimb(rightPointer, rightCount, rightShift, index) + borrow;
    store<u32>(leftPointer + index * LIMB_BYTE_LENGTH, <u32>(left - right));
    borrow = left < right ? 1 : 0;
    index += 1;
  }
  if (borrow != 0) {
    trap();
  }
  return normalizeMagnitudeCount(leftPointer, leftCount);
}

function absoluteMagnitudeDifference(
  leftPointer: u32,
  leftCount: u32,
  rightPointer: u32,
  rightCount: u32,
  resultPointer: u32,
  capacity: u32,
): u32 {
  const comparison = compareMagnitudeToShifted(leftPointer, leftCount, rightPointer, rightCount, 0);
  const largerPointer = comparison >= 0 ? leftPointer : rightPointer;
  const largerCount = comparison >= 0 ? leftCount : rightCount;
  const smallerPointer = comparison >= 0 ? rightPointer : leftPointer;
  const smallerCount = comparison >= 0 ? rightCount : leftCount;
  memory.copy(resultPointer, largerPointer, checkedLimbByteLength(largerCount));
  if (largerCount < capacity) {
    memory.fill(resultPointer + largerCount * LIMB_BYTE_LENGTH, 0, checkedLimbByteLength(capacity - largerCount));
  }
  return subtractShiftedMagnitude(resultPointer, largerCount, smallerPointer, smallerCount, 0);
}

/** Converts exact magnitude / 10^places to the nearest f64 with ties-to-even. */
function decimalUnitsToF64(pointer: u32, count: u32, decimalPlaces: i32): f64 {
  if (decimalPlaces == 0) {
    return signedLimbMagnitudeToF64(1, pointer, count);
  }

  const denominatorPointer = reserveArena(2 * LIMB_BYTE_LENGTH, LIMB_BYTE_LENGTH);
  const denominator = <u64>decimalScale(decimalPlaces);
  store<u32>(denominatorPointer, <u32>denominator);
  store<u32>(denominatorPointer + LIMB_BYTE_LENGTH, <u32>(denominator >> 32));
  const denominatorCount: u32 = denominator >> 32 == 0 ? 1 : 2;
  const numeratorBits = magnitudeBitLength(pointer, count);
  const denominatorBits = magnitudeBitLength(denominatorPointer, denominatorCount);
  let exponent = <i32>numeratorBits - <i32>denominatorBits;
  if (
    exponent >= 0 &&
    compareMagnitudeToShifted(pointer, count, denominatorPointer, denominatorCount, <u32>exponent) < 0
  ) {
    exponent -= 1;
  } else if (
    exponent < 0 &&
    compareMagnitudeToShifted(denominatorPointer, denominatorCount, pointer, count, <u32>-exponent) > 0
  ) {
    exponent -= 1;
  }

  const numeratorShift = exponent < 52 ? <u32>(52 - exponent) : 0;
  const denominatorShift = exponent > 52 ? <u32>(exponent - 52) : 0;
  const dividendCapacity = count + ((numeratorShift + 31) >> 5) + 1;
  const divisorCapacity = denominatorCount + ((denominatorShift + 31) >> 5) + 1;
  const dividendPointer = reserveArena(checkedLimbByteLength(dividendCapacity), LIMB_BYTE_LENGTH);
  const divisorPointer = reserveArena(checkedLimbByteLength(divisorCapacity), LIMB_BYTE_LENGTH);
  let dividendCount = copyShiftedMagnitude(pointer, count, numeratorShift, dividendPointer, dividendCapacity);
  const divisorCount = copyShiftedMagnitude(
    denominatorPointer,
    denominatorCount,
    denominatorShift,
    divisorPointer,
    divisorCapacity,
  );

  let quotient: u64 = 0;
  let quotientBit: i32 = 52;
  while (quotientBit >= 0) {
    if (compareMagnitudeToShifted(dividendPointer, dividendCount, divisorPointer, divisorCount, <u32>quotientBit) >= 0) {
      dividendCount = subtractShiftedMagnitude(
        dividendPointer,
        dividendCount,
        divisorPointer,
        divisorCount,
        <u32>quotientBit,
      );
      quotient |= <u64>1 << quotientBit;
    }
    quotientBit -= 1;
  }

  const doubledRemainderComparison = dividendCount == 0
    ? -1
    : -compareMagnitudeToShifted(divisorPointer, divisorCount, dividendPointer, dividendCount, 1);
  if (doubledRemainderComparison > 0 || (doubledRemainderComparison == 0 && (quotient & 1) != 0)) {
    quotient += 1;
  }
  if (quotient == F64_INTEGER_SIGNIFICAND_LIMIT) {
    quotient >>= 1;
    exponent += 1;
  }
  if (exponent > 1023) {
    return reinterpret<f64>(F64_POSITIVE_INFINITY_BITS);
  }
  const bits = (<u64>(exponent + 1023) << 52) | (quotient & F64_FRACTION_MASK);
  return reinterpret<f64>(bits);
}

/** Implements Number(normalizeZero(value).toFixed(places)) without managed strings. */
export function roundFormulaDecimal(value: f64, decimalPlaces: i32): f64 {
  const places = safeDecimalPlaces(decimalPlaces);
  const normalizedValue = normalizeFormulaZero(value, places);
  if (normalizedValue == 0) {
    return 0;
  }
  if (!isFiniteValue(normalizedValue) || absoluteValue(normalizedValue) >= FIXED_NOTATION_MAGNITUDE_LIMIT) {
    return normalizedValue;
  }

  const mark = markArena();
  const magnitude = absoluteValue(normalizedValue);
  const capacity = decimalUnitCapacity(magnitude, places);
  const pointer = reserveArena(checkedLimbByteLength(capacity), LIMB_BYTE_LENGTH);
  memory.fill(pointer, 0, checkedLimbByteLength(capacity));
  const count = buildRoundedDecimalUnits(magnitude, places, pointer, capacity);
  const roundedMagnitude = count == 0 ? 0 : decimalUnitsToF64(pointer, count, places);
  resetArena(mark);
  return normalizedValue < 0 ? -roundedMagnitude : roundedMagnitude;
}

@inline
function nextDown(value: f64): f64 {
  if (value != value || value == reinterpret<f64>(F64_SIGN_MASK | F64_POSITIVE_INFINITY_BITS)) {
    return value;
  }
  if (value == 0) {
    return reinterpret<f64>(F64_SIGN_MASK | 1);
  }
  const bits = reinterpret<u64>(value);
  return reinterpret<f64>(value > 0 ? bits - 1 : bits + 1);
}

/** Matches the TypeScript floor-after-fixed-rounding rule, including its one-ULP safety walk. */
export function floorFormulaDecimal(value: f64, decimalPlaces: i32): f64 {
  const places = safeDecimalPlaces(decimalPlaces);
  const roundedValue = roundFormulaDecimal(value, places);
  if (!isFiniteValue(value) || roundedValue <= value) {
    return roundedValue;
  }

  const scale = decimalScale(places);
  let scaledFloor = NativeMath.floor(value * scale);
  let flooredValue = scaledFloor / scale;
  while (flooredValue > value) {
    scaledFloor = NativeMath.floor(nextDown(scaledFloor));
    flooredValue = scaledFloor / scale;
  }
  return flooredValue == 0 ? 0 : flooredValue;
}

/** Quantizes a printed coefficient after preserving the source sign decision. */
export function quantizeFormulaCoefficient(value: f64, decimalPlaces: i32): f64 {
  const normalizedValue = normalizeFormulaZero(value, decimalPlaces);
  if (normalizedValue == 0) {
    return 0;
  }
  const magnitude = roundFormulaDecimal(absoluteValue(normalizedValue), decimalPlaces);
  return normalizedValue < 0 ? -magnitude : magnitude;
}

/** Quantizes the printed negative offset and restores the original center sign. */
export function quantizeFormulaOffsetCenter(value: f64, decimalPlaces: i32): f64 {
  return -roundFormulaDecimal(-value, decimalPlaces);
}

/** Adds the canonical decimal units of a quantized coefficient to a reusable Step state. */
export function addQuantizedDecimalUnits(
  statePointer: u32,
  value: f64,
  decimalPlaces: i32,
): void {
  if (decimalPlaces < 0 || decimalPlaces > MAX_DECIMAL_PLACES || !isFiniteValue(value)) {
    trap();
  }
  const normalizedValue = normalizeFormulaZero(value, decimalPlaces);
  if (normalizedValue == 0) {
    return;
  }
  const mark = markArena();
  const magnitude = absoluteValue(normalizedValue);
  const capacity = decimalUnitCapacity(magnitude, decimalPlaces);
  const pointer = reserveArena(checkedLimbByteLength(capacity), LIMB_BYTE_LENGTH);
  memory.fill(pointer, 0, checkedLimbByteLength(capacity));
  const count = buildCanonicalDecimalUnits(magnitude, decimalPlaces, pointer, capacity);
  addSignedMagnitudeToState(statePointer, normalizedValue < 0 ? -1 : 1, pointer, count);
  resetArena(mark);
}

function divideMagnitudeSmall(pointer: u32, count: u32, divisor: u32): u32 {
  let remainder: u64 = 0;
  let index = count;
  while (index != 0) {
    index -= 1;
    const dividend = (remainder << 32) | load<u32>(pointer + index * LIMB_BYTE_LENGTH);
    store<u32>(pointer + index * LIMB_BYTE_LENGTH, <u32>(dividend / divisor));
    remainder = dividend % divisor;
  }
  return <u32>remainder;
}

/** Serializes a nonnegative magnitude as canonical forward ASCII digits without managed strings. */
export function serializeMagnitudeDecimal(
  pointer: u32,
  count: u32,
  digitPointer: u32,
  digitCapacity: u32,
): u32 {
  if (count == 0) {
    if (digitCapacity == 0) {
      trap();
    }
    store<u8>(digitPointer, ASCII_ZERO);
    return 1;
  }
  const copyPointer = reserveArena(checkedLimbByteLength(count), LIMB_BYTE_LENGTH);
  memory.copy(copyPointer, pointer, checkedLimbByteLength(count));
  let copyCount = count;
  let digitCount: u32 = 0;
  while (copyCount != 0) {
    if (digitCount == digitCapacity) {
      trap();
    }
    store<u8>(digitPointer + digitCount, ASCII_ZERO + <u8>divideMagnitudeSmall(copyPointer, copyCount, 10));
    digitCount += 1;
    copyCount = normalizeMagnitudeCount(copyPointer, copyCount);
  }
  let left: u32 = 0;
  let right = digitCount - 1;
  while (left < right) {
    const temporary = load<u8>(digitPointer + left);
    store<u8>(digitPointer + left, load<u8>(digitPointer + right));
    store<u8>(digitPointer + right, temporary);
    left += 1;
    right -= 1;
  }
  return digitCount;
}

/**
 * Produces canonical sign/digits/scale/limbs for one finite decimal value.
 * Magnitudes at least 1e21 follow Number#toString shortest digits, matching JavaScript Number#toFixed.
 */
export function runCanonicalDecimal(inputPointer: u32): u32 {
  requireArenaRange(inputPointer, DECIMAL_INPUT_BYTE_LENGTH, sizeof<f64>());
  const value = load<f64>(inputPointer + DECIMAL_INPUT_VALUE_OFFSET);
  const decimalPlaces = load<i32>(inputPointer + DECIMAL_INPUT_DECIMAL_PLACES_OFFSET);
  if (decimalPlaces < 0 || decimalPlaces > MAX_DECIMAL_PLACES) {
    trap();
  }

  const resultPointer = reserveArena(DECIMAL_RESULT_BYTE_LENGTH, sizeof<f64>());
  store<i32>(resultPointer + DECIMAL_RESULT_SIGN_OFFSET, 0);
  store<u32>(resultPointer + DECIMAL_RESULT_DIGIT_POINTER_OFFSET, 0);
  store<u32>(resultPointer + DECIMAL_RESULT_DIGIT_COUNT_OFFSET, 0);
  store<i32>(resultPointer + DECIMAL_RESULT_DECIMAL_PLACES_OFFSET, decimalPlaces);
  store<u32>(resultPointer + DECIMAL_RESULT_LIMB_POINTER_OFFSET, 0);
  store<u32>(resultPointer + DECIMAL_RESULT_LIMB_COUNT_OFFSET, 0);
  store<f64>(resultPointer + DECIMAL_RESULT_ROUNDED_VALUE_OFFSET, value);
  if (!isFiniteValue(value)) {
    return resultPointer;
  }

  const normalizedValue = normalizeFormulaZero(value, decimalPlaces);
  if (normalizedValue == 0) {
    const digitPointer = reserveArena(1, 1);
    store<u8>(digitPointer, ASCII_ZERO);
    store<u32>(resultPointer + DECIMAL_RESULT_DIGIT_POINTER_OFFSET, digitPointer);
    store<u32>(resultPointer + DECIMAL_RESULT_DIGIT_COUNT_OFFSET, 1);
    store<f64>(resultPointer + DECIMAL_RESULT_ROUNDED_VALUE_OFFSET, 0);
    return resultPointer;
  }

  const magnitude = absoluteValue(normalizedValue);
  const capacity = decimalUnitCapacity(magnitude, decimalPlaces);
  const limbPointer = reserveArena(checkedLimbByteLength(capacity), LIMB_BYTE_LENGTH);
  memory.fill(limbPointer, 0, checkedLimbByteLength(capacity));
  const limbCount = buildCanonicalDecimalUnits(magnitude, decimalPlaces, limbPointer, capacity);
  if (limbCount == 0) {
    const digitPointer = reserveArena(1, 1);
    store<u8>(digitPointer, ASCII_ZERO);
    store<u32>(resultPointer + DECIMAL_RESULT_DIGIT_POINTER_OFFSET, digitPointer);
    store<u32>(resultPointer + DECIMAL_RESULT_DIGIT_COUNT_OFFSET, 1);
    store<f64>(resultPointer + DECIMAL_RESULT_ROUNDED_VALUE_OFFSET, 0);
    return resultPointer;
  }

  const digitCapacity = limbCount * 10 + 1;
  const digitPointer = reserveArena(digitCapacity, 1);
  const serializationMark = markArena();
  const digitCount = serializeMagnitudeDecimal(limbPointer, limbCount, digitPointer, digitCapacity);
  resetArena(serializationMark);
  let roundedMagnitude = magnitude;
  if (magnitude < FIXED_NOTATION_MAGNITUDE_LIMIT) {
    const conversionMark = markArena();
    roundedMagnitude = decimalUnitsToF64(limbPointer, limbCount, decimalPlaces);
    resetArena(conversionMark);
  }
  store<i32>(resultPointer + DECIMAL_RESULT_SIGN_OFFSET, normalizedValue < 0 ? -1 : 1);
  store<u32>(resultPointer + DECIMAL_RESULT_DIGIT_POINTER_OFFSET, digitPointer);
  store<u32>(resultPointer + DECIMAL_RESULT_DIGIT_COUNT_OFFSET, digitCount);
  store<u32>(resultPointer + DECIMAL_RESULT_LIMB_POINTER_OFFSET, limbPointer);
  store<u32>(resultPointer + DECIMAL_RESULT_LIMB_COUNT_OFFSET, limbCount);
  store<f64>(
    resultPointer + DECIMAL_RESULT_ROUNDED_VALUE_OFFSET,
    normalizedValue < 0 ? -roundedMagnitude : roundedMagnitude,
  );
  return resultPointer;
}
