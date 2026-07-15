/** 把 Step 数值解析、精确控制点映射和严格障碍包络组合成寻路可复用的边判定。 */
import { imageToGraphPoint } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import {
  imagePointToPlaneGridPoint,
  planeGridCellCenterToImagePoint,
  planeGridPointsEqual,
  type PlaneGridPoint,
} from "../../core/plane-grid";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import { formulaModeUsesStepGlitch } from "../../formula/generation/capabilities";
import {
  quantizeStepFormulaSteepness,
  resolveStepFormulaPlateauTransition,
  resolveStepFormulaCenterX,
} from "../../formula/generation/step-numeric-strategy";
import type { StepFormulaPlateauState } from "../../formula/generation/step-numeric-strategy";
import type { GraphwarTrajectoryFormulaSettings } from "../../formula/trajectory/sampling";
import {
  createGraphwarPlaneMaskSummedArea,
  createGraphwarStepEnvelope,
  graphwarStepEnvelopeHitsPlaneMask,
  type GraphwarPlaneMaskSummedArea,
  type GraphwarStepEnvelope,
  type GraphwarStepEnvelopeInvalidReason,
} from "./step-envelope";
import type { GraphwarPathfindingEdgeEvaluator } from "./visibility-graph";

/** 搜索使用的稳定 Step 数值模型；最终完整公式仍会从真实发射边缘重新解析。 */
export interface GraphwarStepRouteModel {
  decimalPlaces: number;
  equation: GraphwarTrajectoryFormulaSettings["equation"];
  formulaSteepness: number;
  /** 第一条用户路径点的 y；搜索累计高度的固定格点原点。 */
  originY: number;
}

export interface GraphwarStepRouteTransition {
  envelope: GraphwarStepEnvelope;
  resolvedEndY: number;
  resolvedStartY: number;
  /** 打印系数整数累计身份；相同 key 才是同一个 canonical 平台状态。 */
  routeStateKey?: string;
  secondaryCost: number;
}

export type GraphwarStepRouteInvalidReason = GraphwarStepEnvelopeInvalidReason | "numeric" | "obstacle";

export type GraphwarStepRouteTransitionResult =
  | { ok: true; transition: GraphwarStepRouteTransition }
  | { ok: false; reason: GraphwarStepRouteInvalidReason };

export type GraphwarStepRoutePathValidation =
  | {
      ok: true;
      /** 最后一个路径点的实际累计高度，可直接作为后续搜索的初始状态。 */
      resolvedEndY: number;
      /** 最后一个路径点的 canonical 打印系数累计身份。 */
      routeStateKey?: string;
    }
  | {
      invalidSegmentIndex?: number;
      ok: false;
      reason: GraphwarStepRouteInvalidReason;
    };

type GraphwarStepRouteSettings = Pick<
  GraphwarTrajectoryFormulaSettings,
  "algorithm" | "decimalPlaces" | "equation" | "formulaPathSteepness" | "steepness"
> &
  Partial<Pick<GraphwarTrajectoryFormulaSettings, "stepGlitchMode">>;

interface GraphwarStepRouteCollisionContext {
  boundaryInset: number;
  bounds: GraphBounds;
  summedArea: GraphwarPlaneMaskSummedArea;
}

interface GraphwarStepPathfindingEvaluatorOptions extends GraphwarStepRouteCollisionContext {
  boundsRect: BoundsRect;
  exactStartPoint: PixelPoint;
  exactTargetPoint: PixelPoint;
  model: GraphwarStepRouteModel;
  /** 搜索起点承接已有路径后的实际累计高度。 */
  resolvedStartY: number;
  /** 搜索起点的 canonical 打印系数累计身份。 */
  resolvedStartStateKey?: string;
}

