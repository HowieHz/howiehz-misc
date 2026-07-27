import { isGraphwarBackendAttemptIdentity, type GraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";
import { nowMs } from "../../core/time";
import type { BoundsRect, EquationMode, GraphBounds, GraphPoint } from "../../core/types";
import type { GraphwarExpressionParserOptions } from "../../formula/simulation/simulator";
import {
  isGraphwarTrajectoryBounds,
  isGraphwarTrajectoryBoundsRect,
  isGraphwarTrajectoryCollisionSettings,
  isGraphwarTrajectoryExpressionParserOptions,
  isGraphwarTrajectoryFormulaSettings,
  isGraphwarTrajectoryPoint,
} from "../../formula/trajectory/input-validation";
import {
  createGraphwarTrajectoryFormulaMode,
  resolveGraphwarTrajectory,
  sampleGraphwarExpressionTrajectoryWithStops,
  type GraphwarTrajectoryCollisionSettings,
  type GraphwarTrajectoryFormulaSettings,
} from "../../formula/trajectory/sampling";
import { formatVisibleTrajectoryPoints } from "../../presentation/stage/svg-polyline";

/** 求解器与模拟器实时预览共享的几何和碰撞输入。 */
interface GraphwarLiveClickPreviewRenderInputBase {
  /** 当前 Graphwar 坐标边界。 */
  bounds: GraphBounds;
  /** 截图内 Graphwar 坐标系矩形。 */
  boundsRect: BoundsRect;
  /** 可选碰撞设置；实时预览应和主轨迹使用同一障碍判断。 */
  collision?: GraphwarTrajectoryCollisionSettings;
}

export type GraphwarLiveClickPreviewRenderInput =
  | (GraphwarLiveClickPreviewRenderInputBase & {
      /** 预览用户手写表达式轨迹。 */
      type: "expression";
      equation: EquationMode;
      expression: string;
      launchAngleRadians?: number;
      parser?: GraphwarExpressionParserOptions;
      soldierCenter: GraphPoint;
    })
  | (GraphwarLiveClickPreviewRenderInputBase & {
      /** 预览路径点生成的公式轨迹。 */
      type: "formula";
      points: readonly GraphPoint[];
      settings: GraphwarTrajectoryFormulaSettings;
    });

/** 实时点击预览 Worker 可直接写回页面的渲染结果。 */
export interface GraphwarLiveClickPreviewRenderResult {
  /** 已格式化给 SVG polyline 使用的轨迹点字符串。 */
  curvePoints: string;
  /** Worker 内实际渲染耗时，单位毫秒。 */
  elapsedMs: number;
}

/** 实时点击预览 Worker 的带编号请求。 */
export interface GraphwarLiveClickPreviewWorkerRequest {
  /** Stable preview task and currently authoritative backend attempt. */
  attempt: GraphwarBackendAttemptIdentity;
  id: number;
  input: GraphwarLiveClickPreviewRenderInput;
}

export type GraphwarLiveClickPreviewWorkerResponse =
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      result: GraphwarLiveClickPreviewRenderResult;
      type: "success";
    }
  | {
      attempt: GraphwarBackendAttemptIdentity;
      id: number;
      message: string;
      type: "error";
    };

/** 从 malformed preview request 中只恢复可安全回传的完整 Worker 身份。 */
export function getGraphwarLiveClickPreviewWorkerRequestIdentity(value: unknown) {
  if (!isRecord(value) || !isGraphwarBackendAttemptIdentity(value.attempt) || !isNonNegativeSafeInteger(value.id)) {
    return undefined;
  }
  return { attempt: value.attempt, id: value.id };
}

/** 在 live-preview Worker 唯一入口验证完整 request 和必要数值/TypedArray 边界。 */
export function isGraphwarLiveClickPreviewWorkerRequest(
  value: unknown,
): value is GraphwarLiveClickPreviewWorkerRequest {
  return getGraphwarLiveClickPreviewWorkerRequestIdentity(value) !== undefined && isRecord(value) && "input" in value
    ? isGraphwarLiveClickPreviewRenderInput(value.input)
    : false;
}

/** 渲染实时点击预览；保持纯函数，供 Worker 入口直接调用。 */
export function renderGraphwarLiveClickPreview(
  input: GraphwarLiveClickPreviewRenderInput,
): GraphwarLiveClickPreviewRenderResult {
  const startedAt = nowMs();
  const result =
    input.type === "expression"
      ? sampleGraphwarExpressionTrajectoryWithStops({
          bounds: input.bounds,
          boundsRect: input.boundsRect,
          ...(input.collision ? { collision: input.collision } : {}),
          collectVisiblePixels: true,
          equation: input.equation,
          expression: input.expression,
          ...(input.launchAngleRadians === undefined ? {} : { launchAngleRadians: input.launchAngleRadians }),
          ...(input.parser ? { parser: input.parser } : {}),
          soldierCenter: input.soldierCenter,
        })
      : input.points.length < 2
        ? undefined
        : resolveGraphwarTrajectory({
            bounds: input.bounds,
            boundsRect: input.boundsRect,
            ...(input.collision ? { collision: input.collision } : {}),
            collectVisiblePixels: true,
            formulaMode: createGraphwarTrajectoryFormulaMode(input.settings),
            points: input.points,
            soldierCenter: input.points[0],
          }).result;
  return {
    curvePoints: result ? formatVisibleTrajectoryPoints(result.visiblePixels, result.obstacleHitIndex) : "",
    elapsedMs: nowMs() - startedAt,
  };
}

function isGraphwarLiveClickPreviewRenderInput(value: unknown): value is GraphwarLiveClickPreviewRenderInput {
  if (
    !isRecord(value) ||
    !isGraphwarTrajectoryBounds(value.bounds) ||
    !isGraphwarTrajectoryBoundsRect(value.boundsRect) ||
    (value.collision !== undefined && !isGraphwarTrajectoryCollisionSettings(value.collision))
  ) {
    return false;
  }
  if (value.type === "expression") {
    return (
      (value.equation === "y" || value.equation === "dy" || value.equation === "ddy") &&
      typeof value.expression === "string" &&
      (value.launchAngleRadians === undefined || isFiniteNumber(value.launchAngleRadians)) &&
      (value.parser === undefined || isGraphwarTrajectoryExpressionParserOptions(value.parser)) &&
      isGraphwarTrajectoryPoint(value.soldierCenter)
    );
  }
  return (
    value.type === "formula" &&
    Array.isArray(value.points) &&
    value.points.every(isGraphwarTrajectoryPoint) &&
    isGraphwarTrajectoryFormulaSettings(value.settings)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
