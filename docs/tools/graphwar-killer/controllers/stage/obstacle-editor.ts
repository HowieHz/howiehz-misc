import { ref, type Ref } from "vue";

import {
  imagePointToPlaneGridPoint,
  planeGridCellCenterToImagePoint,
  type PlaneGridPoint,
} from "../../core/plane-grid";
import type { BoundsRect, PixelPoint } from "../../core/types";
import {
  countObstacleMaskComponents,
  paintObstacleMaskDisk,
  paintObstacleMaskStroke,
  type DetectedObstacleMap,
} from "../../detection/objects";

type GraphwarObstacleEditorStatusKind = "success" | "warning";

/** 障碍画笔控制器所需的 mask、坐标和交互依赖。 */
export interface GraphwarObstacleEditorOptions {
  /** 截图中的 Graphwar 坐标系矩形；笔刷坐标应以当前矩形换算到原始平面。 */
  boundsRect: Ref<BoundsRect>;
  /** 连续笔刷操作后的障碍统计刷新延迟。 */
  editRefreshDelayMs: number;
  /** 当前有效笔刷直径；返回 undefined 时应阻止实际绘制。 */
  getBrushDiameter: () => number | undefined;
  /** 障碍统计刷新完成文案。 */
  getEditsAppliedMessage: (count: number) => string;
  /** 恢复自动识别障碍后的文案。 */
  getEditsClearedMessage: (count: number) => string;
  /** 障碍统计刷新中文案。 */
  getUpdatingEditsMessage: () => string;
  /** 障碍 mask 改变后应清理依赖旧 mask 的缓存。 */
  invalidateObstacleCaches: () => void;
  /** 笔刷或恢复基线前应取消正在运行的寻路并清理相关状态。 */
  prepareObstacleEdit: () => void;
  /** 障碍编辑状态文案仍由检测面板展示。 */
  setStatus: (message: string, kind: GraphwarObstacleEditorStatusKind) => void;
}

/** 管理障碍绘制、擦除、撤销状态与笔刷预览的控制器。 */
export interface GraphwarObstacleEditorController {
  /** 接收自动识别出的障碍 mask，并保存可恢复基线。 */
  applyDetectedObstacles: (obstacles: DetectedObstacleMap) => void;
  /** 当前是否正在拖拽障碍笔刷。 */
  brushDragging: Ref<boolean>;
  /** 障碍笔刷当前是否为擦除模式。 */
  brushEraseEnabled: Ref<boolean>;
  /** 当前吸附后的障碍笔刷预览点。 */
  brushPointerPoint: Ref<PixelPoint | undefined>;
  /** 清除识别出的障碍 mask、恢复基线和编辑临时状态。 */
  clear: () => void;
  /** 清理障碍笔刷拖拽和预览状态。 */
  clearInteractionState: () => void;
  /** 页面卸载时清理障碍编辑持有的定时器。 */
  dispose: () => void;
  /** 当前障碍 mask；页面仍负责用它投影可视化和寻路输入。 */
  obstacles: Ref<DetectedObstacleMap | undefined>;
  /** 当前障碍 mask 是否有用户编辑尚未恢复。 */
  editsDirty: Ref<boolean>;
  /** 结束障碍笔刷拖拽；返回值用于页面决定是否释放 pointer capture。 */
  finishBrushDrag: () => boolean;
  /** 在障碍 mask 上绘制或擦除笔刷，并可连接上一点形成连续笔画。 */
  paintBrushAtPoint: (point: PixelPoint, connectFromLastPoint?: boolean) => boolean;
  /** 将障碍 mask 恢复到自动识别后的基线状态。 */
  resetEdits: () => boolean;
  /** 开始障碍笔刷拖拽。 */
  startBrushDrag: () => void;
  /** 切换障碍笔刷添加/擦除模式。 */
  toggleBrushErase: () => void;
  /** 将鼠标位置吸附到 Graphwar 平面 cell 中心，作为笔刷预览点。 */
  updateBrushPreview: (point: PixelPoint) => void;
}

