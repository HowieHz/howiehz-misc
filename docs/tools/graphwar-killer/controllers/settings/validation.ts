import { computed, type ComputedRef } from "vue";

import { MAX_FORMULA_DECIMAL_PLACES, nearlyEqual, parseFiniteNumber } from "../../core/numbers";
import type { GraphBounds } from "../../core/types";
import type { GraphwarKillerLocale } from "../../locale-types";
import { createBoundaryInsetFromObstacleTolerance } from "../../pathfinding/tolerances";

interface GraphwarReadonlyRef<T> {
  readonly value: T;
}

/** 坐标边界解析结果；失败分支直接携带本地化校验文案。 */
export type ParsedBounds = { ok: true; bounds: GraphBounds } | { ok: false; message: string };
/** Step 陡峭度解析结果；只有 step 算法会消费成功值。 */
export type ParsedSteepness = { ok: true; steepness: number } | { ok: false; message: string };
/** 公式输出小数位解析结果；只控制生成公式文本，不约分内部路径点或发射点。 */
export type ParsedPrecision = { ok: true; decimalPlaces: number } | { ok: false; message: string };
/** 识别设定解析结果，失败时阻止重新识别。 */
export type ParsedDetectionSettings =
  | {
      ok: true;
      candidateTopRatio: number;
      maximumSoldierCount: number;
      minArea: number;
      templateMatchingWorkerCount: number;
    }
  | { ok: false; message: string };
/** 放大镜倍率解析结果；允许输入框超过滑条快速范围。 */
export type ParsedMagnifierZoom = { ok: true; zoom: number } | { ok: false; message: string };
/** 障碍笔刷直径解析结果，单位为 Graphwar 原始 770x450 平面像素。 */
export type ParsedObstacleBrushDiameter = { ok: true; diameter: number } | { ok: false; message: string };
/** 寻路并行数解析结果；1 表示一键清图 DAG 建边在 master worker 内串行执行。 */
export type ParsedPathfindingWorkerCount = { ok: true; workerCount: number } | { ok: false; message: string };
/** 普通智能寻路容差解析结果；所有距离都使用 Graphwar 原始 770x450 平面像素。 */
export type ParsedObstacleTolerances =
  | {
      ok: true;
      routeBoundaryInsetPlanePixels: number;
      routePlanningTolerancePlanePixels: number;
      simulationBoundaryInsetPlanePixels: number;
      simulationTolerancePlanePixels: number;
    }
  | { ok: false; message: string };
/** 一键清图容差解析结果；在普通寻路容差之上追加删点局部校验半径。 */
export type ParsedOneClickClearTolerances =
  | (Extract<ParsedObstacleTolerances, { ok: true }> & {
      oneClickClearDeleteCheckRadiusPlanePixels: number;
    })
  | { ok: false; message: string };
interface ParsedSettingsFailure {
  ok: false;
  message: string;
}
type ParsedObstacleToleranceValues = Extract<ParsedObstacleTolerances, { ok: true }>;

interface GraphwarSettingsValidationInputs {
  /** 边界输入应由页面持有，因为它们同时驱动面板展示、手动标定和路径坐标换算。 */
  bounds: {
    maxXText: GraphwarReadonlyRef<string>;
    maxYText: GraphwarReadonlyRef<string>;
    minXText: GraphwarReadonlyRef<string>;
    minYText: GraphwarReadonlyRef<string>;
  };
  /** 公式输入校验应只输出解析结果，不负责生成公式或清理路径缓存。 */
  formula: {
    precisionText: GraphwarReadonlyRef<string>;
    steepnessText: GraphwarReadonlyRef<string>;
  };
  /** 识别设置校验应保持 worker 调度前的原错误优先级。 */
  detection: {
    maximumSoldierCountText: GraphwarReadonlyRef<string>;
    obstacleMinAreaText: GraphwarReadonlyRef<string>;
    soldierTemplateCandidateTopRatioText: GraphwarReadonlyRef<string>;
    templateMatchingWorkerCountText: GraphwarReadonlyRef<string>;
  };
  /** 放大镜校验应允许输入框范围大于滑条范围。 */
  magnifier: {
    zoomText: GraphwarReadonlyRef<string>;
  };
  /** 笔刷校验只负责直径合法性；绘制副作用留在障碍编辑 controller。 */
  obstacleBrush: {
    diameterText: GraphwarReadonlyRef<string>;
  };
  /** 寻路校验只解析用户输入；截图像素换算应留给具体消费方。 */
  pathfinding: {
    oneClickClearDeleteCheckRadiusText: GraphwarReadonlyRef<string>;
    routePlanningToleranceText: GraphwarReadonlyRef<string>;
    simulationToleranceText: GraphwarReadonlyRef<string>;
    workerCountText: GraphwarReadonlyRef<string>;
  };
}

