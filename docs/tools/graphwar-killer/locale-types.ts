/** 定义 Graphwar 杀手本地化文案结构，供中英文页面共享。 */
import type { AlgorithmMode, EquationMode } from "./types";

/** 模拟器停止原因的可本地化子集，只暴露用户需要理解的结果。 */
export type GraphwarKillerStopReason = "invalid" | "max-steps" | "out-of-bounds" | "too-steep";

/**
 * Graphwar 杀手页面的完整文案协议。
 *
 * 数组项保留 value 字段，是为了让 UI 控件直接用同一份本地化数据渲染 label/title，同时保持内部模式类型仍由 `AlgorithmMode`、`EquationMode` 等联合类型约束。
 */
export interface GraphwarKillerLocale {
  algorithmModes: readonly {
    value: AlgorithmMode;
    label: string;
    title: string;
  }[];
  equationModes: readonly {
    value: EquationMode;
    label: string;
    description: string;
    title: string;
  }[];
  toolWorkflowModes: readonly {
    value: "solver" | "simulator";
    label: string;
    title: string;
  }[];
  pathfindingModes: readonly {
    value: "off" | "smart" | "auto-graph";
    label: string;
    title: string;
  }[];
  validation: {
    boundaryExpansionNegative: string;
    boundaryExpansionNumber: string;
    boundaryExpansionPixelRange: (max: number) => string;
    boundsInvalidNumber: string;
    maxXGreaterThanMinX: string;
    maxYGreaterThanMinY: string;
    obstacleMinAreaInteger: string;
    obstacleMinAreaRange: (max: number) => string;
    obstacleBrushDiameterInteger: string;
    obstacleBrushDiameterRange: (min: number, max: number) => string;
    pathfindingMaximumNumber: string;
    pathfindingMaximumPixelRange: (limit: number) => string;
    pathfindingMinimumGreaterThanMaximum: string;
    pathfindingMinimumNumber: string;
    pathfindingMinimumPixelRange: (limit: number) => string;
    routeStepNumber: string;
    simulationExpansionNumber: string;
    simulationExpansionPixelRange: (limit: number) => string;
    stepSteepnessNumber: string;
    decimalPlacesInteger: string;
    decimalPlacesRange: (max: number) => string;
  };
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
    calculation: {
      enterFunction: string;
      enterLaunchAngle: string;
      selectInitialSoldier: string;
      selectPath: string;
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
      detectedCurrentBounds: (soldiers: number, obstacles: number) => string;
      detectedWithAutoBounds: (soldiers: number, obstacles: number) => string;
      obstacleEditsApplied: (obstacles: number) => string;
      obstacleEditsCleared: (obstacles: number) => string;
      updatingObstacleEdits: string;
      noBounds: string;
      noPixels: string;
      preparingPixels: string;
      stopSuffix: string;
      updatingResults: string;
      uploadFirst: string;
    };
    image: {
      defaultStatus: string;
      pastedName: string;
      screenCaptureIncomplete: string;
      screenCaptureName: string;
      screenCaptureUnavailable: string;
      screenCaptureUnsupported: string;
    };
    autoGraphPathfindingDisabled: string;
    pathPointCoordinateNumber: string;
    secondOrderAngleHint: (angle: string) => string;
    stepPathfindingDisabled: string;
    trajectoryWarning: {
      obstacle: string;
      stopped: Record<GraphwarKillerStopReason, string>;
    };
  };
  smartPathfinding: {
    cancelled: string;
    failure: (elapsed?: string) => string;
    forwardPath: (minimumStep: string) => string;
    inProgress: {
      optimize: string;
      search: string;
      trajectory: string;
      stopSuffix: string;
    };
    success: (elapsed?: string) => string;
  };
  ui: {
    actions: {
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
      obstacleBrushDiameter: string;
      obstacleBrushDiameterAriaLabel: string;
      obstacleBrushDiameterTitle: string;
      pickBounds: string;
      pickBoundsTitle: string;
      pickPath: string;
      pickPathTitle: string;
      title: string;
      toolModeAriaLabel: string;
      toolModeTitle: string;
      undoPoint: string;
      undoPointTitle: string;
    };
    detection: {
      autoDetection: string;
      autoDetectionTitle: string;
      busyOverlay: string;
      minObstacleArea: string;
      minObstacleAreaAriaLabel: string;
      minObstacleAreaTitle: string;
      smartCursor: string;
      smartCursorTitle: string;
      startDetection: string;
      startDetectionTitle: string;
      title: string;
    };
    instructions: {
      items: readonly string[];
      title: string;
    };
    introLinkText: string;
    introPrefix: string;
    introSuffix: string;
    pathfinding: {
      allowFriendlyFire: string;
      allowFriendlyFireTitle: string;
      boundaryExpansion: string;
      boundaryExpansionAriaLabel: string;
      boundaryExpansionTitle: string;
      fastMode: string;
      fastModeAriaLabel: string;
      fastModeTitle: string;
      expansionStep: string;
      expansionStepAriaLabel: string;
      expansionStepTitle: string;
      modeAriaLabel: string;
      modeTitle: string;
      obstacleExpansion: string;
      obstacleExpansionTitle: string;
      pathMaximum: string;
      pathMaximumAriaLabel: string;
      pathMaximumTitle: string;
      pathMinimum: string;
      pathMinimumAriaLabel: string;
      pathMinimumTitle: string;
      searchAnimation: string;
      searchAnimationTitle: string;
      simulationExpansion: string;
      simulationExpansionAriaLabel: string;
      simulationExpansionTitle: string;
      title: string;
      unit: string;
      workerCount: string;
      workerCountAriaLabel: string;
      workerCountTitle: string;
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
      formulaInputAriaLabel: string;
      formulaInputTitle: string;
      launchAngle: string;
      launchAngleAriaLabel: string;
      launchAngleTitle: string;
      title: string;
    };
    screenshot: {
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
        maxXAriaLabel: string;
        maxXTitle: string;
        maxYAriaLabel: string;
        maxYTitle: string;
        minXAriaLabel: string;
        minXTitle: string;
        minYAriaLabel: string;
        minYTitle: string;
      };
      advancedSettings: string;
      decimalPlaces: string;
      decimalPlacesAriaLabel: string;
      decimalPlacesTitle: string;
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
      skipUnknownCharacters: string;
      skipUnknownCharactersTitle: string;
      stepSteepness: string;
      stepSteepnessAriaLabel: string;
      stepSteepnessTitle: string;
      title: string;
    };
  };
}
