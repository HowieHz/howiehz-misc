import {
  EXPRESSION_INPUT_BYTE_LENGTH,
  EXPRESSION_INPUT_CONSTANT_COUNT_OFFSET,
  EXPRESSION_INPUT_CONSTANT_POINTER_OFFSET,
  EXPRESSION_INPUT_DY_POINTER_OFFSET,
  EXPRESSION_INPUT_MAXIMUM_STACK_SIZE_OFFSET,
  EXPRESSION_INPUT_OPCODE_COUNT_OFFSET,
  EXPRESSION_INPUT_OPCODE_POINTER_OFFSET,
  EXPRESSION_INPUT_VALUE_COUNT_OFFSET,
  EXPRESSION_INPUT_X_POINTER_OFFSET,
  EXPRESSION_INPUT_Y_POINTER_OFFSET,
  FORMULA_RESULT_BYTE_LENGTH,
  FORMULA_RESULT_VALUE_COUNT_OFFSET,
  FORMULA_RESULT_VALUE_POINTER_OFFSET,
} from "./formula-layout";
import { requireArenaRange, reserveArena } from "./memory";

const MAX_U32: u64 = 0xffff_ffff;
const F64_BYTE_LENGTH: u32 = sizeof<f64>();

const OPCODE_ADD: u8 = 1;
const OPCODE_NEGATE: u8 = 2;
const OPCODE_MULTIPLY: u8 = 3;
const OPCODE_DIVIDE: u8 = 4;
const OPCODE_POW: u8 = 5;
const OPCODE_SQRT: u8 = 6;
const OPCODE_LOG10: u8 = 7;
const OPCODE_ABS: u8 = 8;
const OPCODE_SIN: u8 = 9;
const OPCODE_COS: u8 = 10;
const OPCODE_TAN: u8 = 11;
const OPCODE_LN: u8 = 12;
const OPCODE_X: u8 = 13;
const OPCODE_Y: u8 = 14;
const OPCODE_DY: u8 = 15;
const OPCODE_CONSTANT: u8 = 16;

@inline
function trap(): void {
  unreachable();
}

@inline
function getF64ByteLength(count: u32): u32 {
  const byteLength = <u64>count * F64_BYTE_LENGTH;
  if (byteLength > MAX_U32) {
    trap();
  }
  return <u32>byteLength;
}

/** Proves the canonical reverse-prefix shape and its exact operand-stack high-water mark. */
export function validateExpressionProgram(
  opcodePointer: u32,
  opcodeCount: u32,
  constantCount: u32,
  maximumStackSize: u32,
): void {
  if (opcodeCount == 0 || maximumStackSize == 0) {
    trap();
  }

  let actualConstantCount: u32 = 0;
  let actualMaximumStackSize: u32 = 0;
  let stackSize: u32 = 0;
  let opcodeIndex = opcodeCount;
  while (opcodeIndex > 0) {
    opcodeIndex -= 1;
    const opcode = load<u8>(opcodePointer + opcodeIndex);
    if (opcode >= OPCODE_X && opcode <= OPCODE_CONSTANT) {
      if (stackSize == 0xffff_ffff) {
        trap();
      }
      stackSize += 1;
      if (opcode == OPCODE_CONSTANT) {
        actualConstantCount += 1;
      }
    } else if (opcode == OPCODE_NEGATE || (opcode >= OPCODE_SQRT && opcode <= OPCODE_LN)) {
      if (stackSize < 1) {
        trap();
      }
    } else if (
      opcode == OPCODE_ADD ||
      opcode == OPCODE_MULTIPLY ||
      opcode == OPCODE_DIVIDE ||
      opcode == OPCODE_POW
    ) {
      if (stackSize < 2) {
        trap();
      }
      stackSize -= 1;
    } else {
      trap();
    }

    if (stackSize > actualMaximumStackSize) {
      actualMaximumStackSize = stackSize;
    }
  }

  if (
    stackSize != 1 ||
    actualConstantCount != constantCount ||
    actualMaximumStackSize != maximumStackSize
  ) {
    trap();
  }
}

