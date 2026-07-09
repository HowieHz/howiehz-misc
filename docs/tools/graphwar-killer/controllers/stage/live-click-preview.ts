import { computed, ref, type Ref } from "vue";

import { imageToGraphPoint, normalizePathPoint } from "../../core/geometry";
import type {
  AlgorithmMode,
  BoundsRect,
  EquationMode,
  GraphBounds,
  GraphPoint,
  PixelPoint,
  ToolMode,
  ToolWorkflowMode,
} from "../../core/types";
import type { GraphwarDetectionBox } from "../../detection/objects";
import {
  createGraphwarTrajectoryFormulaContext,
  sampleGraphwarExpressionTrajectoryWithStops,
  sampleGraphwarFormulaTrajectory,
  type GraphwarTrajectoryCollisionSettings,
  type GraphwarTrajectoryFormulaSettings,
  type GraphwarTrajectorySampleResult,
} from "../../formula/trajectory/sampling";
import type { GraphwarPathfindingLineSegment } from "../../pathfinding/smart/preview";
import type { GraphwarSmartPathfindingSoldierTarget } from "../../pathfinding/targeting";
import { formatVisibleTrajectoryPoints } from "../path/trajectory-result";

interface ReadonlyRef<T> {
  readonly value: T;
}

interface GraphwarLiveClickPreviewOptions {
  /** 坐标映射应复用页面当前标定；bounds 无效时预览保持空结果。 */
  geometry: {
    boundsRect: ReadonlyRef<BoundsRect>;
    getBounds: () => GraphBounds | undefined;
  };
  /** 指针交互状态应只暴露预览判断所需的当前路径命中信息。 */
  interaction: {
    draggingPathPointIndex: ReadonlyRef<number | undefined>;
    getPathPointIndexAtPoint: (point: PixelPoint) => number | undefined;
    smartPathfindingInProgress: ReadonlyRef<boolean>;
    toolMode: ReadonlyRef<ToolMode>;
  };
  /** 路径数据和绘制线段规则应与主路径展示保持一致。 */
  path: {
    createLineSegments: (points: readonly PixelPoint[]) => GraphwarPathfindingLineSegment[];
    mappedPathPoints: ReadonlyRef<readonly GraphPoint[]>;
    pathPixels: ReadonlyRef<readonly PixelPoint[]>;
  };
  /** 公式和模式开关应由页面统一解析，预览只消费合法性结果。 */
  settings: {
    algorithmMode: ReadonlyRef<AlgorithmMode>;
    effectiveSmartPathfindingEnabled: ReadonlyRef<boolean>;
    equationMode: ReadonlyRef<EquationMode>;
    isEquationModeDisabled: (mode: EquationMode) => boolean;
    precisionValid: ReadonlyRef<boolean>;
    steepnessValid: ReadonlyRef<boolean>;
    toolWorkflowMode: ReadonlyRef<ToolWorkflowMode>;
  };
  /** 模拟器表达式预览应复用主轨迹解析策略。 */
  simulator: {
    formulaText: ReadonlyRef<string>;
    launchAngleRadians: ReadonlyRef<number | undefined>;
    parseDerivativeAsY: ReadonlyRef<boolean>;
    skipUnknownCharacters: ReadonlyRef<boolean>;
  };
  /** 智能光标目标规则应由页面的目标选择 Module 统一提供。 */
  target: {
    createMinimumForwardTargetPoint: (point: PixelPoint) => PixelPoint | undefined;
    createSearchStartSoldierAimPoint: (
      startPoint: PixelPoint | undefined,
      box: GraphwarDetectionBox,
    ) => PixelPoint | undefined;
    createSmartPathfindingSoldierTarget: (
      startPoint: PixelPoint,
      box: GraphwarDetectionBox,
    ) => GraphwarSmartPathfindingSoldierTarget | undefined;
    getDetectionBoxCenter: (box: GraphwarDetectionBox) => PixelPoint;
    getDetectedSoldierAtPoint: (point: PixelPoint) => GraphwarDetectionBox | undefined;
    smartCursorEnabled: ReadonlyRef<boolean>;
  };
  /** 轨迹采样设置应与主结果共享，避免实时预览生成不同公式。 */
  trajectory: {
    formulaSettings: ReadonlyRef<GraphwarTrajectoryFormulaSettings>;
    getCollisionSettings: () => GraphwarTrajectoryCollisionSettings | undefined;
  };
  /** 预览标签文案由页面本地化决定。 */
  getSelfLabel: () => string;
}

