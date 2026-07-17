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
import { GraphwarSignRole, isGraphwarSignProtected } from "./sign-protection";
import type { GraphwarSignProtection } from "./sign-protection";
import {
  quantizeFormulaCoefficient,
  quantizeFormulaOffsetCenter,
  getStepGlitchFormulaDecimalPlaces,
  quantizeStepFormulaSteepness,
  quantizeStepFormulaCenterX,
  resolveStepFormula,
  shouldUseStepDerivativeOverflowProtection,
} from "./step-numeric-strategy";
import type { FormulaEvaluationOptions, StepGlitchSegment, StepOverflowProtectionRange } from "./step-numeric-strategy";
export { GraphwarSignRole } from "./sign-protection";
export type { GraphwarSignProtection } from "./sign-protection";
export type { FormulaEvaluationOptions, StepOverflowProtectionRange } from "./step-numeric-strategy";

/** 双绝对值连接遇到垂直或反向线段时，使用 Graphwar 源码里的函数最小 x 步长保持公式有限。 */
const ABS_CONNECTOR_MIN_WIDTH = GRAPHWAR_FUNC_MIN_X_STEP_DISTANCE;
/** 软分段权重使用高偶次幂，让相邻 Hermite 段平滑过渡但保持局部主导。 */
const SOFT_INTERVAL_INDICATOR_POWER = 8;
/** 生成可复制公式文本时的选项；与求值选项分开，避免 UI 输出和内部采样互相污染。 */
export interface BuildFormulaOptions {
  /** 已按最终文本规则预编译的公式材料；传入后避免重复建段和重复舍入。 */
  compiledMaterials?: CompiledGraphwarFormulaMaterials;
  /** 按原始路径段保存的局部 sign 除零保护。 */
  signProtection?: GraphwarSignProtection;
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
  /** 编译会省略无效项；保护身份必须继续使用压缩前的原始路径段下标。 */
  sourceSegmentIndex: number;
}

/** ABS y'' 平滑斜率变化的一项最终文本等价数据。 */
export interface CompiledAbsSecondDerivativePulse {
  /** 最终公式里的脉冲系数，已经包含陡峭度。 */
  coefficient: number;
  /** 最终公式里的脉冲中心点。 */
  formulaCenterX: number;
}

/** ABS y'' 最终文本等价材料；只在二阶微分方程模式下编译。 */
export interface CompiledAbsSecondDerivativeFormula {
  /** 最终公式文本里的陡峭度。 */
  formulaSteepness: number;
  /** 内部折点的斜率差脉冲，以及末点把末段斜率归零的脉冲。 */
  pulses: readonly CompiledAbsSecondDerivativePulse[];
}

/** Step 公式的一项最终文本等价预编译数据，统一支持 y、y'、y'' 三种模式。 */
export interface CompiledStepTerm {
  /** 最终公式里的 Sigmoid 中心点。 */
  formulaCenterX: number;
  /** Y'= 邪道模式下替换普通 step 项的高导数门函数。 */
  glitchSegment?: StepGlitchSegment;
  /** 一阶导前置系数。 */
  firstDerivativeCoefficient: number;
  /** 二阶导前置系数。 */
  secondDerivativeCoefficient: number;
  /** 导数项是否必须使用抗溢出的 exp 写法。 */
  derivativeUsesOverflowProtection: boolean;
  /** Y= 模式累计高度系数。 */
  yCoefficient: number;
  /** 编译会省略零系数项；保护身份必须继续对应原始路径段。 */
  sourceSegmentIndex: number;
}

/** Step 公式最终文本等价材料；同一份数据应同时服务输出和采样。 */
export interface CompiledStepFormula {
  /** 生成 canonical 系数时采用的方程模式。 */
  equation: EquationMode;
  /** 最终公式文本里的陡峭度。 */
  formulaSteepness: number;
  /** 当前精度下仍会输出的阶跃项。 */
  terms: CompiledStepTerm[];
}

/** 软插值单段的最终文本等价常量；所有派生系数分别量化，不能从另一组舍入值反推。 */
export interface CompiledSoftCubicSegment {
  /** 三次 Hermite 主体的最终文本系数。 */
  cubicCoefficients: readonly [number, number, number, number];
  /** 三次 Hermite 主体一阶导的最终文本系数。 */
  firstCubicCoefficients: readonly [number, number, number, number];
  /** 软分段权重一阶导中的幂次系数。 */
  firstPowerCoefficient: number;
  /** 分段半宽，用于构造软区间权重。 */
  halfWidth: number;
  /** 三次 Hermite 主体二阶导的最终文本系数。 */
  secondCubicCoefficients: readonly [number, number, number, number];
  /** 软分段权重二阶导中的幂次系数。 */
  secondPowerCoefficient: number;
  /** 软分段权重使用的区间中心。 */
  softCenterX: number;
  /** Hermite 局部参数的分段起点。 */
  startX: number;
  /** Hermite 局部参数的非零分段宽度。 */
  width: number;
}

/** 最终文本等价的公式材料；context 内应编译一次，再供文本、探测和采样复用。 */
export interface CompiledGraphwarFormulaMaterials {
  /** 当前材料对应的公式算法。 */
  algorithm: AlgorithmMode;
  /** Abs 算法当前精度下仍会输出的连接段。 */
  absSegments?: readonly CompiledAbsConnectorSegment[];
  /** ABS y'' 当前精度下仍会输出的平滑斜率变化脉冲。 */
  absSecondDerivativeFormula?: CompiledAbsSecondDerivativeFormula;
  /** Step 算法当前精度下仍会输出的阶跃项。 */
  stepFormula?: CompiledStepFormula;
  /** PCHIP/Akima 当前精度下的文本等价 Hermite 和软权重常量。 */
  softCubicSegments?: readonly CompiledSoftCubicSegment[];
}

/** 采样器使用的预编译公式求值器，避免在每个轨迹点重新解析表达式文本。 */
export interface CompiledFormulaEvaluator {
  /** 计算 y'，供 y'= 模式积分和发射角迭代使用。 */
  evaluateFirstDerivativeY: (x: number, y: number) => number;
  /** 计算 y''，供 y''= 模式 RK4 使用。 */
  evaluateSecondDerivativeY: (x: number, y?: number, dy?: number) => number;
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
  const formulaEvaluation = createFormulaEvaluationOptions(mode, decimalPlaces, options);
  const compiledMaterials =
    options.compiledMaterials ?? compileGraphwarFormulaMaterials(points, steepness, algorithm, formulaEvaluation);
  const terms = createStepTerms(points);

