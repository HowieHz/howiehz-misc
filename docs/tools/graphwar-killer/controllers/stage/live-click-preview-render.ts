import { nowMs } from "../../core/time";
import type { BoundsRect, EquationMode, GraphBounds, GraphPoint } from "../../core/types";
import type { GraphwarExpressionParserOptions } from "../../formula/simulation/simulator";
import {
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
  id: number;
  input: GraphwarLiveClickPreviewRenderInput;
}

export type GraphwarLiveClickPreviewWorkerResponse =
  | {
      id: number;
      result: GraphwarLiveClickPreviewRenderResult;
      type: "success";
    }
  | {
      id: number;
      message: string;
      type: "error";
    };

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
            points: input.points,
            settings: input.settings,
            soldierCenter: input.points[0],
          }).result;
  return {
    curvePoints: result ? formatVisibleTrajectoryPoints(result.visiblePixels, result.obstacleHitIndex) : "",
    elapsedMs: nowMs() - startedAt,
  };
}