export interface GraphwarLiveClickPreviewController {
  /** 实时点击预览是否启用。 */
  enabled: Ref<boolean>;
  /** 当前预览轨迹 SVG polyline points。 */
  curvePoints: ReadonlyRef<string>;
  /** 当前预览点标签。 */
  label: ReadonlyRef<string>;
  /** 从路径尾点到预览点的提示线段；只表达追加关系，不表达实际函数轨迹。 */
  lineSegments: ReadonlyRef<GraphwarPathfindingLineSegment[]>;
  /** 当前左键点击会追加或落位的预览点。 */
  point: ReadonlyRef<PixelPoint | undefined>;
  /** 清理悬停预览并取消待执行的绘制帧。 */
  clearPointerPoint: () => void;
  /** 页面卸载时释放预览持有的浏览器帧。 */
  dispose: () => void;
  /** 路径点或选择半径变化后刷新当前悬停点的路径命中缓存。 */
  refreshPointerPathPointIndex: () => void;
  /** 高频 pointermove 应合并到每个浏览器绘制帧最多一次。 */
  schedulePointerPoint: (point: PixelPoint, pathPointIndex: number | undefined) => void;
  /** 立即记录当前指针点，用于 pointerdown 先同步命中状态。 */
  setPointerPoint: (point: PixelPoint, pathPointIndex: number | undefined) => void;
}

