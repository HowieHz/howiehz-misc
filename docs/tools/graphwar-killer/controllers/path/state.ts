/** 管理路径编辑的双工作流状态，页面只负责 Graphwar 规则和重建副作用。 */
import { computed, ref, type Ref, type WritableComputedRef } from "vue";

import type { GraphPoint, PixelPoint, ToolWorkflowMode } from "../../core/types";

const defaultTrajectoryStrokeColor = "#ec4899";

/** 路径点坐标输入框轴向。 */
export type PathPointCoordinateAxis = "x" | "y";

/** 路径点坐标输入框文本，编辑时保留用户输入而非立即格式化。 */
interface PathPointCoordinateText {
  /** X 输入框文本。 */
  x: string;
  /** Y 输入框文本。 */
  y: string;
}

/** 当前正在编辑的路径点坐标单元格。 */
interface EditingPathPointCoordinate {
  /** 正在编辑的轴向。 */
  axis: PathPointCoordinateAxis;
  /** 路径点索引。 */
  index: number;
}

/** 坐标文本同步需要页面提供格式化策略，避免状态 Module 依赖本地化或精度解析。 */
interface PathPointCoordinateSyncOptions {
  /** 当前路径点的 Graphwar 坐标。 */
  points: readonly GraphPoint[];
  /** 页面统一的坐标格式化函数；只格式化输入框文本，不反写内部路径点。 */
  formatCoordinate: (value: number) => string;
}

/** 页面使用的路径状态 Interface；隐藏双模式切换的内部实现。 */
export interface GraphwarPathStateController {
  /** 原子写入已完整验证的路径。 */
  applyValidatedPath: (points: PixelPoint[]) => void;
  /** 清空当前工作流路径。 */
  clearActivePath: () => void;
  /** 清空 solver/simulator 两套路径。 */
  clearAllModePaths: () => void;
  /** 清空 hover、drag 和坐标编辑状态。 */
  clearPathInteractionState: () => void;
  /** 当前拖拽中的路径点索引。 */
  draggingPathPointIndex: Ref<number | undefined>;
  /** 结束坐标编辑并同步格式化文本。 */
  finishPathPointCoordinateEdit: (syncOptions: PathPointCoordinateSyncOptions) => void;
  /** 读取坐标输入框文本。 */
  getPathPointCoordinateText: (index: number, axis: PathPointCoordinateAxis) => string;
  /** 当前悬停路径点索引。 */
  hoveredPathPointIndex: Ref<number | undefined>;
  /** 当前工作流路径。 */
  pathPixels: WritableComputedRef<PixelPoint[]>;
  /** 当前工作流路径状态文案。 */
  pathStatus: WritableComputedRef<string>;
  /** 删除当前工作流指定路径点。 */
  removeActivePathPoint: (index: number) => boolean;
  /** 模拟器路径。 */
  simulatorPathPixels: Ref<PixelPoint[]>;
  /** 模拟器轨迹线颜色。 */
  simulatorTrajectoryStrokeColor: Ref<string>;
  /** 解算器路径。 */
  solverPathPixels: Ref<PixelPoint[]>;
  /** 解算器轨迹线颜色。 */
  solverTrajectoryStrokeColor: Ref<string>;
  /** 更新坐标输入框文本。 */
  setPathPointCoordinateText: (index: number, axis: PathPointCoordinateAxis, value: string) => void;
  /** 开始编辑坐标输入框。 */
  startPathPointCoordinateEdit: (index: number, axis: PathPointCoordinateAxis) => void;
  /** 同步坐标输入框文本。 */
  syncPathPointCoordinateTexts: (options: PathPointCoordinateSyncOptions) => void;
  /** 当前工作流轨迹线颜色。 */
  trajectoryStrokeColor: WritableComputedRef<string>;
  /** 删除当前工作流最后一个路径点。 */
  undoActivePathPoint: () => boolean;
}

