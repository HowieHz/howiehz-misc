/** 编译用户输入的 Graphwar 表达式，并输出游戏可用的公式文本。 */
import { GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE } from "../../core/game/constants";
import {
  formatDecimal,
  formatDoublePrecisionDecimal,
  formatSignedNumber,
  normalizeZero,
  roundToDecimalPlaces,
} from "../../core/numbers";
import type { AlgorithmMode, EquationMode, FormulaResult, GraphPoint, StepTerm } from "../../core/types";
import { GRAPHWAR_TOOL_SIGN_EPSILON, shouldUseStepDerivativeOverflowProtection } from "./step-numeric-strategy";
import type { FormulaEvaluationOptions, StepGlitchSegment, StepOverflowProtectionRange } from "./step-numeric-strategy";
export { GRAPHWAR_TOOL_SIGN_EPSILON } from "./step-numeric-strategy";
export type { FormulaEvaluationOptions, StepOverflowProtectionRange } from "./step-numeric-strategy";

/** 双绝对值连接遇到垂直或反向线段时，使用 Graphwar 源码里的函数最小 x 步长保持公式有限。 */
const ABS_CONNECTOR_MIN_WIDTH = GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE;
/** 软分段权重使用高偶次幂，让相邻 Hermite 段平滑过渡但保持局部主导。 */
const SOFT_INTERVAL_INDICATOR_POWER = 8;
/** 生成可复制公式文本时的选项；与求值选项分开，避免 UI 输出和内部采样互相污染。 */
export interface BuildFormulaOptions {
  /** 已按最终文本规则预编译的公式材料；传入后避免重复建段和重复舍入。 */
  compiledMaterials?: CompiledGraphwarFormulaMaterials;
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

/** Abs 连接公式的最终文本等价预编译段，采样时只做代入，避免重复生成文本。 */
export interface CompiledAbsConnectorSegment {
  /** 最终公式里实际输出的 Abs 差系数。 */
  coefficient: number;
  /** 最终公式里实际输出的右端 Graphwar x。 */
  endX: number;
  /** 最终公式里实际输出的左端 Graphwar x。 */
  startX: number;
  /** 最终公式里实际输出的非零段宽。 */
  width: number;
}

/** Step 公式的一项最终文本等价预编译数据，统一支持 y、y'、y'' 三种模式。 */
export interface CompiledStepTerm {
  /** 最终公式里的 Sigmoid 中心点。 */
  formulaCenterX: number;
  /** Y'= 漏洞模式下替换普通 step 项的高导数门函数。 */
  glitchSegment?: StepGlitchSegment;
  /** 一阶导前置系数。 */
  firstDerivativeCoefficient: number;
  /** 二阶导前置系数。 */
  secondDerivativeCoefficient: number;
  /** 导数项是否必须使用抗溢出的 exp 写法。 */
  derivativeUsesOverflowProtection: boolean;
  /** Y= 模式累计高度系数。 */
  yCoefficient: number;
}

/** Step 公式最终文本等价材料；同一份数据应同时服务输出和采样。 */
export interface CompiledStepFormula {
  /** 最终公式文本里的陡峭度。 */
  formulaSteepness: number;
  /** 当前精度下仍会输出的阶跃项。 */
  terms: CompiledStepTerm[];
}

/** 最终文本等价的公式材料；context 内应编译一次，再供文本、探测和采样复用。 */
export interface CompiledGraphwarFormulaMaterials {
  /** 当前材料对应的公式算法。 */
  algorithm: AlgorithmMode;
  /** Abs 算法当前精度下仍会输出的连接段。 */
  absSegments?: readonly CompiledAbsConnectorSegment[];
  /** Step 算法当前精度下仍会输出的阶跃项。 */
  stepFormula?: CompiledStepFormula;
}

/** 采样器使用的预编译公式求值器，避免在每个轨迹点重新解析表达式文本。 */
export interface CompiledFormulaEvaluator {
  /** 计算 y'，供 y'= 模式积分和发射角迭代使用。 */
  evaluateFirstDerivativeY: (x: number, y: number) => number;
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
  const formulaEvaluation = createFormulaEvaluationOptions(decimalPlaces, options);
  const compiledMaterials =
    options.compiledMaterials ?? compileGraphwarFormulaMaterials(points, steepness, algorithm, formulaEvaluation);
  const terms = createStepTerms(points);

