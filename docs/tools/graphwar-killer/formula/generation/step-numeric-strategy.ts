/** Step 公式的数值保护策略；公式输出、寻路和轨迹采样必须共用同一套判断。 */
import { planePixelsToGraphUnits } from "../../core/geometry";
import {
  clampDecimalPlaces,
  floorToDecimalPlaces,
  formatDecimal,
  normalizeZero,
  roundToDecimalPlaces,
} from "../../core/numbers";
import { graphwarToolDefaults } from "../../core/tool/defaults";
import type { EquationMode, GraphBounds, GraphPoint } from "../../core/types";
import type { GraphwarSignProtection, GraphwarSignRole } from "./sign-protection";

/** Java/Graphwar double 的指数上限；Graphwar 会把 exp(z) 解析成 Math.pow(Math.E, z)。 */
const JAVA_DOUBLE_MAX_EXP_ARGUMENT = Math.log(Number.MAX_VALUE);

/** 相邻控制点解析出的最终文本等价 Step 数值。 */
export interface ResolvedStepFormulaTransition {
  /** 当前方程最终打印的唯一 canonical 系数。 */
  activeCoefficient: number;
  /** Canonical 系数对应的实际平台高度变化。 */
  effectiveDeltaY: number;
  /** 由 canonical 系数反推的一阶导系数；y'' 发射角必须使用它。 */
  firstDerivativeCoefficient: number;
  /** 当前方程和陡峭度能否表示有限、非退化的阶跃。 */
  isValid: boolean;
  /** 应用有效高度变化后的平台 y。 */
  resolvedEndY: number;
  /** 本段开始前的实际平台 y。 */
  resolvedStartY: number;
  /** 由 canonical 系数反推的二阶导系数。 */
  secondDerivativeCoefficient: number;
  /** 本段希望补到目标点的高度差。 */
  wantedDeltaY: number;
  /** 由 canonical 系数反推的 y= 高度系数。 */
  yCoefficient: number;
}

/** 整条 Step 路径按最终公式精度迭代解析出的平台高度。 */
export interface ResolvedStepFormula {
  /** 当前方程模式。 */
  equation: EquationMode;
  /** 最终公式文本中的陡峭度。 */
  formulaSteepness: number;
  /** 终点平台的精确打印系数累计状态；寻路用它消除浮点加法造成的伪标签。 */
  plateauState: StepFormulaPlateauState;
  /** 与相邻控制点一一对应的解析结果，包括最终会省略的零系数段。 */
  transitions: ResolvedStepFormulaTransition[];
}

/** 以首平台为原点、按打印系数最小十进制单位累计的 Step 状态。 */
export interface StepFormulaPlateauState {
  /** 有公式精度时保存精确整数单位；undefined 表示调用方要求保留未量化 double。 */
  coefficientUnits?: bigint;
  /** 当前累计格点的固定高度原点；邪道实际落点会建立新原点。 */
  originY: number;
  /** 从原点和整数单位重建的 canonical 平台高度。 */
  resolvedY: number;
}

/** 按最终公式文本规则量化普通系数，供输出、采样和寻路共用。 */
export function quantizeFormulaCoefficient(coefficientValue: number, decimalPlaces?: number) {
  if (decimalPlaces === undefined) {
    return coefficientValue;
  }

  // 文本先按原符号决定 +/-，再格式化绝对值；负数临界值必须沿用同一顺序。
  const normalizedCoefficient = normalizeZero(coefficientValue, decimalPlaces);
  if (normalizedCoefficient === 0) {
    return 0;
  }
  const magnitude = roundToDecimalPlaces(Math.abs(normalizedCoefficient), decimalPlaces);
  return normalizedCoefficient < 0 ? -magnitude : magnitude;
}

/** 按最终 `value-center` 文本实际打印的负 offset 量化中心，再还原中心值。 */
export function quantizeFormulaOffsetCenter(center: number, decimalPlaces?: number) {
  return decimalPlaces === undefined ? center : -roundToDecimalPlaces(-center, decimalPlaces);
}

