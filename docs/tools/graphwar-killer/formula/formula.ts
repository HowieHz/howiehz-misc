/** 编译用户输入的 Graphwar 表达式，并输出游戏可用的公式文本。 */
import { GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE } from "../core/graphwar";
import {
  MAX_FORMULA_DECIMAL_PLACES,
  formatDecimal,
  formatSignedNumber,
  normalizeZero,
  roundToDecimalPlaces,
} from "../core/numbers";
import type { AlgorithmMode, EquationMode, FormulaResult, GraphPoint, StepTerm } from "../core/types";
import {
  GRAPHWAR_TOOL_SIGN_EPSILON,
  shouldFormatStepTermWithOverflowProtection,
  shouldUseStepOverflowProtection,
} from "./step-numeric-strategy";
import type { FormulaEvaluationOptions, StepOverflowProtectionRange } from "./step-numeric-strategy";
export { GRAPHWAR_TOOL_SIGN_EPSILON } from "./step-numeric-strategy";
export type { FormulaEvaluationOptions, StepOverflowProtectionRange } from "./step-numeric-strategy";

/** 双绝对值连接遇到垂直或反向线段时，使用 Graphwar 源码里的函数最小 x 步长保持公式有限。 */
const ABS_CONNECTOR_MIN_WIDTH = GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE;
/** 软分段权重使用高偶次幂，让相邻 Hermite 段平滑过渡但保持局部主导。 */
const SOFT_INTERVAL_INDICATOR_POWER = 8;
/** 生成可复制公式文本时的选项；与求值选项分开，避免 UI 输出和内部采样互相污染。 */
export interface BuildFormulaOptions {
  /** 稳定符号比值的除零保护值；默认使用工具保护值，传 0 则输出 Graphwar 原始写法。 */
  signEpsilon?: number;
  /** 判断 step 项是否可能溢出的有效 x 范围。 */
  stepOverflowProtectionRange?: StepOverflowProtectionRange;
  /** 是否允许输出抗溢出的 step 表达式。 */
  stepOverflowProtection?: boolean;
}

/** A(abs(x+b)-abs(x+c)) 连接函数使用的标准化线段数据。 */
interface AbsConnectorSegment {
  /** 线段左端 Graphwar x，必要时会被最小宽度保护重算。 */
  startX: number;
  /** 线段右端 Graphwar x，必要时会被最小宽度保护重算。 */
  endX: number;
  /** 受 Graphwar 最小 x 步长保护后的非零宽度。 */
  width: number;
  /** 线段两端的 Graphwar y 差值。 */
  deltaY: number;
}

/** 三次 Hermite 软分段的标准化段数据，同时支持 y、y' 和 y'' 公式生成。 */
interface CubicHermiteSegment {
  /** 分段右端 Graphwar x。 */
  startX: number;
  /** 分段左端 Graphwar x。 */
  endX: number;
  /** 分段宽度，用于归一化 t。 */
  width: number;
  /** 左端 y。 */
  startY: number;
  /** 右端 y。 */
  endY: number;
  /** 左端斜率，来自 PCHIP 或 Akima。 */
  startSlope: number;
  /** 右端斜率，来自 PCHIP 或 Akima。 */
  endSlope: number;
}

/** Abs 连接公式的预编译段，采样时只做代入，避免重复生成文本。 */
interface CompiledAbsConnectorSegment {
  /** Abs 差的系数。 */
  coefficient: number;
  /** 右端 Graphwar x。 */
  endX: number;
  /** 左端 Graphwar x。 */
  startX: number;
  /** 非零段宽，保护垂直线段不会产生无限系数。 */
  width: number;
}

