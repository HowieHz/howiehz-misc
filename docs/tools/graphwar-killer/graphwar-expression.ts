/** 解析并求值 Graphwar 用户表达式，保持原版 PolishNotationFunction 的兼容规则。 */

/** 用户输入表达式的 Graphwar 源码兼容解析选项。 */
export interface GraphwarExpressionParserOptions {
  /** 是否跳过 Graphwar 表达式中无法识别的字符。 */
  skipUnknownCharacters: boolean;
  /** 是否复刻原版 token 正则顺序，把 y' 当作 y 后再处理剩余 apostrophe。 */
  parseDerivativeAsY: boolean;
}

/** Graphwar 原版 PolishNotationFunction 使用的简单数值 token。 */
interface GraphwarExpressionToken {
  /** Token 类型编号；顺序参与原版优先级重排。 */
  type: GraphwarExpressionTokenType;
  /** 常量 token 的数值。 */
  value?: number;
}

/** Graphwar 表达式 token 编号；数值顺序就是原版重排优先级，不能按可读性随意调整。 */
const enum GraphwarExpressionTokenType {
  /** 加法 token。 */
  Add = 1,
  /** 减号 token；Graphwar 原版把它作为一元负号处理。 */
  Subtract = 2,
  /** 乘法 token。 */
  Multiply = 3,
  /** 除法 token。 */
  Divide = 4,
  /** 幂运算 token。 */
  Pow = 5,
  /** Sqrt 函数 token。 */
  Sqrt = 6,
  /** Log10 函数 token。 */
  Log = 7,
  /** Abs 函数 token。 */
  Abs = 8,
  /** Sin/sen 函数 token。 */
  Sin = 9,
  /** Cos 函数 token。 */
  Cos = 10,
  /** Tan/tg 函数 token。 */
  Tan = 11,
  /** Ln 函数 token。 */
  Ln = 12,
  /** X 变量 token。 */
  X = 13,
  /** Y 变量 token。 */
  Y = 14,
  /** Y' 变量 token。 */
  DY = 15,
  /** 数字常量 token。 */
  Value = 16,
  /** 左括号 token，只参与重排时的嵌套层级计算。 */
  LeftBracket = 17,
  /** 右括号 token，只参与重排时的嵌套层级计算。 */
  RightBracket = 18,
}

/** 编译用户输入表达式，只暴露 Graphwar 支持的一小组数学函数。 */
export function createGraphwarExpressionEvaluator(expression: string, parserOptions?: GraphwarExpressionParserOptions) {
  const polishTokens = parseGraphwarExpression(expression, parserOptions);
  if (!polishTokens) {
    return undefined;
  }

  return createGraphwarPolishExpressionEvaluator(polishTokens);
}

/** 按 Graphwar PolishNotationFunction 的 token 规则解析用户表达式。 */
function parseGraphwarExpression(
  expression: string,
  parserOptions?: GraphwarExpressionParserOptions,
): GraphwarExpressionToken[] | undefined {
  // 流程刻意保持为 token 化 -> 前缀 Polish 重排 -> 栈求值，便于对齐 Graphwar 原版解析差异。
  const regularTokens = tokenizeGraphwarExpression(expression, parserOptions);
  if (!regularTokens || regularTokens.length === 0) {
    return undefined;
  }
  const polishTokens: GraphwarExpressionToken[] = [];
  if (!reorderGraphwarExpressionTokens(polishTokens, regularTokens, 0, regularTokens.length - 1)) {
    return undefined;
  }
  return graphwarPolishValuesNeeded(polishTokens) === 0 ? polishTokens : undefined;
}