/** 邪道 y 门必须至少保留 1 位，避免 0 位把目标中心和小于 0.5 的士兵半径量化到同一门线。 */
export function getStepGlitchFormulaDecimalPlaces(decimalPlaces: number): number;
export function getStepGlitchFormulaDecimalPlaces(decimalPlaces?: number): number | undefined;
export function getStepGlitchFormulaDecimalPlaces(decimalPlaces?: number) {
  return decimalPlaces === undefined ? undefined : Math.max(1, decimalPlaces);
}

/** 先量化陡峭度，后续所有方程系数和中心都必须使用这个 kf。 */
export function quantizeStepFormulaSteepness(steepness: number, decimalPlaces?: number) {
  return decimalPlaces === undefined ? steepness : roundToDecimalPlaces(steepness, decimalPlaces);
}

/**
 * 从当前实际平台补到下一个目标点，并以当前方程最终打印的系数为唯一真源。
 *
 * 调用方应传入已经量化的 formulaSteepness，避免批量解析或寻路热路径重复舍入 kf。
 */
export function resolveStepFormulaTransition(
  resolvedStartY: number,
  targetY: number,
  equation: EquationMode,
  formulaSteepness: number,
  decimalPlaces?: number,
): ResolvedStepFormulaTransition {
  const wantedDeltaY = targetY - resolvedStartY;
  const scale = getStepEquationScale(equation, formulaSteepness);
  const activeCoefficient = quantizeFormulaCoefficient(wantedDeltaY * scale, decimalPlaces);
  const hasUsableScale =
    Number.isFinite(resolvedStartY) &&
    Number.isFinite(targetY) &&
    Number.isFinite(formulaSteepness) &&
    formulaSteepness > 0 &&
    Number.isFinite(scale) &&
    scale !== 0 &&
    Number.isFinite(activeCoefficient);

  let yCoefficient: number;
  let firstDerivativeCoefficient: number;
  let secondDerivativeCoefficient: number;
  if (equation === "y") {
    yCoefficient = activeCoefficient;
    firstDerivativeCoefficient = activeCoefficient * formulaSteepness;
    secondDerivativeCoefficient = firstDerivativeCoefficient * formulaSteepness;
  } else if (equation === "dy") {
    firstDerivativeCoefficient = activeCoefficient;
    yCoefficient = formulaSteepness === 0 ? 0 : activeCoefficient / formulaSteepness;
    secondDerivativeCoefficient = activeCoefficient * formulaSteepness;
  } else {
    secondDerivativeCoefficient = activeCoefficient;
    firstDerivativeCoefficient = formulaSteepness === 0 ? 0 : activeCoefficient / formulaSteepness;
    yCoefficient = formulaSteepness === 0 ? 0 : firstDerivativeCoefficient / formulaSteepness;
  }

  // kf=0 时最终曲线是常量，Graphwar 的发射点 offset 会消掉它，因此实际平台不能前进。
  const hasZeroSteepness =
    formulaSteepness === 0 &&
    Number.isFinite(resolvedStartY) &&
    Number.isFinite(targetY) &&
    Number.isFinite(activeCoefficient);
  const effectiveDeltaY = hasUsableScale ? activeCoefficient / scale : hasZeroSteepness ? 0 : Number.NaN;
  return {
    activeCoefficient,
    effectiveDeltaY,
    firstDerivativeCoefficient,
    isValid: hasUsableScale && Number.isFinite(effectiveDeltaY),
    resolvedEndY: resolvedStartY + effectiveDeltaY,
    resolvedStartY,
    secondDerivativeCoefficient,
    wantedDeltaY,
    yCoefficient,
  };
}

/** 创建一段普通 Step 累计的格点原点。 */
export function createStepFormulaPlateauState(originY: number, decimalPlaces?: number): StepFormulaPlateauState {
  return {
    ...(decimalPlaces === undefined ? {} : { coefficientUnits: 0n }),
    originY,
    resolvedY: originY,
  };
}

/**
 * 从精确打印系数累计状态解析一段 Step。
 *
 * `resolvedY` 仍是 Graphwar double，但状态身份来自整数单位；等价路径不会再因加法 ULP 产生不同标签。
 */
