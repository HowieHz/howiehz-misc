/** 定义 Graphwar 杀手本地化文案结构，供中英文页面共享。 */
import type { GraphwarAgentClientErrorKind } from "./controllers/agent/client";
import type { GraphwarCapabilityReason } from "./controllers/page/capabilities";
import type { AlgorithmMode, EquationMode } from "./core/types";
import type { GraphwarDetectionWarning } from "./detection/objects";
import type { GraphwarDetectionWorkerTimingDetail } from "./detection/runtime/protocol";
import type {
  GraphwarOneClickClearDebugDetail,
  GraphwarOneClickClearDebugStage,
} from "./pathfinding/one-click-clear/search";

/** 模拟器停止原因的可本地化子集，只暴露用户需要理解的结果。 */
export type GraphwarKillerStopReason = "invalid" | "max-steps" | "out-of-bounds" | "too-steep";

/** 调试面板中一个阶段或明细条目的短标签和说明标题。 */
interface GraphwarKillerDebugStageText {
  /** 面板中展示的短标签。 */
  label: string;
  /** Hover/title 使用的阶段说明。 */
  title: string;
}

/** 模板匹配细分 timing 的本地化文案。 */
interface GraphwarKillerDetectionDebugDetailText {
  /** 分发候选给子 Worker 的耗时文案。 */
  "template-matching-dispatch": GraphwarKillerDebugStageText;
  /** 子 Worker 失败后串行 fallback 的耗时文案。 */
  "template-matching-fallback-serial": GraphwarKillerDebugStageText;
  /** 合并模板匹配结果的耗时文案。 */
  "template-matching-merge": GraphwarKillerDebugStageText;
  /** 当前模板匹配执行模式的文案。 */
  "template-matching-mode": {
    /** 根据串行/并行/fallback 模式和 Worker 数生成标签。 */
    label: (
      mode: Extract<GraphwarDetectionWorkerTimingDetail, { type: "template-matching-mode" }>["mode"],
      workerCount: number,
    ) => string;
    /** 模式说明标题。 */
    title: string;
  };
  /** 主 Worker 串行模板匹配的耗时文案。 */
  "template-matching-serial": GraphwarKillerDebugStageText;
  /** 单个子 Worker 模板匹配的耗时文案。 */
  "template-matching-worker": {
    /** 根据子 Worker 序号生成标签。 */
    label: (workerIndex: number) => string;
    /** 子 Worker 耗时说明标题。 */
    title: string;
  };
}

/** 一键清图搜索细分 timing 的本地化文案。 */
type GraphwarKillerPathfindingDebugDetailText = Record<
  GraphwarOneClickClearDebugStage,
  GraphwarKillerDebugStageText
> & {
  /** DAG 建边实际调度模式的文案。 */
  "dag-edge-mode": {
    /** 根据串行/并行/fallback 模式和 Worker 数生成标签。 */
    label: (
      mode: Extract<GraphwarOneClickClearDebugDetail, { type: "dag-edge-mode" }>["mode"],
      workerCount: number,
    ) => string;
    /** 模式说明标题。 */
    title: string;
  };
  /** 单个 DAG 建边子 Worker 的耗时文案。 */
  "dag-edge-worker": {
    /** 根据子 Worker 序号生成标签。 */
    label: (workerIndex: number) => string;
    /** 子 Worker 耗时说明标题。 */
    title: string;
  };
};

/**
 * Graphwar 杀手页面的完整文案协议。
 *
 * 数组项保留 value 字段，是为了让 UI 控件直接用同一份本地化数据渲染 label/title，同时保持内部模式类型仍由 `AlgorithmMode`、`EquationMode` 等联合类型约束。
 */