  if (algorithm === "abs") {
    const segments = getCompiledAbsConnectorSegments(points, formulaEvaluation, compiledMaterials);
    if (mode === "dy") {
      return {
        // y'= 模式需要输入斜率；abs 连接函数的导数是两个 sign 项的差。
        expression: formatAbsConnectorFirstDerivativeExpression(segments, decimalPlaces, options.signProtection),
        terms,
      };
    }
    if (mode === "ddy") {
      return {
        // y''= 用平滑脉冲近似硬折线的斜率变化；完整轨迹模拟负责裁决尾值误差。
        // 当前没有缩短表达式的需求，因此固定使用稳定式，不读取 Step 的防溢出开关。
        expression: formatAbsSecondDerivativeExpression(
          getCompiledAbsSecondDerivativeFormula(points, steepness, formulaEvaluation, compiledMaterials),
          decimalPlaces,
        ),
        terms,
      };
    }

    return {
      // y= 模式输入相对形状即可，Graphwar 会按发射点补回绝对 y。
      expression: formatAbsConnectorExpression(segments, decimalPlaces),
      terms,
    };
  }

  if (isCubicInterpolationAlgorithm(algorithm)) {
    return {
      // pchip/akima 共用同一段 Hermite 表达式，再按模式取 y、y' 或 y''。
      expression: formatSoftCubicInterpolationExpression(
        getCompiledSoftCubicSegments(points, algorithm, formulaEvaluation, compiledMaterials),
        mode,
        decimalPlaces,
      ),
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
      expression: formatStepFirstDerivativeExpression(stepFormula, decimalPlaces, options.signProtection),
      terms,
    };
  }