interface GraphwarSettingsValidationLimits {
  detection: {
    obstacleMaximumArea: number;
  };
  magnifier: {
    inputMaximumZoom: number;
    minimumZoom: number;
  };
  obstacleBrush: {
    inputMaximumDiameter: number;
    minimumDiameter: number;
  };
  pathfinding: {
    deleteCheckRadiusMinimumPlanePixels: number;
    obstacleToleranceLimit: number;
  };
}

interface GraphwarSettingsValidationOptions {
  /** 本地化文案应在 computed 求值时读取，避免 locale 切换后保留旧文案。 */
  getLocale: () => GraphwarKillerLocale;
  /** 输入按页面设置域分组，避免把每个 ref 平铺成浅 Interface。 */
  inputs: GraphwarSettingsValidationInputs;
  /** 范围限制应由页面提供，确保面板展示范围和校验范围继续使用同一批常量。 */
  limits: GraphwarSettingsValidationLimits;
}

export interface GraphwarSettingsValidationController {
  parsedBounds: ComputedRef<ParsedBounds>;
  parsedDetectionSettings: ComputedRef<ParsedDetectionSettings>;
  parsedMagnifierZoom: ComputedRef<ParsedMagnifierZoom>;
  parsedObstacleBrushDiameter: ComputedRef<ParsedObstacleBrushDiameter>;
  parsedOneClickClearTolerances: ComputedRef<ParsedOneClickClearTolerances>;
  parsedObstacleTolerances: ComputedRef<ParsedObstacleTolerances>;
  parsedPathfindingWorkerCount: ComputedRef<ParsedPathfindingWorkerCount>;
  parsedPrecision: ComputedRef<ParsedPrecision>;
  parsedSteepness: ComputedRef<ParsedSteepness>;
}