export interface GraphwarKillerLocale {
  /** 公式生成算法切换项。 */
  algorithmModes: readonly {
    value: AlgorithmMode;
    label: string;
    title: string;
  }[];
  /** Graphwar 方程解释模式切换项。 */
  equationModes: readonly {
    value: EquationMode;
    /** 游戏模式名称，不包含函数输入框使用的等号。 */
    label: string;
    /** 仅用于函数输入/输出框左侧的 Graphwar 公式前缀。 */
    formulaPrefix: string;
    description: string;
    title: string;
  }[];
  /** 解算器和模拟器工作流切换项。 */
  toolWorkflowModes: readonly {
    value: "solver" | "simulator";
    label: string;
    title: string;
  }[];
  /** 输入校验错误文案。 */
  validation: {
    boundsInvalidNumber: string;
    maxXGreaterThanMinX: string;
    maxYGreaterThanMinY: string;
    magnifierZoomNumber: string;
    magnifierZoomRange: (min: number, max: number) => string;
    maximumSoldierCountInteger: string;
    maximumSoldierCountPositive: string;
    obstacleMinAreaInteger: string;
    obstacleMinAreaRange: (max: number) => string;
    obstacleBrushDiameterInteger: string;
    obstacleBrushDiameterRange: (min: number, max: number) => string;
    oneClickClearDeleteCheckRadiusNumber: string;
    oneClickClearDeleteCheckRadiusRange: (min: number) => string;
    pathfindingWorkerCountInteger: string;
    pathfindingWorkerCountRange: string;
    routePlanningToleranceNumber: string;
    routePlanningTolerancePixelRange: (limit: number) => string;
    simulationToleranceNumber: string;
    simulationTolerancePixelRange: (limit: number) => string;
    soldierTemplateCandidateTopRatioNumber: string;
    soldierTemplateCandidateTopRatioRange: string;
    templateMatchingWorkerCountInteger: string;
    templateMatchingWorkerCountRange: string;
    stepSteepnessNumber: string;
    decimalPlacesInteger: string;
    decimalPlacesRange: (max: number) => string;
  };
  /** 页面状态栏、按钮状态和计算警告文案。 */
  status: {
    activeEquation: {
      abs: string;
      absDerivative: string;
      akima: string;
      akimaFirstDerivative: string;
      akimaSecondDerivative: string;
      pchip: string;
      pchipFirstDerivative: string;
      pchipSecondDerivative: string;
      simulator: string;
    };
    activeToolHint: {
      bounds: string;
      obstacle: string;
      simulatorPath: string;
      solverPath: string;
    };
    liveClickPreview: {
      inProgress: string;
      rendered: (elapsed: string) => string;
    };
    calculation: {
      enterFunction: string;
      enterLaunchAngle: string;
      fallbackWarning: string;
      fallbackWarningTitle: (message: string) => string;
      inProgress: string;
      selectInitialSoldier: string;
      selectPath: string;
      simulateFailed: string;
      solveFailed: string;
      success: (elapsed: string) => string;
    };
    copy: {
      buttonDefault: string;
      buttonError: string;
      buttonSuccess: string;
      error: string;
      success: string;
    };
    detection: {
      cancelled: string;
      detectingBounds: string;
      detectingObjects: string;
      detectedBounds: (elapsed: string) => string;
      detectedCurrentBounds: (soldiers: number, elapsed: string) => string;
      detectedWithAutoBounds: (soldiers: number, elapsed: string) => string;
      failed: (message: string) => string;
      obstacleEditsApplied: (obstacles: number) => string;
      obstacleEditsCleared: (obstacles: number) => string;
      updatingObstacleEdits: string;
      needBounds: string;
      noBounds: string;
      noPixels: string;
      partialWarning: string;
      preparingPixels: string;
      stopSuffix: string;
      updatingResults: string;
      uploadFirst: string;
      warningTitle: (warning: GraphwarDetectionWarning) => string;
    };
    image: {
      defaultStatus: string;
      pastedName: string;
      screenCaptureIncomplete: string;
      screenCaptureName: string;
      screenCaptureUnavailable: string;
      screenCaptureUnsupported: string;
    };
    agent: {
      defaultStatus: string;
      failed: (message: string) => string;
      failureReason: (kind: GraphwarAgentClientErrorKind | undefined, message: string) => string;
      fireFailed: (message: string) => string;
      fileFailed: (message: string) => string;
      fileIncompatible: string;
      fired: string;
      loaded: (soldiers: number) => string;
      obstacleFileLoaded: string;
      readFirst: string;
      reading: string;
      readingFile: string;
      stateFileLoaded: string;
    };
    pathPointCoordinateNumber: string;
    secondOrderAngleHint: (angle: string) => string;
    trajectoryWarning: {
      obstacle: string;
      stopped: Record<GraphwarKillerStopReason, string>;
    };
  };
  /** 智能寻路流程状态文案。 */
  smartPathfinding: {
    cancelled: string;
    currentPathBlocked: string;
    failure: (elapsed?: string) => string;
    forwardMinimumDouble: string;
    forwardPath: (minimumStep: string) => string;
    needBounds: string;
    needDetection: string;
    inProgress: {
      optimize: string;
      search: string;
      trajectory: string;
      stopSuffix: string;
    };
    success: (elapsed?: string, resultCacheHit?: boolean) => string;
    oneClickClear: {
      inProgress: string;
      needDetection: string;
      needCurrentPath: string;
      noCandidate: string;
      noUsableTarget: (elapsed: string) => string;
      pathfindingWorkerFailed: (elapsed: string) => string;
      success: (killCount: number, elapsed: string, resultCacheHit?: boolean) => string;
      unsupported: string;
    };
    managed: {
      backgroundWarning: string;
      calculationComplete: (targetCount: number, elapsed: string) => string;
      calculating: (targetCount?: number) => string;
      completedWaiting: string;
      connectionFailed: (message: string) => string;
      deadlineFired: string;
      deadlineNoPlan: string;
      deadlinePlan: (targetCount: number, elapsed: string) => string;
      enabled: string;
      incompatible: string;
      readying: string;
      searchFailed: string;
      skippingTurn: string;
      skipTurnFired: string;
      shotUnknown: (message: string) => string;
      stopped: string;
      successFired: string;
      waitingForGame: string;
      waitingForTurn: string;
    };
  };
  /** 页面控件、面板标题和可访问性标签文案。 */
  ui: {
    actions: {
      collisionCheck: string;
      collisionCheckTitle: string;
      clearPath: string;
      clearPathTitle: string;
      clearObstacleEdits: string;
      clearObstacleEditsTitle: string;
      drawObstacle: string;
      drawObstacleTitle: string;
      eraseObstacle: string;
      eraseObstacleTitle: string;
      magnifier: string;
      magnifierTitle: string;
      magnifierZoom: string;
      magnifierZoomAriaLabel: string;
      magnifierZoomTitle: string;
      obstacleBrushDiameter: string;
      obstacleBrushDiameterAriaLabel: string;
      obstacleBrushDiameterTitle: string;
      liveClickPreview: string;
      liveClickPreviewTitle: string;
      pickBounds: string;
      pickBoundsTitle: string;
      pickPath: string;
      pickPathTitle: string;
      pathPlanning: string;
      pathPlanningTitle: string;
      snapSoldiers: string;
      snapSoldiersTitle: string;
      title: string;
      toolModeAriaLabel: string;
      toolModeTitle: string;
      undoPoint: string;
      undoPointTitle: string;
    };
    detection: {
      agent: {
        address: string;
        addressAriaLabel: string;
        addressTitle: string;
        helpLink: string;
        readObstacleFile: string;
        readObstacleFileTitle: string;
        read: string;
        reading: string;
        readStateFile: string;
        readStateFileTitle: string;
        readTitle: string;
        settingsSummary: string;
        toggle: string;
        toggleTitle: string;
      };
      autoDetection: string;
      autoDetectionTitle: string;
      busyOverlay: string;
      debugNoTiming: string;
      debugDetails: GraphwarKillerDetectionDebugDetailText;
      debugStages: Record<
        | "building-obstacle-mask"
        | "collecting-soldier-candidates"
        | "preparing-pixels"
        | "detecting-bounds"
        | "detecting-objects"
        | "filtering-obstacle-components"
        | "matching-soldier-templates"
        | "updating-results"
        | "setting-status"
        | "outside-stages"
        | "total",
        GraphwarKillerDebugStageText
      >;
      debugSummary: string;
      minObstacleArea: string;
      minObstacleAreaAriaLabel: string;
      minObstacleAreaTitle: string;
      detectBounds: string;
      detectBoundsTitle: string;
      detectObjects: string;
      detectObjectsNeedBoundsTitle: string;
      detectObjectsTitle: string;
      title: string;
    };
    pathfinding: {
      allowFriendlyFire: string;
      allowFriendlyFireTitle: string;
      capabilityReasons: Record<GraphwarCapabilityReason, string>;
      debugDetails: GraphwarKillerPathfindingDebugDetailText;
      debugNoTiming: string;
      debugStages: Record<
        | "preflight"
        | "prefix-evidence-hit"
        | "prefix-evidence-miss"
        | "prepare-pathfinding-prefix"
        | "collect-targets"
        | "result-cache-hit"
        | "result-cache-miss"
        | "route-mask-cache-hit"
        | "route-mask-cache-miss"
        | "search-route"
        | "visibility-cache-hit"
        | "visibility-cache-miss"
        | "visibility-cache-skipped"
        | "validate-trajectory"
        | "validate-direct-trajectory"
        | "optimize-path"
        | "apply-result"
        | "one-click-clear-preflight"
        | "one-click-clear-collect-targets"
        | "one-click-clear-result-cache-hit"
        | "one-click-clear-result-cache-miss"
        | "one-click-clear-route-mask-cache-hit"
        | "one-click-clear-route-mask-cache-miss"
        | "one-click-clear-search"
        | "one-click-clear-apply-result"
        | "one-click-clear-setting-status"
        | "setting-status"
        | "outside-stages"
        | "total",
        GraphwarKillerDebugStageText
      >;
      debugSummary: string;
      deleteOptimization: string;
      deleteOptimizationTitle: string;
      obstacleExpansionAgentMode: string;
      obstacleExpansionDetectionMode: string;
      obstacleExpansion: string;
      obstacleExpansionTitle: string;
      oneClickClearDeleteCheckRadius: string;
      oneClickClearDeleteCheckRadiusAriaLabel: string;
      oneClickClearDeleteCheckRadiusTitle: string;
      oneClickClearTitle: string;
      managedFriendlyFireWarning: string;
      managedMode: string;
      managedModeDisableTitle: string;
      /** 明确列出托管算法支持结论，以及每个不支持模式将采用的算法设定。 */
      managedModeConfirmation: (
        repairs: readonly {
          equation: string;
          algorithm: string;
          properties: readonly string[];
        }[],
        friendlyFireEnabled: boolean,
      ) => string;
      managedModeTitle: string;
      routePlanningTolerance: string;
      routePlanningToleranceAriaLabel: string;
      routePlanningToleranceTitle: string;
      routeAlgorithm: string;
      routeAlgorithmTitle: string;
      routeLazyVisibilityGraph: string;
      routeThetaStar: string;
      routeXPlusScan: string;
      searchAnimation: string;
      searchAnimationTitle: string;
      simulationTolerance: string;
      simulationToleranceAriaLabel: string;
      simulationToleranceTitle: string;
      autoGraph: string;
      title: string;
      settingsSummary: string;
      unit: string;
    };
    point: {
      coordinateAriaLabel: (label: string, axis: "x" | "y") => string;
      coordinateTitle: (label: string, axis: "x" | "y") => string;
      header: string;
      selfLabel: string;
      svgSelfLabel: string;
      pathLabel: (index: number) => string;
    };
    result: {
      clearSimulator: string;
      clearSimulatorTitle: string;
      copyTitle: string;
      fire: string;
      fireError: string;
      fireSuccess: string;
      fireTitle: string;
      firing: string;
      formulaInputAriaLabel: string;
      formulaInputTitle: string;
      launchAngle: string;
      launchAngleAriaLabel: string;
      launchAngleTitle: string;
      title: string;
    };
    screenshot: {
      agentPlaceholder: string;
      stepGlitchAgentRecommendation: (agentToggleLabel: string) => string;
      capture: string;
      captureTitle: string;
      placeholder: string;
      title: string;
      upload: string;
      uploadInputTitle: string;
      uploadTitle: string;
    };
    settings: {
      algorithm: string;
      algorithmAriaLabel: string;
      algorithmTitle: string;
      bounds: {
        heading: string;
        maxXAriaLabel: string;
        maxXTitle: string;
        maxYAriaLabel: string;
        maxYTitle: string;
        minXAriaLabel: string;
        minXTitle: string;
        minYAriaLabel: string;
        minYTitle: string;
      };
      actionBar: {
        heading: string;
        liveClickPreviewWorkerCount: string;
        liveClickPreviewWorkerCountAriaLabel: string;
        liveClickPreviewWorkerCountTitle: string;
      };
      advancedSettings: string;
      debugActivationCountdown: (remainingSeconds: string) => string;
      decimalPlaces: string;
      decimalPlacesAriaLabel: string;
      decimalPlacesTitle: string;
      debugInfoEnabled: string;
      gameMode: string;
      gameModeAriaLabel: string;
      gameModeTitle: string;
      mode: string;
      modeAriaLabel: string;
      modeTitle: string;
      overflowProtection: string;
      overflowProtectionTitle: string;
      parseDerivativeAsY: string;
      parseDerivativeAsYTitle: string;
      pathfinding: {
        heading: string;
        workerCount: string;
        workerCountAriaLabel: string;
        workerCountTitle: string;
      };
      recognition: {
        candidateTopRatio: string;
        candidateTopRatioAriaLabel: string;
        candidateTopRatioTitle: string;
        heading: string;
        maximumSoldierCount: string;
        maximumSoldierCountAriaLabel: string;
        maximumSoldierCountTitle: string;
        templateMatchingWorkerCount: string;
        templateMatchingWorkerCountAriaLabel: string;
        templateMatchingWorkerCountTitle: string;
      };
      simulator: string;
      skipUnknownCharacters: string;
      skipUnknownCharactersTitle: string;
      stepGlitchMode: string;
      stepGlitchModeInactiveReason: string;
      stepGlitchModeObstacleRequiredReason: string;
      stepGlitchModeTitle: string;
      stepSteepness: string;
      stepSteepnessAriaLabel: string;
      stepSteepnessTitle: string;
      title: string;
    };
  };
}
