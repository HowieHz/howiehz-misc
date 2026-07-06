import type { Ref } from "vue";

import { graphToImagePoint } from "../core/geometry";
import {
  normalizePathForMinimumForwardStep,
  normalizePathPointForStrictForward,
  pathFollowsGraphRule,
} from "../core/graphwar-forward-rule";
import { createGraphPoint, type BoundsRect, type GraphBounds, type GraphPoint, type PixelPoint } from "../core/types";
import type { GraphwarPathStateController, PathPointCoordinateAxis } from "./use-graphwar-path-state";

type PathPointCoordinateState = Pick<
  GraphwarPathStateController,
  | "finishPathPointCoordinateEdit"
  | "getPathPointCoordinateText"
  | "removeActivePathPoint"
  | "setPathPointCoordinateText"
  | "startPathPointCoordinateEdit"
  | "syncPathPointCoordinateTexts"
>;

interface GraphwarPathPointEditingOptions {
  /** 当前截图棋盘矩形；路径点编辑应始终使用页面当前标定。 */
  boundsRect: Ref<BoundsRect>;
  /** 坐标输入框状态应由路径状态 Module 持有。 */
  coordinateState: PathPointCoordinateState;
  /** 坐标输入框结束编辑时应恢复页面统一的 double 精度格式。 */
  formatCoordinate: (value: number) => string;
  /** 当前 Graphwar 坐标范围；无效时路径编辑应保持原失败语义。 */
  getBounds: () => GraphBounds | undefined;
  /** 坐标输入错误文案应由页面本地化决定。 */
  getCoordinateErrorMessage: () => string;
  /** X+ 规则错误文案应由页面本地化决定。 */
  getForwardPathMessage: () => string;
  /** 当前路径的 Graphwar 坐标应由页面统一投影，避免像素/坐标换算规则分叉。 */
  getMappedPathPoints: () => readonly GraphPoint[];
  /** 删除发射点时应失效依赖发射点的 Worker cache。 */
  invalidatePathStartCaches: () => void;
  /** 删除路径点前应取消异步寻路并清理寻路状态。 */
  preparePathPointRemoval: () => void;
  /** 坐标输入解析策略应与页面其他数字输入保持一致。 */
  parseCoordinate: (value: string) => number | undefined;
  /** 当前工作流路径。 */
  pathPixels: Ref<PixelPoint[]>;
  /** 当前工作流路径状态文案。 */
  pathStatus: Ref<string>;
  /** 路径落地应走页面统一入口，以保留缓存失效和预览清理语义。 */
  setPathPixels: (points: PixelPoint[]) => void;
}

export interface GraphwarPathPointEditingController {
  /** 结束路径点坐标编辑并恢复格式化文本。 */
  finishPathPointCoordinateEdit: () => void;
  /** 读取路径点坐标输入框文本。 */
  getPathPointCoordinateText: (index: number, axis: PathPointCoordinateAxis) => string;
  /** 处理坐标输入框文本变更，合法数字会立即映射回截图像素更新路径。 */
  handlePathPointCoordinateInput: (index: number, axis: PathPointCoordinateAxis, value: string) => void;
  /** 删除路径点，并保留原有寻路取消和缓存失效语义。 */
  removePathPoint: (index: number) => boolean;
  /** 更新路径点并重新规范化后续路径。 */
  setPathPoint: (index: number, point: PixelPoint) => boolean;
  /** 记录当前编辑的路径点坐标单元格。 */
  startPathPointCoordinateEdit: (index: number, axis: PathPointCoordinateAxis) => void;
  /** 同步坐标输入框文本；正在编辑的单元格保留原输入。 */
  syncPathPointCoordinateTexts: () => void;
}