/** 有效 ODE 邪道模式会改变逐段语义，必须改走固定扫描器。 */
export function createGraphwarStepRouteModel(
  originY: number,
  settings: GraphwarStepRouteSettings,
): GraphwarStepRouteModel | undefined {
  if (
    settings.algorithm !== "step" ||
    formulaModeUsesStepGlitch(settings.algorithm, settings.equation, settings.stepGlitchMode === true) ||
    !Number.isFinite(originY)
  ) {
    return undefined;
  }
  const formulaSteepness = quantizeStepFormulaSteepness(
    settings.formulaPathSteepness ?? settings.steepness,
    settings.decimalPlaces,
  );
  if (!(formulaSteepness > 0) || !Number.isFinite(formulaSteepness)) {
    return undefined;
  }
  return {
    decimalPlaces: settings.decimalPlaces,
    equation: settings.equation,
    formulaSteepness,
    originY,
  };
}

/** 为固定 route mask 构造 Step 查询材料；调用方可把返回值与 mask cache 同生命周期保存。 */
export function createGraphwarStepRouteSummedArea(routeMask: Uint8Array) {
  return createGraphwarPlaneMaskSummedArea(routeMask);
}

/** 解析并严格检查一条控制边；结果同时携带后继高度和路由次级成本。 */
export function evaluateGraphwarStepRouteTransition(
  model: GraphwarStepRouteModel,
  resolvedStartY: number,
  previous: GraphPoint,
  next: GraphPoint,
  collision: GraphwarStepRouteCollisionContext,
  routeStateKey?: string,
): GraphwarStepRouteTransitionResult {
  if (!graphXAdvancesStrictly(previous.x, next.x)) {
    return { ok: false, reason: "non-forward" };
  }

  const plateauState = createGraphwarStepRoutePlateauState(model, resolvedStartY, routeStateKey);
  if (!plateauState) {
    return { ok: false, reason: "numeric" };
  }
  const resolvedState = resolveStepFormulaPlateauTransition(
    plateauState,
    next.y,
    model.equation,
    model.formulaSteepness,
    model.decimalPlaces,
  );
  const resolved = resolvedState.transition;
  if (!resolved.isValid || !Number.isFinite(resolved.resolvedStartY) || !Number.isFinite(resolved.resolvedEndY)) {
    return { ok: false, reason: "numeric" };
  }

  const centerX = resolveStepFormulaCenterX(
    previous.x,
    next.x,
    resolved.effectiveDeltaY,
    model.formulaSteepness,
    collision.bounds,
    model.decimalPlaces,
  );
  const envelopeResult = createGraphwarStepEnvelope({
    centerX,
    endX: next.x,
    resolvedEndY: resolved.resolvedEndY,
    resolvedStartY: resolved.resolvedStartY,
    startX: previous.x,
  });
  if (!envelopeResult.ok) {
    return envelopeResult;
  }
  if (
    graphwarStepEnvelopeHitsPlaneMask(
      envelopeResult.envelope,
      collision.bounds,
      collision.summedArea,
      collision.boundaryInset,
    )
  ) {
    return { ok: false, reason: "obstacle" };
  }

  return {
    ok: true,
    transition: {
      envelope: envelopeResult.envelope,
      resolvedEndY: resolved.resolvedEndY,
      resolvedStartY: resolved.resolvedStartY,
      ...(resolvedState.state.coefficientUnits === undefined
        ? {}
        : { routeStateKey: resolvedState.state.coefficientUnits.toString() }),
      secondaryCost: Math.abs(next.y - previous.y),
    },
  };
}

/** 为 Visibility Graph/Theta* 构造共用边判定；首尾保留精确点击坐标，中间点使用 cell 中心。 */
export function createGraphwarStepPathfindingEdgeEvaluator(options: GraphwarStepPathfindingEvaluatorOptions): {
  estimateRemainingSecondaryCost: (current: PlaneGridPoint, target: PlaneGridPoint) => number;
  evaluateEdge: GraphwarPathfindingEdgeEvaluator;
  initialRouteState: number;
  initialRouteStateKey?: string;
} {
  const exactStartCell = imagePointToPlaneGridPoint(options.exactStartPoint, options.boundsRect);
  const exactTargetCell = imagePointToPlaneGridPoint(options.exactTargetPoint, options.boundsRect);
  const toGraphPoint = (point: PlaneGridPoint) =>
    imageToGraphPoint(
      planePointToExactOrCellCenter(point, exactStartCell, exactTargetCell, options),
      options.bounds,
      options.boundsRect,
    );

  return {
    estimateRemainingSecondaryCost(current, target) {
      return Math.abs(toGraphPoint(target).y - toGraphPoint(current).y);
    },
    evaluateEdge(previous, next, resolvedStartY, routeStateKey) {
      const result = evaluateGraphwarStepRouteTransition(
        options.model,
        resolvedStartY,
        toGraphPoint(previous),
        toGraphPoint(next),
        {
          boundaryInset: options.boundaryInset,
          bounds: options.bounds,
          summedArea: options.summedArea,
        },
        routeStateKey,
      );
      return result.ok
        ? {
            nextRouteState: result.transition.resolvedEndY,
            ...(result.transition.routeStateKey === undefined
              ? {}
              : { nextRouteStateKey: result.transition.routeStateKey }),
            secondaryCost: result.transition.secondaryCost,
          }
        : undefined;
    },
    initialRouteState: options.resolvedStartY,
    ...(options.resolvedStartStateKey === undefined ? {} : { initialRouteStateKey: options.resolvedStartStateKey }),
  };
}

