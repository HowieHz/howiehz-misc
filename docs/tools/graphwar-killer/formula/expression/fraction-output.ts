const decimalLiteralPattern = /\d+\.\d+/g;

/**
 * 将生成表达式里的有限小数字面量精确改写为最简分数。
 *
 * Graphwar 会把分子、分母分别解析为 double；超出精确整数范围的长分子可能让运行值与原小数相差 1 ULP。这里仍以十进制文本的精确有理数为准，否则输出就不再是该小数对应的最简分数。
 */
export function convertGraphwarExpressionDecimalsToFractions(expression: string) {
  return expression.replace(decimalLiteralPattern, (decimal, offset) => {
    const [integerPart, fractionPart] = decimal.split(".") as [string, string];
    let numerator = BigInt(`${integerPart}${fractionPart}`);
    let denominator = 10n ** BigInt(fractionPart.length);
    let left = numerator;
    let right = denominator;
    // 直接按十进制文本迭代约分，既避开浮点精度损失，也不让递归深度随小数位数增长。
    while (right !== 0n) {
      const remainder = left % right;
      left = right;
      right = remainder;
    }
    numerator /= left;
    denominator /= left;
    const fraction = denominator === 1n ? String(numerator) : `${numerator}/${denominator}`;
    if (!fraction.includes("/")) {
      return fraction;
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
    return previousToken === "^" || nextToken === "/" || nextToken === "^" ? `(${fraction})` : fraction;
  });
}
