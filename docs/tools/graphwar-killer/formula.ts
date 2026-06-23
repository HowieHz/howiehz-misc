import { GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE } from "./graphwar";
import { MAX_FORMULA_DECIMAL_PLACES, formatDecimal, formatSignedNumber, normalizeZero } from "./numbers";
import { graphwarToolDefaults } from "./tool-defaults";
import type { AlgorithmMode, EquationMode, FormulaResult, GraphPoint, StepTerm } from "./types";

/** 双绝对值连接遇到垂直或反向线段时，使用 Graphwar 源码里的函数最小 x 步长保持公式有限。 */
const ABS_CONNECTOR_MIN_WIDTH = GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE;

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
      : mode === "y"
        ? formatStepExpression(0, terms, steepness, decimalPlaces, signEpsilon)
        : mode === "dy"
          ? formatStepFirstDerivativeExpression(terms, steepness, decimalPlaces)
          : formatStepSecondDerivativeExpression(terms, steepness, decimalPlaces, signEpsilon);
  const previewExpression =
    algorithm === "abs"
      ? formatAbsConnectorExpression(points, decimalPlaces)
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
    const coefficient = normalizeFormulaCoefficient(segment.deltaY / (2 * segment.width), options);
    const width = normalizeFormulaCoefficient(segment.width, options);
    y += coefficient * (Math.abs(x - segment.startX) - Math.abs(x - segment.endX) + width);
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
    const coefficient = normalizeFormulaCoefficient(segment.deltaY / (2 * segment.width), options);
    slope +=
      coefficient *
      (evaluateStableSignRatio(x - segment.startX, options) - evaluateStableSignRatio(x - segment.endX, options));
  }
  return slope;
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
    const coefficient = segment.deltaY / (2 * segment.width);
    const startText = formatXOffset(segment.startX, decimalPlaces);
    const endText = formatXOffset(segment.endX, decimalPlaces);
    const body = `${formatStableSignRatio(startText, signEpsilon)}-${formatStableSignRatio(endText, signEpsilon)}`;
    parts.push(formatSignedRawTerm(coefficient, `(${body})`, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
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
  return normalizeZero(value, options?.coefficientDecimalPlaces);
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
  return `x${formatSignedNumber(-centerX, decimalPlaces)}`;
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