  if (algorithm === "abs") {
    const segments = getCompiledAbsConnectorSegments(points, formulaEvaluation, compiledMaterials);
    if (mode === "dy") {
      return {
        // y'= 模式需要输入斜率；abs 连接函数的导数是两个 sign 项的差。
        expression: formatAbsConnectorFirstDerivativeExpression(segments, decimalPlaces, signEpsilon),
        terms,
      };
    }

    return {
      // y= 模式输入相对形状即可，Graphwar 会按发射点补回绝对 y。abs + y''= 由页面禁用，不在这里生成。
      expression: formatAbsConnectorExpression(segments, decimalPlaces),
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
    const stepFormula = getCompiledStepFormula(points, steepness, formulaEvaluation, compiledMaterials);
    return {
      // step 的 y= 表达式只输出阶跃累计变化量，绝对高度同样由 Graphwar 的发射点 offset 决定。
      expression: formatStepExpression(stepFormula, decimalPlaces),
      terms,
    };
  }

  if (mode === "dy") {
    const stepFormula = getCompiledStepFormula(points, steepness, formulaEvaluation, compiledMaterials);
    return {
      // y'= 模式输入 sigmoid 阶跃的一阶导。
      expression: formatStepFirstDerivativeExpression(stepFormula, decimalPlaces, signEpsilon),
      terms,
    };
  }

  const stepFormula = getCompiledStepFormula(points, steepness, formulaEvaluation, compiledMaterials);
  return {
    // y''= 模式输入 sigmoid 阶跃的二阶导。
    expression: formatStepSecondDerivativeExpression(stepFormula, decimalPlaces, signEpsilon),
    terms,
  };
}

/** 把不随采样 x 变化的公式材料预先整理好，供轨迹采样反复代入。 */
export function compileFormulaEvaluator(
  points: readonly GraphPoint[],
  steepness: number,
  algorithm: AlgorithmMode,
  options?: FormulaEvaluationOptions,
  compiledMaterials = compileGraphwarFormulaMaterials(points, steepness, algorithm, options),
): CompiledFormulaEvaluator {
  if (algorithm === "abs") {
    return compileAbsConnectorEvaluator(points, options, compiledMaterials);
  }
  if (algorithm === "pchip" || algorithm === "akima") {
    return compileSoftCubicInterpolationEvaluator(points, algorithm);
  }
  return compileStepEvaluator(points, steepness, options, compiledMaterials);
}

/** 判断最终公式文本里是否存在 z/abs(z) 形态的符号比值；无 sign 子表达式时不应探测 epsilon。 */
export function formulaUsesStableSignRatio(
  points: readonly GraphPoint[],
  steepness: number,
  mode: EquationMode,
  algorithm: AlgorithmMode,
  options?: FormulaEvaluationOptions,
  compiledMaterials = compileGraphwarFormulaMaterials(points, steepness, algorithm, options),
) {
  if (algorithm === "abs") {
    return mode === "dy" && getCompiledAbsConnectorSegments(points, options, compiledMaterials).length > 0;
  }
  if (algorithm === "step" && mode === "dy") {
    return getCompiledStepFormula(points, steepness, options, compiledMaterials).terms.some((term) =>
      Boolean(term.glitchSegment),
    );
  }
  if (algorithm !== "step" || mode !== "ddy") {
    return false;
  }

  const stepFormula = getCompiledStepFormula(points, steepness, options, compiledMaterials);
  return stepFormula.terms.some(
    (term) => term.secondDerivativeCoefficient !== 0 && term.derivativeUsesOverflowProtection,
  );
}

/** 按最终文本规则预编译公式材料；结果可结构化传递，不包含闭包。 */
export function compileGraphwarFormulaMaterials(
  points: readonly GraphPoint[],
  steepness: number,
  algorithm: AlgorithmMode,
  options?: FormulaEvaluationOptions,
): CompiledGraphwarFormulaMaterials {
  if (algorithm === "abs") {
    return {
      algorithm,
      absSegments: createCompiledAbsConnectorSegments(points, options),
    };
  }
  if (algorithm === "step") {
    return {
      algorithm,
      stepFormula: createCompiledStepFormula(points, steepness, options),
    };
  }
  return { algorithm };
}

/** 预编译 sigmoid 阶跃公式，避免每个采样 x 重新归一化系数和判断固定抗溢出区间。 */
function compileStepEvaluator(
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
  compiledMaterials?: CompiledGraphwarFormulaMaterials,
): CompiledFormulaEvaluator {
  const baseY = points[0]?.y ?? 0;
  const formula = getCompiledStepFormula(points, steepness, options, compiledMaterials);

  return {
    evaluateFirstDerivativeY(x, y) {
      let slope = 0;
      for (let index = formula.terms.length - 1; index >= 0; index -= 1) {
        const term = formula.terms[index];
        if (term.glitchSegment) {
          slope = evaluateCompiledStepGlitchFirstDerivative(x, y, term.glitchSegment, options) + slope;
          continue;
        }
        if (term.firstDerivativeCoefficient === 0) {
          // 最终公式会省略 0 系数项；编译路径也不应求值其 body，避免 0 * NaN 偏离文本回放。
          continue;
        }

        const t = formula.formulaSteepness * (x - term.formulaCenterX);
        if (term.derivativeUsesOverflowProtection) {
          // Stable 文本同样由首个 * 作为 Graphwar Polish 根节点，应先折叠右侧分式再乘系数。
          slope = term.firstDerivativeCoefficient * evaluateCompiledStepStableFirstDerivativeBody(t) + slope;
        } else {
          // Graphwar 输出公式应先算 exp/(1+exp)^2，再乘系数；预编译路径保持同一求值顺序。
          slope = term.firstDerivativeCoefficient * evaluateCompiledStepDirectFirstDerivativeBody(t) + slope;
        }
      }
      return slope;
    },
    evaluateSecondDerivativeY(x) {
      let acceleration = 0;
      for (let index = formula.terms.length - 1; index >= 0; index -= 1) {
        const term = formula.terms[index];
        if (term.glitchSegment) {
          continue;
        }
        if (term.secondDerivativeCoefficient === 0) {
          // 省略项没有 sign(t) 子表达式；跳过才能让 sign epsilon 探测与最终文本一致。
          continue;
        }

        const t = formula.formulaSteepness * (x - term.formulaCenterX);
        if (term.derivativeUsesOverflowProtection) {
          const sign = evaluateStableSignRatio(t, options);
          // Stable 二阶导文本是 k*sign*q*(1-q)/denom；Graphwar 会逐层把左侧 * 作为根节点。
          acceleration =
            -term.secondDerivativeCoefficient * (sign * evaluateCompiledStepStableSecondDerivativeBody(t)) +
            acceleration;
        } else {
          // Graphwar 的 Polish 重排会让 exp*((exp-1)/(1+exp)^3) 先结合，避免系数乘法提前溢出。
          acceleration =
            term.secondDerivativeCoefficient * evaluateCompiledStepDirectSecondDerivativeBody(t) + acceleration;
        }
      }
      return acceleration;
    },
    evaluateY(x) {
      let yOffset = 0;
      for (let index = formula.terms.length - 1; index >= 0; index -= 1) {
        const term = formula.terms[index];
        if (term.glitchSegment) {
          continue;
        }
        if (term.yCoefficient === 0) {
          continue;
        }

        const t = formula.formulaSteepness * (x - term.formulaCenterX);
        yOffset = term.yCoefficient / (1 + evaluateCompiledStepExp(-t)) + yOffset;
      }
      return baseY + yOffset;
    },
  };
}

/** Graphwar 会把 exp(z) 改写成 e^z；内部回放也应走同一种 pow 语义。 */
function evaluateCompiledStepExp(argument: number) {
  return Math.pow(Math.E, argument);
}

/** 回放一阶导 direct 文本里的 exp/(1+exp)^2；同参 pow 是纯函数，可以在单项内缓存。 */
function evaluateCompiledStepDirectFirstDerivativeBody(t: number) {
  const exp = evaluateCompiledStepExp(-t);
  const denominator = 1 + exp;
  return exp / denominator ** 2;
}

/** 回放一阶导 stable 文本里的 q/(1+q)^2，并保持 Graphwar 的 pow 语义。 */
function evaluateCompiledStepStableFirstDerivativeBody(t: number) {
  const q = evaluateCompiledStepExp(-Math.abs(t));
  const denominator = 1 + q;
  return q / denominator ** 2;
}

/** 回放二阶导 direct 文本里的 exp*((exp-1)/(1+exp)^3)。 */
function evaluateCompiledStepDirectSecondDerivativeBody(t: number) {
  const exp = evaluateCompiledStepExp(-t);
  const denominator = 1 + exp;
  return exp * ((exp - 1) / denominator ** 3);
}

/** 回放二阶导 stable 文本中位于 sign 右侧的 q*((1-q)/(1+q)^3)。 */
function evaluateCompiledStepStableSecondDerivativeBody(t: number) {
  const q = evaluateCompiledStepExp(-Math.abs(t));
  const denominator = 1 + q;
  return q * ((1 - q) / denominator ** 3);
}

/** 回放漏洞模式门函数；x 右门负责让旧漏洞只在局部窗口内生效。 */
function evaluateCompiledStepGlitchFirstDerivative(
  x: number,
  y: number,
  segment: StepGlitchSegment,
  options?: FormulaEvaluationOptions,
) {
  const direction = segment.derivative < 0 ? -1 : 1;
  const xGate = 1 + evaluateStableSignRatio(x - segment.startX, options);
  const xLimitGate = 1 - evaluateStableSignRatio(x - segment.endX, options);
  const yGate = 1 + evaluateStableSignRatio(direction * (segment.gateY - y), options);
  return (segment.derivative / 8) * xGate * xLimitGate * yGate;
}

/** 内部 step 采样应使用最终公式文本中的陡峭度，确保 y/dy/ddy 回放一致。 */
function createCompiledStepFormula(
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
) {
  const formulaSteepness = createCompiledStepFormulaSteepness(steepness, options);
  const terms: CompiledStepTerm[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const glitchSegment = createCompiledStepGlitchSegment(options?.stepGlitchSegments?.[index - 1], options);
    const formulaCenterX = createCompiledFormulaXCenter(points[index].x, options);
    const deltaY = options?.stepSegmentDeltaYs?.[index - 1] ?? points[index].y - points[index - 1].y;
    const yCoefficient = createCompiledFormulaCoefficient(deltaY, options);
    const firstDerivativeCoefficient = createCompiledFormulaCoefficient(deltaY * steepness, options);
    const secondDerivativeCoefficient = createCompiledFormulaCoefficient(deltaY * steepness * steepness, options);
    if (!glitchSegment && yCoefficient === 0 && firstDerivativeCoefficient === 0 && secondDerivativeCoefficient === 0) {
      continue;
    }

    terms.push({
      formulaCenterX,
      ...(glitchSegment ? { glitchSegment } : {}),
      derivativeUsesOverflowProtection: createCompiledStepDerivativeOverflowProtection(
        formulaSteepness,
        formulaCenterX,
        options,
      ),
      firstDerivativeCoefficient,
      secondDerivativeCoefficient,
      yCoefficient,
    });
  }

  return { formulaSteepness, terms };
}

function createCompiledStepGlitchSegment(
  segment: StepGlitchSegment | undefined,
  options?: FormulaEvaluationOptions,
): StepGlitchSegment | undefined {
  if (!segment) {
    return undefined;
  }

  return {
    derivative: createCompiledFormulaCoefficient(segment.derivative, options),
    endX: segment.endX,
    gateY: createCompiledFormulaYCenter(segment.gateY, options),
    startX: segment.startX,
    targetY: createCompiledFormulaYCenter(segment.targetY, options),
  };
}

function createCompiledStepFormulaSteepness(steepness: number, options?: FormulaEvaluationOptions) {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  return decimalPlaces === undefined ? steepness : roundToDecimalPlaces(steepness, decimalPlaces);
}

/** 内部 step 采样应使用最终公式文本中的中心点，避免小数位边界偏移。 */
function createCompiledFormulaXCenter(centerX: number, options?: FormulaEvaluationOptions) {
  return createCompiledFormulaOffsetCenter(centerX, options);
}

/** 内部 step 采样应使用最终公式文本中的 y 阈值，避免小数位边界偏移。 */
function createCompiledFormulaYCenter(centerY: number, options?: FormulaEvaluationOptions) {
  return createCompiledFormulaOffsetCenter(centerY, options);
}

function createCompiledFormulaOffsetCenter(center: number, options?: FormulaEvaluationOptions) {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  return decimalPlaces === undefined ? center : -roundToDecimalPlaces(-center, decimalPlaces);
}

/** 无采样范围时，编译路径应与公式输出一样保守使用 stable 导数形式。 */
function createCompiledStepDerivativeOverflowProtection(
  steepness: number,
  centerX: number,
  options?: FormulaEvaluationOptions,
) {
  return options?.stepOverflowProtectionRange
    ? shouldUseStepDerivativeOverflowProtection(steepness, centerX, options)
    : (options?.stepOverflowProtection ?? true);
}

/** 内部 step 采样应使用最终公式文本中的系数，省略项和低精度系数才不会影响轨迹。 */
function createCompiledFormulaCoefficient(coefficientValue: number, options?: FormulaEvaluationOptions) {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  if (decimalPlaces === undefined) {
    return coefficientValue;
  }

  // formatSignedRawTerm 先按原符号决定 +/-，再格式化绝对值；这里按同一规则生成可求值数字。
  const normalizedCoefficient = normalizeZero(coefficientValue, decimalPlaces);
  if (normalizedCoefficient === 0) {
    return 0;
  }

  const magnitude = roundToDecimalPlaces(Math.abs(normalizedCoefficient), decimalPlaces);
  return normalizedCoefficient < 0 ? -magnitude : magnitude;
}

/** 编译和输出都应显式使用同一份最终公式小数位。 */
function getFormulaDecimalPlaces(options?: FormulaEvaluationOptions) {
  return options?.formulaDecimalPlaces;
}

/** `buildFormula` 的 options 应转成采样层可复用的公式等价配置。 */
function createFormulaEvaluationOptions(
  decimalPlaces: number | undefined,
  options: BuildFormulaOptions,
): FormulaEvaluationOptions {
  return {
    formulaDecimalPlaces: decimalPlaces,
    stepOverflowProtection: options.stepOverflowProtection ?? true,
    stepOverflowProtectionRange: options.stepOverflowProtectionRange,
  };
}

function getCompiledAbsConnectorSegments(
  points: readonly GraphPoint[],
  options: FormulaEvaluationOptions | undefined,
  compiledMaterials: CompiledGraphwarFormulaMaterials | undefined,
) {
  return compiledMaterials?.algorithm === "abs" && compiledMaterials.absSegments
    ? compiledMaterials.absSegments
    : createCompiledAbsConnectorSegments(points, options);
}

function getCompiledStepFormula(
  points: readonly GraphPoint[],
  steepness: number,
  options: FormulaEvaluationOptions | undefined,
  compiledMaterials: CompiledGraphwarFormulaMaterials | undefined,
) {
  return compiledMaterials?.algorithm === "step" && compiledMaterials.stepFormula
    ? compiledMaterials.stepFormula
    : createCompiledStepFormula(points, steepness, options);
}

/** Abs 连接段应按最终公式文本里的数字预编译，避免探测 raw double 折点。 */
function createCompiledAbsConnectorSegments(
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
): CompiledAbsConnectorSegment[] {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  const segments: CompiledAbsConnectorSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = createAbsConnectorSegment(points[index - 1], points[index]);
    if (isRoundedAbsConnectorZero(segment, decimalPlaces)) {
      continue;
    }

    const coefficient = createCompiledFormulaCoefficient(segment.deltaY / (2 * segment.width), options);
    if (coefficient === 0) {
      continue;
    }

    segments.push({
      coefficient,
      endX: createCompiledFormulaXCenter(segment.endX, options),
      startX: createCompiledFormulaXCenter(segment.startX, options),
      width: createCompiledFormulaDistance(segment.width, options),
    });
  }
  return segments;
}

/** 正长度参数在文本里用普通数字格式化，应与 formatDecimal 的舍入规则一致。 */
function createCompiledFormulaDistance(value: number, options?: FormulaEvaluationOptions) {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  return decimalPlaces === undefined ? value : roundToDecimalPlaces(value, decimalPlaces);
}

/** 预编译 abs 连接公式，把每段的端点和系数固定下来，采样时只做代入求值。 */
function compileAbsConnectorEvaluator(
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
  compiledMaterials?: CompiledGraphwarFormulaMaterials,
): CompiledFormulaEvaluator {
  const baseY = points[0]?.y ?? 0;
  const segments = getCompiledAbsConnectorSegments(points, options, compiledMaterials);

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
function formatStepExpression(formula: CompiledStepFormula, decimalPlaces: number | undefined) {
  const parts: string[] = [];
  for (const term of formula.terms) {
    if (term.yCoefficient === 0) {
      continue;
    }

    // y= 直写 sigmoid 在 Graphwar 中即使 exp 溢出也会自然趋近 0/1，应避免改写引入 sign 折点。
    parts.push(
      formatSignedFractionTerm(
        term.yCoefficient,
        `1+${formatDirectStepDerivativeExp(formula.formulaSteepness, term.formulaCenterX, decimalPlaces)}`,
        decimalPlaces,
      ),
    );
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化 sigmoid 阶跃表达式的一阶导。 */
function formatStepFirstDerivativeExpression(
  formula: CompiledStepFormula,
  decimalPlaces: number | undefined,
  signEpsilon: number,
) {
  const parts: string[] = [];
  for (const term of formula.terms) {
    if (term.glitchSegment) {
      parts.push(formatStepGlitchFirstDerivativeExpression(term.glitchSegment, decimalPlaces, signEpsilon));
      continue;
    }
    if (term.firstDerivativeCoefficient === 0) {
      continue;
    }

    // 一阶导可直接替换 exp 文本；稳定版和直写版的代数结构相同。
    const expText = term.derivativeUsesOverflowProtection
      ? formatStableStepDerivativeExp(formula.formulaSteepness, term.formulaCenterX, decimalPlaces)
      : formatDirectStepDerivativeExp(formula.formulaSteepness, term.formulaCenterX, decimalPlaces);
    parts.push(formatSignedRawTerm(term.firstDerivativeCoefficient, `${expText}/(1+${expText})^2`, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化局部漏洞项；右侧 x 门会在候选窗口末端关闭旧漏洞。 */
function formatStepGlitchFirstDerivativeExpression(
  segment: StepGlitchSegment,
  decimalPlaces: number | undefined,
  signEpsilon: number,
) {
  const direction = segment.derivative < 0 ? -1 : 1;
  const xGate = `1+${formatStableSignRatio(formatStepGlitchXOffset(segment.startX), signEpsilon)}`;
  const xLimitGate = `1-${formatStableSignRatio(formatStepGlitchXOffset(segment.endX), signEpsilon)}`;
  const yGate = `1+${formatStableSignRatio(
    formatDirectedTargetYOffset(segment.gateY, direction, decimalPlaces),
    signEpsilon,
  )}`;
  // 三个 sign 门全开时乘积是 8，因此文本系数使用 D/8，实际导数仍是 D。
  return formatSignedRawTerm(segment.derivative / 8, `(${xGate})*(${xLimitGate})*(${yGate})`, decimalPlaces);
}

/** 格式化 sigmoid 阶跃表达式的二阶导。 */
function formatStepSecondDerivativeExpression(
  formula: CompiledStepFormula,
  decimalPlaces: number | undefined,
  signEpsilon: number,
) {
  const parts: string[] = [];
  for (const term of formula.terms) {
    if (term.secondDerivativeCoefficient === 0) {
      continue;
    }

    // 二阶导稳定写法需要额外的 sign(t)，用于还原 exp(-abs(t)) 两侧的方向。
    if (term.derivativeUsesOverflowProtection) {
      const argumentText = formatStepDerivativeArgument(formula.formulaSteepness, term.formulaCenterX, decimalPlaces);
      const expText = formatStableStepDerivativeExp(formula.formulaSteepness, term.formulaCenterX, decimalPlaces);
      const signText = formatStableSignRatio(argumentText, signEpsilon);
      const body = `${signText}*${expText}*(1-${expText})/(1+${expText})^3`;
      parts.push(formatSignedRawTerm(-term.secondDerivativeCoefficient, body, decimalPlaces));
    } else {
      const expText = formatDirectStepDerivativeExp(formula.formulaSteepness, term.formulaCenterX, decimalPlaces);
      parts.push(
        formatSignedRawTerm(
          term.secondDerivativeCoefficient,
          `${expText}*(${expText}-1)/(1+${expText})^3`,
          decimalPlaces,
        ),
      );
    }
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化相邻点击点之间双绝对值连接函数的 y= 叠加式。 */
function formatAbsConnectorExpression(segments: readonly CompiledAbsConnectorSegment[], decimalPlaces?: number) {
  const parts: string[] = [];
  for (const segment of segments) {
    const body = `${formatAbsXOffset(segment.startX, decimalPlaces)}-${formatAbsXOffset(segment.endX, decimalPlaces)}+${formatDecimal(segment.width, decimalPlaces)}`;
    parts.push(formatSignedRawTerm(segment.coefficient, `(${body})`, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化双绝对值连接表达式的一阶导。 */
function formatAbsConnectorFirstDerivativeExpression(
  segments: readonly CompiledAbsConnectorSegment[],
  decimalPlaces: number | undefined,
  signEpsilon = GRAPHWAR_TOOL_SIGN_EPSILON,
) {
  const parts: string[] = [];
  for (const segment of segments) {
    const startText = formatXOffset(segment.startX, decimalPlaces);
    const endText = formatXOffset(segment.endX, decimalPlaces);
    const body = `${formatStableSignRatio(startText, signEpsilon)}-${formatStableSignRatio(endText, signEpsilon)}`;
    parts.push(formatSignedRawTerm(segment.coefficient, `(${body})`, decimalPlaces));
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

/** 格式化 exp(-abs(a*(x+c)))，避免导数项产生巨大的 exp(...) 中间值。 */
function formatStableStepDerivativeExp(steepness: number, centerX: number, decimalPlaces?: number) {
  return `exp(-abs(${formatStepDerivativeArgument(steepness, centerX, decimalPlaces)}))`;
}

/** 格式化朴素 exp(-a*(x+c))，与 Graphwar 实际表达式数值行为一致。 */
function formatDirectStepDerivativeExp(steepness: number, centerX: number, decimalPlaces?: number) {
  return `exp(-${formatStepDerivativeArgument(steepness, centerX, decimalPlaces)})`;
}

/** 模拟输出表达式里的 z / (abs(z)+eps)，避免折点 0 / 0。 */
function evaluateStableSignRatio(value: number, options?: FormulaEvaluationOptions) {
  options?.onSignArgument?.(value);
  return value / (Math.abs(value) + (options?.signEpsilon ?? GRAPHWAR_TOOL_SIGN_EPSILON));
}

/** 分母除零保护值不能跟随用户小数位，否则低精度输出会把它折成 0。 */
function formatSignEpsilon(signEpsilon: number) {
  return formatDoublePrecisionDecimal(signEpsilon);
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

/** 漏洞 x 门已经在采样层按最终文本精度整理过，这里只负责无损输出整理后的门线。 */
function formatStepGlitchXOffset(centerX: number) {
  const offset = Object.is(centerX, -0) ? 0 : -centerX;
  return offset === 0 ? "x" : `x${formatDoublePrecisionSignedNumber(offset)}`;
}

function formatDoublePrecisionSignedNumber(value: number) {
  if (Object.is(value, -0) || value === 0) {
    return "+0";
  }
  return value < 0 ? formatDoublePrecisionDecimal(value) : `+${formatDoublePrecisionDecimal(value)}`;
}

function formatDirectedTargetYOffset(targetY: number, direction: 1 | -1, decimalPlaces?: number) {
  if (direction > 0) {
    return `(${formatDecimal(targetY, decimalPlaces)}-y)`;
  }
  const offset = normalizeZero(-targetY, decimalPlaces);
  return offset === 0 ? "y" : `y${formatSignedNumber(offset, decimalPlaces)}`;
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