/** 模拟 Graphwar 对普通输入的简单 token 化，包括 exp=>e^、逗号小数和隐式乘法。 */
function tokenizeGraphwarExpression(
  expression: string,
  parserOptions: GraphwarExpressionParserOptions = {
    parseDerivativeAsY: false,
    skipUnknownCharacters: false,
  },
): GraphwarExpressionToken[] | undefined {
  const tokens: GraphwarExpressionToken[] = [];
  const source = expression.toLowerCase().replaceAll("-", "+-").replaceAll("exp", "e^").replaceAll(",", ".");
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const rest = source.slice(index);
    const numberMatch = rest.match(/^[0-9]*\.?[0-9]+/);
    if (numberMatch) {
      tokens.push({ type: GraphwarExpressionTokenType.Value, value: Number(numberMatch[0]) });
      index += numberMatch[0].length;
      continue;
    }

    const token = readGraphwarExpressionToken(rest, parserOptions);
    if (!token) {
      if (parserOptions.skipUnknownCharacters) {
        index += 1;
        continue;
      }
      return undefined;
    }
    tokens.push(token.token);
    index += token.length;
  }

  return insertGraphwarImplicitMultiplications(tokens);
}

/** 读取当前位置的 Graphwar 表达式 token，保留原版函数名和 y' 解析差异开关。 */
function readGraphwarExpressionToken(
  rest: string,
  parserOptions: GraphwarExpressionParserOptions,
): { length: number; token: GraphwarExpressionToken } | undefined {
  if (!parserOptions.parseDerivativeAsY && rest.startsWith("y'")) {
    return { length: 2, token: { type: GraphwarExpressionTokenType.DY } };
  }

  const namedTokens: [string, GraphwarExpressionTokenType, number?][] = [
    ["sqrt", GraphwarExpressionTokenType.Sqrt],
    ["log", GraphwarExpressionTokenType.Log],
    ["abs", GraphwarExpressionTokenType.Abs],
    ["sen", GraphwarExpressionTokenType.Sin],
    ["sin", GraphwarExpressionTokenType.Sin],
    ["cos", GraphwarExpressionTokenType.Cos],
    ["tan", GraphwarExpressionTokenType.Tan],
    ["tg", GraphwarExpressionTokenType.Tan],
    ["ln", GraphwarExpressionTokenType.Ln],
    ["pi", GraphwarExpressionTokenType.Value, Math.PI],
  ];
  for (const [text, type, value] of namedTokens) {
    if (rest.startsWith(text)) {
      return { length: text.length, token: { type, value } };
    }
  }

  const charTokens: Record<string, GraphwarExpressionToken> = {
    "(": { type: GraphwarExpressionTokenType.LeftBracket },
    ")": { type: GraphwarExpressionTokenType.RightBracket },
    "+": { type: GraphwarExpressionTokenType.Add },
    "-": { type: GraphwarExpressionTokenType.Subtract },
    "*": { type: GraphwarExpressionTokenType.Multiply },
    "/": { type: GraphwarExpressionTokenType.Divide },
    "^": { type: GraphwarExpressionTokenType.Pow },
    e: { type: GraphwarExpressionTokenType.Value, value: Math.E },
    x: { type: GraphwarExpressionTokenType.X },
    y: { type: GraphwarExpressionTokenType.Y },
  };
  return charTokens[rest[0]] ? { length: 1, token: charTokens[rest[0]] } : undefined;
}

/** 在相邻值 token 之间插入 Graphwar 支持的隐式乘法。 */
function insertGraphwarImplicitMultiplications(tokens: GraphwarExpressionToken[]) {
  const result: GraphwarExpressionToken[] = [];
  for (const token of tokens) {
    const previous = result.at(-1);
    if (previous && graphwarTokensAreImplicitMultiplication(previous.type, token.type)) {
      result.push({ type: GraphwarExpressionTokenType.Multiply });
    }
    result.push(token);
  }
  return result;
}

/** 判断两个相邻 token 是否需要补乘号，模拟 Graphwar 输入容错。 */
function graphwarTokensAreImplicitMultiplication(
  previousType: GraphwarExpressionTokenType,
  nextType: GraphwarExpressionTokenType,
) {
  return (
    graphwarExpressionTokenIsValueLike(previousType) &&
    (graphwarExpressionTokenCanStartValue(nextType) ||
      nextType === GraphwarExpressionTokenType.LeftBracket ||
      getGraphwarExpressionTokenParamCount(nextType) === 1)
  );
}