/** Step 公式的一项预编译数据，统一支持 y、y'、y'' 三种模式。 */
interface CompiledStepTerm {
  /** Sigmoid 中心点 Graphwar x。 */
  centerX: number;
  /** 一阶导前置系数。 */
  firstDerivativeCoefficient: number;
  /** 二阶导前置系数。 */
  secondDerivativeCoefficient: number;
  /** 当前项是否必须使用抗溢出的 exp 写法。 */
  useOverflowProtection?: boolean;
  /** Y= 模式累计高度系数。 */
  yCoefficient: number;
}

/** 采样器使用的预编译公式求值器，避免在每个轨迹点重新解析表达式文本。 */
export interface CompiledFormulaEvaluator {
  /** 计算 y'，供 y'= 模式积分和发射角迭代使用。 */
  evaluateFirstDerivativeY: (x: number) => number;
  /** 计算 y''，供 y''= 模式 RK4 使用。 */
  evaluateSecondDerivativeY: (x: number) => number;
  /** 计算 y，供普通 y= 模式和预览使用。 */
  evaluateY: (x: number) => number;
}

/** 根据当前算法生成可复制的 Graphwar 表达式。 */
export function buildFormula(
  points: readonly GraphPoint[],
  steepness: number,
  mode: EquationMode,
  algorithm: AlgorithmMode,
  decimalPlaces?: number,
  options: BuildFormulaOptions = {},
): FormulaResult {
  const signEpsilon = options.signEpsilon ?? GRAPHWAR_TOOL_SIGN_EPSILON;
  const stepOverflowProtection = options.stepOverflowProtection ?? true;
  const stepOverflowProtectionRange = options.stepOverflowProtectionRange;
  const terms = createStepTerms(points);

  if (algorithm === "abs") {
    if (mode === "dy") {
      return {
        // y'= 模式需要输入斜率；abs 连接函数的导数是两个 sign 项的差。
        expression: formatAbsConnectorFirstDerivativeExpression(points, decimalPlaces, signEpsilon),
        terms,
      };
    }

    return {
      // y= 模式输入相对形状即可，Graphwar 会按发射点补回绝对 y。abs + y''= 由页面禁用，不在这里生成。
      expression: formatAbsConnectorExpression(points, decimalPlaces),
      terms,
    };
  }

  if (isCubicInterpolationAlgorithm(algorithm)) {
    return {
      // pchip/akima 共用同一段 Hermite 表达式，再按模式取 y、y' 或 y''。
      // 先减掉首点 y：y= 交给 Graphwar 按发射点平移；y'/y''= 则避免输出会代数抵消的 baseY。
      expression: formatSoftCubicInterpolationExpression(points, algorithm, mode, decimalPlaces, -(points[0]?.y ?? 0)),
      terms,
    };
  }

  if (mode === "y") {
    return {
      // step 的 y= 表达式只输出阶跃累计变化量，绝对高度同样由 Graphwar 的发射点 offset 决定。
      expression: formatStepExpression(
        terms,
        steepness,
        decimalPlaces,
        stepOverflowProtection,
        signEpsilon,
        stepOverflowProtectionRange,
      ),
      terms,
    };
  }

  if (mode === "dy") {
    return {
      // y'= 模式输入 sigmoid 阶跃的一阶导。
      expression: formatStepFirstDerivativeExpression(
        terms,
        steepness,
        decimalPlaces,
        stepOverflowProtection,
        stepOverflowProtectionRange,
      ),
      terms,
    };
  }

  return {
    // y''= 模式输入 sigmoid 阶跃的二阶导。
    expression: formatStepSecondDerivativeExpression(
      terms,
      steepness,
      decimalPlaces,
      stepOverflowProtection,
      signEpsilon,
      stepOverflowProtectionRange,
    ),
    terms,
  };
}

/** 把不随采样 x 变化的公式材料预先整理好，供轨迹采样反复代入。 */
export function compileFormulaEvaluator(
  points: readonly GraphPoint[],
  steepness: number,
  algorithm: AlgorithmMode,
  options?: FormulaEvaluationOptions,
): CompiledFormulaEvaluator {
  if (algorithm === "abs") {
    return compileAbsConnectorEvaluator(points, options);
  }
  if (algorithm === "pchip" || algorithm === "akima") {
    return compileSoftCubicInterpolationEvaluator(points, algorithm);
  }
  return compileStepEvaluator(points, steepness, options);
}

