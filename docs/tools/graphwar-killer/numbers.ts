/** 提供 Graphwar 杀手表单解析、数值格式化和浮点比较工具。 */
/** 解析用户输入的数字文本，并拒绝空值、NaN 和无穷值。 */
export function parseFiniteNumber(value: string) {
  const normalizedValue = value.trim();
  if (normalizedValue === "") {
    return undefined;
  }

  const numberValue = Number(normalizedValue);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

/** 将数字限制在闭区间范围内。 */
export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** 按参与比较的数值尺度估算 double 舍入误差容差。 */
export function doublePrecisionTolerance(...values: readonly number[]) {
  const finiteScale = values.filter(Number.isFinite).reduce((scale, value) => Math.max(scale, Math.abs(value)), 1);
  return Number.EPSILON * finiteScale;
}

/** 使用 double 精度容差比较两个浮点数是否近似相等。 */
export function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= doublePrecisionTolerance(left, right);
}

/** 判断 Graphwar x 差是否达到当前公式输出精度要求的最小前进步长。 */
export function graphXAdvancesEnough(deltaX: number, minimumGraphXStep: number, ...sourceValues: readonly number[]) {
  return deltaX + doublePrecisionTolerance(deltaX, minimumGraphXStep, ...sourceValues) >= minimumGraphXStep;
}

export const MAX_FORMULA_DECIMAL_PLACES = 15;
export const DEFAULT_FORMULA_DECIMAL_PLACES = 5;

/** 将公式输出小数位限制在 Graphwar 可读且 double 有意义的范围内。 */
export function clampDecimalPlaces(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_FORMULA_DECIMAL_PLACES;
  }
  return clampNumber(Math.trunc(value), 0, MAX_FORMULA_DECIMAL_PLACES);
}

/** 折叠微小浮点残差，避免生成公式里出现 -0 或当前精度下的 0.000...。 */
export function normalizeZero(value: number, decimalPlaces = DEFAULT_FORMULA_DECIMAL_PLACES) {
  const threshold = 0.5 * 10 ** -clampDecimalPlaces(decimalPlaces);
  return Math.abs(value) < threshold ? 0 : value;
}

/** 按公式输出精度生成数值副本；内部计算在调用前仍保留 double 精度。 */
export function roundToDecimalPlaces(value: number, decimalPlaces = DEFAULT_FORMULA_DECIMAL_PLACES) {
  const safeDecimalPlaces = clampDecimalPlaces(decimalPlaces);
  const normalizedValue = normalizeZero(value, safeDecimalPlaces);
  return normalizedValue === 0 ? 0 : Number(normalizedValue.toFixed(safeDecimalPlaces));
}

/** 用足够精度格式化 Graphwar 公式数字，并去掉多余末尾 0。 */
export function formatDecimal(value: number, decimalPlaces = DEFAULT_FORMULA_DECIMAL_PLACES) {
  const safeDecimalPlaces = clampDecimalPlaces(decimalPlaces);
  const normalizedValue = normalizeZero(value, safeDecimalPlaces);
  if (normalizedValue === 0) {
    return "0";
  }

  return trimTrailingDecimalZeros(expandExponentialNotation(normalizedValue.toFixed(safeDecimalPlaces)));
}

/** 格式化输入框里的坐标边界，保留 JS double 的最短往返表示且不受公式输出精度影响。 */
export function formatDoublePrecisionDecimal(value: number) {
  if (Object.is(value, -0)) {
    return "0";
  }

  return expandExponentialNotation(value.toString());
}

/** 去掉固定小数输出的末尾 0，缩短 Graphwar 公式文本。 */
function trimTrailingDecimalZeros(value: string) {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** Graphwar 不识别科学计数法；把 1e+21 展开成普通十进制数字串。 */
function expandExponentialNotation(value: string) {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(value);
  if (!match) {
    return value;
  }

  const [, sign, integerPart, fractionPart = "", exponentText] = match;
  const exponent = Number(exponentText);
  const digits = `${integerPart}${fractionPart}`;
  const decimalIndex = integerPart.length + exponent;

  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

/** 为 x+c 表达式片段格式化 +3 或 -2.5 这样的带符号偏移。 */
export function formatSignedNumber(value: number, decimalPlaces = DEFAULT_FORMULA_DECIMAL_PLACES) {
  const normalizedValue = normalizeZero(value, decimalPlaces);
  if (normalizedValue === 0) {
    return "+0";
  }
  return normalizedValue < 0
    ? formatDecimal(normalizedValue, decimalPlaces)
    : `+${formatDecimal(normalizedValue, decimalPlaces)}`;
}

/** 按 Graphwar 角度面板的显示精度格式化角度。 */
export function formatAngleDegree(value: number) {
  return normalizeZero(value, 2).toFixed(2);
}

/** 以稳定且较短的小数形式格式化 SVG 折线坐标。 */
export function formatSvgNumber(value: number) {
  return value.toFixed(2);
}