/** 逐段检查已有或完整候选路径，并定位第一条不能用于 Step 寻路的段。 */
export function validateGraphwarStepRoutePath(options: {
  boundaryInset: number;
  bounds: GraphBounds;
  boundsRect: BoundsRect;
  /** 续接子路径时传入前缀的实际累计高度；完整路径默认从首点高度开始。 */
  initialResolvedY?: number;
  /** 续接子路径时传入前缀的 canonical 打印系数累计身份。 */
  initialRouteStateKey?: string;
  model: GraphwarStepRouteModel;
  points: readonly PixelPoint[];
  summedArea: GraphwarPlaneMaskSummedArea;
}): GraphwarStepRoutePathValidation {
  let resolvedStartY = options.initialResolvedY ?? options.model.originY;
  // 完整路径从模型原点开始，打印系数累计必然为 0；续接路径必须显式继承前缀 key。
  let routeStateKey = options.initialRouteStateKey ?? (options.initialResolvedY === undefined ? "0" : undefined);
  if (!Number.isFinite(resolvedStartY)) {
    return { ok: false, reason: "numeric" };
  }
  for (let index = 1; index < options.points.length; index += 1) {
    const previous = imageToGraphPoint(options.points[index - 1], options.bounds, options.boundsRect);
    const next = imageToGraphPoint(options.points[index], options.bounds, options.boundsRect);
    const result = evaluateGraphwarStepRouteTransition(
      options.model,
      resolvedStartY,
      previous,
      next,
      options,
      routeStateKey,
    );
    if (!result.ok) {
      return { invalidSegmentIndex: index - 1, ok: false, reason: result.reason };
    }
    resolvedStartY = result.transition.resolvedEndY;
    routeStateKey = result.transition.routeStateKey;
  }
  return {
    ok: true,
    resolvedEndY: resolvedStartY,
    ...(routeStateKey === undefined ? {} : { routeStateKey }),
  };
}

/** 从路由标签恢复数值 resolver 状态；非法 key 直接让该边不可用。 */
function createGraphwarStepRoutePlateauState(
  model: GraphwarStepRouteModel,
  resolvedY: number,
  routeStateKey?: string,
): StepFormulaPlateauState | undefined {
  if (routeStateKey === undefined) {
    // 兼容只提供旧 number 状态的调用方；内部 Step 流程始终会提供精确 key。
    return { originY: resolvedY, resolvedY };
  }
  try {
    return {
      coefficientUnits: BigInt(routeStateKey),
      originY: model.originY,
      resolvedY,
    };
  } catch {
    return undefined;
  }
}

function planePointToExactOrCellCenter(
  point: PlaneGridPoint,
  exactStartCell: PlaneGridPoint,
  exactTargetCell: PlaneGridPoint,
  options: Pick<GraphwarStepPathfindingEvaluatorOptions, "boundsRect" | "exactStartPoint" | "exactTargetPoint">,
) {
  if (planeGridPointsEqual(point, exactStartCell)) {
    return options.exactStartPoint;
  }
  if (planeGridPointsEqual(point, exactTargetCell)) {
    return options.exactTargetPoint;
  }
  return planeGridCellCenterToImagePoint(point, options.boundsRect);
}