  const stepFormula = getCompiledStepFormula(points, steepness, formulaEvaluation, compiledMaterials);
  return {
    // y''= 模式输入 sigmoid 阶跃的二阶导。
    expression: formatStepSecondDerivativeExpression(stepFormula, decimalPlaces, options.signProtection),
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
    return compileAbsConnectorEvaluator(points, steepness, options, compiledMaterials);
  }
  if (algorithm === "pchip" || algorithm === "akima") {
    return compileSoftCubicInterpolationEvaluator(points, algorithm, options, compiledMaterials);
  }
  return compileStepEvaluator(points, steepness, options, compiledMaterials);
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
      ...(options?.equation === "ddy"
        ? { absSecondDerivativeFormula: createCompiledAbsSecondDerivativeFormula(points, steepness, options) }
        : {}),
    };
  }
  if (algorithm === "step") {
    return {
      algorithm,
      stepFormula: createCompiledStepFormula(points, steepness, options),
    };
  }
  if (algorithm === "pchip" || algorithm === "akima") {
    return {
      algorithm,
      softCubicSegments: createCompiledSoftCubicSegments(points, algorithm, options),
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
          if (term.glitchSegment.equation !== "dy") {
            // 二阶邪道项在窗口外没有一阶导尾值，不能参与建议发射角。
            continue;
          }
          if (term.glitchSegment.derivative === 0) {
            // 最终文本会省略舍入为 0 的 D/8；不能继续求门函数并产生 0*NaN。
            continue;
          }
          slope =
            evaluateCompiledStepGlitchFirstDerivative(x, y, term.glitchSegment, term.sourceSegmentIndex, options) +
            slope;
          continue;
        }
        if (term.firstDerivativeCoefficient === 0) {
          // 最终公式会省略 0 系数项；编译路径也不应求值其 body，避免 0 * NaN 偏离发射文本语义。
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
    evaluateSecondDerivativeY(x, y = 0) {
      let acceleration: number | undefined;
      for (let index = formula.terms.length - 1; index >= 0; index -= 1) {
        const term = formula.terms[index];
        if (term.glitchSegment) {
          if (term.glitchSegment.equation === "ddy") {
            const contribution = evaluateCompiledStepGlitchSecondDerivative(
              x,
              y,
              term.glitchSegment,
              term.sourceSegmentIndex,
              options,
            );
            acceleration = acceleration === undefined ? contribution : contribution + acceleration;
          }
          continue;
        }
        if (term.secondDerivativeCoefficient === 0) {
          // 省略项没有 sign(t) 子表达式；跳过才能让 sign epsilon 探测与最终文本一致。
          continue;
        }

        const t = formula.formulaSteepness * (x - term.formulaCenterX);
        if (term.derivativeUsesOverflowProtection) {
          const sign = evaluateStableSignRatio(t, term.sourceSegmentIndex, GraphwarSignRole.CenterX, options);
          // Stable 二阶导文本是 k*sign*q*(1-q)/denom；Graphwar 会逐层把左侧 * 作为根节点。
          const contribution =
            -term.secondDerivativeCoefficient * (sign * evaluateCompiledStepStableSecondDerivativeBody(t));
          acceleration = acceleration === undefined ? contribution : contribution + acceleration;
        } else {
          // Graphwar 的 Polish 重排会让 exp*((exp-1)/(1+exp)^3) 先结合，避免系数乘法提前溢出。
          const contribution = term.secondDerivativeCoefficient * evaluateCompiledStepDirectSecondDerivativeBody(t);
          acceleration = acceleration === undefined ? contribution : contribution + acceleration;
        }
      }
      return acceleration ?? 0;
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

/** 回放邪道模式门函数；x 右门负责让旧邪道项只在局部窗口内生效。 */
function evaluateCompiledStepGlitchFirstDerivative(
  x: number,
  y: number,
  segment: Extract<StepGlitchSegment, { equation: "dy" }>,
  sourceSegmentIndex: number,
  options?: FormulaEvaluationOptions,
) {
  const direction = segment.derivative < 0 ? -1 : 1;
  const xGate = 1 + evaluateStableSignRatio(x - segment.startX, sourceSegmentIndex, GraphwarSignRole.StartX, options);
  const xLimitGate = 1 - evaluateStableSignRatio(x - segment.endX, sourceSegmentIndex, GraphwarSignRole.EndX, options);
  const yGate =
    1 + evaluateStableSignRatio(direction * (segment.gateY - y), sourceSegmentIndex, GraphwarSignRole.GateY, options);
  // Graphwar 以最左乘号为根解析连续乘法，必须按文本的右结合树求值。
  return (segment.derivative / 8) * (xGate * (xLimitGate * yGate));
}

/** 回放 y'' 邪道的近侧加速门和远侧刹车门；最终文本只使用原版可靠的 x、y 变量。 */
function evaluateCompiledStepGlitchSecondDerivative(
  x: number,
  y: number,
  segment: Extract<StepGlitchSegment, { equation: "ddy" }>,
  sourceSegmentIndex: number,
  options?: FormulaEvaluationOptions,
) {
  const direction: 1 | -1 = segment.acceleration < 0 ? -1 : 1;
  const xGate = 1 + evaluateStableSignRatio(x - segment.startX, sourceSegmentIndex, GraphwarSignRole.StartX, options);
  const xLimitGate =
    1 - evaluateStableSignRatio(x - segment.pulseEndX, sourceSegmentIndex, GraphwarSignRole.EndX, options);
  const accelerationGate =
    1 +
    evaluateStableSignRatio(
      direction * (segment.accelerationGateY - y),
      sourceSegmentIndex,
      GraphwarSignRole.GateY,
      options,
    );
  const brakingGate =
    1 +
    evaluateStableSignRatio(
      direction * (y - segment.brakingGateY),
      sourceSegmentIndex,
      GraphwarSignRole.BrakingGateY,
      options,
    );
  return (
    (segment.acceleration / 8) * (xGate * (xLimitGate * accelerationGate)) +
    (segment.braking / 8) * (xGate * (xLimitGate * brakingGate))
  );
}

/** 内部 step 采样应使用最终公式文本中的陡峭度，确保 y/dy/ddy 回放一致。 */
function createCompiledStepFormula(
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
) {
  const equation = options?.equation ?? "y";
  const resolvedFormula = resolveStepFormula(points, steepness, equation, options);
  const formulaSteepness = resolvedFormula.formulaSteepness;
  const terms: CompiledStepTerm[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const sourceSegmentIndex = index - 1;
    if (options?.disabledSegments?.[sourceSegmentIndex]) {
      continue;
    }
    const transition = resolvedFormula.transitions[sourceSegmentIndex];
    const glitchSegment = createCompiledStepGlitchSegment(options?.stepGlitchSegments?.[sourceSegmentIndex], options);
    if (!transition) {
      continue;
    }
    const formulaCenterX = createCompiledFormulaXCenter(points[index].x, options);
    const { firstDerivativeCoefficient, secondDerivativeCoefficient, yCoefficient } = transition;
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
      sourceSegmentIndex,
      yCoefficient,
    });
  }

  return { equation, formulaSteepness, terms };
}

/** 把邪道段量化为最终公式文本实际回放的门和导数。 */
function createCompiledStepGlitchSegment(
  segment: StepGlitchSegment | undefined,
  options?: FormulaEvaluationOptions,
): StepGlitchSegment | undefined {
  if (!segment) {
    return undefined;
  }

  const decimalPlaces =
    segment.formulaDecimalPlaces ?? getStepGlitchFormulaDecimalPlaces(getFormulaDecimalPlaces(options));
  if (segment.equation === "ddy") {
    // 三个逻辑门全开时贡献 8；加速和刹车分支必须分别按最终文本系数量化。
    return {
      acceleration: 8 * quantizeFormulaCoefficient(segment.acceleration / 8, decimalPlaces),
      accelerationGateY: quantizeFormulaOffsetCenter(segment.accelerationGateY, decimalPlaces),
      braking: 8 * quantizeFormulaCoefficient(segment.braking / 8, decimalPlaces),
      brakingGateY: quantizeFormulaOffsetCenter(segment.brakingGateY, decimalPlaces),
      endX: segment.endX,
      equation: segment.equation,
      formulaDecimalPlaces: decimalPlaces,
      pulseEndX: segment.pulseEndX,
      startX: segment.startX,
      targetY: quantizeFormulaOffsetCenter(segment.targetY, decimalPlaces),
    };
  }
  // 三个 sign 门全开时贡献 8；先量化最终文本里的 D/8，再反推候选模拟应使用的有效 D。
  const gateCoefficient = quantizeFormulaCoefficient(segment.derivative / 8, decimalPlaces);
  return {
    derivative: 8 * gateCoefficient,
    endX: segment.endX,
    equation: segment.equation,
    formulaDecimalPlaces: decimalPlaces,
    gateY: quantizeFormulaOffsetCenter(segment.gateY, decimalPlaces),
    startX: segment.startX,
    targetY: quantizeFormulaOffsetCenter(segment.targetY, decimalPlaces),
  };
}

/** 内部 step 采样应使用最终公式文本中的中心点，避免小数位边界偏移。 */
function createCompiledFormulaXCenter(centerX: number, options?: FormulaEvaluationOptions) {
  return quantizeStepFormulaCenterX(centerX, getFormulaDecimalPlaces(options));
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

/** 编译和输出都应显式使用同一份最终公式小数位。 */
function getFormulaDecimalPlaces(options?: FormulaEvaluationOptions) {
  return options?.formulaDecimalPlaces;
}

/** `buildFormula` 的 options 应转成采样层可复用的公式等价配置。 */
function createFormulaEvaluationOptions(
  equation: EquationMode,
  decimalPlaces: number | undefined,
  options: BuildFormulaOptions,
): FormulaEvaluationOptions {
  return {
    equation,
    formulaDecimalPlaces: decimalPlaces,
    signProtection: options.signProtection,
    stepOverflowProtection: options.stepOverflowProtection ?? true,
    stepOverflowProtectionRange: options.stepOverflowProtectionRange,
  };
}

/** 复用调用方的 Abs 材料，缺失时按同一公式选项重新编译。 */
function getCompiledAbsConnectorSegments(
  points: readonly GraphPoint[],
  options: FormulaEvaluationOptions | undefined,
  compiledMaterials: CompiledGraphwarFormulaMaterials | undefined,
) {
  return compiledMaterials?.algorithm === "abs" && compiledMaterials.absSegments
    ? compiledMaterials.absSegments
    : createCompiledAbsConnectorSegments(points, options);
}

/** ABS y'' 文本和求值器必须共用同一份量化脉冲，避免斜率差重复计算。 */
function getCompiledAbsSecondDerivativeFormula(
  points: readonly GraphPoint[],
  steepness: number,
  options: FormulaEvaluationOptions | undefined,
  compiledMaterials: CompiledGraphwarFormulaMaterials | undefined,
) {
  return compiledMaterials?.algorithm === "abs" && compiledMaterials.absSecondDerivativeFormula
    ? compiledMaterials.absSecondDerivativeFormula
    : createCompiledAbsSecondDerivativeFormula(points, steepness, options);
}

/** 复用调用方的 Step 材料，缺失时按同一公式选项重新编译。 */
function getCompiledStepFormula(
  points: readonly GraphPoint[],
  steepness: number,
  options: FormulaEvaluationOptions | undefined,
  compiledMaterials: CompiledGraphwarFormulaMaterials | undefined,
) {
  const equation = options?.equation ?? "y";
  return compiledMaterials?.algorithm === "step" && compiledMaterials.stepFormula?.equation === equation
    ? compiledMaterials.stepFormula
    : createCompiledStepFormula(points, steepness, options);
}

/** 软插值文本和求值器必须共用同一份量化分段，避免重复算斜率和派生系数。 */
function getCompiledSoftCubicSegments(
  points: readonly GraphPoint[],
  algorithm: "pchip" | "akima",
  options: FormulaEvaluationOptions | undefined,
  compiledMaterials: CompiledGraphwarFormulaMaterials | undefined,
) {
  return compiledMaterials?.algorithm === algorithm && compiledMaterials.softCubicSegments
    ? compiledMaterials.softCubicSegments
    : createCompiledSoftCubicSegments(points, algorithm, options);
}

/** Abs 连接段应按最终公式文本里的数字预编译，避免探测 raw double 折点。 */
function createCompiledAbsConnectorSegments(
  points: readonly GraphPoint[],
  options?: FormulaEvaluationOptions,
): CompiledAbsConnectorSegment[] {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  const segments: CompiledAbsConnectorSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    if (options?.disabledSegments?.[index]) {
      continue;
    }
    let startPoint = points[index];
    // 只有 ABS y' 消费模拟确认的真实段起点；其他方程必须保留原始点，避免读取陈旧补正状态。
    if (index > 0 && options?.equation === "dy") {
      const resolvedStartPoint = options.segmentStartPoints?.[index];
      if (resolvedStartPoint !== undefined) {
        startPoint = resolvedStartPoint;
      }
    }
    const segment = createAbsConnectorSegment(startPoint, points[index + 1]);
    if (isRoundedAbsConnectorZero(segment, decimalPlaces)) {
      continue;
    }

    const coefficient = quantizeFormulaCoefficient(segment.deltaY / (2 * segment.width), decimalPlaces);
    if (coefficient === 0) {
      continue;
    }

    segments.push({
      coefficient,
      endX: createCompiledFormulaXCenter(segment.endX, options),
      sourceSegmentIndex: index,
      startX: createCompiledFormulaXCenter(segment.startX, options),
      width: createCompiledFormulaDistance(segment.width, options),
    });
  }
  return segments;
}

/** 从完整原始分段生成斜率变化；零斜率段也会影响相邻折点，不能沿用 y= 的压缩连接段。 */
function createCompiledAbsSecondDerivativeFormula(
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
): CompiledAbsSecondDerivativeFormula {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  const formulaSteepness = quantizeStepFormulaSteepness(steepness, decimalPlaces);
  const pulses: CompiledAbsSecondDerivativePulse[] = [];
  let deltaSlopes = options?.absSecondDerivativePulseDeltaSlopes;
  if (deltaSlopes === undefined) {
    // 完整原始分段包含零斜率段；末点补反向脉冲，让路径后恢复水平。
    const segmentSlopes = createSegmentSlopes(points);
    deltaSlopes = segmentSlopes.map((slope, index) =>
      index < segmentSlopes.length - 1 ? segmentSlopes[index + 1] - slope : -slope,
    );
  }
  for (let index = 0; index < deltaSlopes.length; index += 1) {
    const deltaSlope = deltaSlopes[index];
    const center = points[index + 1];
    if (deltaSlope === undefined || !center) {
      continue;
    }
    const coefficient = quantizeFormulaCoefficient(formulaSteepness * deltaSlope, decimalPlaces);
    if (coefficient !== 0) {
      pulses.push({
        coefficient,
        formulaCenterX: createCompiledFormulaXCenter(
          options?.absSecondDerivativePulseCenterXs?.[index] ?? center.x,
          options,
        ),
      });
    }
  }
  return { formulaSteepness, pulses };
}

/** 正长度参数在文本里用普通数字格式化，应与 formatDecimal 的舍入规则一致。 */
function createCompiledFormulaDistance(value: number, options?: FormulaEvaluationOptions) {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  return decimalPlaces === undefined ? value : roundToDecimalPlaces(value, decimalPlaces);
}

/** 预编译 abs 连接公式，把每段的端点和系数固定下来，采样时只做代入求值。 */
function compileAbsConnectorEvaluator(
  points: readonly GraphPoint[],
  steepness: number,
  options?: FormulaEvaluationOptions,
  compiledMaterials?: CompiledGraphwarFormulaMaterials,
): CompiledFormulaEvaluator {
  const segments = getCompiledAbsConnectorSegments(points, options, compiledMaterials);
  const secondDerivativeFormula =
    options?.equation === "ddy"
      ? getCompiledAbsSecondDerivativeFormula(points, steepness, options, compiledMaterials)
      : undefined;

  return {
    evaluateFirstDerivativeY(x) {
      let slope: number | undefined;
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        const contribution =
          segment.coefficient *
          (evaluateStableSignRatio(x - segment.startX, segment.sourceSegmentIndex, GraphwarSignRole.StartX, options) -
            evaluateStableSignRatio(x - segment.endX, segment.sourceSegmentIndex, GraphwarSignRole.EndX, options));
        slope = slope === undefined ? contribution : contribution + slope;
      }
      return slope ?? 0;
    },
    evaluateSecondDerivativeY(x) {
      if (!secondDerivativeFormula) {
        return Number.NaN;
      }

      let acceleration = 0;
      for (let index = secondDerivativeFormula.pulses.length - 1; index >= 0; index -= 1) {
        const pulse = secondDerivativeFormula.pulses[index];
        const t = secondDerivativeFormula.formulaSteepness * (x - pulse.formulaCenterX);
        acceleration = pulse.coefficient * evaluateCompiledStepStableFirstDerivativeBody(t) + acceleration;
      }
      return acceleration;
    },
    evaluateY(x) {
      // 输出文本只描述相对形状，绝对高度由 Graphwar 发射点 offset 补回；提前加 baseY 会引入一次无谓消去和 ULP 差异。
      let y = 0;
      // Graphwar Polish 重排把最左侧加减项放在语法树根部，因此实际从文本右端向左累计。
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index];
        // `a-b+w` 会被原版解析为 `a+(-b+w)`，而非 JavaScript 常规的 `(a-b)+w`。
        y += segment.coefficient * (Math.abs(x - segment.startX) + (segment.width - Math.abs(x - segment.endX)));
      }
      return y;
    },
  };
}

