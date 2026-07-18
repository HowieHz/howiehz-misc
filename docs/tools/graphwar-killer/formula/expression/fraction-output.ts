const decimalLiteralPattern = /\d*\.\d+/g;
const doubleFractionMask = (1n << 52n) - 1n;

/** Graphwar 对外公式及其中小数是否都已完成运行时等价转换。 */
export interface GraphwarFractionOutput {
  /** 可直接显示、复制或提交给 Agent 的公式。 */
  expression: string;
  /** `false` 表示至少一个小数字面量因无法保证 Graphwar 运行值等价而被保留。 */
  fullyConverted: boolean;
}

/**
 * 将 Graphwar 接受的 `0.5` 和 `.5` 小数字面量改写为运行时等价的分数。
 *
 * 优先使用十进制文本的最简分数；若 Graphwar 分别将长分子、分母解析为 double 后会改变值， 则回退到该 double 的精确二进制有理数。仍无法等价解析时保留原字面量并报告局部失败。
 */
export function convertGraphwarExpressionDecimalsToFractions(expression: string): GraphwarFractionOutput {
  let fullyConverted = true;
  const convertedExpression = expression.replace(decimalLiteralPattern, (decimal, offset) => {
    const originalValue = Number(decimal);
    let replacement = decimal;
    let replacementIsFraction = false;
    if (Number.isFinite(originalValue)) {
      const [integerPart, fractionPart] = decimal.split(".") as [string, string];
      let fraction = reduceFraction(BigInt(`${integerPart || "0"}${fractionPart}`), 10n ** BigInt(fractionPart.length));
      // 数学等价不够：Graphwar 会先把两个整数字面量各自舍入为 double，再执行除法。
      let equivalent = isGraphwarFractionEquivalent(fraction, originalValue);
      if (!equivalent) {
        // 精确二进制有理数补偿上述两次舍入；极小值的分母仍可能溢出，最终验收会拒绝它。
        fraction = createExactDoubleFraction(originalValue);
        equivalent = isGraphwarFractionEquivalent(fraction, originalValue);
      }
      if (equivalent) {
        const [numerator, denominator] = fraction;
        replacement = denominator === 1n ? String(numerator) : `${numerator}/${denominator}`;
        replacementIsFraction = denominator !== 1n;
      } else {
        fullyConverted = false;
      }
    } else {
      fullyConverted = false;
    }

    // 原版把 `.5.5` 解析为两个隐式相乘的数字；括号避免两个替换结果粘成另一个整数。
    if (expression[offset + decimal.length] === ".") {
      return `(${replacement})`;
    }
    if (!replacementIsFraction) {
      return replacement;
    }

    let previousToken: string | undefined;
    for (let index = offset - 1; index >= 0; index -= 1) {
      if (!/\s/.test(expression[index])) {
        previousToken = expression[index];
        break;
      }
    }
    let nextToken: string | undefined;
    for (let index = offset + decimal.length; index < expression.length; index += 1) {
      if (!/\s/.test(expression[index])) {
        nextToken = expression[index];
        break;
      }
    }
    // Graphwar 的同级除法按右结合解析，所以除数 `x/1/2` 已等价于 `x/(1/2)`；
    // 只有分数位于分子或幂两侧时，才需要括号保持原小数字面量的运算边界。
    return previousToken === "^" || nextToken === "/" || nextToken === "^" ? `(${replacement})` : replacement;
  });

  return { expression: convertedExpression, fullyConverted };
}

/** 迭代约分正分母有理数，避免小数字数影响递归深度。 */
function reduceFraction(numerator: bigint, denominator: bigint): [bigint, bigint] {
  let left = numerator;
  let right = denominator;
  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return [numerator / left, denominator / left];
}

/** 按 Graphwar 的 `Double.parseDouble(numerator) / Double.parseDouble(denominator)` 语义验收分数。 */
function isGraphwarFractionEquivalent([numerator, denominator]: readonly [bigint, bigint], originalValue: number) {
  const parsedNumerator = Number(numerator);
  const parsedDenominator = Number(denominator);
  return (
    Number.isFinite(parsedNumerator) &&
    Number.isFinite(parsedDenominator) &&
    parsedNumerator / parsedDenominator === originalValue
  );
}

/** 迭代拆解有限正 double 的符号位之外字段，返回其精确最简有理数。 */
function createExactDoubleFraction(value: number): [bigint, bigint] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  let numerator = bits & doubleFractionMask;
  const binaryExponent = exponentBits === 0 ? -1074 : exponentBits - 1075;
  if (exponentBits !== 0) {
    numerator |= 1n << 52n;
  }

  let denominator = 1n;
  if (binaryExponent >= 0) {
    numerator <<= BigInt(binaryExponent);
  } else {
    denominator <<= BigInt(-binaryExponent);
  }
  return reduceFraction(numerator, denominator);
}