export function resolveStepFormulaPlateauTransition(
  state: StepFormulaPlateauState,
  targetY: number,
  equation: EquationMode,
  formulaSteepness: number,
  decimalPlaces?: number,
) {
  const scale = getStepEquationScale(equation, formulaSteepness);
  const resolvedStartY = resolveStepFormulaPlateauY(state, scale, decimalPlaces);
  const transition = resolveStepFormulaTransition(resolvedStartY, targetY, equation, formulaSteepness, decimalPlaces);
  if (decimalPlaces === undefined || state.coefficientUnits === undefined || !transition.isValid) {
    const nextState: StepFormulaPlateauState = {
      originY: state.originY,
      resolvedY: transition.resolvedEndY,
    };
    return { state: nextState, transition };
  }

  const coefficientUnits =
    state.coefficientUnits + quantizedCoefficientToIntegerUnits(transition.activeCoefficient, decimalPlaces);
  const nextState: StepFormulaPlateauState = {
    coefficientUnits,
    originY: state.originY,
    resolvedY: resolveStepFormulaPlateauY(
      { coefficientUnits, originY: state.originY, resolvedY: transition.resolvedEndY },
      scale,
      decimalPlaces,
    ),
  };
  return {
    state: nextState,
    transition: {
      ...transition,
      resolvedEndY: nextState.resolvedY,
      resolvedStartY,
    },
  };
}

/** O(n) 解析整条 Step 路径；每段都从上一段实际平台继续补向用户目标。 */
export function resolveStepFormula(
  points: readonly GraphPoint[],
  steepness: number,
  equation: EquationMode,
  options?: Pick<FormulaEvaluationOptions, "formulaDecimalPlaces" | "stepSegmentDeltaYs">,
): ResolvedStepFormula {
  const decimalPlaces = options?.formulaDecimalPlaces;
  const formulaSteepness = quantizeStepFormulaSteepness(steepness, decimalPlaces);
  const transitions: ResolvedStepFormulaTransition[] = [];
  let plateauState = createStepFormulaPlateauState(points[0]?.y ?? 0, decimalPlaces);
  for (let index = 1; index < points.length; index += 1) {
    const targetY = points[index].y;
    const deltaYOverride = options?.stepSegmentDeltaYs?.[index - 1];
    // 邪道落点后的覆盖量等于 targetY-actualStartY，可直接恢复真实段起点再继续解析。
    if (deltaYOverride !== undefined) {
      plateauState = createStepFormulaPlateauState(targetY - deltaYOverride, decimalPlaces);
    }
    const resolved = resolveStepFormulaPlateauTransition(
      plateauState,
      targetY,
      equation,
      formulaSteepness,
      decimalPlaces,
    );
    transitions.push(resolved.transition);
    plateauState = resolved.state;
  }
  return { equation, formulaSteepness, plateauState, transitions };
}

/** 返回 y、y'、y'' canonical 系数相对实际平台高度变化的尺度。 */
function getStepEquationScale(equation: EquationMode, formulaSteepness: number) {
  return equation === "y" ? 1 : equation === "dy" ? formulaSteepness : formulaSteepness ** 2;
}

/** 从精确十进制系数累计值恢复 Graphwar double 平台高度。 */
function resolveStepFormulaPlateauY(state: StepFormulaPlateauState, equationScale: number, decimalPlaces?: number) {
  if (decimalPlaces === undefined || state.coefficientUnits === undefined) {
    return state.resolvedY;
  }
  const coefficient = Number(state.coefficientUnits) / 10 ** clampDecimalPlaces(decimalPlaces);
  return state.originY + coefficient / equationScale;
}

/** 最终系数已经按 decimalPlaces 量化；转字符串后可无损恢复对应的十进制整数单位。 */
function quantizedCoefficientToIntegerUnits(coefficient: number, decimalPlaces: number) {
  const safeDecimalPlaces = clampDecimalPlaces(decimalPlaces);
  const magnitudeText = formatDecimal(Math.abs(coefficient), safeDecimalPlaces);
  const [integerPart, fractionPart = ""] = magnitudeText.split(".");
  const digits = `${integerPart}${fractionPart.padEnd(safeDecimalPlaces, "0")}`.replace(/^0+/, "") || "0";
  const units = BigInt(digits);
  return coefficient < 0 ? -units : units;
}

