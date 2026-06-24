import { GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE } from "./graphwar";
import {
  MAX_FORMULA_DECIMAL_PLACES,
  formatDecimal,
  formatSignedNumber,
  normalizeZero,
  roundToDecimalPlaces,
} from "./numbers";
import { graphwarToolDefaults } from "./tool-defaults";
import { createGraphPoint } from "./types";
import type { AlgorithmMode, EquationMode, FormulaResult, GraphPoint, StepTerm } from "./types";

/** 双绝对值连接遇到垂直或反向线段时，使用 Graphwar 源码里的函数最小 x 步长保持公式有限。 */
const ABS_CONNECTOR_MIN_WIDTH = GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE;
const SOFT_INTERVAL_INDICATOR_POWER = 8;

/** 稳定版 sigmoid 公式在符号项可去奇点处避免 0 / 0 的最小十进制保护值。 */
export const GRAPHWAR_TOOL_SIGN_EPSILON = graphwarToolDefaults.stepSignEpsilon;

export interface FormulaEvaluationOptions {
  coefficientDecimalPlaces?: number;
  onSignArgument?: (value: number) => void;
  signEpsilon?: number;
}

/** A(abs(x+b)-abs(x+c)) 连接函数使用的标准化线段数据。 */
interface AbsConnectorSegment {
  startX: number;
  endX: number;
  width: number;
  deltaY: number;
}

interface CubicHermiteSegment {
  startX: number;
  endX: number;
  width: number;
  startY: number;
  endY: number;
  startSlope: number;
  endSlope: number;
}

/** 根据当前算法生成可复制的 Graphwar 表达式和 y= 预览表达式。 */
export function buildFormula(
  points: readonly GraphPoint[],
  steepness: number,
  mode: EquationMode,
  algorithm: AlgorithmMode,
  decimalPlaces?: number,
  signEpsilon = GRAPHWAR_TOOL_SIGN_EPSILON,
): FormulaResult {
  const start = points[0];
  const terms = createStepTerms(points);
  const expression =
    algorithm === "abs"
      ? mode === "dy"
        ? formatAbsConnectorFirstDerivativeExpression(points, decimalPlaces, signEpsilon)
        : formatAbsConnectorExpression(points, decimalPlaces, 0)
      : isCubicInterpolationAlgorithm(algorithm)
        ? formatSoftCubicInterpolationExpression(
            points,
            algorithm,
            mode,
            decimalPlaces,
            mode === "y" ? -(points[0]?.y ?? 0) : 0,
          )
        : mode === "y"
          ? formatStepExpression(0, terms, steepness, decimalPlaces, signEpsilon)
          : mode === "dy"
            ? formatStepFirstDerivativeExpression(terms, steepness, decimalPlaces)
            : formatStepSecondDerivativeExpression(terms, steepness, decimalPlaces, signEpsilon);
  const previewExpression =
    algorithm === "abs"
      ? formatAbsConnectorExpression(points, decimalPlaces)
      : isCubicInterpolationAlgorithm(algorithm)
        ? formatSoftCubicInterpolationExpression(points, algorithm, "y", decimalPlaces)
        : formatStepExpression(start.y, terms, steepness, decimalPlaces, signEpsilon);

  return {
    expression,
    previewExpression,
    terms,
  };
}

/** 计算 sigmoid 阶梯 y= 路径，用于 SVG 预览采样。 */
export function evaluateStepY(
  x: number,
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
) {
  let y = points[0]?.y ?? 0;
  for (let index = 1; index < points.length; index += 1) {
    const coefficient = normalizeFormulaCoefficient(points[index].y - points[index - 1].y, options);
    y += coefficient * evaluateStableStepSigmoid(steepness * (x - points[index].x), options);
  }
  return y;
}

/** 计算 sigmoid 阶梯路径在指定 x 处的一阶斜率，用于 y'' 模式发射角提示。 */
export function evaluateStepFirstDerivativeY(
  x: number,
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
) {
  let slope = 0;
  for (let index = 1; index < points.length; index += 1) {
    const deltaY = points[index].y - points[index - 1].y;
    const coefficient = normalizeFormulaCoefficient(deltaY * steepness, options);
    const t = steepness * (x - points[index].x);
    const q = Math.exp(-Math.abs(t));
    slope += (coefficient * q) / (1 + q) ** 2;
  }
  return slope;
}