/** 预编译 sigmoid 阶跃公式，避免每个采样 x 重新归一化系数和判断固定抗溢出区间。 */
function compileStepEvaluator(
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
): CompiledFormulaEvaluator {
  const baseY = points[0]?.y ?? 0;
  const terms: CompiledStepTerm[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const centerX = points[index].x;
    const deltaY = points[index].y - points[index - 1].y;
    terms.push({
      centerX,
      firstDerivativeCoefficient: deltaY * steepness,
      secondDerivativeCoefficient: deltaY * steepness * steepness,
      // 有明确保护范围时，每个阶跃项是否需要抗溢出只取决于中心点，可在编译期固定。
      useOverflowProtection: options?.stepOverflowProtectionRange
        ? shouldUseStepOverflowProtection(steepness, centerX, 0, options)
        : undefined,
      yCoefficient: deltaY,
    });
  }

  return {
    evaluateFirstDerivativeY(x) {
      let slope = 0;
      for (const term of terms) {
        const t = steepness * (x - term.centerX);
        if (compiledStepTermUsesOverflowProtection(term, steepness, t, options)) {
          const q = Math.exp(-Math.abs(t));
          slope += (term.firstDerivativeCoefficient * q) / (1 + q) ** 2;
        } else {
          const exp = Math.exp(-t);
          slope += (term.firstDerivativeCoefficient * exp) / (1 + exp) ** 2;
        }
      }
      return slope;
    },
    evaluateSecondDerivativeY(x) {
      let acceleration = 0;
      for (const term of terms) {
        const t = steepness * (x - term.centerX);
        if (compiledStepTermUsesOverflowProtection(term, steepness, t, options)) {
          const q = Math.exp(-Math.abs(t));
          const sign = evaluateStableSignRatio(t, options);
          acceleration += (-term.secondDerivativeCoefficient * sign * q * (1 - q)) / (1 + q) ** 3;
        } else {
          const exp = Math.exp(-t);
          acceleration += (term.secondDerivativeCoefficient * exp * (exp - 1)) / (1 + exp) ** 3;
        }
      }
      return acceleration;
    },
    evaluateY(x) {
      let y = baseY;
      for (const term of terms) {
        const t = steepness * (x - term.centerX);
        y +=
          term.yCoefficient *
          (compiledStepTermUsesOverflowProtection(term, steepness, t, options)
            ? evaluateStableStepSigmoid(t, options)
            : evaluateDirectStepSigmoid(t));
      }
      return y;
    },
  };
}

/** 判断当前 step 项采样时是否走抗溢出分支；有编译期结论时直接复用。 */
function compiledStepTermUsesOverflowProtection(
  term: CompiledStepTerm,
  steepness: number,
  currentArgument: number,
  options?: FormulaEvaluationOptions,
) {
  return (
    term.useOverflowProtection ?? shouldUseStepOverflowProtection(steepness, term.centerX, currentArgument, options)
  );
}

/** 预编译 abs 连接公式，把每段的端点和系数固定下来，采样时只做代入求值。 */
function compileAbsConnectorEvaluator(
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
): CompiledFormulaEvaluator {
  const baseY = points[0]?.y ?? 0;
  const segments: CompiledAbsConnectorSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = createAbsConnectorSegment(points[index - 1], points[index]);
    segments.push({
      coefficient: segment.deltaY / (2 * segment.width),
      endX: segment.endX,
      startX: segment.startX,
      width: segment.width,
    });
  }

  return {
    evaluateFirstDerivativeY(x) {
      let slope = 0;
      for (const segment of segments) {
        slope +=
          segment.coefficient *
          (evaluateStableSignRatio(x - segment.startX, options) - evaluateStableSignRatio(x - segment.endX, options));
      }
      return slope;
    },
    evaluateSecondDerivativeY() {
      return Number.NaN;
    },
    evaluateY(x) {
      let y = baseY;
      for (const segment of segments) {
        y += segment.coefficient * (Math.abs(x - segment.startX) - Math.abs(x - segment.endX) + segment.width);
      }
      return y;
    },
  };
}