/** 创建路径编辑状态 Module，集中 solver/simulator 双份路径的切换规则。 */
export function useGraphwarPathState(workflowMode: Ref<ToolWorkflowMode>): GraphwarPathStateController {
  const solverPathPixels = ref<PixelPoint[]>([]);
  const simulatorPathPixels = ref<PixelPoint[]>([]);
  const pathPixels = computed<PixelPoint[]>({
    get: () => (workflowMode.value === "simulator" ? simulatorPathPixels.value : solverPathPixels.value),
    set: (points) => {
      if (workflowMode.value === "simulator") {
        simulatorPathPixels.value = points;
      } else {
        solverPathPixels.value = points;
      }
    },
  });

  const solverPathStatus = ref("");
  const simulatorPathStatus = ref("");
  const pathStatus = computed<string>({
    get: () => (workflowMode.value === "simulator" ? simulatorPathStatus.value : solverPathStatus.value),
    set: (status) => {
      if (workflowMode.value === "simulator") {
        simulatorPathStatus.value = status;
      } else {
        solverPathStatus.value = status;
      }
    },
  });

  const solverTrajectoryStrokeColor = ref(defaultTrajectoryStrokeColor);
  const simulatorTrajectoryStrokeColor = ref(defaultTrajectoryStrokeColor);
  const trajectoryStrokeColor = computed<string>({
    get: () =>
      workflowMode.value === "simulator" ? simulatorTrajectoryStrokeColor.value : solverTrajectoryStrokeColor.value,
    set: (color) => {
      if (workflowMode.value === "simulator") {
        simulatorTrajectoryStrokeColor.value = color;
      } else {
        solverTrajectoryStrokeColor.value = color;
      }
    },
  });

  const pathPointCoordinateTexts = ref<PathPointCoordinateText[]>([]);
  const draggingPathPointIndex = ref<number>();
  const hoveredPathPointIndex = ref<number>();
  const editingPathPointCoordinate = ref<EditingPathPointCoordinate>();

  /** 清理 hover/drag/editing 这类只在当前交互帧有效的路径状态。 */
  function clearPathInteractionState() {
    hoveredPathPointIndex.value = undefined;
    draggingPathPointIndex.value = undefined;
    editingPathPointCoordinate.value = undefined;
  }

  /** 清空当前工作流路径；调用方负责先处理取消、状态提示和一键清图副作用。 */
  function clearActivePath() {
    pathPixels.value = [];
    pathStatus.value = "";
    hoveredPathPointIndex.value = undefined;
    trajectoryStrokeColor.value = defaultTrajectoryStrokeColor;
  }

  /** 清除公式生成和模拟器两种模式的路径状态。 */
  function clearAllModePaths() {
    solverPathPixels.value = [];
    simulatorPathPixels.value = [];
    solverPathStatus.value = "";
    simulatorPathStatus.value = "";
    clearPathInteractionState();
    solverTrajectoryStrokeColor.value = defaultTrajectoryStrokeColor;
    simulatorTrajectoryStrokeColor.value = defaultTrajectoryStrokeColor;
  }

  /** 从当前工作流删除指定路径点，并收敛悬停索引和默认轨迹色。 */
  function removeActivePathPoint(index: number) {
    if (index < 0 || index >= pathPixels.value.length) {
      return false;
    }

    pathPixels.value = pathPixels.value.filter((_, pointIndex) => pointIndex !== index);
    normalizeHoverAfterPathLengthChange();
    resetTrajectoryColorIfPathEmpty();
    pathStatus.value = "";
    return true;
  }

  /** 删除当前工作流的最后一个路径点。 */
  function undoActivePathPoint() {
    if (pathPixels.value.length === 0) {
      return false;
    }

    pathPixels.value = pathPixels.value.slice(0, -1);
    normalizeHoverAfterPathLengthChange();
    resetTrajectoryColorIfPathEmpty();
    pathStatus.value = "";
    return true;
  }

  /** 原子替换当前路径；目标命中证据只属于产生它的那次搜索，不跨运行写入页面状态。 */
  function applyValidatedPath(points: PixelPoint[]) {
    if (workflowMode.value === "simulator") {
      simulatorPathPixels.value = points;
      return;
    }
    solverPathPixels.value = points;
  }

  /** 读取路径点坐标输入框文本。 */
  function getPathPointCoordinateText(index: number, axis: PathPointCoordinateAxis) {
    return pathPointCoordinateTexts.value[index]?.[axis] ?? "";
  }

  /** 同步坐标输入框文本；正在编辑的单元格保留原输入。 */
  function syncPathPointCoordinateTexts(options: PathPointCoordinateSyncOptions) {
    const editing = editingPathPointCoordinate.value;
    pathPointCoordinateTexts.value = options.points.map((point, index) => {
      const current = pathPointCoordinateTexts.value[index];
      return {
        x:
          editing?.index === index && editing.axis === "x"
            ? (current?.x ?? options.formatCoordinate(point.x))
            : options.formatCoordinate(point.x),
        y:
          editing?.index === index && editing.axis === "y"
            ? (current?.y ?? options.formatCoordinate(point.y))
            : options.formatCoordinate(point.y),
      };
    });
  }

  /** 记录当前编辑的路径点坐标单元格。 */
  function startPathPointCoordinateEdit(index: number, axis: PathPointCoordinateAxis) {
    editingPathPointCoordinate.value = { index, axis };
  }

  /** 结束路径点坐标编辑并恢复格式化文本。 */
  function finishPathPointCoordinateEdit(syncOptions: PathPointCoordinateSyncOptions) {
    editingPathPointCoordinate.value = undefined;
    syncPathPointCoordinateTexts(syncOptions);
  }

  /** 更新坐标输入框文本；返回值让页面继续执行数字解析和路径规则。 */
  function setPathPointCoordinateText(index: number, axis: PathPointCoordinateAxis, value: string) {
    const currentTexts = pathPointCoordinateTexts.value[index] ?? { x: "", y: "" };
    pathPointCoordinateTexts.value[index] = { ...currentTexts, [axis]: value };
  }

  /** 路径缩短后避免 hover 指向不存在的点。 */
  function normalizeHoverAfterPathLengthChange() {
    if (hoveredPathPointIndex.value !== undefined && hoveredPathPointIndex.value >= pathPixels.value.length) {
      hoveredPathPointIndex.value = undefined;
    }
  }

  /** 最后一个点被删掉时，轨迹颜色回到工具默认色。 */
  function resetTrajectoryColorIfPathEmpty() {
    if (pathPixels.value.length === 0) {
      trajectoryStrokeColor.value = defaultTrajectoryStrokeColor;
    }
  }

  return {
    applyValidatedPath,
    clearActivePath,
    clearAllModePaths,
    clearPathInteractionState,
    draggingPathPointIndex,
    finishPathPointCoordinateEdit,
    getPathPointCoordinateText,
    hoveredPathPointIndex,
    pathPixels,
    pathStatus,
    removeActivePathPoint,
    simulatorPathPixels,
    simulatorTrajectoryStrokeColor,
    solverPathPixels,
    solverTrajectoryStrokeColor,
    startPathPointCoordinateEdit,
    syncPathPointCoordinateTexts,
    trajectoryStrokeColor,
    undoActivePathPoint,
    setPathPointCoordinateText,
  };
}