/** 预编译 PCHIP/Akima 软分段三次插值，缓存 segments/slopes 供 y、dy、ddy 共用。 */
function compileSoftCubicInterpolationEvaluator(
  points: readonly GraphPoint[],
  algorithm: "pchip" | "akima",
  options?: FormulaEvaluationOptions,
  compiledMaterials?: CompiledGraphwarFormulaMaterials,
): CompiledFormulaEvaluator {
  const segments = getCompiledSoftCubicSegments(points, algorithm, options, compiledMaterials);
  return {
    evaluateFirstDerivativeY: (x) => evaluateCompiledSoftCubicInterpolationY(x, segments, "dy"),
    evaluateSecondDerivativeY: (x) => evaluateCompiledSoftCubicInterpolationY(x, segments, "ddy"),
    evaluateY: (x) => evaluateCompiledSoftCubicInterpolationY(x, segments, "y"),
  };
}

/** 把软插值文本会打印的每个派生常量分别量化，避免从另一项舍入结果反推造成 ULP 漂移。 */
function createCompiledSoftCubicSegments(
  points: readonly GraphPoint[],
  algorithm: "pchip" | "akima",
  options?: FormulaEvaluationOptions,
): CompiledSoftCubicSegment[] {
  const decimalPlaces = getFormulaDecimalPlaces(options);
  const segments = createCubicInterpolationSegments(points, algorithm, -(points[0]?.y ?? 0));
  return segments.map((segment) => {
    const quantize = (value: number) =>
      decimalPlaces === undefined ? value : roundToDecimalPlaces(value, decimalPlaces);
    const halfWidth = segment.width / 2;
    return {
      cubicCoefficients: [
        quantize(segment.startY),
        quantize(segment.width * segment.startSlope),
        quantize(segment.endY),
        quantize(segment.width * segment.endSlope),
      ],
      firstCubicCoefficients: [
        quantize(segment.startY / segment.width),
        quantize(segment.startSlope),
        quantize(segment.endY / segment.width),
        quantize(segment.endSlope),
      ],
      firstPowerCoefficient: quantize((SOFT_INTERVAL_INDICATOR_POWER * 2) / halfWidth),
      halfWidth: quantize(halfWidth),
      secondCubicCoefficients: [
        quantize(segment.startY / segment.width ** 2),
        quantize(segment.startSlope / segment.width),
        quantize(segment.endY / segment.width ** 2),
        quantize(segment.endSlope / segment.width),
      ],
      secondPowerCoefficient: quantize(
        (SOFT_INTERVAL_INDICATOR_POWER * 2 * (SOFT_INTERVAL_INDICATOR_POWER * 2 - 1)) / halfWidth ** 2,
      ),
      softCenterX: quantize((segment.startX + segment.endX) / 2),
      startX: quantize(segment.startX),
      width: quantize(segment.width),
    };
  });
}