/** 将 Step 中心向左移动，使最终 sigmoid 在用户目标 x 处进入允许尾差。 */
export function calculateStepFormulaCenterX(
  startX: number,
  targetX: number,
  effectiveDeltaY: number,
  formulaSteepness: number,
  bounds: GraphBounds,
) {
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(targetX) ||
    !Number.isFinite(effectiveDeltaY) ||
    !Number.isFinite(formulaSteepness)
  ) {
    return Number.NaN;
  }
  if (formulaSteepness <= 0) {
    return targetX;
  }

  const availableOffset = targetX - startX - planePixelsToGraphUnits(1, bounds, "x");
  const requiredProgress =
    1 -
    planePixelsToGraphUnits(graphwarToolDefaults.targetRangePixelTolerance, bounds, "y") / Math.abs(effectiveDeltaY);
  if (effectiveDeltaY === 0 || requiredProgress <= 0.5 || availableOffset <= 0 || !Number.isFinite(availableOffset)) {
    return targetX;
  }

  const centerOffset = Math.log(requiredProgress / (1 - requiredProgress)) / formulaSteepness;
  return targetX - Math.min(centerOffset, availableOffset);
}

/** Step 中心只能向左量化；向右舍入会让目标 x 处重新超出 1px 尾差。 */
export function quantizeStepFormulaCenterX(centerX: number, decimalPlaces?: number) {
  return decimalPlaces === undefined ? centerX : floorToDecimalPlaces(centerX, decimalPlaces);
}

/** 计算并量化最终公式中心，寻路的 xs=2c-x1 应直接使用该返回值。 */
export function resolveStepFormulaCenterX(
  startX: number,
  targetX: number,
  effectiveDeltaY: number,
  formulaSteepness: number,
  bounds: GraphBounds,
  decimalPlaces?: number,
) {
  return quantizeStepFormulaCenterX(
    calculateStepFormulaCenterX(startX, targetX, effectiveDeltaY, formulaSteepness, bounds),
    decimalPlaces,
  );
}

/** Step 指数项只需要覆盖实际轨迹会扫过的 x 范围，减少公式长度和数值偏差。 */
export interface StepOverflowProtectionRange {
  /** 轨迹采样区间右端 Graphwar x。 */
  maxX: number;
  /** 轨迹采样区间左端 Graphwar x。 */
  minX: number;
}

/** Step 邪道段共用的固定 x 窗口和落点目标。 */
interface StepGlitchSegmentBase {
  /** 触发窗口的右边界；关闭旧邪道门，避免后续反向段重新触发。 */
  endX: number;
  /** 最终公式里的 x 左门；扫描器可固定像素门，普通求解则由右门和窗口宽度推导。 */
  startX: number;
  /** 当前路径段目标中心 y；用于候选落点误差。 */
  targetY: number;
}

/** Step y'= 邪道段；高导数门在目标命中圈处关闭。 */
export interface StepFirstOrderGlitchSegment extends StepGlitchSegmentBase {
  /** 目标导数；按源码最小步长估算，用来迫使自适应步长缩到邪道触发边界。 */
  derivative: number;
  equation: "dy";
  /** Y 门关闭阈值；进入目标命中圈就应关门，不必继续冲到目标中心线。 */
  gateY: number;
}

/** Step y''= 邪道段；同一 RK4 步内先加速纵跳，再按跳前/跨门速度计算末相位刹车脉冲，候选按落点 y、单次跳转和无障碍验收，不验收最终 y'。 */
export interface StepSecondOrderGlitchSegment extends StepGlitchSegmentBase {
  /** 纵跳阶段使用的加速度。 */
  acceleration: number;
  /** 轨迹尚未进入目标近侧命中边界时，加速门保持开启。 */
  accelerationGateY: number;
  /** 末个 RK4 相位使用的刹车加速度。 */
  braking: number;
  /** RK4 内部预测越过目标远侧命中边界后，刹车门才开启。 */
  brakingGateY: number;
  equation: "ddy";
  /** 加速和刹车脉冲在恢复步的 a2 前一起关闭，避免内部预测重新触发。 */
  pulseEndX: number;
}