/** 预编译 PCHIP/Akima 软分段三次插值，缓存 segments/slopes 供 y、dy、ddy 共用。 */
function compileSoftCubicInterpolationEvaluator(
  points: readonly GraphPoint[],
  algorithm: "pchip" | "akima",
): CompiledFormulaEvaluator {
  const segments = createCubicInterpolationSegments(points, algorithm);
  const fallbackY = points[0]?.y ?? 0;
  return {
    evaluateFirstDerivativeY: (x) => evaluateSoftCubicInterpolationSegmentsY(x, segments, "dy", fallbackY),
    evaluateSecondDerivativeY: (x) => evaluateSoftCubicInterpolationSegmentsY(x, segments, "ddy", fallbackY),
    evaluateY: (x) => evaluateSoftCubicInterpolationSegmentsY(x, segments, "y", fallbackY),
  };
}

/** 将点击路径点转换为阶跃中心点和纵向变化量。 */
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

/** 收窄三次插值算法类型，方便调用方进入 PCHIP/Akima 分支后获得精确类型。 */
function isCubicInterpolationAlgorithm(algorithm: AlgorithmMode): algorithm is "pchip" | "akima" {
  return algorithm === "pchip" || algorithm === "akima";
}

/** 格式化用户可粘贴到 Graphwar 的基础 y= sigmoid 阶跃表达式。 */
function formatStepExpression(
  terms: readonly StepTerm[],
  steepness: number,
  decimalPlaces: number | undefined,
  stepOverflowProtection: boolean,
  signEpsilon: number,
  stepOverflowProtectionRange: StepOverflowProtectionRange | undefined,
) {
  const parts: string[] = [];
  for (const term of terms) {
    // 只有可能触发 exp 溢出的项才改用稳定 sigmoid，避免无风险区间偏离 Graphwar 原始公式。
    if (
      shouldFormatStepTermWithOverflowProtection(steepness, term.x, stepOverflowProtection, stepOverflowProtectionRange)
    ) {
      parts.push(
        formatSignedRawTerm(
          term.deltaY,
          `(${formatStableStepSigmoid(steepness, term.x, decimalPlaces, signEpsilon)})`,
          decimalPlaces,
        ),
      );
    } else {
      parts.push(
        formatSignedFractionTerm(
          term.deltaY,
          `1+${formatDirectStepDerivativeExp(steepness, term.x, decimalPlaces)}`,
          decimalPlaces,
        ),
      );
    }
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化 sigmoid 阶跃表达式的一阶导。 */
function formatStepFirstDerivativeExpression(
  terms: readonly StepTerm[],
  steepness: number,
  decimalPlaces: number | undefined,
  stepOverflowProtection: boolean,
  stepOverflowProtectionRange: StepOverflowProtectionRange | undefined,
) {
  const parts: string[] = [];
  for (const term of terms) {
    const coefficient = term.deltaY * steepness;
    // 一阶导可直接替换 exp 文本；稳定版和直写版的代数结构相同。
    const expText = shouldFormatStepTermWithOverflowProtection(
      steepness,
      term.x,
      stepOverflowProtection,
      stepOverflowProtectionRange,
    )
      ? formatStableStepDerivativeExp(steepness, term.x, decimalPlaces)
      : formatDirectStepDerivativeExp(steepness, term.x, decimalPlaces);
    parts.push(formatSignedRawTerm(coefficient, `${expText}/(1+${expText})^2`, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化 sigmoid 阶跃表达式的二阶导。 */
function formatStepSecondDerivativeExpression(
  terms: readonly StepTerm[],
  steepness: number,
  decimalPlaces: number | undefined,
  stepOverflowProtection: boolean,
  signEpsilon: number,
  stepOverflowProtectionRange: StepOverflowProtectionRange | undefined,
) {
  const parts: string[] = [];
  for (const term of terms) {
    const coefficient = term.deltaY * steepness * steepness;
    // 二阶导稳定写法需要额外的 sign(t)，用于还原 exp(-abs(t)) 两侧的方向。
    if (
      shouldFormatStepTermWithOverflowProtection(steepness, term.x, stepOverflowProtection, stepOverflowProtectionRange)
    ) {
      const argumentText = formatStepDerivativeArgument(steepness, term.x, decimalPlaces);
      const expText = formatStableStepDerivativeExp(steepness, term.x, decimalPlaces);
      const signText = formatStableSignRatio(argumentText, signEpsilon);
      const body = `${signText}*${expText}*(1-${expText})/(1+${expText})^3`;
      parts.push(formatSignedRawTerm(-coefficient, body, decimalPlaces));
    } else {
      const expText = formatDirectStepDerivativeExp(steepness, term.x, decimalPlaces);
      parts.push(formatSignedRawTerm(coefficient, `${expText}*(${expText}-1)/(1+${expText})^3`, decimalPlaces));
    }
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化相邻点击点之间双绝对值连接函数的 y= 叠加式。 */
function formatAbsConnectorExpression(points: readonly GraphPoint[], decimalPlaces?: number) {
  const parts: string[] = [];
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

/** 把每段 Hermite 曲线用软权重拼成一个 Graphwar 可粘贴的全局表达式。 */
function formatSoftCubicInterpolationExpression(
  points: readonly GraphPoint[],
  algorithm: "pchip" | "akima",
  mode: EquationMode,
  decimalPlaces?: number,
  yOffset = 0,
) {
  const segments = createCubicInterpolationSegments(points, algorithm, yOffset);
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

/** 预先构造软加权商函数的分子/分母及一二阶导组成部分。 */
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

/** 格式化单段 Hermite 三次曲线 y。 */
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

/** 格式化单段 Hermite 三次曲线 y'。 */
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

/** 格式化单段 Hermite 三次曲线 y''。 */
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

/** 格式化软区间权重，权重在分段中心附近最大、远离后快速衰减。 */
function formatSoftIntervalIndicator(segment: CubicHermiteSegment, decimalPlaces?: number) {
  return `1/(${formatSoftIntervalBase(segment, decimalPlaces)})`;
}

/** 格式化软区间权重的一阶导，供商函数求导使用。 */
function formatSoftIntervalIndicatorDerivative(segment: CubicHermiteSegment, decimalPlaces?: number) {
  const firstPowerDerivative = formatSoftIntervalPowerDerivative(segment, 1, decimalPlaces);
  return `-(${firstPowerDerivative})/(${formatSoftIntervalBase(segment, decimalPlaces)})^2`;
}

/** 格式化软区间权重的二阶导，供 y'' 模式使用。 */
function formatSoftIntervalIndicatorSecondDerivative(segment: CubicHermiteSegment, decimalPlaces?: number) {
  const firstPowerDerivative = formatSoftIntervalPowerDerivative(segment, 1, decimalPlaces);
  const secondPowerDerivative = formatSoftIntervalPowerDerivative(segment, 2, decimalPlaces);
  const base = formatSoftIntervalBase(segment, decimalPlaces);
  return `-(${secondPowerDerivative})/(${base})^2+2*(${firstPowerDerivative})^2/(${base})^3`;
}

/** 格式化软权重分母基础项 1+t^n。 */
function formatSoftIntervalBase(segment: CubicHermiteSegment, decimalPlaces?: number) {
  return `1+${formatSoftIntervalPower(segment, SOFT_INTERVAL_INDICATOR_POWER * 2, decimalPlaces)}`;
}

/** 格式化以分段中心和半宽归一化后的幂项。 */
function formatSoftIntervalPower(segment: CubicHermiteSegment, power: number, decimalPlaces?: number) {
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  return `((${formatXOffset(center, decimalPlaces)})/${formatDecimal(halfWidth, decimalPlaces)})^${power}`;
}

/** 格式化归一化幂项的一阶或二阶导。 */
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

/** 直接求值软分段商函数，和格式化表达式保持同一套公式。 */
function evaluateSoftCubicInterpolationSegmentsY(
  x: number,
  segments: readonly CubicHermiteSegment[],
  mode: EquationMode,
  fallbackY: number,
) {
  if (segments.length === 0) {
    return fallbackY;
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

/** 求值单段 Hermite 曲线 y。 */
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

/** 求值单段 Hermite 曲线 y'。 */
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

/** 求值单段 Hermite 曲线 y''。 */
function evaluateCubicHermiteSegmentSecondDerivativeY(x: number, segment: CubicHermiteSegment) {
  const t = (x - segment.startX) / segment.width;
  return (
    (segment.startY * (12 * t - 6)) / segment.width ** 2 +
    (segment.startSlope * (6 * t - 4)) / segment.width +
    (segment.endY * (-12 * t + 6)) / segment.width ** 2 +
    (segment.endSlope * (6 * t - 2)) / segment.width
  );
}

/** 求值软区间权重。 */
function evaluateSoftIntervalIndicator(x: number, segment: CubicHermiteSegment) {
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  return 1 / (1 + ((x - center) / halfWidth) ** (2 * SOFT_INTERVAL_INDICATOR_POWER));
}

/** 求值软区间权重的一阶导。 */
function evaluateSoftIntervalIndicatorDerivative(x: number, segment: CubicHermiteSegment) {
  const base = evaluateSoftIntervalBase(x, segment);
  return -evaluateSoftIntervalPowerDerivative(x, segment, 1) / base ** 2;
}

/** 求值软区间权重的二阶导。 */
function evaluateSoftIntervalIndicatorSecondDerivative(x: number, segment: CubicHermiteSegment) {
  const base = evaluateSoftIntervalBase(x, segment);
  const firstPowerDerivative = evaluateSoftIntervalPowerDerivative(x, segment, 1);
  return -evaluateSoftIntervalPowerDerivative(x, segment, 2) / base ** 2 + (2 * firstPowerDerivative ** 2) / base ** 3;
}

/** 求值软权重分母基础项。 */
function evaluateSoftIntervalBase(x: number, segment: CubicHermiteSegment) {
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  return 1 + ((x - center) / halfWidth) ** (2 * SOFT_INTERVAL_INDICATOR_POWER);
}

/** 求值归一化幂项的一阶或二阶导。 */
function evaluateSoftIntervalPowerDerivative(x: number, segment: CubicHermiteSegment, derivativeOrder: 1 | 2) {
  const power = SOFT_INTERVAL_INDICATOR_POWER * 2;
  const center = (segment.startX + segment.endX) / 2;
  const halfWidth = segment.width / 2;
  const coefficient = derivativeOrder === 1 ? power / halfWidth : (power * (power - 1)) / halfWidth ** 2;
  return coefficient * ((x - center) / halfWidth) ** (power - derivativeOrder);
}

/** 根据 PCHIP/Akima 斜率生成 Hermite 分段，并保护过窄区间。 */
function createCubicInterpolationSegments(points: readonly GraphPoint[], algorithm: "pchip" | "akima", yOffset = 0) {
  const interpolationPoints = [...points];
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

/** 计算 PCHIP 斜率，保持单调区间不产生过冲。 */
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

/** 计算 PCHIP 端点斜率，并按算法规则限制反号和过大斜率。 */
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

/** 计算 Akima 斜率，降低局部异常点对相邻段的影响。 */
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

/** 创建分段宽度，并用 Graphwar 最小 x 步长保护零宽段。 */
function createSegmentWidths(points: readonly GraphPoint[]) {
  return points
    .slice(0, -1)
    .map((point, index) => Math.max(points[index + 1].x - point.x, GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE));
}

/** 创建相邻控制点的割线斜率。 */
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

/** 判断 abs 连接段在当前输出精度下是否会被四舍五入成零宽无效项。 */
function isRoundedAbsConnectorZero(segment: AbsConnectorSegment, decimalPlaces?: number) {
  return (
    roundToDecimalPlaces(segment.startX, decimalPlaces) === roundToDecimalPlaces(segment.endX, decimalPlaces) &&
    roundToDecimalPlaces(segment.width, decimalPlaces) === 0
  );
}

/** 格式化 a*(x+c)，即导数公式使用的带符号阶跃中心距离。 */
function formatStepDerivativeArgument(steepness: number, centerX: number, decimalPlaces?: number) {
  return `${formatDecimal(steepness, decimalPlaces)}*(x${formatSignedNumber(-centerX, decimalPlaces)})`;
}

/** 格式化抗溢出的 sigmoid 阶跃本体。 */
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

/** 格式化朴素 exp(-a*(x+c))，与 Graphwar 实际表达式数值行为一致。 */
function formatDirectStepDerivativeExp(steepness: number, centerX: number, decimalPlaces?: number) {
  return `exp(-${formatStepDerivativeArgument(steepness, centerX, decimalPlaces)})`;
}

/** 计算与生成表达式一致的抗溢出 sigmoid 近似值。 */
function evaluateStableStepSigmoid(t: number, options?: FormulaEvaluationOptions) {
  const q = Math.exp(-Math.abs(t));
  const sign = evaluateStableSignRatio(t, options);
  return 0.5 + (0.5 * sign * (1 - q)) / (1 + q);
}

/** 计算朴素 1/(1+exp(-t))，保留溢出后的实际 JS/Graphwar 数值行为。 */
function evaluateDirectStepSigmoid(t: number) {
  return 1 / (1 + Math.exp(-t));
}

/** 模拟输出表达式里的 z / (abs(z)+eps)，避免折点 0 / 0。 */
function evaluateStableSignRatio(value: number, options?: FormulaEvaluationOptions) {
  options?.onSignArgument?.(value);
  return value / (Math.abs(value) + (options?.signEpsilon ?? GRAPHWAR_TOOL_SIGN_EPSILON));
}

/** 分母除零保护值不能跟随用户小数位，否则低精度输出会把它折成 0。 */
function formatSignEpsilon(signEpsilon: number) {
  return formatDecimal(signEpsilon, MAX_FORMULA_DECIMAL_PLACES);
}

/** 格式化稳定符号比值；epsilon 为 0 时保留原始 abs 分母写法。 */
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

/** 格式化 x+c，其中 c 用来把阶跃或连接中心移动到选中点。 */
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

/** 格式化带符号的 k/(body) 项，并丢弃四舍五入后为 0 的系数。 */
function formatSignedFractionTerm(coefficientValue: number, denominator: string, decimalPlaces?: number) {
  const coefficient = normalizeZero(coefficientValue, decimalPlaces);
  if (coefficient === 0) {
    return "";
  }

  const sign = coefficient < 0 ? "-" : "+";
  return `${sign}${formatDecimal(Math.abs(coefficient), decimalPlaces)}/(${denominator})`;
}

/** 去掉生成表达式开头无意义的符号。 */
function cleanupExpression(expression: string) {
  return expression.replace(/^0\+/, "").replace(/^0-/, "-").replace(/^\+/, "").trim();
}