/** 判断 token 是否可以作为值表达式的起点。 */
function graphwarExpressionTokenCanStartValue(type: GraphwarExpressionTokenType) {
  return (
    type === GraphwarExpressionTokenType.Value ||
    type === GraphwarExpressionTokenType.X ||
    type === GraphwarExpressionTokenType.Y ||
    type === GraphwarExpressionTokenType.DY
  );
}

/** 判断 token 是否能作为隐式乘法左侧的值表达式。 */
function graphwarExpressionTokenIsValueLike(type: GraphwarExpressionTokenType) {
  return (
    type === GraphwarExpressionTokenType.Value ||
    type === GraphwarExpressionTokenType.X ||
    type === GraphwarExpressionTokenType.Y ||
    type === GraphwarExpressionTokenType.DY ||
    type === GraphwarExpressionTokenType.RightBracket
  );
}

/** 按 Graphwar 原版优先级规则把普通 token 区间重排为前缀 Polish token。 */
function reorderGraphwarExpressionTokens(
  output: GraphwarExpressionToken[],
  input: GraphwarExpressionToken[],
  start: number,
  end: number,
): boolean {
  const pendingRanges: { end: number; mustContainToken: boolean; start: number }[] = [
    { start, end, mustContainToken: true },
  ];
  while (pendingRanges.length > 0) {
    const currentRange = pendingRanges.pop();
    if (!currentRange) {
      continue;
    }

    const rootIndex = findGraphwarExpressionRootTokenIndex(input, currentRange.start, currentRange.end);
    if (rootIndex === -1) {
      if (currentRange.mustContainToken) {
        return false;
      }
      continue;
    }

    const token = input[rootIndex];
    const paramCount = getGraphwarExpressionTokenParamCount(token.type);
    output.push(token);
    if (paramCount === 1) {
      // 函数和一元负号只消费右侧表达式，左侧空区间由调用方判定是否合法。
      pendingRanges.push({ start: rootIndex + 1, end: currentRange.end, mustContainToken: false });
    } else if (paramCount === 2) {
      // 栈后进先出：先压右区间，才能保持旧递归的 left-before-right 输出顺序。
      pendingRanges.push({ start: rootIndex + 1, end: currentRange.end, mustContainToken: false });
      if (
        token.type === GraphwarExpressionTokenType.Add &&
        findGraphwarExpressionRootTokenIndex(input, currentRange.start, rootIndex - 1) === -1
      ) {
        output.push({ type: GraphwarExpressionTokenType.Value, value: 0 });
      } else {
        pendingRanges.push({ start: currentRange.start, end: rootIndex - 1, mustContainToken: false });
      }
    }
  }
  return true;
}

/** 找到当前区间的重排根 token：更外层优先，同层按 Graphwar 原版 token 编号优先。 */
function findGraphwarExpressionRootTokenIndex(input: GraphwarExpressionToken[], start: number, end: number) {
  if (start > end || start >= input.length) {
    return -1;
  }

  let rootIndex = -1;
  let rootNestDepth = Number.POSITIVE_INFINITY;
  let nestDepth = 0;
  for (let index = start; index <= end; index += 1) {
    const type = input[index].type;
    if (type === GraphwarExpressionTokenType.LeftBracket) {
      nestDepth += 1;
    } else if (type === GraphwarExpressionTokenType.RightBracket) {
      nestDepth -= 1;
    } else if (
      nestDepth < rootNestDepth ||
      (nestDepth === rootNestDepth && (rootIndex === -1 || type < input[rootIndex].type))
    ) {
      // 同层选择编号更小的 token；编号顺序承担 Graphwar 原版的优先级 contract。
      rootIndex = index;
      rootNestDepth = nestDepth;
    }
  }
  return rootIndex;
}