/** 集中页面设置输入解析；页面应只消费校验结果，workflow 副作用应留在页面侧。 */
export function useGraphwarSettingsValidation(
  options: GraphwarSettingsValidationOptions,
): GraphwarSettingsValidationController {
  const parsedBounds = computed<ParsedBounds>(() => {
    const validation = options.getLocale().validation;
    const minX = parseFiniteNumber(options.inputs.bounds.minXText.value);
    const maxX = parseFiniteNumber(options.inputs.bounds.maxXText.value);
    const minY = parseFiniteNumber(options.inputs.bounds.minYText.value);
    const maxY = parseFiniteNumber(options.inputs.bounds.maxYText.value);

    if (minX === undefined || maxX === undefined || minY === undefined || maxY === undefined) {
      return { ok: false as const, message: validation.boundsInvalidNumber };
    }

    if (minX >= maxX || nearlyEqual(minX, maxX)) {
      return { ok: false as const, message: validation.maxXGreaterThanMinX };
    }
    if (minY >= maxY || nearlyEqual(minY, maxY)) {
      return { ok: false as const, message: validation.maxYGreaterThanMinY };
    }

    return { ok: true as const, bounds: { minX, maxX, minY, maxY } };
  });

  const parsedSteepness = computed<ParsedSteepness>(() => {
    const steepness = parseFiniteNumber(options.inputs.formula.steepnessText.value);
    if (steepness === undefined || steepness <= 0) {
      return { ok: false as const, message: options.getLocale().validation.stepSteepnessNumber };
    }
    return { ok: true as const, steepness };
  });

  const parsedPrecision = computed<ParsedPrecision>(() => {
    const validation = options.getLocale().validation;
    const decimalPlaces = parseFiniteNumber(options.inputs.formula.precisionText.value);
    if (decimalPlaces === undefined || !Number.isInteger(decimalPlaces)) {
      return { ok: false as const, message: validation.decimalPlacesInteger };
    }
    if (decimalPlaces < 0 || decimalPlaces > MAX_FORMULA_DECIMAL_PLACES) {
      return { ok: false as const, message: validation.decimalPlacesRange(MAX_FORMULA_DECIMAL_PLACES) };
    }
    return { ok: true as const, decimalPlaces };
  });

  const parsedDetectionSettings = computed<ParsedDetectionSettings>(() => {
    const validation = options.getLocale().validation;
    const maximumSoldierCount = parseFiniteNumber(options.inputs.detection.maximumSoldierCountText.value);
    if (maximumSoldierCount === undefined || !Number.isInteger(maximumSoldierCount)) {
      return { ok: false as const, message: validation.maximumSoldierCountInteger };
    }
    if (maximumSoldierCount < 1) {
      return { ok: false as const, message: validation.maximumSoldierCountPositive };
    }

    const candidateTopRatio = parseFiniteNumber(options.inputs.detection.soldierTemplateCandidateTopRatioText.value);
    if (candidateTopRatio === undefined) {
      return { ok: false as const, message: validation.soldierTemplateCandidateTopRatioNumber };
    }
    if (candidateTopRatio <= 0 || candidateTopRatio > 1) {
      return { ok: false as const, message: validation.soldierTemplateCandidateTopRatioRange };
    }

    const templateMatchingWorkerCount = parseFiniteNumber(
      options.inputs.detection.templateMatchingWorkerCountText.value,
    );
    if (templateMatchingWorkerCount === undefined || !Number.isInteger(templateMatchingWorkerCount)) {
      return { ok: false as const, message: validation.templateMatchingWorkerCountInteger };
    }
    if (templateMatchingWorkerCount < 1 || templateMatchingWorkerCount > 128) {
      return { ok: false as const, message: validation.templateMatchingWorkerCountRange };
    }

    const minArea = parseFiniteNumber(options.inputs.detection.obstacleMinAreaText.value);
    if (minArea === undefined || !Number.isInteger(minArea)) {
      return { ok: false as const, message: validation.obstacleMinAreaInteger };
    }
    if (minArea < 0 || minArea > options.limits.detection.obstacleMaximumArea) {
      return {
        ok: false as const,
        message: validation.obstacleMinAreaRange(options.limits.detection.obstacleMaximumArea),
      };
    }

    return { ok: true as const, candidateTopRatio, maximumSoldierCount, minArea, templateMatchingWorkerCount };
  });

  const parsedMagnifierZoom = computed<ParsedMagnifierZoom>(() => {
    const validation = options.getLocale().validation;
    const zoom = parseFiniteNumber(options.inputs.magnifier.zoomText.value);
    if (zoom === undefined) {
      return { ok: false as const, message: validation.magnifierZoomNumber };
    }
    if (zoom < options.limits.magnifier.minimumZoom || zoom > options.limits.magnifier.inputMaximumZoom) {
      return {
        ok: false as const,
        message: validation.magnifierZoomRange(
          options.limits.magnifier.minimumZoom,
          options.limits.magnifier.inputMaximumZoom,
        ),
      };
    }
    return { ok: true as const, zoom };
  });

  const parsedObstacleBrushDiameter = computed<ParsedObstacleBrushDiameter>(() => {
    const validation = options.getLocale().validation;
    const diameter = parseFiniteNumber(options.inputs.obstacleBrush.diameterText.value);
    if (diameter === undefined || !Number.isInteger(diameter)) {
      return { ok: false as const, message: validation.obstacleBrushDiameterInteger };
    }
    if (
      diameter < options.limits.obstacleBrush.minimumDiameter ||
      diameter > options.limits.obstacleBrush.inputMaximumDiameter
    ) {
      return {
        ok: false as const,
        message: validation.obstacleBrushDiameterRange(
          options.limits.obstacleBrush.minimumDiameter,
          options.limits.obstacleBrush.inputMaximumDiameter,
        ),
      };
    }
    return { ok: true as const, diameter };
  });

  const parsedPathfindingWorkerCount = computed<ParsedPathfindingWorkerCount>(() => {
    const workerCount = parseFiniteNumber(options.inputs.pathfinding.workerCountText.value);
    if (workerCount === undefined || !Number.isInteger(workerCount)) {
      return { ok: false as const, message: options.getLocale().validation.pathfindingWorkerCountInteger };
    }
    if (workerCount < 1 || workerCount > 128) {
      return { ok: false as const, message: options.getLocale().validation.pathfindingWorkerCountRange };
    }
    return { ok: true as const, workerCount };
  });

  const parsedObstacleTolerances = computed<ParsedObstacleTolerances>(() => {
    const toleranceValues = parseObstacleToleranceInputValues();
    if (!toleranceValues.ok) {
      return toleranceValues;
    }
    const rangeResult = validateObstacleToleranceRanges(toleranceValues);
    if (!rangeResult.ok) {
      return rangeResult;
    }
    return toleranceValues;
  });

  const parsedOneClickClearTolerances = computed<ParsedOneClickClearTolerances>(() => {
    const toleranceValues = parseObstacleToleranceInputValues();
    if (!toleranceValues.ok) {
      return toleranceValues;
    }

    const validation = options.getLocale().validation;
    const oneClickClearDeleteCheckRadiusPlanePixels = parseFiniteNumber(
      options.inputs.pathfinding.oneClickClearDeleteCheckRadiusText.value,
    );
    if (oneClickClearDeleteCheckRadiusPlanePixels === undefined) {
      return { ok: false as const, message: validation.oneClickClearDeleteCheckRadiusNumber };
    }

    const rangeResult = validateObstacleToleranceRanges(toleranceValues);
    if (!rangeResult.ok) {
      return rangeResult;
    }

    if (oneClickClearDeleteCheckRadiusPlanePixels < options.limits.pathfinding.deleteCheckRadiusMinimumPlanePixels) {
      return {
        ok: false as const,
        message: validation.oneClickClearDeleteCheckRadiusRange(
          options.limits.pathfinding.deleteCheckRadiusMinimumPlanePixels,
        ),
      };
    }

    return {
      ...toleranceValues,
      oneClickClearDeleteCheckRadiusPlanePixels,
    };
  });

  function parseObstacleToleranceInputValues(): ParsedObstacleToleranceValues | ParsedSettingsFailure {
    const boundsResult = parsedBounds.value;
    if (!boundsResult.ok) {
      return { ok: false as const, message: boundsResult.message };
    }

    const validation = options.getLocale().validation;
    const routePlanningTolerancePlanePixels = parseFiniteNumber(
      options.inputs.pathfinding.routePlanningToleranceText.value,
    );
    if (routePlanningTolerancePlanePixels === undefined) {
      return { ok: false as const, message: validation.routePlanningToleranceNumber };
    }

    const simulationTolerancePlanePixels = parseFiniteNumber(options.inputs.pathfinding.simulationToleranceText.value);
    if (simulationTolerancePlanePixels === undefined) {
      return { ok: false as const, message: validation.simulationToleranceNumber };
    }

    return {
      ok: true as const,
      routeBoundaryInsetPlanePixels: createBoundaryInsetFromObstacleTolerance(routePlanningTolerancePlanePixels),
      routePlanningTolerancePlanePixels,
      simulationBoundaryInsetPlanePixels: createBoundaryInsetFromObstacleTolerance(simulationTolerancePlanePixels),
      simulationTolerancePlanePixels,
    };
  }

  function validateObstacleToleranceRanges(
    toleranceValues: ParsedObstacleToleranceValues,
  ): { ok: true } | ParsedSettingsFailure {
    const validation = options.getLocale().validation;
    if (
      Math.abs(toleranceValues.routePlanningTolerancePlanePixels) > options.limits.pathfinding.obstacleToleranceLimit
    ) {
      return {
        ok: false as const,
        message: validation.routePlanningTolerancePixelRange(options.limits.pathfinding.obstacleToleranceLimit),
      };
    }

    if (Math.abs(toleranceValues.simulationTolerancePlanePixels) > options.limits.pathfinding.obstacleToleranceLimit) {
      return {
        ok: false as const,
        message: validation.simulationTolerancePixelRange(options.limits.pathfinding.obstacleToleranceLimit),
      };
    }

    return { ok: true };
  }

  return {
    parsedBounds,
    parsedDetectionSettings,
    parsedMagnifierZoom,
    parsedObstacleBrushDiameter,
    parsedOneClickClearTolerances,
    parsedObstacleTolerances,
    parsedPathfindingWorkerCount,
    parsedPrecision,
    parsedSteepness,
  };
}