/** Executes one already-validated program while preserving non-finite intermediates that can recover. */
export function evaluateExpressionProgram(
  opcodePointer: u32,
  opcodeCount: u32,
  constantPointer: u32,
  constantCount: u32,
  stackPointer: u32,
  x: f64,
  y: f64,
  dy: f64,
): f64 {
  let constantIndex = constantCount;
  let stackSize: u32 = 0;
  let opcodeIndex = opcodeCount;
  while (opcodeIndex > 0) {
    opcodeIndex -= 1;
    const opcode = load<u8>(opcodePointer + opcodeIndex);
    if (opcode == OPCODE_ADD) {
      const leftPointer = stackPointer + (stackSize - 2) * F64_BYTE_LENGTH;
      store<f64>(leftPointer, load<f64>(leftPointer) + load<f64>(leftPointer + F64_BYTE_LENGTH));
      stackSize -= 1;
    } else if (opcode == OPCODE_NEGATE) {
      const valuePointer = stackPointer + (stackSize - 1) * F64_BYTE_LENGTH;
      store<f64>(valuePointer, -load<f64>(valuePointer));
    } else if (opcode == OPCODE_MULTIPLY) {
      const leftPointer = stackPointer + (stackSize - 2) * F64_BYTE_LENGTH;
      store<f64>(leftPointer, load<f64>(leftPointer) * load<f64>(leftPointer + F64_BYTE_LENGTH));
      stackSize -= 1;
    } else if (opcode == OPCODE_DIVIDE) {
      const denominatorPointer = stackPointer + (stackSize - 2) * F64_BYTE_LENGTH;
      store<f64>(
        denominatorPointer,
        load<f64>(denominatorPointer + F64_BYTE_LENGTH) / load<f64>(denominatorPointer),
      );
      stackSize -= 1;
    } else if (opcode == OPCODE_POW) {
      const exponentPointer = stackPointer + (stackSize - 2) * F64_BYTE_LENGTH;
      store<f64>(
        exponentPointer,
        NativeMath.pow(load<f64>(exponentPointer + F64_BYTE_LENGTH), load<f64>(exponentPointer)),
      );
      stackSize -= 1;
    } else if (opcode == OPCODE_SQRT) {
      const valuePointer = stackPointer + (stackSize - 1) * F64_BYTE_LENGTH;
      store<f64>(valuePointer, NativeMath.sqrt(load<f64>(valuePointer)));
    } else if (opcode == OPCODE_LOG10) {
      const valuePointer = stackPointer + (stackSize - 1) * F64_BYTE_LENGTH;
      store<f64>(valuePointer, NativeMath.log10(load<f64>(valuePointer)));
    } else if (opcode == OPCODE_ABS) {
      const valuePointer = stackPointer + (stackSize - 1) * F64_BYTE_LENGTH;
      store<f64>(valuePointer, NativeMath.abs(load<f64>(valuePointer)));
    } else if (opcode == OPCODE_SIN) {
      const valuePointer = stackPointer + (stackSize - 1) * F64_BYTE_LENGTH;
      store<f64>(valuePointer, NativeMath.sin(load<f64>(valuePointer)));
    } else if (opcode == OPCODE_COS) {
      const valuePointer = stackPointer + (stackSize - 1) * F64_BYTE_LENGTH;
      store<f64>(valuePointer, NativeMath.cos(load<f64>(valuePointer)));
    } else if (opcode == OPCODE_TAN) {
      const valuePointer = stackPointer + (stackSize - 1) * F64_BYTE_LENGTH;
      store<f64>(valuePointer, NativeMath.tan(load<f64>(valuePointer)));
    } else if (opcode == OPCODE_LN) {
      const valuePointer = stackPointer + (stackSize - 1) * F64_BYTE_LENGTH;
      store<f64>(valuePointer, NativeMath.log(load<f64>(valuePointer)));
    } else if (opcode == OPCODE_X) {
      store<f64>(stackPointer + stackSize * F64_BYTE_LENGTH, x);
      stackSize += 1;
    } else if (opcode == OPCODE_Y) {
      store<f64>(stackPointer + stackSize * F64_BYTE_LENGTH, y);
      stackSize += 1;
    } else if (opcode == OPCODE_DY) {
      store<f64>(stackPointer + stackSize * F64_BYTE_LENGTH, dy);
      stackSize += 1;
    } else {
      constantIndex -= 1;
      store<f64>(
        stackPointer + stackSize * F64_BYTE_LENGTH,
        load<f64>(constantPointer + constantIndex * F64_BYTE_LENGTH),
      );
      stackSize += 1;
    }
  }

  return load<f64>(stackPointer);
}