/** 管理实时点击预览的指针帧、落位规则和临时轨迹采样。 */
export function useGraphwarLiveClickPreview(
  options: GraphwarLiveClickPreviewOptions,
): GraphwarLiveClickPreviewController {
  const enabled = ref(true);
  const pointerPoint = ref<PixelPoint>();
  const pointerPathPointIndex = ref<number>();
  let pointerFrame: number | undefined;
  let pendingPathPointIndex: number | undefined;
  let pendingPointerPoint: PixelPoint | undefined;

  const point = computed(() => {
    const currentPoint = pointerPoint.value;
    if (
      !enabled.value ||
      options.interaction.toolMode.value !== "path" ||
      options.interaction.smartPathfindingInProgress.value ||
      !currentPoint
    ) {
      return undefined;
    }
    if (options.interaction.draggingPathPointIndex.value !== undefined || pointerPathPointIndex.value !== undefined) {
      return undefined;
    }
    return createClickPreviewPoint(currentPoint);
  });

  const lineSegments = computed(() => {
    const previewPoint = point.value;
    const start =
      options.settings.toolWorkflowMode.value === "simulator" ? undefined : options.path.pathPixels.value.at(-1);
    if (!previewPoint || !start) {
      return [];
    }
    return options.path.createLineSegments([start, previewPoint]);
  });

  const trajectorySampleResult = computed<GraphwarTrajectorySampleResult | undefined>(() => {
    const previewPoint = point.value;
    const bounds = options.geometry.getBounds();
    if (!previewPoint || !bounds || options.settings.effectiveSmartPathfindingEnabled.value) {
      return undefined;
    }

    if (options.settings.toolWorkflowMode.value === "simulator") {
      if (!options.simulator.formulaText.value.trim()) {
        return undefined;
      }

      return sampleGraphwarExpressionTrajectoryWithStops({
        bounds,
        boundsRect: options.geometry.boundsRect.value,
        collision: options.trajectory.getCollisionSettings(),
        collectVisiblePixels: true,
        equation: options.settings.equationMode.value,
        expression: options.simulator.formulaText.value,
        launchAngleRadians: options.simulator.launchAngleRadians.value,
        parser: {
          parseDerivativeAsY: options.simulator.parseDerivativeAsY.value,
          skipUnknownCharacters: options.simulator.skipUnknownCharacters.value,
        },
        soldierCenter: imageToGraphPoint(previewPoint, bounds, options.geometry.boundsRect.value),
      });
    }

    if (
      options.path.pathPixels.value.length === 0 ||
      !options.settings.precisionValid.value ||
      (options.settings.algorithmMode.value === "step" && !options.settings.steepnessValid.value) ||
      (options.settings.algorithmMode.value === "abs" && options.settings.equationMode.value === "ddy") ||
      options.settings.isEquationModeDisabled(options.settings.equationMode.value)
    ) {
      return undefined;
    }

    const previewPathPoints = [
      ...options.path.mappedPathPoints.value,
      imageToGraphPoint(previewPoint, bounds, options.geometry.boundsRect.value),
    ];
    const context = createGraphwarTrajectoryFormulaContext({
      bounds,
      points: previewPathPoints,
      settings: options.trajectory.formulaSettings.value,
      soldierCenter: previewPathPoints[0],
    });
    if (context.formulaPoints.length < 2) {
      return undefined;
    }

    return sampleGraphwarFormulaTrajectory({
      bounds,
      boundsRect: options.geometry.boundsRect.value,
      collision: options.trajectory.getCollisionSettings(),
      collectVisiblePixels: true,
      context,
    });
  });

  const curvePoints = computed(() => {
    const result = trajectorySampleResult.value;
    return result ? formatVisibleTrajectoryPoints(result.visiblePixels, result.obstacleHitIndex) : "";
  });

  const label = computed(() => {
    if (options.settings.toolWorkflowMode.value === "simulator" || options.path.pathPixels.value.length === 0) {
      return options.getSelfLabel();
    }
    return String(options.path.pathPixels.value.length);
  });

  /** 高频 pointermove 只保留最新落点，每个浏览器绘制帧最多触发一次轨迹预览重算。 */
  function schedulePointerPoint(point: PixelPoint, pathPointIndex: number | undefined) {
    pendingPointerPoint = point;
    pendingPathPointIndex = pathPointIndex;
    if (pointerFrame !== undefined) {
      return;
    }

    pointerFrame = requestAnimationFrame(() => {
      const point = pendingPointerPoint;
      const pathPointIndex = pendingPathPointIndex;
      pointerFrame = undefined;
      pendingPointerPoint = undefined;
      pendingPathPointIndex = undefined;
      pointerPoint.value = point;
      pointerPathPointIndex.value = pathPointIndex;
    });
  }

  /** 立即记录当前指针点，用于 pointerdown 先同步命中状态。 */
  function setPointerPoint(point: PixelPoint, pathPointIndex: number | undefined) {
    pointerPoint.value = point;
    pointerPathPointIndex.value = pathPointIndex;
  }

  /** 清理悬停预览时取消待执行帧，避免离开舞台或切模式后旧落点回写。 */
  function clearPointerPoint() {
    pendingPointerPoint = undefined;
    pendingPathPointIndex = undefined;
    pointerPoint.value = undefined;
    pointerPathPointIndex.value = undefined;
    if (pointerFrame !== undefined) {
      cancelAnimationFrame(pointerFrame);
      pointerFrame = undefined;
    }
  }

  /** 路径点或点半径变化时刷新命中缓存，保持悬停预览和当前路径状态一致。 */
  function refreshPointerPathPointIndex() {
    pendingPathPointIndex =
      pendingPointerPoint === undefined ? undefined : options.interaction.getPathPointIndexAtPoint(pendingPointerPoint);
    pointerPathPointIndex.value =
      pointerPoint.value === undefined ? undefined : options.interaction.getPathPointIndexAtPoint(pointerPoint.value);
  }

  /** 计算实时点击预览的落位点；只模拟左键点击会选择的目标，不触发寻路或状态写入。 */
  function createClickPreviewPoint(point: PixelPoint) {
    if (!options.geometry.getBounds()) {
      return undefined;
    }

    const selectedSoldier = options.target.smartCursorEnabled.value
      ? options.target.getDetectedSoldierAtPoint(point)
      : undefined;
    if (!selectedSoldier) {
      return createManualClickPreviewPoint(point);
    }
    if (options.settings.toolWorkflowMode.value === "simulator" || options.path.pathPixels.value.length === 0) {
      return createManualClickPreviewPoint(options.target.getDetectionBoxCenter(selectedSoldier));
    }

    const startPoint = options.path.pathPixels.value.at(-1);
    if (!startPoint) {
      return undefined;
    }
    const targetPoint = options.settings.effectiveSmartPathfindingEnabled.value
      ? options.target.createSmartPathfindingSoldierTarget(startPoint, selectedSoldier)?.targetPoint
      : options.target.createSearchStartSoldierAimPoint(startPoint, selectedSoldier);
    return targetPoint ? createManualClickPreviewPoint(targetPoint) : undefined;
  }

  /** 复刻 appendPathPoint 的同步落位规则，避免实时预览改动真实路径和提示状态。 */
  function createManualClickPreviewPoint(point: PixelPoint) {
    const bounds = options.geometry.getBounds();
    if (!bounds) {
      return undefined;
    }
    if (options.settings.toolWorkflowMode.value === "simulator") {
      return normalizePathPoint(point, options.geometry.boundsRect.value, bounds, undefined, 0);
    }

    const targetPoint =
      options.path.pathPixels.value.length > 0 ? options.target.createMinimumForwardTargetPoint(point) : point;
    if (!targetPoint) {
      return undefined;
    }
    return options.path.pathPixels.value.length > 0
      ? targetPoint
      : normalizePathPoint(targetPoint, options.geometry.boundsRect.value, bounds, undefined, 0);
  }

  /** 页面卸载时释放预览持有的浏览器帧。 */
  function dispose() {
    clearPointerPoint();
  }

  return {
    clearPointerPoint,
    curvePoints,
    dispose,
    enabled,
    label,
    lineSegments,
    point,
    refreshPointerPathPointIndex,
    schedulePointerPoint,
    setPointerPoint,
  };
}