/** 管理路径点坐标编辑、拖拽落点和删除路径点的 Graphwar 规则。 */
export function useGraphwarPathPointEditing(
  options: GraphwarPathPointEditingOptions,
): GraphwarPathPointEditingController {
  /** 更新路径点并重新规范化后续路径。 */
  function setPathPoint(index: number, point: PixelPoint) {
    const bounds = options.getBounds();
    if (!bounds || index < 0 || index >= options.pathPixels.value.length) {
      return false;
    }

    const previousPoint = index > 0 ? options.pathPixels.value[index - 1] : undefined;
    const nextPoint = normalizePathPointForStrictForwardForCurrentBounds(point, previousPoint);
    if (!nextPoint) {
      return false;
    }

    const nextPath = [...options.pathPixels.value];
    nextPath[index] = nextPoint;
    const normalizedPath = normalizePathForMinimumForwardStepForCurrentBounds(nextPath);
    if (!pathFollowsGraphRuleForCurrentBounds(normalizedPath)) {
      options.pathStatus.value = options.getForwardPathMessage();
      return false;
    }

    options.setPathPixels(normalizedPath);
    return true;
  }

  /** 读取路径点坐标输入框文本。 */
  function getPathPointCoordinateText(index: number, axis: PathPointCoordinateAxis) {
    return options.coordinateState.getPathPointCoordinateText(index, axis);
  }

  /** 同步坐标输入框文本；正在编辑的单元格保留原输入。 */
  function syncPathPointCoordinateTexts() {
    options.coordinateState.syncPathPointCoordinateTexts({
      formatCoordinate: options.formatCoordinate,
      points: options.getMappedPathPoints(),
    });
  }

  /** 记录当前编辑的路径点坐标单元格。 */
  function startPathPointCoordinateEdit(index: number, axis: PathPointCoordinateAxis) {
    options.coordinateState.startPathPointCoordinateEdit(index, axis);
  }

  /** 结束路径点坐标编辑并恢复格式化文本。 */
  function finishPathPointCoordinateEdit() {
    options.coordinateState.finishPathPointCoordinateEdit({
      formatCoordinate: options.formatCoordinate,
      points: options.getMappedPathPoints(),
    });
    if (options.pathStatus.value === options.getCoordinateErrorMessage()) {
      options.pathStatus.value = "";
    }
  }

  /** 处理坐标输入框文本变更，合法数字会立即映射回截图像素更新路径。 */
  function handlePathPointCoordinateInput(index: number, axis: PathPointCoordinateAxis, value: string) {
    options.coordinateState.setPathPointCoordinateText(index, axis, value);
    const coordinate = options.parseCoordinate(value);
    if (coordinate === undefined) {
      options.pathStatus.value = options.getCoordinateErrorMessage();
      return;
    }

    setPathPointFromGraphCoordinate(index, axis, coordinate);
  }

  /** 删除路径点。 */
  function removePathPoint(index: number) {
    if (index < 0 || index >= options.pathPixels.value.length) {
      return false;
    }
    options.preparePathPointRemoval();
    if (!options.coordinateState.removeActivePathPoint(index)) {
      return false;
    }
    if (index === 0) {
      options.invalidatePathStartCaches();
    }
    return true;
  }

  /** 用 Graphwar 坐标更新单个路径点，其他轴保持原值。 */
  function setPathPointFromGraphCoordinate(index: number, axis: PathPointCoordinateAxis, coordinate: number) {
    const bounds = options.getBounds();
    if (!bounds) {
      return false;
    }

    const currentPoint = options.getMappedPathPoints()[index];
    if (!currentPoint) {
      return false;
    }

    const nextGraphPoint = createGraphPoint(
      axis === "x" ? coordinate : currentPoint.x,
      axis === "y" ? coordinate : currentPoint.y,
    );
    return setPathPoint(index, graphToImagePoint(nextGraphPoint, bounds, options.boundsRect.value));
  }

  /** 按严格 x+ 规则把整条路径推进到下一个可表示 double。 */
  function normalizePathForMinimumForwardStepForCurrentBounds(points: readonly PixelPoint[]) {
    const bounds = options.getBounds();
    if (!bounds || points.length < 2) {
      return [...points];
    }

    return normalizePathForMinimumForwardStep(points, bounds, options.boundsRect.value);
  }

  /** 先按边界收缩点，再只在必要时把 Graphwar x 推到上一个点后的下一个 double。 */
  function normalizePathPointForStrictForwardForCurrentBounds(point: PixelPoint, previousPoint?: PixelPoint) {
    const bounds = options.getBounds();
    if (!bounds) {
      return point;
    }

    return normalizePathPointForStrictForward(point, previousPoint, bounds, options.boundsRect.value);
  }

  /** 验证整条路径是否始终满足 Graphwar 最小 x+ 步长。 */
  function pathFollowsGraphRuleForCurrentBounds(points: readonly PixelPoint[]) {
    const bounds = options.getBounds();
    if (!bounds || points.length < 2) {
      return true;
    }

    return pathFollowsGraphRule(points, bounds, options.boundsRect.value);
  }

  return {
    finishPathPointCoordinateEdit,
    getPathPointCoordinateText,
    handlePathPointCoordinateInput,
    removePathPoint,
    setPathPoint,
    startPathPointCoordinateEdit,
    syncPathPointCoordinateTexts,
  };
}