/** 管理障碍编辑的 mask、baseline、笔刷手势和延迟统计刷新。 */
export function useGraphwarObstacleEditor(options: GraphwarObstacleEditorOptions): GraphwarObstacleEditorController {
  const obstacles = ref<DetectedObstacleMap>();
  const baselineObstacles = ref<DetectedObstacleMap>();
  const brushEraseEnabled = ref(false);
  const brushPointerPoint = ref<PixelPoint>();
  const brushDragging = ref(false);
  const brushLastPlanePoint = ref<PlaneGridPoint>();
  const editsDirty = ref(false);
  let editRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  /** 接收自动识别出的障碍 mask，并保存可恢复基线。 */
  function applyDetectedObstacles(nextObstacles: DetectedObstacleMap) {
    obstacles.value = nextObstacles;
    baselineObstacles.value = cloneDetectedObstacleMap(nextObstacles);
    editsDirty.value = false;
    clearInteractionState();
  }

  /** 清除识别出的障碍 mask、恢复基线和编辑临时状态。 */
  function clear() {
    obstacles.value = undefined;
    baselineObstacles.value = undefined;
    editsDirty.value = false;
    clearInteractionState();
    clearEditRefreshTimer();
  }

  /** 开始障碍笔刷拖拽。 */
  function startBrushDrag() {
    brushDragging.value = true;
    brushLastPlanePoint.value = undefined;
  }

  /** 结束障碍笔刷拖拽；返回值用于页面决定是否释放 pointer capture。 */
  function finishBrushDrag() {
    if (!brushDragging.value) {
      return false;
    }

    brushDragging.value = false;
    brushLastPlanePoint.value = undefined;
    return true;
  }

  /** 清理障碍笔刷拖拽和预览状态。 */
  function clearInteractionState() {
    brushPointerPoint.value = undefined;
    brushDragging.value = false;
    brushLastPlanePoint.value = undefined;
  }

  /** 切换障碍笔刷添加/擦除模式。 */
  function toggleBrushErase() {
    brushEraseEnabled.value = !brushEraseEnabled.value;
  }

  /** 将障碍 mask 恢复到自动识别后的基线状态。 */
  function resetEdits() {
    const baseline = baselineObstacles.value;
    if (!baseline) {
      return false;
    }

    options.prepareObstacleEdit();
    clearEditRefreshTimer();
    options.invalidateObstacleCaches();
    obstacles.value = cloneDetectedObstacleMap(baseline);
    editsDirty.value = false;
    options.setStatus(options.getEditsClearedMessage(baseline.count), "success");
    return true;
  }

  /** 将鼠标位置吸附到 Graphwar 平面 cell 中心，作为笔刷预览点。 */
  function updateBrushPreview(point: PixelPoint) {
    brushPointerPoint.value = pointIsInsideBoundsRect(point, options.boundsRect.value)
      ? planeGridCellCenterToImagePoint(
          imagePointToPlaneGridPoint(point, options.boundsRect.value),
          options.boundsRect.value,
        )
      : undefined;
  }

  /** 在障碍 mask 上绘制或擦除笔刷，并可连接上一点形成连续笔画。 */
  function paintBrushAtPoint(point: PixelPoint, connectFromLastPoint = false) {
    const obstacleMap = obstacles.value;
    const brushDiameter = options.getBrushDiameter();
    if (
      obstacleMap === undefined ||
      brushDiameter === undefined ||
      !pointIsInsideBoundsRect(point, options.boundsRect.value)
    ) {
      brushLastPlanePoint.value = undefined;
      return false;
    }

    options.prepareObstacleEdit();
    const center = imagePointToPlaneGridPoint(point, options.boundsRect.value);
    brushPointerPoint.value = planeGridCellCenterToImagePoint(center, options.boundsRect.value);
    const brushValue = brushEraseEnabled.value ? 0 : 1;
    const previousCenter = connectFromLastPoint ? brushLastPlanePoint.value : undefined;
    const nextMask =
      previousCenter !== undefined
        ? paintObstacleMaskStroke(obstacleMap.mask, previousCenter, center, brushDiameter, brushValue)
        : paintObstacleMaskDisk(obstacleMap.mask, center, brushDiameter, brushValue);
    brushLastPlanePoint.value = center;
    if (nextMask === obstacleMap.mask) {
      return false;
    }

    options.invalidateObstacleCaches();
    obstacles.value = {
      count: obstacleMap.count,
      mask: nextMask,
    };
    editsDirty.value = true;
    scheduleEditRefresh();
    return true;
  }

  /** 延迟刷新障碍连通域数量，合并连续笔刷操作。 */
  function scheduleEditRefresh() {
    clearEditRefreshTimer();
    options.setStatus(options.getUpdatingEditsMessage(), "warning");
    editRefreshTimer = setTimeout(() => {
      editRefreshTimer = undefined;
      const currentObstacles = obstacles.value;
      if (!currentObstacles) {
        return;
      }
      const count = countObstacleMaskComponents(currentObstacles.mask);
      obstacles.value = {
        count,
        mask: currentObstacles.mask,
      };
      options.setStatus(options.getEditsAppliedMessage(count), "success");
    }, options.editRefreshDelayMs);
  }

  /** 清理障碍编辑后的延迟统计刷新。 */
  function clearEditRefreshTimer() {
    if (!editRefreshTimer) {
      return;
    }

    clearTimeout(editRefreshTimer);
    editRefreshTimer = undefined;
  }

  /** 页面卸载时清理障碍编辑持有的定时器。 */
  function dispose() {
    clearEditRefreshTimer();
  }

  return {
    applyDetectedObstacles,
    brushDragging,
    brushEraseEnabled,
    brushPointerPoint,
    clear,
    clearInteractionState,
    dispose,
    editsDirty,
    finishBrushDrag,
    obstacles,
    paintBrushAtPoint,
    resetEdits,
    startBrushDrag,
    toggleBrushErase,
    updateBrushPreview,
  };
}

/** 深拷贝障碍 mask，作为用户编辑前的恢复基线。 */
function cloneDetectedObstacleMap(obstacles: DetectedObstacleMap): DetectedObstacleMap {
  return {
    count: obstacles.count,
    mask: new Uint8Array(obstacles.mask),
  };
}

/** 判断点是否在指定截图矩形内，边界视为有效。 */
function pointIsInsideBoundsRect(point: PixelPoint, rect: BoundsRect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}