/** 校验 Polish token 序列是否刚好消费一个表达式值。 */
function graphwarPolishValuesNeeded(tokens: readonly GraphwarExpressionToken[]) {
  let valuesNeeded = 1;
  for (let index = 0; index < tokens.length; index += 1) {
    valuesNeeded += graphwarExpressionTokenIsOperation(tokens[index].type)
      ? getGraphwarExpressionTokenParamCount(tokens[index].type) - 1
      : -1;
    if (valuesNeeded === 0 && index + 1 < tokens.length) {
      return -1;
    }
  }
  return valuesNeeded;
}

/** 为编译后的 Polish 表达式创建可复用栈，避免每个采样点重新分配。 */
function createGraphwarPolishExpressionEvaluator(tokens: readonly GraphwarExpressionToken[]) {
  const stack = new Array<number>(tokens.length);
  return (x: number, y: number, dy: number) => evaluateGraphwarPolishExpression(tokens, stack, x, y, dy);
}

/** 从后向前求值 Graphwar 前缀 Polish 表达式。 */
function evaluateGraphwarPolishExpression(
  tokens: readonly GraphwarExpressionToken[],
  stack: number[],
  x: number,
  y: number,
  dy: number,
) {
  let stackSize = 0;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];

    switch (token.type) {
      case GraphwarExpressionTokenType.Add:
        if (stackSize < 2) {
          return Number.NaN;
        }
        stack[stackSize - 2] += stack[stackSize - 1];
        stackSize -= 1;
        break;
      case GraphwarExpressionTokenType.Subtract:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = -stack[stackSize - 1];
        break;
      case GraphwarExpressionTokenType.Multiply:
        if (stackSize < 2) {
          return Number.NaN;
        }
        stack[stackSize - 2] *= stack[stackSize - 1];
        stackSize -= 1;
        break;
      case GraphwarExpressionTokenType.Divide:
        if (stackSize < 2) {
          return Number.NaN;
        }
        stack[stackSize - 2] = stack[stackSize - 1] / stack[stackSize - 2];
        stackSize -= 1;
        break;
      case GraphwarExpressionTokenType.Pow:
        if (stackSize < 2) {
          return Number.NaN;
        }
        stack[stackSize - 2] = Math.pow(stack[stackSize - 1], stack[stackSize - 2]);
        stackSize -= 1;
        break;
      case GraphwarExpressionTokenType.Sqrt:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.sqrt(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Log:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.log10(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Abs:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.abs(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Sin:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.sin(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Cos:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.cos(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Tan:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.tan(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.Ln:
        if (stackSize < 1) {
          return Number.NaN;
        }
        stack[stackSize - 1] = Math.log(stack[stackSize - 1]);
        break;
      case GraphwarExpressionTokenType.X:
        stack[stackSize] = x;
        stackSize += 1;
        break;
      case GraphwarExpressionTokenType.Y:
        stack[stackSize] = y;
        stackSize += 1;
        break;
      case GraphwarExpressionTokenType.DY:
        stack[stackSize] = dy;
        stackSize += 1;
        break;
      case GraphwarExpressionTokenType.Value:
        stack[stackSize] = token.value ?? Number.NaN;
        stackSize += 1;
        break;
      default:
        return Number.NaN;
    }
  }

  const value = stackSize === 1 ? stack[0] : Number.NaN;
  return Number.isFinite(value) ? value : Number.NaN;
}

/** 判断 token 是否为 Graphwar 表达式运算符。 */
function graphwarExpressionTokenIsOperation(type: GraphwarExpressionTokenType) {
  return type >= GraphwarExpressionTokenType.Add && type <= GraphwarExpressionTokenType.Ln;
}

/** 返回 Graphwar 运算符需要的参数个数。 */
function getGraphwarExpressionTokenParamCount(type: GraphwarExpressionTokenType) {
  if (type === GraphwarExpressionTokenType.Subtract) {
    return 1;
  }
  if (type >= GraphwarExpressionTokenType.Add && type <= GraphwarExpressionTokenType.Pow) {
    return 2;
  }
  if (type >= GraphwarExpressionTokenType.Sqrt && type <= GraphwarExpressionTokenType.Ln) {
    return 1;
  }
  return 0;
}