/** 最终公式中的一段 Step 邪道替换项。 */
export type StepGlitchSegment = StepFirstOrderGlitchSegment | StepSecondOrderGlitchSegment;

/** 编译和输出共用的公式数值保护选项；调用方先探测轨迹，再决定是否启用保护。 */
export interface FormulaEvaluationOptions {
  /** ABS y'' 每个折点按真实二阶状态求出的速度变化；末项只保留路径后趋平意图，不验收最终导数。 */
  absSecondDerivativePulseDeltaSlopes?: readonly (number | undefined)[];
  /** 从左到右模拟确认的真实段起点；首段始终使用重新解析出的枪口点。 */
  segmentStartPoints?: readonly (GraphPoint | undefined)[];
  /** 当前公式方程；Step 必须据此选择最终打印的 canonical 系数。 */
  equation?: EquationMode;
  /** 采样应按最终公式小数位判断参数、系数、溢出和 sign 折点。 */
  formulaDecimalPlaces?: number;
  /** 只在最终 double 实参精确为 0 时上报原始段和逻辑角色。 */
  onZeroSignArgument?: (segmentIndex: number, role: GraphwarSignRole) => void;
  /** 按原始路径段保存的局部 sign 除零保护；未设置的逻辑项保留 Graphwar 原始除法。 */
  signProtection?: GraphwarSignProtection;
  /** 每个 step 段对应的邪道替换项；undefined 表示该段保持普通 step。 */
  stepGlitchSegments?: readonly (StepGlitchSegment | undefined)[];
  /** 每个 step 段的期望高度差覆盖；邪道段后的普通 step 用它恢复模拟器实际起点。 */
  stepSegmentDeltaYs?: readonly (number | undefined)[];
  /** 只从表达式中临时排除指定段；逐段求解用它保证 prefix 不包含当前及未来候选。 */
  disabledSegments?: readonly boolean[];
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

/** 运行时判断 step 导数项是否需要抗溢出，避免无风险项改变 Graphwar 原始行为。 */
export function shouldUseStepDerivativeOverflowProtection(
  steepness: number,
  centerX: number,
  options?: FormulaEvaluationOptions,
) {
  if (!(options?.stepOverflowProtection ?? true)) {
    return false;
  }
  const range = options?.stepOverflowProtectionRange;
  if (range) {
    // 有轨迹范围时按整条可能采样区间做编译期结论，采样热路径可直接复用。
    return stepDerivativeTermNeedsOverflowProtection(steepness, centerX, range);
  }
  // 没有范围时无法证明直写式安全；应与公式输出一样保守使用 stable 导数形式。
  return true;
}

/** 输出导数公式时判断 step 项是否需要抗溢出写法；没有范围时保守保护导数项。 */
export function shouldFormatStepDerivativeWithOverflowProtection(
  steepness: number,
  centerX: number,
  stepOverflowProtection: boolean,
  range: StepOverflowProtectionRange | undefined,
) {
  return stepOverflowProtection && (!range || stepDerivativeTermNeedsOverflowProtection(steepness, centerX, range));
}

/** 判断指定 x 范围内 step 导数直写式是否会因 exp 本身溢出而产生 NaN。 */
function stepDerivativeTermNeedsOverflowProtection(
  steepness: number,
  centerX: number,
  range: StepOverflowProtectionRange,
) {
  const minX = Math.min(range.minX, range.maxX);
  const maxExpArgument = -steepness * (minX - centerX);
  // Graphwar 会先算 exp/(1+exp)^n 这一侧；分母溢出只会得到 0，exp 本身溢出才会变成 NaN。
  return maxExpArgument > JAVA_DOUBLE_MAX_EXP_ARGUMENT;
}