/** Validates and evaluates a canonical expression program for parallel x/y/dy input records. */
export function runExpressionBatch(inputPointer: u32): u32 {
  requireArenaRange(inputPointer, EXPRESSION_INPUT_BYTE_LENGTH, sizeof<u32>());

  const opcodePointer = load<u32>(inputPointer + EXPRESSION_INPUT_OPCODE_POINTER_OFFSET);
  const opcodeCount = load<u32>(inputPointer + EXPRESSION_INPUT_OPCODE_COUNT_OFFSET);
  const constantPointer = load<u32>(inputPointer + EXPRESSION_INPUT_CONSTANT_POINTER_OFFSET);
  const constantCount = load<u32>(inputPointer + EXPRESSION_INPUT_CONSTANT_COUNT_OFFSET);
  const maximumStackSize = load<u32>(inputPointer + EXPRESSION_INPUT_MAXIMUM_STACK_SIZE_OFFSET);
  const xPointer = load<u32>(inputPointer + EXPRESSION_INPUT_X_POINTER_OFFSET);
  const yPointer = load<u32>(inputPointer + EXPRESSION_INPUT_Y_POINTER_OFFSET);
  const dyPointer = load<u32>(inputPointer + EXPRESSION_INPUT_DY_POINTER_OFFSET);
  const valueCount = load<u32>(inputPointer + EXPRESSION_INPUT_VALUE_COUNT_OFFSET);
  const constantByteLength = getF64ByteLength(constantCount);
  const valueByteLength = getF64ByteLength(valueCount);

  requireArenaRange(opcodePointer, opcodeCount, sizeof<u8>());
  requireArenaRange(constantPointer, constantByteLength, F64_BYTE_LENGTH);
  requireArenaRange(xPointer, valueByteLength, F64_BYTE_LENGTH);
  requireArenaRange(yPointer, valueByteLength, F64_BYTE_LENGTH);
  requireArenaRange(dyPointer, valueByteLength, F64_BYTE_LENGTH);
  validateExpressionProgram(opcodePointer, opcodeCount, constantCount, maximumStackSize);

  let valuePointer: u32 = 0;
  let stackPointer: u32 = 0;
  if (valueCount > 0) {
    valuePointer = reserveArena(valueByteLength, F64_BYTE_LENGTH);
    stackPointer = reserveArena(getF64ByteLength(maximumStackSize), F64_BYTE_LENGTH);
  }
  const resultPointer = reserveArena(FORMULA_RESULT_BYTE_LENGTH, F64_BYTE_LENGTH);
  memory.fill(resultPointer, 0, FORMULA_RESULT_BYTE_LENGTH);
  store<u32>(resultPointer + FORMULA_RESULT_VALUE_POINTER_OFFSET, valuePointer);
  store<u32>(resultPointer + FORMULA_RESULT_VALUE_COUNT_OFFSET, valueCount);

  for (let valueIndex: u32 = 0; valueIndex < valueCount; valueIndex += 1) {
    const valueOffset = valueIndex * F64_BYTE_LENGTH;
    store<f64>(
      valuePointer + valueOffset,
      evaluateExpressionProgram(
        opcodePointer,
        opcodeCount,
        constantPointer,
        constantCount,
        stackPointer,
        load<f64>(xPointer + valueOffset),
        load<f64>(yPointer + valueOffset),
        load<f64>(dyPointer + valueOffset),
      ),
    );
  }

  return resultPointer;
}
