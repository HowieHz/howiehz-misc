/** Graphwar expression VM opcode；数值保持原版 Java token 排序合约。 */
export enum GraphwarExpressionOpcode {
  Add = 1,
  Negate = 2,
  Multiply = 3,
  Divide = 4,
  Pow = 5,
  Sqrt = 6,
  Log10 = 7,
  Abs = 8,
  Sin = 9,
  Cos = 10,
  Tan = 11,
  Ln = 12,
  X = 13,
  Y = 14,
  DY = 15,
  Constant = 16,
}

/** TypeScript fallback 与 WASM Adapter 共用的规范前缀 Polish program。 */
export interface GraphwarExpressionProgram {
  /** 常量顺序与 `Constant` opcode 在前缀程序中的出现顺序一致。 */
  readonly constants: Float64Array;
  /** 反向求值前缀程序所需的精确 stack 高水位。 */
  readonly maximumStackSize: number;
  /** 前缀 Polish opcode；括号只属于 parser token，不进入此 program。 */
  readonly opcodes: Uint8Array;
}

/** 证明结构与精确 stack 上界后，从新获得 ownership 的 buffer 构造 program。 */
export function createGraphwarExpressionProgram(
  opcodes: Uint8Array,
  constants: Float64Array,
): GraphwarExpressionProgram | undefined {
  const maximumStackSize = inspectGraphwarExpressionProgram(opcodes, constants.length);
  return maximumStackSize === undefined ? undefined : { constants, maximumStackSize, opcodes };
}

/** 在 Adapter 边界验证不可信的 structured-clone/program payload。 */
export function isGraphwarExpressionProgram(value: unknown): value is GraphwarExpressionProgram {
  if (
    typeof value !== "object" ||
    value === null ||
    !("constants" in value) ||
    !("maximumStackSize" in value) ||
    !("opcodes" in value) ||
    !(value.constants instanceof Float64Array) ||
    !(value.opcodes instanceof Uint8Array) ||
    !Number.isSafeInteger(value.maximumStackSize)
  ) {
    return false;
  }

  const maximumStackSize = inspectGraphwarExpressionProgram(value.opcodes, value.constants.length);
  return maximumStackSize !== undefined && value.maximumStackSize === maximumStackSize;
}

/** 创建可复用 evaluator；其唯一可变状态是预分配的数值 stack。 */
export function createGraphwarExpressionProgramEvaluator(program: GraphwarExpressionProgram) {
  const stack = new Float64Array(program.maximumStackSize);
  return (x: number, y: number, dy: number) => evaluateGraphwarExpressionProgram(program, stack, x, y, dy);
}

/** 前缀指令从右向左求值。常量使用同一个反向 cursor，因此规范 bytecode 不需要为每条指令保存常量索引。 */
function evaluateGraphwarExpressionProgram(
  program: GraphwarExpressionProgram,
  stack: Float64Array,
  x: number,
  y: number,
  dy: number,
) {
  let constantIndex = program.constants.length;
  let stackSize = 0;
  for (let index = program.opcodes.length - 1; index >= 0; index -= 1) {
    switch (program.opcodes[index]) {
      case GraphwarExpressionOpcode.Add:
        stack[stackSize - 2] += stack[stackSize - 1];
        stackSize -= 1;
        break;
      case GraphwarExpressionOpcode.Negate:
        stack[stackSize - 1] = -stack[stackSize - 1];
        break;
      case GraphwarExpressionOpcode.Multiply:
        stack[stackSize - 2] *= stack[stackSize - 1];
        stackSize -= 1;
        break;
      case GraphwarExpressionOpcode.Divide:
        stack[stackSize - 2] = stack[stackSize - 1] / stack[stackSize - 2];
        stackSize -= 1;
        break;
      case GraphwarExpressionOpcode.Pow:
        stack[stackSize - 2] = Math.pow(stack[stackSize - 1], stack[stackSize - 2]);
        stackSize -= 1;
        break;
      case GraphwarExpressionOpcode.Sqrt:
        stack[stackSize - 1] = Math.sqrt(stack[stackSize - 1]);
        break;
      case GraphwarExpressionOpcode.Log10:
        stack[stackSize - 1] = Math.log10(stack[stackSize - 1]);
        break;
      case GraphwarExpressionOpcode.Abs:
        stack[stackSize - 1] = Math.abs(stack[stackSize - 1]);
        break;
      case GraphwarExpressionOpcode.Sin:
        stack[stackSize - 1] = Math.sin(stack[stackSize - 1]);
        break;
      case GraphwarExpressionOpcode.Cos:
        stack[stackSize - 1] = Math.cos(stack[stackSize - 1]);
        break;
      case GraphwarExpressionOpcode.Tan:
        stack[stackSize - 1] = Math.tan(stack[stackSize - 1]);
        break;
      case GraphwarExpressionOpcode.Ln:
        stack[stackSize - 1] = Math.log(stack[stackSize - 1]);
        break;
      case GraphwarExpressionOpcode.X:
        stack[stackSize] = x;
        stackSize += 1;
        break;
      case GraphwarExpressionOpcode.Y:
        stack[stackSize] = y;
        stackSize += 1;
        break;
      case GraphwarExpressionOpcode.DY:
        stack[stackSize] = dy;
        stackSize += 1;
        break;
      case GraphwarExpressionOpcode.Constant:
        constantIndex -= 1;
        stack[stackSize] = program.constants[constantIndex];
        stackSize += 1;
        break;
    }
  }

  const value = stack[0];
  return Number.isFinite(value) ? value : Number.NaN;
}

/** 返回反向求值 stack 的精确高水位，或拒绝 malformed program。 */
function inspectGraphwarExpressionProgram(opcodes: Uint8Array, expectedConstantCount: number) {
  if (opcodes.length === 0) {
    return undefined;
  }

  let constantCount = 0;
  let maximumStackSize = 0;
  let stackSize = 0;
  for (let index = opcodes.length - 1; index >= 0; index -= 1) {
    const opcode = opcodes[index];
    if (
      opcode === GraphwarExpressionOpcode.X ||
      opcode === GraphwarExpressionOpcode.Y ||
      opcode === GraphwarExpressionOpcode.DY ||
      opcode === GraphwarExpressionOpcode.Constant
    ) {
      stackSize += 1;
      if (opcode === GraphwarExpressionOpcode.Constant) {
        constantCount += 1;
      }
    } else if (opcode === GraphwarExpressionOpcode.Negate || isGraphwarExpressionUnaryFunction(opcode)) {
      if (stackSize < 1) {
        return undefined;
      }
    } else if (isGraphwarExpressionBinaryOperator(opcode)) {
      if (stackSize < 2) {
        return undefined;
      }
      stackSize -= 1;
    } else {
      return undefined;
    }

    maximumStackSize = Math.max(maximumStackSize, stackSize);
  }

  return stackSize === 1 && constantCount === expectedConstantCount ? maximumStackSize : undefined;
}

function isGraphwarExpressionBinaryOperator(opcode: number) {
  return (
    opcode === GraphwarExpressionOpcode.Add ||
    opcode === GraphwarExpressionOpcode.Multiply ||
    opcode === GraphwarExpressionOpcode.Divide ||
    opcode === GraphwarExpressionOpcode.Pow
  );
}

function isGraphwarExpressionUnaryFunction(opcode: number) {
  return opcode >= GraphwarExpressionOpcode.Sqrt && opcode <= GraphwarExpressionOpcode.Ln;
}