/** 计算 sigmoid 阶梯路径在指定 x 处的二阶导，用于 y'' 模式 RK4 预览。 */
export function evaluateStepSecondDerivativeY(
  x: number,
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
) {
  let acceleration = 0;
  for (let index = 1; index < points.length; index += 1) {
    const deltaY = points[index].y - points[index - 1].y;
    const coefficient = normalizeFormulaCoefficient(deltaY * steepness * steepness, options);
    const t = steepness * (x - points[index].x);
    const q = Math.exp(-Math.abs(t));
    const sign = evaluateStableSignRatio(t, options);
    acceleration += (-coefficient * sign * q * (1 - q)) / (1 + q) ** 3;
  }
  return acceleration;
}

/** 计算双绝对值 y= 连接路径，用于 SVG 预览采样。 */
export function evaluateAbsConnectorY(x: number, points: readonly GraphPoint[], options?: FormulaEvaluationOptions) {
  let y = points[0]?.y ?? 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = createAbsConnectorSegment(points[index - 1], points[index]);
    const startX = normalizeFormulaCoefficient(segment.startX, options);
    const endX = normalizeFormulaCoefficient(segment.endX, options);
    const coefficient = normalizeFormulaCoefficient(segment.deltaY / (2 * segment.width), options);
    const width = normalizeFormulaCoefficient(segment.width, options);
    y += coefficient * (Math.abs(x - startX) - Math.abs(x - endX) + width);
  }
  return y;
}

/** 计算双绝对值连接函数的一阶导，用于 y'= 模式 RK4 预览。 */
export function evaluateAbsConnectorFirstDerivativeY(
  x: number,
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
) {
  let slope = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = createAbsConnectorSegment(points[index - 1], points[index]);
    const startX = normalizeFormulaCoefficient(segment.startX, options);
    const endX = normalizeFormulaCoefficient(segment.endX, options);
    const coefficient = normalizeFormulaCoefficient(segment.deltaY / (2 * segment.width), options);
    slope += coefficient * (evaluateStableSignRatio(x - startX, options) - evaluateStableSignRatio(x - endX, options));
  }
  return slope;
}

/** 计算 PCHIP 插值的归一化软分段三次路径。 */
export function evaluatePchipY(x: number, points: readonly GraphPoint[], options?: FormulaEvaluationOptions) {
  return evaluateSoftCubicInterpolationY(x, points, "pchip", "y", options);
}

/** 计算 Akima 插值的归一化软分段三次路径。 */
export function evaluateAkimaY(x: number, points: readonly GraphPoint[], options?: FormulaEvaluationOptions) {
  return evaluateSoftCubicInterpolationY(x, points, "akima", "y", options);
}

export function evaluatePchipFirstDerivativeY(
  x: number,
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
) {
  return evaluateSoftCubicInterpolationY(x, points, "pchip", "dy", options);
}

export function evaluateAkimaFirstDerivativeY(
  x: number,
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
) {
  return evaluateSoftCubicInterpolationY(x, points, "akima", "dy", options);
}

export function evaluatePchipSecondDerivativeY(
  x: number,
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
) {
  return evaluateSoftCubicInterpolationY(x, points, "pchip", "ddy", options);
}

export function evaluateAkimaSecondDerivativeY(
  x: number,
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
) {
  return evaluateSoftCubicInterpolationY(x, points, "akima", "ddy", options);
}

/** 将点击路径点转换为阶梯中心点和纵向变化量。 */
function createStepTerms(points: readonly GraphPoint[]) {
  const terms: StepTerm[] = [];
  for (let index = 1; index < points.length; index += 1) {
    terms.push({
      x: points[index].x,
      deltaY: points[index].y - points[index - 1].y,
    });
  }
  return terms;
}

function isCubicInterpolationAlgorithm(algorithm: AlgorithmMode): algorithm is "pchip" | "akima" {
  return algorithm === "pchip" || algorithm === "akima";
}

/** 格式化用户可粘贴到 Graphwar 的基础 y= sigmoid 阶梯表达式。 */
function formatStepExpression(
  baseY: number,
  terms: readonly StepTerm[],
  steepness: number,
  decimalPlaces: number | undefined,
  signEpsilon: number,
) {
  const parts = [formatDecimal(baseY, decimalPlaces)];
  for (const term of terms) {
    parts.push(
      formatSignedRawTerm(
        term.deltaY,
        `(${formatStableStepSigmoid(steepness, term.x, decimalPlaces, signEpsilon)})`,
        decimalPlaces,
      ),
    );
  }
  return cleanupExpression(parts.join(""));
}

