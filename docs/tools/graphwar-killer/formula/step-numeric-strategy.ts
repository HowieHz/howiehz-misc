/** Step 公式的数值保护策略；公式输出和轨迹采样必须共用同一套判断。 */
import type { GraphBounds, GraphPoint } from "../core/types";

/** Java/Graphwar double 的 exp 上限，用于判断 step 公式是否必须改写成抗溢出形式。 */
const JAVA_DOUBLE_MAX_EXP_ARGUMENT = Math.log(Number.MAX_VALUE);

/** 稳定版 sigmoid 公式在符号项可去奇点处避免 0 / 0 的 double 精度保护值。 */
export const GRAPHWAR_TOOL_SIGN_EPSILON = Number.EPSILON;

/** Step 指数项只需要覆盖实际轨迹会扫过的 x 范围，减少公式长度和数值偏差。 */
export interface StepOverflowProtectionRange {
  /** 轨迹采样区间右端 Graphwar x。 */
  maxX: number;
  /** 轨迹采样区间左端 Graphwar x。 */
  minX: number;
}

/** 编译和输出共用的 step 数值保护选项；调用方先探测轨迹，再决定是否启用保护。 */
export interface FormulaEvaluationOptions {
  /** 采样 step 符号项实参的钩子，用于判断是否必须启用 sign epsilon。 */
  onSignArgument?: (value: number) => void;
  /** 稳定符号比值的除零保护值；0 表示保留 Graphwar 原始数值行为。 */
  signEpsilon?: number;
  /** 只在该 x 范围内判断 exp 是否可能溢出，避免过度改写无关区间。 */
  stepOverflowProtectionRange?: StepOverflowProtectionRange;
  /** 是否对 step 表达式使用抗溢出的等价格式。 */
  stepOverflowProtection?: boolean;
}

/** Graphwar 只会沿 x+ 方向采样；抗溢出判断只需要覆盖从发射点到右侧边界的 x 区间。 */
export function createStepOverflowProtectionRange(bounds: GraphBounds, points: readonly GraphPoint[]) {
  const startPoint = points[0];
  if (!startPoint) {
    return undefined;
  }

  return {
    minX: startPoint.x,
    maxX: Math.max(bounds.minX, bounds.maxX),
  };
}

/**
 * 用 signEpsilon=0 的采样回放探测稳定符号近似是否必须启用 epsilon。
 *
 * Sign epsilon 会轻微改变折点附近曲线；只有真实轨迹踩到 sign(t) 的 t=0 折点时才写入保护。
 */
export function probeSignEpsilonRequirement(probeSignArguments: (onSignArgument: (value: number) => void) => void) {
  let hasZeroSignArgument = false;
  probeSignArguments((value) => {
    if (value === 0) {
      hasZeroSignArgument = true;
    }
  });
  return hasZeroSignArgument;
}

/** 运行时判断 step 项是否需要抗溢出，避免无风险项改变 Graphwar 原始行为。 */
export function shouldUseStepOverflowProtection(
  steepness: number,
  centerX: number,
  currentArgument: number,
  options?: FormulaEvaluationOptions,
) {
  if (!(options?.stepOverflowProtection ?? true)) {
    return false;
  }
  const range = options?.stepOverflowProtectionRange;
  if (range) {
    // 有轨迹范围时按整条可能采样区间做编译期结论，采样热路径可直接复用。
    return stepTermCanOverflowExp(steepness, centerX, range);
  }
  // 没有范围时退回到当前 t 值，保持旧的逐点判断语义。
  return -currentArgument > JAVA_DOUBLE_MAX_EXP_ARGUMENT;
}

/** 输出公式时判断 step 项是否需要抗溢出写法；没有范围时保守保护所有 step 项。 */
export function shouldFormatStepTermWithOverflowProtection(
  steepness: number,
  centerX: number,
  stepOverflowProtection: boolean,
  range: StepOverflowProtectionRange | undefined,
) {
  return stepOverflowProtection && (!range || stepTermCanOverflowExp(steepness, centerX, range));
}

/** 判断指定 x 范围内 exp(-steepness*(x-center)) 是否会超过 Java double 上限。 */
function stepTermCanOverflowExp(steepness: number, centerX: number, range: StepOverflowProtectionRange) {
  const minX = Math.min(range.minX, range.maxX);
  const maxExpArgument = -steepness * (minX - centerX);
  return maxExpArgument > JAVA_DOUBLE_MAX_EXP_ARGUMENT;
}
