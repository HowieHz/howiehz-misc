import { computed, ref, watch, type Ref } from "vue";

import { imageToGraphPoint, normalizePathPoint } from "../../core/geometry";
import { createGraphPoint } from "../../core/types";
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
import type {
  GraphwarTrajectoryCollisionSettings,
  GraphwarTrajectoryFormulaSettings,
} from "../../formula/trajectory/sampling";
import type { GraphwarPathfindingLineSegment } from "../../pathfinding/smart/preview";
import type { GraphwarSmartPathfindingSoldierTarget } from "../../pathfinding/targeting";
import type { GraphwarLiveClickPreviewRenderInput } from "./live-click-preview-render";
import {
  GRAPHWAR_LIVE_CLICK_PREVIEW_WORKER_COUNT_MAXIMUM,
  createGraphwarLiveClickPreviewRunner,
  isGraphwarLiveClickPreviewCancelledError,
} from "./live-click-preview-runner";

export { GRAPHWAR_LIVE_CLICK_PREVIEW_WORKER_COUNT_MAXIMUM };

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
  /** Worker 调度设置独立于寻路 Worker；实时预览只消费已解析后的安全值。 */
  runtime: {
    workerCount: ReadonlyRef<number>;
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

type GraphwarLiveClickPreviewExpressionContext = Omit<
  Extract<GraphwarLiveClickPreviewRenderInput, { type: "expression" }>,
  "soldierCenter"
>;
type GraphwarLiveClickPreviewFormulaContext = Extract<GraphwarLiveClickPreviewRenderInput, { type: "formula" }>;
type GraphwarLiveClickPreviewRenderContext =
  | GraphwarLiveClickPreviewExpressionContext
  | GraphwarLiveClickPreviewFormulaContext;

interface GraphwarLiveClickPreviewRenderRequest {
  /** 对象身份用于拒绝公式、路径或碰撞设置变化前的迟到结果。 */
  context: GraphwarLiveClickPreviewRenderContext;
  input: GraphwarLiveClickPreviewRenderInput;
  /** 原始 pointer 变化先于 rAF 落位，用它避免旧结果提前结束 warning。 */
  pointerIntent: number;
  /** 本次 Worker 输入对应的最终像素落位点。 */
  point: PixelPoint;
}

interface GraphwarLiveClickPreviewSnapshot {
  curvePoints: string;
  point: PixelPoint;
}

export interface GraphwarLiveClickPreviewController {
  /** 实时点击预览是否启用。 */
  enabled: Ref<boolean>;
  /** 最新一次实时预览是否仍在 Worker 中计算。 */
  inProgress: ReadonlyRef<boolean>;
  /** 当前预览轨迹 SVG polyline points。 */
  curvePoints: ReadonlyRef<string>;
  /** 当前预览点标签。 */
  label: ReadonlyRef<string>;
  /** 从路径尾点到预览点的提示线段；只表达追加关系，不表达实际函数轨迹。 */
  lineSegments: ReadonlyRef<GraphwarPathfindingLineSegment[]>;
  /** 预览点按旧曲线绑定点、当前鼠标点的绘制顺序排列；坐标相同时只含当前点。 */
  points: ReadonlyRef<readonly PixelPoint[]>;
  /** 最近一次实时预览渲染耗时；短时间后自动清空，用于操作栏临时状态。 */
  renderedElapsedMs: ReadonlyRef<number | undefined>;
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
  // 实时预览会随指针移动持续计算；默认关闭，仅在用户明确开启后运行。
  const enabled = ref(false);
  const displayedPreview = ref<GraphwarLiveClickPreviewSnapshot>();
  const curvePoints = computed(() => displayedPreview.value?.curvePoints ?? "");
  const inProgress = ref(false);
  const renderedElapsedMs = ref<number>();
  const pointerPoint = ref<PixelPoint>();
  const pointerPathPointIndex = ref<number>();
  const runner = createGraphwarLiveClickPreviewRunner({
    workerCount: options.runtime.workerCount,
  });
  let activeRenderContext: GraphwarLiveClickPreviewRenderContext | undefined;
  let latestPublishedSequence = 0;
  let latestRequestedSequence = 0;
  let nextRenderSequence = 1;
  let pointerFrame: number | undefined;
  let committedPointerIntent = 0;
  let latestPointerIntent = 0;
  let renderSession = 0;
  let pendingPathPointIndex: number | undefined;
  let pendingPointerIntent: number | undefined;
  let pendingPointerPoint: PixelPoint | undefined;
  let renderStatusTimer: number | undefined;

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

  const points = computed<readonly PixelPoint[]>(() => {
    const currentPoint = point.value;
    if (!currentPoint) {
      return [];
    }
    const renderedPoint = displayedPreview.value?.point;
    return renderedPoint && !pixelPointsEqual(renderedPoint, currentPoint)
      ? [renderedPoint, currentPoint]
      : [currentPoint];
  });

  const renderContext = computed<GraphwarLiveClickPreviewRenderContext | undefined>(() => {
    return createRenderContext();
  });
  const renderRequest = computed<GraphwarLiveClickPreviewRenderRequest | undefined>(() => {
    const previewPoint = point.value;
    if (!previewPoint) {
      return undefined;
    }
    const context = renderContext.value;
    if (!context) {
      return undefined;
    }
    return {
      context,
      input: createRenderInput(context, previewPoint),
      pointerIntent: committedPointerIntent,
      point: previewPoint,
    };
  });

  const label = computed(() => {
    if (options.settings.toolWorkflowMode.value === "simulator" || options.path.pathPixels.value.length === 0) {
      return options.getSelfLabel();
    }
    return String(options.path.pathPixels.value.length);
  });

  /** 高频 pointermove 只保留最新落点，每个浏览器绘制帧最多触发一次轨迹预览重算。 */
  function schedulePointerPoint(point: PixelPoint, pathPointIndex: number | undefined) {
    latestPointerIntent += 1;
    pendingPointerPoint = point;
    pendingPathPointIndex = pathPointIndex;
    pendingPointerIntent = latestPointerIntent;
    if (pointerFrame !== undefined) {
      return;
    }

    pointerFrame = requestAnimationFrame(() => {
      const point = pendingPointerPoint;
      const pathPointIndex = pendingPathPointIndex;
      const pointerIntent = pendingPointerIntent;
      pointerFrame = undefined;
      pendingPointerPoint = undefined;
      pendingPathPointIndex = undefined;
      pendingPointerIntent = undefined;
      if (!point || pointerIntent === undefined) {
        return;
      }
      // 请求版本必须和本帧实际提交的坐标成对，不能借用尚未落位的新 pointer intent。
      committedPointerIntent = pointerIntent;
      pointerPoint.value = point;
      pointerPathPointIndex.value = pathPointIndex;
    });
  }

  /** 立即记录当前指针点，用于 pointerdown 先同步命中状态。 */
  function setPointerPoint(point: PixelPoint, pathPointIndex: number | undefined) {
    latestPointerIntent += 1;
    committedPointerIntent = latestPointerIntent;
    pointerPoint.value = point;
    pointerPathPointIndex.value = pathPointIndex;
  }

  /** 清理悬停预览时取消待执行帧，避免离开舞台或切模式后旧落点回写。 */
  function clearPointerPoint() {
    pendingPointerPoint = undefined;
    pendingPathPointIndex = undefined;
    pendingPointerIntent = undefined;
    pointerPoint.value = undefined;
    pointerPathPointIndex.value = undefined;
    if (pointerFrame !== undefined) {
      cancelAnimationFrame(pointerFrame);
      pointerFrame = undefined;
    }
    invalidateRenderSession();
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
    clearRenderedStatus();
    runner.close();
  }

  watch(
    renderRequest,
    (request) => {
      // request 已携带其 context；无预览点时不要订阅或复制整条路径上下文。
      const currentContext = request?.context;
      const contextChanged = currentContext !== activeRenderContext;
      if (contextChanged) {
        activeRenderContext = currentContext;
        invalidateRenderSession();
      }
      if (!request) {
        if (!contextChanged) {
          invalidateRenderSession();
        }
        return;
      }

      const sequence = nextRenderSequence;
      nextRenderSequence += 1;
      latestRequestedSequence = sequence;
      const session = renderSession;
      inProgress.value = true;
      void runner
        .render(request.input)
        .then((result) => {
          const currentPoint = point.value;
          if (
            !currentPoint ||
            session !== renderSession ||
            request.context !== activeRenderContext ||
            request.context !== renderContext.value ||
            sequence <= latestPublishedSequence
          ) {
            return;
          }

          latestPublishedSequence = sequence;
          displayedPreview.value = result.curvePoints
            ? {
                curvePoints: result.curvePoints,
                point: request.point,
              }
            : undefined;
          if (
            sequence !== latestRequestedSequence ||
            request.pointerIntent !== latestPointerIntent ||
            !pixelPointsEqual(request.point, currentPoint)
          ) {
            return;
          }

          inProgress.value = false;
          if (result.curvePoints) {
            showRenderedStatus(result.elapsedMs);
          } else {
            clearRenderedStatus();
          }
        })
        .catch((error: unknown) => {
          const currentPoint = point.value;
          if (
            !currentPoint ||
            session !== renderSession ||
            request.context !== activeRenderContext ||
            request.context !== renderContext.value ||
            sequence !== latestRequestedSequence ||
            request.pointerIntent !== latestPointerIntent ||
            !pixelPointsEqual(request.point, currentPoint)
          ) {
            return;
          }
          inProgress.value = false;
          if (!isGraphwarLiveClickPreviewCancelledError(error)) {
            displayedPreview.value = undefined;
            clearRenderedStatus();
          }
        });
    },
    { immediate: true },
  );

  /** 结束当前预览会话；上下文变化和交互失效都必须阻止迟到 Promise 回写。 */
  function invalidateRenderSession() {
    renderSession += 1;
    latestRequestedSequence = 0;
    inProgress.value = false;
    displayedPreview.value = undefined;
    clearRenderedStatus();
    runner.cancel();
  }

  function createRenderContext(): GraphwarLiveClickPreviewRenderContext | undefined {
    const bounds = options.geometry.getBounds();
    if (!bounds || options.settings.effectiveSmartPathfindingEnabled.value) {
      return undefined;
    }

    const boundsRect = options.geometry.boundsRect.value;
    const collision = options.trajectory.getCollisionSettings();
    const base = {
      bounds: {
        maxX: bounds.maxX,
        maxY: bounds.maxY,
        minX: bounds.minX,
        minY: bounds.minY,
      },
      boundsRect: {
        height: boundsRect.height,
        width: boundsRect.width,
        x: boundsRect.x,
        y: boundsRect.y,
      },
      ...(collision ? { collision } : {}),
    };
    if (options.settings.toolWorkflowMode.value === "simulator") {
      const expression = options.simulator.formulaText.value;
      if (!expression.trim()) {
        return undefined;
      }
      return {
        ...base,
        equation: options.settings.equationMode.value,
        expression,
        ...(options.simulator.launchAngleRadians.value === undefined
          ? {}
          : { launchAngleRadians: options.simulator.launchAngleRadians.value }),
        parser: {
          parseDerivativeAsY: options.simulator.parseDerivativeAsY.value,
          skipUnknownCharacters: options.simulator.skipUnknownCharacters.value,
        },
        type: "expression",
      };
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
    return {
      ...base,
      // 固定已有路径点；仅鼠标预览点留到每个请求创建时追加。
      points: options.path.mappedPathPoints.value.map((pathPoint) => createGraphPoint(pathPoint.x, pathPoint.y)),
      settings: options.trajectory.formulaSettings.value,
      type: "formula",
    };
  }

  function createRenderInput(
    context: GraphwarLiveClickPreviewRenderContext,
    previewPoint: PixelPoint,
  ): GraphwarLiveClickPreviewRenderInput {
    const graphPoint = imageToGraphPoint(previewPoint, context.bounds, context.boundsRect);
    return context.type === "expression"
      ? {
          ...context,
          soldierCenter: graphPoint,
        }
      : {
          ...context,
          points: [...context.points, graphPoint],
        };
  }

  function showRenderedStatus(elapsedMs: number) {
    renderedElapsedMs.value = elapsedMs;
    if (renderStatusTimer !== undefined) {
      window.clearTimeout(renderStatusTimer);
    }
    renderStatusTimer = window.setTimeout(() => {
      renderedElapsedMs.value = undefined;
      renderStatusTimer = undefined;
    }, 2000);
  }

  function clearRenderedStatus() {
    renderedElapsedMs.value = undefined;
    if (renderStatusTimer !== undefined) {
      window.clearTimeout(renderStatusTimer);
      renderStatusTimer = undefined;
    }
  }

  return {
    clearPointerPoint,
    curvePoints,
    dispose,
    enabled,
    inProgress,
    label,
    lineSegments,
    points,
    renderedElapsedMs,
    refreshPointerPathPointIndex,
    schedulePointerPoint,
    setPointerPoint,
  };
}

function pixelPointsEqual(left: PixelPoint, right: PixelPoint) {
  return left.x === right.x && left.y === right.y;
}