/** 按最终文本的右结合 Polish 树求值软分段商，避免常规 JS 结合顺序产生不同轨迹分支。 */
function evaluateCompiledSoftCubicInterpolationY(
  x: number,
  segments: readonly CompiledSoftCubicSegment[],
  mode: EquationMode,
) {
  if (segments.length === 0) {
    return 0;
  }

  let numerator = 0;
  let denominator = 0;
  let firstNumerator = 0;
  let firstDenominator = 0;
  let secondNumerator = 0;
  let secondDenominator = 0;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const normalized = (x - segment.softCenterX) / segment.halfWidth;
    const base = 1 + Math.pow(normalized, SOFT_INTERVAL_INDICATOR_POWER * 2);
    const weight = 1 / base;
    const t = (x - segment.startX) / segment.width;
    const cubic = evaluateCompiledCubicHermiteBody(t, segment.cubicCoefficients, 0);

    numerator = weight * cubic + numerator;
    denominator = weight + denominator;
    if (mode === "y") {
      continue;
    }

    const firstPower = segment.firstPowerCoefficient * Math.pow(normalized, SOFT_INTERVAL_INDICATOR_POWER * 2 - 1);
    const baseSquared = Math.pow(base, 2);
    const firstWeight = -firstPower / baseSquared;
    const firstCubic = evaluateCompiledCubicHermiteBody(t, segment.firstCubicCoefficients, 1);
    firstNumerator = firstWeight * cubic + (weight * firstCubic + firstNumerator);
    firstDenominator = firstWeight + firstDenominator;
    if (mode === "dy") {
      continue;
    }

    const secondPower = segment.secondPowerCoefficient * Math.pow(normalized, SOFT_INTERVAL_INDICATOR_POWER * 2 - 2);
    // `2*a^2/base^3` 在 Graphwar 中解析为 `2*(a^2/base^3)`；先乘 2 会改变极值溢出语义。
    const secondWeight = -secondPower / baseSquared + 2 * (Math.pow(firstPower, 2) / Math.pow(base, 3));
    const secondCubic = evaluateCompiledCubicHermiteBody(t, segment.secondCubicCoefficients, 2);
    secondNumerator =
      secondWeight * cubic + (2 * (firstWeight * firstCubic) + (weight * secondCubic + secondNumerator));
    secondDenominator = secondWeight + secondDenominator;
  }
  if (mode === "dy") {
    return (firstNumerator * denominator - numerator * firstDenominator) / Math.pow(denominator, 2);
  }
  if (mode === "ddy") {
    const firstQuotientNumerator = firstNumerator * denominator - numerator * firstDenominator;
    return (
      ((secondNumerator * denominator - numerator * secondDenominator) * denominator -
        2 * (firstQuotientNumerator * firstDenominator)) /
      Math.pow(denominator, 3)
    );
  }
  return numerator / denominator;
}

