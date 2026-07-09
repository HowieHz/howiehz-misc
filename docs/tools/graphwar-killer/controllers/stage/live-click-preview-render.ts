import { formatSvgNumber } from "../../core/numbers";
import type { BoundsRect, EquationMode, GraphBounds, GraphPoint, PixelPoint } from "../../core/types";
import type { GraphwarExpressionParserOptions } from "../../formula/simulation/simulator";
import {
  createGraphwarTrajectoryFormulaContext,
  sampleGraphwarExpressionTrajectoryWithStops,
  sampleGraphwarFormulaTrajectory,
  type GraphwarTrajectoryCollisionSettings,
  type GraphwarTrajectoryFormulaSettings,
} from "../../formula/trajectory/sampling";

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

export interface GraphwarLiveClickPreviewRenderResult {
  /** 已格式化给 SVG polyline 使用的轨迹点字符串。 */
  curvePoints: string;
  /** Worker 内实际渲染耗时，单位毫秒。 */
  elapsedMs: number;
}

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
      : sampleFormulaPreview(input);
  return {
    curvePoints: result ? formatVisibleTrajectoryPoints(result.visiblePixels, result.obstacleHitIndex) : "",
    elapsedMs: nowMs() - startedAt,
  };
}

function sampleFormulaPreview(input: Extract<GraphwarLiveClickPreviewRenderInput, { type: "formula" }>) {
  const context = createGraphwarTrajectoryFormulaContext({
    bounds: input.bounds,
    points: input.points,
    settings: input.settings,
    soldierCenter: input.points[0],
  });
  if (context.formulaPoints.length < 2) {
    return undefined;
  }

  return sampleGraphwarFormulaTrajectory({
    bounds: input.bounds,
    boundsRect: input.boundsRect,
    ...(input.collision ? { collision: input.collision } : {}),
    collectVisiblePixels: true,
    context,
  });
}

function formatVisibleTrajectoryPoints(points: readonly PixelPoint[], hitIndex: number) {
  const sampledPoints = hitIndex >= 0 ? points.slice(0, hitIndex + 1) : points;
  return sampledPoints.map((point) => `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`).join(" ");
}

function nowMs() {
  return performance.now();
}