/** 使用抗溢出的 exp 形式格式化 sigmoid 阶梯表达式的一阶导。 */
function formatStepFirstDerivativeExpression(terms: readonly StepTerm[], steepness: number, decimalPlaces?: number) {
  const parts: string[] = [];
  for (const term of terms) {
    const coefficient = term.deltaY * steepness;
    const expText = formatStableStepDerivativeExp(steepness, term.x, decimalPlaces);
    parts.push(formatSignedRawTerm(coefficient, `${expText}/(1+${expText})^2`, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 使用稳定的对称形式格式化 sigmoid 阶梯表达式的二阶导。 */
function formatStepSecondDerivativeExpression(
  terms: readonly StepTerm[],
  steepness: number,
  decimalPlaces: number | undefined,
  signEpsilon: number,
) {
  const parts: string[] = [];
  for (const term of terms) {
    const coefficient = term.deltaY * steepness * steepness;
    const argumentText = formatStepDerivativeArgument(steepness, term.x, decimalPlaces);
    const expText = formatStableStepDerivativeExp(steepness, term.x, decimalPlaces);
    const signText = formatStableSignRatio(argumentText, signEpsilon);
    const body = `${signText}*${expText}*(1-${expText})/(1+${expText})^3`;
    parts.push(formatSignedRawTerm(-coefficient, body, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化相邻点击点之间双绝对值连接函数的 y= 叠加式。 */
function formatAbsConnectorExpression(
  points: readonly GraphPoint[],
  decimalPlaces?: number,
  baseY = points[0]?.y ?? 0,
) {
  const parts = [formatDecimal(baseY, decimalPlaces)];
  for (let index = 1; index < points.length; index += 1) {
    const segment = createAbsConnectorSegment(points[index - 1], points[index]);
    if (isRoundedAbsConnectorZero(segment, decimalPlaces)) {
      continue;
    }

    const coefficient = segment.deltaY / (2 * segment.width);
    const body = `${formatAbsXOffset(segment.startX, decimalPlaces)}-${formatAbsXOffset(segment.endX, decimalPlaces)}+${formatDecimal(segment.width, decimalPlaces)}`;
    parts.push(formatSignedRawTerm(coefficient, `(${body})`, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化双绝对值连接表达式的一阶导。 */
function formatAbsConnectorFirstDerivativeExpression(
  points: readonly GraphPoint[],
  decimalPlaces: number | undefined,
  signEpsilon = GRAPHWAR_TOOL_SIGN_EPSILON,
) {
  const parts: string[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = createAbsConnectorSegment(points[index - 1], points[index]);
    if (isRoundedAbsConnectorZero(segment, decimalPlaces)) {
      continue;
    }

    const coefficient = segment.deltaY / (2 * segment.width);
    const startText = formatXOffset(segment.startX, decimalPlaces);
    const endText = formatXOffset(segment.endX, decimalPlaces);
    const body = `${formatStableSignRatio(startText, signEpsilon)}-${formatStableSignRatio(endText, signEpsilon)}`;
    parts.push(formatSignedRawTerm(coefficient, `(${body})`, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

function formatSoftCubicInterpolationExpression(
  points: readonly GraphPoint[],
  algorithm: "pchip" | "akima",
  mode: EquationMode,
  decimalPlaces?: number,
  yOffset = 0,
) {
  const segments = createCubicInterpolationSegments(points, algorithm, undefined, yOffset);
  if (segments.length === 0) {
    return "0";
  }

  const parts = createSoftCubicInterpolationFormulaParts(segments, decimalPlaces);
  if (mode === "dy") {
    return `((${parts.firstNumerator})*(${parts.denominator})-(${parts.numerator})*(${parts.firstDenominator}))/(${parts.denominator})^2`;
  }
  if (mode === "ddy") {
    const quotientNumerator = `(${parts.firstNumerator})*(${parts.denominator})-(${parts.numerator})*(${parts.firstDenominator})`;
    return `(((${parts.secondNumerator})*(${parts.denominator})-(${parts.numerator})*(${parts.secondDenominator}))*(${parts.denominator})-2*(${quotientNumerator})*(${parts.firstDenominator}))/(${parts.denominator})^3`;
  }

  return `(${parts.numerator})/(${parts.denominator})`;
}

function createSoftCubicInterpolationFormulaParts(segments: readonly CubicHermiteSegment[], decimalPlaces?: number) {
  const numeratorParts: string[] = [];
  const denominatorParts: string[] = [];
  const firstNumeratorParts: string[] = [];
  const firstDenominatorParts: string[] = [];
  const secondNumeratorParts: string[] = [];
  const secondDenominatorParts: string[] = [];

  for (const segment of segments) {
    const weight = formatSoftIntervalIndicator(segment, decimalPlaces);
    const firstWeight = formatSoftIntervalIndicatorDerivative(segment, decimalPlaces);
    const secondWeight = formatSoftIntervalIndicatorSecondDerivative(segment, decimalPlaces);
    const cubic = formatCubicHermiteSegmentExpression(segment, decimalPlaces);
    const firstCubic = formatCubicHermiteSegmentDerivativeExpression(segment, decimalPlaces);
    const secondCubic = formatCubicHermiteSegmentSecondDerivativeExpression(segment, decimalPlaces);

    numeratorParts.push(`(${weight})*(${cubic})`);
    denominatorParts.push(`(${weight})`);
    firstNumeratorParts.push(`(${firstWeight})*(${cubic})+(${weight})*(${firstCubic})`);
    firstDenominatorParts.push(`(${firstWeight})`);
    secondNumeratorParts.push(
      `(${secondWeight})*(${cubic})+2*(${firstWeight})*(${firstCubic})+(${weight})*(${secondCubic})`,
    );
    secondDenominatorParts.push(`(${secondWeight})`);
  }

  return {
    denominator: denominatorParts.join("+"),
    firstDenominator: firstDenominatorParts.join("+"),
    firstNumerator: firstNumeratorParts.join("+"),
    numerator: numeratorParts.join("+"),
    secondDenominator: secondDenominatorParts.join("+"),
    secondNumerator: secondNumeratorParts.join("+"),
  };
}

function formatCubicHermiteSegmentExpression(segment: CubicHermiteSegment, decimalPlaces?: number) {
  const t = `((${formatXOffset(segment.startX, decimalPlaces)})/${formatDecimal(segment.width, decimalPlaces)})`;
  const parts = [
    formatSignedRawTerm(segment.startY, `(2*${t}^3-3*${t}^2+1)`, decimalPlaces),
    formatSignedRawTerm(segment.width * segment.startSlope, `(${t}^3-2*${t}^2+${t})`, decimalPlaces),
    formatSignedRawTerm(segment.endY, `(-2*${t}^3+3*${t}^2)`, decimalPlaces),
    formatSignedRawTerm(segment.width * segment.endSlope, `(${t}^3-${t}^2)`, decimalPlaces),
  ];
  return cleanupExpression(parts.join("")) || "0";
}

function formatCubicHermiteSegmentDerivativeExpression(segment: CubicHermiteSegment, decimalPlaces?: number) {
  const t = `((${formatXOffset(segment.startX, decimalPlaces)})/${formatDecimal(segment.width, decimalPlaces)})`;
  const parts = [
    formatSignedRawTerm(segment.startY / segment.width, `(6*${t}^2-6*${t})`, decimalPlaces),
    formatSignedRawTerm(segment.startSlope, `(3*${t}^2-4*${t}+1)`, decimalPlaces),
    formatSignedRawTerm(segment.endY / segment.width, `(-6*${t}^2+6*${t})`, decimalPlaces),
    formatSignedRawTerm(segment.endSlope, `(3*${t}^2-2*${t})`, decimalPlaces),
  ];
  return cleanupExpression(parts.join("")) || "0";
}

function formatCubicHermiteSegmentSecondDerivativeExpression(segment: CubicHermiteSegment, decimalPlaces?: number) {
  const t = `((${formatXOffset(segment.startX, decimalPlaces)})/${formatDecimal(segment.width, decimalPlaces)})`;
  const parts = [
    formatSignedRawTerm(segment.startY / segment.width ** 2, `(12*${t}-6)`, decimalPlaces),
    formatSignedRawTerm(segment.startSlope / segment.width, `(6*${t}-4)`, decimalPlaces),
    formatSignedRawTerm(segment.endY / segment.width ** 2, `(-12*${t}+6)`, decimalPlaces),
    formatSignedRawTerm(segment.endSlope / segment.width, `(6*${t}-2)`, decimalPlaces),
  ];
  return cleanupExpression(parts.join("")) || "0";
}

function formatSoftIntervalIndicator(segment: CubicHermiteSegment, decimalPlaces?: number) {
  return `1/(${formatSoftIntervalBase(segment, decimalPlaces)})`;
}

function formatSoftIntervalIndicatorDerivative(segment: CubicHermiteSegment, decimalPlaces?: number) {
  const firstPowerDerivative = formatSoftIntervalPowerDerivative(segment, 1, decimalPlaces);
  return `-(${firstPowerDerivative})/(${formatSoftIntervalBase(segment, decimalPlaces)})^2`;
}

function formatSoftIntervalIndicatorSecondDerivative(segment: CubicHermiteSegment, decimalPlaces?: number) {
  const firstPowerDerivative = formatSoftIntervalPowerDerivative(segment, 1, decimalPlaces);
  const secondPowerDerivative = formatSoftIntervalPowerDerivative(segment, 2, decimalPlaces);
  const base = formatSoftIntervalBase(segment, decimalPlaces);
  return `-(${secondPowerDerivative})/(${base})^2+2*(${firstPowerDerivative})^2/(${base})^3`;
}

function formatSoftIntervalBase(segment: CubicHermiteSegment, decimalPlaces?: number) {
  return `1+${formatSoftIntervalPower(segment, SOFT_INTERVAL_INDICATOR_POWER * 2, decimalPlaces)}`;
}

function formatSoftIntervalPower(segment: CubicHermiteSegment, power: number, decimalPlaces?: number) {
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  return `((${formatXOffset(center, decimalPlaces)})/${formatDecimal(halfWidth, decimalPlaces)})^${power}`;
}

function formatSoftIntervalPowerDerivative(
  segment: CubicHermiteSegment,
  derivativeOrder: 1 | 2,
  decimalPlaces?: number,
) {
  const power = SOFT_INTERVAL_INDICATOR_POWER * 2;
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  const coefficient = derivativeOrder === 1 ? power / halfWidth : (power * (power - 1)) / halfWidth ** 2;
  return `${formatDecimal(coefficient, decimalPlaces)}*((${formatXOffset(center, decimalPlaces)})/${formatDecimal(halfWidth, decimalPlaces)})^${power - derivativeOrder}`;
}

function evaluateSoftCubicInterpolationY(
  x: number,
  points: readonly GraphPoint[],
  algorithm: "pchip" | "akima",
  mode: EquationMode,
  options?: FormulaEvaluationOptions,
) {
  const segments = createCubicInterpolationSegments(points, algorithm, options);
  if (segments.length === 0) {
    return points[0]?.y ?? 0;
  }

  let numerator = 0;
  let denominator = 0;
  let firstNumerator = 0;
  let firstDenominator = 0;
  let secondNumerator = 0;
  let secondDenominator = 0;
  for (const segment of segments) {
    const weight = evaluateSoftIntervalIndicator(x, segment);
    const firstWeight = evaluateSoftIntervalIndicatorDerivative(x, segment);
    const secondWeight = evaluateSoftIntervalIndicatorSecondDerivative(x, segment);
    const cubic = evaluateCubicHermiteSegmentY(x, segment);
    const firstCubic = evaluateCubicHermiteSegmentDerivativeY(x, segment);
    const secondCubic = evaluateCubicHermiteSegmentSecondDerivativeY(x, segment);
    numerator += weight * cubic;
    denominator += weight;
    firstNumerator += firstWeight * cubic + weight * firstCubic;
    firstDenominator += firstWeight;
    secondNumerator += secondWeight * cubic + 2 * firstWeight * firstCubic + weight * secondCubic;
    secondDenominator += secondWeight;
  }
  if (denominator === 0) {
    return 0;
  }
  if (mode === "dy") {
    return (firstNumerator * denominator - numerator * firstDenominator) / denominator ** 2;
  }
  if (mode === "ddy") {
    const firstQuotientNumerator = firstNumerator * denominator - numerator * firstDenominator;
    return (
      ((secondNumerator * denominator - numerator * secondDenominator) * denominator -
        2 * firstQuotientNumerator * firstDenominator) /
      denominator ** 3
    );
  }
  return numerator / denominator;
}

function evaluateCubicHermiteSegmentY(x: number, segment: CubicHermiteSegment) {
  const t = (x - segment.startX) / segment.width;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * segment.startY +
    (t3 - 2 * t2 + t) * segment.width * segment.startSlope +
    (-2 * t3 + 3 * t2) * segment.endY +
    (t3 - t2) * segment.width * segment.endSlope
  );
}

function evaluateCubicHermiteSegmentDerivativeY(x: number, segment: CubicHermiteSegment) {
  const t = (x - segment.startX) / segment.width;
  const t2 = t * t;
  return (
    (segment.startY * (6 * t2 - 6 * t)) / segment.width +
    segment.startSlope * (3 * t2 - 4 * t + 1) +
    (segment.endY * (-6 * t2 + 6 * t)) / segment.width +
    segment.endSlope * (3 * t2 - 2 * t)
  );
}

function evaluateCubicHermiteSegmentSecondDerivativeY(x: number, segment: CubicHermiteSegment) {
  const t = (x - segment.startX) / segment.width;
  return (
    (segment.startY * (12 * t - 6)) / segment.width ** 2 +
    (segment.startSlope * (6 * t - 4)) / segment.width +
    (segment.endY * (-12 * t + 6)) / segment.width ** 2 +
    (segment.endSlope * (6 * t - 2)) / segment.width
  );
}

function evaluateSoftIntervalIndicator(x: number, segment: CubicHermiteSegment) {
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  return 1 / (1 + ((x - center) / halfWidth) ** (2 * SOFT_INTERVAL_INDICATOR_POWER));
}

function evaluateSoftIntervalIndicatorDerivative(x: number, segment: CubicHermiteSegment) {
  const base = evaluateSoftIntervalBase(x, segment);
  return -evaluateSoftIntervalPowerDerivative(x, segment, 1) / base ** 2;
}

function evaluateSoftIntervalIndicatorSecondDerivative(x: number, segment: CubicHermiteSegment) {
  const base = evaluateSoftIntervalBase(x, segment);
  const firstPowerDerivative = evaluateSoftIntervalPowerDerivative(x, segment, 1);
  return -evaluateSoftIntervalPowerDerivative(x, segment, 2) / base ** 2 + (2 * firstPowerDerivative ** 2) / base ** 3;
}

function evaluateSoftIntervalBase(x: number, segment: CubicHermiteSegment) {
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  return 1 + ((x - center) / halfWidth) ** (2 * SOFT_INTERVAL_INDICATOR_POWER);
}

function evaluateSoftIntervalPowerDerivative(x: number, segment: CubicHermiteSegment, derivativeOrder: 1 | 2) {
  const power = SOFT_INTERVAL_INDICATOR_POWER * 2;
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  const coefficient = derivativeOrder === 1 ? power / halfWidth : (power * (power - 1)) / halfWidth ** 2;
  return coefficient * ((x - center) / halfWidth) ** (power - derivativeOrder);
}

function createCubicInterpolationSegments(
  points: readonly GraphPoint[],
  algorithm: "pchip" | "akima",
  options?: FormulaEvaluationOptions,
  yOffset = 0,
) {
  const interpolationPoints = normalizeInterpolationPoints(points, options);
  if (interpolationPoints.length < 2) {
    return [];
  }

  const slopes =
    algorithm === "pchip" ? createPchipSlopes(interpolationPoints) : createAkimaSlopes(interpolationPoints);
  const segments: CubicHermiteSegment[] = [];
  for (let index = 0; index < interpolationPoints.length - 1; index += 1) {
    const start = interpolationPoints[index];
    const end = interpolationPoints[index + 1];
    const width = Math.max(end.x - start.x, GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE);
    segments.push({
      startX: start.x,
      endX: start.x + width,
      width,
      startY: start.y + yOffset,
      endY: end.y + yOffset,
      startSlope: slopes[index],
      endSlope: slopes[index + 1],
    });
  }
  return segments;
}

function normalizeInterpolationPoints(points: readonly GraphPoint[], options?: FormulaEvaluationOptions) {
  return points.map((point) =>
    createGraphPoint(normalizeFormulaCoefficient(point.x, options), normalizeFormulaCoefficient(point.y, options)),
  );
}

function createPchipSlopes(points: readonly GraphPoint[]) {
  const segmentSlopes = createSegmentSlopes(points);
  if (segmentSlopes.length === 1) {
    return [segmentSlopes[0], segmentSlopes[0]];
  }

  const widths = createSegmentWidths(points);
  const slopes = Array.from({ length: points.length }, () => 0);
  slopes[0] = createPchipEndpointSlope(widths[0], widths[1], segmentSlopes[0], segmentSlopes[1]);
  slopes[slopes.length - 1] = createPchipEndpointSlope(
    widths[widths.length - 1],
    widths[widths.length - 2],
    segmentSlopes[segmentSlopes.length - 1],
    segmentSlopes[segmentSlopes.length - 2],
  );

  for (let index = 1; index < points.length - 1; index += 1) {
    const previousSlope = segmentSlopes[index - 1];
    const nextSlope = segmentSlopes[index];
    if (previousSlope * nextSlope <= 0) {
      slopes[index] = 0;
      continue;
    }

    const previousWidth = widths[index - 1];
    const nextWidth = widths[index];
    const leftWeight = 2 * nextWidth + previousWidth;
    const rightWeight = nextWidth + 2 * previousWidth;
    slopes[index] = (leftWeight + rightWeight) / (leftWeight / previousSlope + rightWeight / nextSlope);
  }

  return slopes;
}

function createPchipEndpointSlope(width: number, nextWidth: number, slope: number, nextSlope: number) {
  const endpointSlope = ((2 * width + nextWidth) * slope - width * nextSlope) / (width + nextWidth);
  if (endpointSlope * slope <= 0) {
    return 0;
  }
  if (slope * nextSlope < 0 && Math.abs(endpointSlope) > Math.abs(3 * slope)) {
    return 3 * slope;
  }
  return endpointSlope;
}

function createAkimaSlopes(points: readonly GraphPoint[]) {
  const segmentSlopes = createSegmentSlopes(points);
  if (segmentSlopes.length === 1) {
    return [segmentSlopes[0], segmentSlopes[0]];
  }

  const firstSlope = segmentSlopes[0];
  const secondSlope = segmentSlopes[1];
  const lastSlope = segmentSlopes[segmentSlopes.length - 1];
  const penultimateSlope = segmentSlopes[segmentSlopes.length - 2];
  const extendedSlopes = [
    3 * firstSlope - 2 * secondSlope,
    2 * firstSlope - secondSlope,
    ...segmentSlopes,
    2 * lastSlope - penultimateSlope,
    3 * lastSlope - 2 * penultimateSlope,
  ];

  const slopes: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const leftWeight = Math.abs(extendedSlopes[index + 3] - extendedSlopes[index + 2]);
    const rightWeight = Math.abs(extendedSlopes[index + 1] - extendedSlopes[index]);
    slopes.push(
      leftWeight + rightWeight === 0
        ? (extendedSlopes[index + 1] + extendedSlopes[index + 2]) / 2
        : (leftWeight * extendedSlopes[index + 1] + rightWeight * extendedSlopes[index + 2]) /
            (leftWeight + rightWeight),
    );
  }
  return slopes;
}

function createSegmentWidths(points: readonly GraphPoint[]) {
  return points
    .slice(0, -1)
    .map((point, index) => Math.max(points[index + 1].x - point.x, GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE));
}

function createSegmentSlopes(points: readonly GraphPoint[]) {
  return createSegmentWidths(points).map((width, index) => (points[index + 1].y - points[index].y) / width);
}

/** 创建一个连接线段，并把垂直输入拓宽到足以保持公式有限。 */
function createAbsConnectorSegment(start: GraphPoint, end: GraphPoint): AbsConnectorSegment {
  const deltaY = end.y - start.y;
  const rawWidth = end.x - start.x;
  if (rawWidth > ABS_CONNECTOR_MIN_WIDTH) {
    return {
      startX: start.x,
      endX: end.x,
      width: rawWidth,
      deltaY,
    };
  }

  const centerX = (start.x + end.x) / 2;
  return {
    startX: centerX - ABS_CONNECTOR_MIN_WIDTH / 2,
    endX: centerX + ABS_CONNECTOR_MIN_WIDTH / 2,
    width: ABS_CONNECTOR_MIN_WIDTH,
    deltaY,
  };
}

function isRoundedAbsConnectorZero(segment: AbsConnectorSegment, decimalPlaces?: number) {
  return (
    roundToDecimalPlaces(segment.startX, decimalPlaces) === roundToDecimalPlaces(segment.endX, decimalPlaces) &&
    roundToDecimalPlaces(segment.width, decimalPlaces) === 0
  );
}

/** 格式化 a*(x+c)，即导数公式使用的带符号阶梯中心距离。 */
function formatStepDerivativeArgument(steepness: number, centerX: number, decimalPlaces?: number) {
  return `${formatDecimal(steepness, decimalPlaces)}*(x${formatSignedNumber(-centerX, decimalPlaces)})`;
}

/** 格式化抗溢出的 sigmoid 阶梯本体。 */
function formatStableStepSigmoid(
  steepness: number,
  centerX: number,
  decimalPlaces: number | undefined,
  signEpsilon: number,
) {
  const argumentText = formatStepDerivativeArgument(steepness, centerX, decimalPlaces);
  const expText = formatStableStepDerivativeExp(steepness, centerX, decimalPlaces);
  const signText = formatStableSignRatio(argumentText, signEpsilon);
  return `0.5+0.5*${signText}*(1-${expText})/(1+${expText})`;
}

/** 格式化 exp(-abs(a*(x+c)))，避免导数项产生巨大的 exp(...) 中间值。 */
function formatStableStepDerivativeExp(steepness: number, centerX: number, decimalPlaces?: number) {
  return `exp(-abs(${formatStepDerivativeArgument(steepness, centerX, decimalPlaces)}))`;
}

/** 计算与生成表达式一致的抗溢出 sigmoid 近似值。 */
function evaluateStableStepSigmoid(t: number, options?: FormulaEvaluationOptions) {
  const q = Math.exp(-Math.abs(t));
  const sign = evaluateStableSignRatio(t, options);
  return 0.5 + (0.5 * sign * (1 - q)) / (1 + q);
}

/** 模拟输出表达式里的 z / (abs(z)+eps)，避免折点 0 / 0。 */
function evaluateStableSignRatio(value: number, options?: FormulaEvaluationOptions) {
  options?.onSignArgument?.(value);
  return value / (Math.abs(value) + (options?.signEpsilon ?? GRAPHWAR_TOOL_SIGN_EPSILON));
}

function normalizeFormulaCoefficient(value: number, options?: FormulaEvaluationOptions) {
  return roundToDecimalPlaces(value, options?.coefficientDecimalPlaces);
}

/** 分母除零保护值不能跟随用户小数位，否则低精度输出会把它折成 0。 */
function formatSignEpsilon(signEpsilon: number) {
  return formatDecimal(signEpsilon, MAX_FORMULA_DECIMAL_PLACES);
}

function formatStableSignRatio(argumentText: string, signEpsilon: number) {
  if (signEpsilon === 0) {
    return `(${argumentText})/abs(${argumentText})`;
  }
  return `(${argumentText})/(abs(${argumentText})+${formatSignEpsilon(signEpsilon)})`;
}

/** 为双绝对值连接表达式格式化 abs(x+c)。 */
function formatAbsXOffset(centerX: number, decimalPlaces?: number) {
  return `abs(${formatXOffset(centerX, decimalPlaces)})`;
}

/** 格式化 x+c，其中 c 用来把阶梯或连接中心移动到选中点。 */
function formatXOffset(centerX: number, decimalPlaces?: number) {
  const offset = normalizeZero(-centerX, decimalPlaces);
  return offset === 0 ? "x" : `x${formatSignedNumber(offset, decimalPlaces)}`;
}

/** 格式化带符号的 k*body 项，并丢弃四舍五入后为 0 的系数。 */
function formatSignedRawTerm(coefficientValue: number, body: string, decimalPlaces?: number) {
  const coefficient = normalizeZero(coefficientValue, decimalPlaces);
  if (coefficient === 0) {
    return "";
  }

  const sign = coefficient < 0 ? "-" : "+";
  return `${sign}${formatDecimal(Math.abs(coefficient), decimalPlaces)}*${body}`;
}

/** 去掉生成表达式开头无意义的符号。 */
function cleanupExpression(expression: string) {
  return expression.replace(/^0\+/, "").replace(/^0-/, "-").replace(/^\+/, "").trim();
}