/** 求值文本中的一组 Hermite 基函数；从右到左累计，且省略量化为 0 的整项。 */
function evaluateCompiledCubicHermiteBody(
  t: number,
  coefficients: readonly [number, number, number, number],
  derivativeOrder: 0 | 1 | 2,
) {
  const t2 = Math.pow(t, 2);
  const t3 = derivativeOrder === 0 ? Math.pow(t, 3) : 0;
  let value = 0;
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    if (coefficients[index] !== 0) {
      let basis: number;
      if (derivativeOrder === 0) {
        basis =
          index === 0
            ? 2 * t3 + (-3 * t2 + 1)
            : index === 1
              ? t3 + (-2 * t2 + t)
              : index === 2
                ? -2 * t3 + 3 * t2
                : t3 - t2;
      } else if (derivativeOrder === 1) {
        basis =
          index === 0
            ? 6 * t2 - 6 * t
            : index === 1
              ? 3 * t2 + (-4 * t + 1)
              : index === 2
                ? -6 * t2 + 6 * t
                : 3 * t2 - 2 * t;
      } else {
        basis = index === 0 ? 12 * t - 6 : index === 1 ? 6 * t - 4 : index === 2 ? -12 * t + 6 : 6 * t - 2;
      }
      value = coefficients[index] * basis + value;
    }
  }
  return value;
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
  signProtection: GraphwarSignProtection | undefined,
) {
  const parts: string[] = [];
  for (const term of formula.terms) {
    if (term.glitchSegment) {
      if (term.glitchSegment.equation !== "dy") {
        continue;
      }
      parts.push(
        formatStepGlitchFirstDerivativeExpression(
          term.glitchSegment,
          term.sourceSegmentIndex,
          decimalPlaces,
          signProtection,
        ),
      );
      continue;
    }
    if (term.firstDerivativeCoefficient === 0) {
      continue;
    }

    let body: string;
    if (term.derivativeUsesOverflowProtection) {
      body = formatStableStepFirstDerivativeBody(formula.formulaSteepness, term.formulaCenterX, decimalPlaces);
    } else {
      const expText = formatDirectStepDerivativeExp(formula.formulaSteepness, term.formulaCenterX, decimalPlaces);
      body = `${expText}/(1+${expText})^2`;
    }
    parts.push(formatSignedRawTerm(term.firstDerivativeCoefficient, body, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化局部邪道项；右侧 x 门会在候选窗口末端关闭旧邪道项。 */
function formatStepGlitchFirstDerivativeExpression(
  segment: Extract<StepGlitchSegment, { equation: "dy" }>,
  sourceSegmentIndex: number,
  decimalPlaces: number | undefined,
  signProtection: GraphwarSignProtection | undefined,
) {
  decimalPlaces = segment.formulaDecimalPlaces ?? getStepGlitchFormulaDecimalPlaces(decimalPlaces);
  const direction = segment.derivative < 0 ? -1 : 1;
  const xGate = `1+${formatStableSignRatio(
    formatStepGlitchXOffset(segment.startX),
    isGraphwarSignProtected(signProtection, sourceSegmentIndex, GraphwarSignRole.StartX),
  )}`;
  const xLimitGate = `1-${formatStableSignRatio(
    formatStepGlitchXOffset(segment.endX),
    isGraphwarSignProtected(signProtection, sourceSegmentIndex, GraphwarSignRole.EndX),
  )}`;
  const yGate = `1+${formatStableSignRatio(
    formatDirectedTargetYOffset(segment.gateY, direction, decimalPlaces),
    isGraphwarSignProtected(signProtection, sourceSegmentIndex, GraphwarSignRole.GateY),
  )}`;
  // 三个 sign 门全开时乘积是 8，因此文本系数使用 D/8，实际导数仍是 D。
  return formatSignedRawTerm(segment.derivative / 8, `(${xGate})*(${xLimitGate})*(${yGate})`, decimalPlaces);
}

/** 格式化 sigmoid 阶跃表达式的二阶导。 */
function formatStepSecondDerivativeExpression(
  formula: CompiledStepFormula,
  decimalPlaces: number | undefined,
  signProtection: GraphwarSignProtection | undefined,
) {
  const parts: string[] = [];
  for (const term of formula.terms) {
    if (term.glitchSegment) {
      if (term.glitchSegment.equation === "ddy") {
        parts.push(
          ...formatStepGlitchSecondDerivativeExpression(
            term.glitchSegment,
            term.sourceSegmentIndex,
            decimalPlaces,
            signProtection,
          ),
        );
      }
      continue;
    }
    if (term.secondDerivativeCoefficient === 0) {
      continue;
    }

    // 二阶导稳定写法需要额外的 sign(t)，用于还原 exp(-abs(t)) 两侧的方向。
    if (term.derivativeUsesOverflowProtection) {
      const argumentText = formatStepDerivativeArgument(formula.formulaSteepness, term.formulaCenterX, decimalPlaces);
      const expText = formatStableStepDerivativeExp(formula.formulaSteepness, term.formulaCenterX, decimalPlaces);
      const signText = formatStableSignRatio(
        argumentText,
        isGraphwarSignProtected(signProtection, term.sourceSegmentIndex, GraphwarSignRole.CenterX),
      );
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

/** 格式化二阶邪道的近侧加速和远侧刹车分支。 */
function formatStepGlitchSecondDerivativeExpression(
  segment: Extract<StepGlitchSegment, { equation: "ddy" }>,
  sourceSegmentIndex: number,
  decimalPlaces: number | undefined,
  signProtection: GraphwarSignProtection | undefined,
) {
  decimalPlaces = segment.formulaDecimalPlaces ?? getStepGlitchFormulaDecimalPlaces(decimalPlaces);
  const direction: 1 | -1 = segment.acceleration < 0 ? -1 : 1;
  const xGate = `1+${formatStableSignRatio(
    formatStepGlitchXOffset(segment.startX),
    isGraphwarSignProtected(signProtection, sourceSegmentIndex, GraphwarSignRole.StartX),
  )}`;
  const xLimitGate = `1-${formatStableSignRatio(
    formatStepGlitchXOffset(segment.pulseEndX),
    isGraphwarSignProtected(signProtection, sourceSegmentIndex, GraphwarSignRole.EndX),
  )}`;
  const accelerationGate = `1+${formatStableSignRatio(
    formatDirectedTargetYOffset(segment.accelerationGateY, direction, decimalPlaces),
    isGraphwarSignProtected(signProtection, sourceSegmentIndex, GraphwarSignRole.GateY),
  )}`;
  const brakingGate = `1+${formatStableSignRatio(
    formatDirectedTargetYOffset(segment.brakingGateY, direction === 1 ? -1 : 1, decimalPlaces),
    isGraphwarSignProtected(signProtection, sourceSegmentIndex, GraphwarSignRole.BrakingGateY),
  )}`;
  return [
    formatSignedRawTerm(segment.acceleration / 8, `(${xGate})*(${xLimitGate})*(${accelerationGate})`, decimalPlaces),
    formatSignedRawTerm(segment.braking / 8, `(${xGate})*(${xLimitGate})*(${brakingGate})`, decimalPlaces),
  ];
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
  signProtection: GraphwarSignProtection | undefined,
) {
  const parts: string[] = [];
  for (const segment of segments) {
    const startText = formatXOffset(segment.startX, decimalPlaces);
    const endText = formatXOffset(segment.endX, decimalPlaces);
    const body = `${formatStableSignRatio(
      startText,
      isGraphwarSignProtected(signProtection, segment.sourceSegmentIndex, GraphwarSignRole.StartX),
    )}-${formatStableSignRatio(
      endText,
      isGraphwarSignProtected(signProtection, segment.sourceSegmentIndex, GraphwarSignRole.EndX),
    )}`;
    parts.push(formatSignedRawTerm(segment.coefficient, `(${body})`, decimalPlaces));
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化 ABS y'' 的平滑斜率变化脉冲。 */
function formatAbsSecondDerivativeExpression(
  formula: CompiledAbsSecondDerivativeFormula,
  decimalPlaces: number | undefined,
) {
  const parts: string[] = [];
  for (const pulse of formula.pulses) {
    parts.push(
      formatSignedRawTerm(
        pulse.coefficient,
        formatStableStepFirstDerivativeBody(formula.formulaSteepness, pulse.formulaCenterX, decimalPlaces),
        decimalPlaces,
      ),
    );
  }
  return cleanupExpression(parts.join("")) || "0";
}

/** 把每段 Hermite 曲线用软权重拼成一个 Graphwar 可粘贴的全局表达式。 */
function formatSoftCubicInterpolationExpression(
  segments: readonly CompiledSoftCubicSegment[],
  mode: EquationMode,
  decimalPlaces?: number,
) {
  if (segments.length === 0) {
    return "0";
  }

  const parts = createSoftCubicInterpolationFormulaParts(segments, mode, decimalPlaces);
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
function createSoftCubicInterpolationFormulaParts(
  segments: readonly CompiledSoftCubicSegment[],
  mode: EquationMode,
  decimalPlaces?: number,
) {
  const numeratorParts: string[] = [];
  const denominatorParts: string[] = [];
  const firstNumeratorParts: string[] | undefined = mode === "y" ? undefined : [];
  const firstDenominatorParts: string[] | undefined = mode === "y" ? undefined : [];
  const secondNumeratorParts: string[] | undefined = mode === "ddy" ? [] : undefined;
  const secondDenominatorParts: string[] | undefined = mode === "ddy" ? [] : undefined;

  for (const segment of segments) {
    const weight = formatSoftIntervalIndicator(segment, decimalPlaces);
    const cubic = formatCubicHermiteSegmentExpression(segment, decimalPlaces);

    numeratorParts.push(`(${weight})*(${cubic})`);
    denominatorParts.push(`(${weight})`);
    if (firstNumeratorParts && firstDenominatorParts) {
      const firstWeight = formatSoftIntervalIndicatorDerivative(segment, decimalPlaces);
      const firstCubic = formatCubicHermiteSegmentDerivativeExpression(segment, decimalPlaces);
      firstNumeratorParts.push(`(${firstWeight})*(${cubic})+(${weight})*(${firstCubic})`);
      firstDenominatorParts.push(`(${firstWeight})`);
      if (secondNumeratorParts && secondDenominatorParts) {
        const secondWeight = formatSoftIntervalIndicatorSecondDerivative(segment, decimalPlaces);
        const secondCubic = formatCubicHermiteSegmentSecondDerivativeExpression(segment, decimalPlaces);
        secondNumeratorParts.push(
          `(${secondWeight})*(${cubic})+2*(${firstWeight})*(${firstCubic})+(${weight})*(${secondCubic})`,
        );
        secondDenominatorParts.push(`(${secondWeight})`);
      }
    }
  }

  return {
    denominator: denominatorParts.join("+"),
    firstDenominator: firstDenominatorParts?.join("+") ?? "",
    firstNumerator: firstNumeratorParts?.join("+") ?? "",
    numerator: numeratorParts.join("+"),
    secondDenominator: secondDenominatorParts?.join("+") ?? "",
    secondNumerator: secondNumeratorParts?.join("+") ?? "",
  };
}

/** 格式化单段 Hermite 三次曲线 y。 */
function formatCubicHermiteSegmentExpression(segment: CompiledSoftCubicSegment, decimalPlaces?: number) {
  const t = `((${formatXOffset(segment.startX, decimalPlaces)})/${formatDecimal(segment.width, decimalPlaces)})`;
  const parts = [
    formatSignedRawTerm(segment.cubicCoefficients[0], `(2*${t}^3-3*${t}^2+1)`, decimalPlaces),
    formatSignedRawTerm(segment.cubicCoefficients[1], `(${t}^3-2*${t}^2+${t})`, decimalPlaces),
    formatSignedRawTerm(segment.cubicCoefficients[2], `(-2*${t}^3+3*${t}^2)`, decimalPlaces),
    formatSignedRawTerm(segment.cubicCoefficients[3], `(${t}^3-${t}^2)`, decimalPlaces),
  ];
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化单段 Hermite 三次曲线 y'。 */
function formatCubicHermiteSegmentDerivativeExpression(segment: CompiledSoftCubicSegment, decimalPlaces?: number) {
  const t = `((${formatXOffset(segment.startX, decimalPlaces)})/${formatDecimal(segment.width, decimalPlaces)})`;
  const parts = [
    formatSignedRawTerm(segment.firstCubicCoefficients[0], `(6*${t}^2-6*${t})`, decimalPlaces),
    formatSignedRawTerm(segment.firstCubicCoefficients[1], `(3*${t}^2-4*${t}+1)`, decimalPlaces),
    formatSignedRawTerm(segment.firstCubicCoefficients[2], `(-6*${t}^2+6*${t})`, decimalPlaces),
    formatSignedRawTerm(segment.firstCubicCoefficients[3], `(3*${t}^2-2*${t})`, decimalPlaces),
  ];
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化单段 Hermite 三次曲线 y''。 */
function formatCubicHermiteSegmentSecondDerivativeExpression(
  segment: CompiledSoftCubicSegment,
  decimalPlaces?: number,
) {
  const t = `((${formatXOffset(segment.startX, decimalPlaces)})/${formatDecimal(segment.width, decimalPlaces)})`;
  const parts = [
    formatSignedRawTerm(segment.secondCubicCoefficients[0], `(12*${t}-6)`, decimalPlaces),
    formatSignedRawTerm(segment.secondCubicCoefficients[1], `(6*${t}-4)`, decimalPlaces),
    formatSignedRawTerm(segment.secondCubicCoefficients[2], `(-12*${t}+6)`, decimalPlaces),
    formatSignedRawTerm(segment.secondCubicCoefficients[3], `(6*${t}-2)`, decimalPlaces),
  ];
  return cleanupExpression(parts.join("")) || "0";
}

/** 格式化软区间权重，权重在分段中心附近最大、远离后快速衰减。 */
function formatSoftIntervalIndicator(segment: CompiledSoftCubicSegment, decimalPlaces?: number) {
  return `1/(${formatSoftIntervalBase(segment, decimalPlaces)})`;
}

/** 格式化软区间权重的一阶导，供商函数求导使用。 */
function formatSoftIntervalIndicatorDerivative(segment: CompiledSoftCubicSegment, decimalPlaces?: number) {
  const firstPowerDerivative = formatSoftIntervalPowerDerivative(segment, 1, decimalPlaces);
  return `-(${firstPowerDerivative})/(${formatSoftIntervalBase(segment, decimalPlaces)})^2`;
}

/** 格式化软区间权重的二阶导，供 y'' 模式使用。 */
function formatSoftIntervalIndicatorSecondDerivative(segment: CompiledSoftCubicSegment, decimalPlaces?: number) {
  const firstPowerDerivative = formatSoftIntervalPowerDerivative(segment, 1, decimalPlaces);
  const secondPowerDerivative = formatSoftIntervalPowerDerivative(segment, 2, decimalPlaces);
  const base = formatSoftIntervalBase(segment, decimalPlaces);
  return `-(${secondPowerDerivative})/(${base})^2+2*(${firstPowerDerivative})^2/(${base})^3`;
}

/** 格式化软权重分母基础项 1+t^n。 */
function formatSoftIntervalBase(segment: CompiledSoftCubicSegment, decimalPlaces?: number) {
  return `1+${formatSoftIntervalPower(segment, SOFT_INTERVAL_INDICATOR_POWER * 2, decimalPlaces)}`;
}

/** 格式化以分段中心和半宽归一化后的幂项。 */
function formatSoftIntervalPower(segment: CompiledSoftCubicSegment, power: number, decimalPlaces?: number) {
  return `((${formatXOffset(segment.softCenterX, decimalPlaces)})/${formatDecimal(segment.halfWidth, decimalPlaces)})^${power}`;
}

/** 格式化归一化幂项的一阶或二阶导。 */
function formatSoftIntervalPowerDerivative(
  segment: CompiledSoftCubicSegment,
  derivativeOrder: 1 | 2,
  decimalPlaces?: number,
) {
  const power = SOFT_INTERVAL_INDICATOR_POWER * 2;
  const coefficient = derivativeOrder === 1 ? segment.firstPowerCoefficient : segment.secondPowerCoefficient;
  return `${formatDecimal(coefficient, decimalPlaces)}*((${formatXOffset(segment.softCenterX, decimalPlaces)})/${formatDecimal(segment.halfWidth, decimalPlaces)})^${power - derivativeOrder}`;
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

/** 用 q=exp(-abs(t)) 输出 q/(1+q)^2。它与直接写法 exp(-t)/(1+exp(-t))^2 数学等价，但能避免 exp(-t) 溢出后的 Infinity/Infinity -> NaN。 */
function formatStableStepFirstDerivativeBody(steepness: number, centerX: number, decimalPlaces?: number) {
  const q = formatStableStepDerivativeExp(steepness, centerX, decimalPlaces);
  return `${q}/(1+${q})^2`;
}

/** 格式化朴素 exp(-a*(x+c))，与 Graphwar 实际表达式数值行为一致。 */
function formatDirectStepDerivativeExp(steepness: number, centerX: number, decimalPlaces?: number) {
  return `exp(-${formatStepDerivativeArgument(steepness, centerX, decimalPlaces)})`;
}

/** 模拟逻辑 sign 项；只有该原始段角色曾精确踩中 0 时才加入分母 epsilon。 */
function evaluateStableSignRatio(
  value: number,
  sourceSegmentIndex: number,
  role: GraphwarSignRole,
  options?: FormulaEvaluationOptions,
) {
  if (value === 0) {
    options?.onZeroSignArgument?.(sourceSegmentIndex, role);
  }
  return (
    value /
    (Math.abs(value) +
      (isGraphwarSignProtected(options?.signProtection, sourceSegmentIndex, role) ? Number.EPSILON : 0))
  );
}

/** 分母除零保护值不能跟随用户小数位，否则低精度输出会把它折成 0。 */
function formatSignEpsilon() {
  return formatDoublePrecisionDecimal(Number.EPSILON);
}

/** 格式化逻辑 sign 项；未确认折点时保留 Graphwar 原始数值行为。 */
function formatStableSignRatio(argumentText: string, protectedSign: boolean) {
  if (!protectedSign) {
    return `(${argumentText})/abs(${argumentText})`;
  }
  return `(${argumentText})/(abs(${argumentText})+${formatSignEpsilon()})`;
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

/** 邪道 x 门已经在采样层按最终文本精度整理过，这里只负责无损输出整理后的门线。 */
function formatStepGlitchXOffset(centerX: number) {
  const offset = Object.is(centerX, -0) ? 0 : -centerX;
  return offset === 0 ? "x" : `x${formatDoublePrecisionSignedNumber(offset)}`;
}

/** 邪道门线保留完整 double，并始终输出显式符号以便直接拼接到 x 后。 */
function formatDoublePrecisionSignedNumber(value: number) {
  if (Object.is(value, -0) || value === 0) {
    return "+0";
  }
  return value < 0 ? formatDoublePrecisionDecimal(value) : `+${formatDoublePrecisionDecimal(value)}`;
}

/** 格式化朝目标方向关闭门函数所需的带符号 y offset。 */
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
