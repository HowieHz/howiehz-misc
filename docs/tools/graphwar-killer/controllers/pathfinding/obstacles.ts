import { computed, type ComputedRef } from "vue";

import type { BoundsRect, ReadonlyValue as ReadonlyRef } from "../../core/types";
import {
  buildObstacleEdgePath,
  buildObstacleFillPath,
  type DetectedObstacleMap,
  type GraphwarDetectionBox,
} from "../../detection/objects";
import type { GraphwarTrajectoryCollisionSettings } from "../../formula/trajectory/sampling";
import type { createGraphwarPathfindingCacheController } from "../../pathfinding/runtime/cache";
import type { ParsedBounds, ParsedObstacleTolerances } from "../settings/validation";

type GraphwarPathfindingCacheController = ReturnType<typeof createGraphwarPathfindingCacheController>;

/** 路线目标边界内收值所需的模式和容差输入。 */
interface GraphwarPathfindingRouteBoundaryInsetOptions {
  modes: {
    /** 手工碰撞检查启用时，普通目标选择也应避开 route 边界。 */
    isCollisionCheckEnabled: ReadonlyRef<boolean>;
    /** 寻路障碍显示启用时，目标选择应按 route tolerance 同步边界内收。 */
    isPathfindingObstacleEdgesActive: ReadonlyRef<boolean>;
  };
  settings: {
    /** 容差校验结果应由 settings controller 保持原错误优先级。 */
    parsedObstacleTolerances: ComputedRef<ParsedObstacleTolerances>;
  };
}

/** 多类寻路障碍 mask 派生所需的页面状态。 */
interface GraphwarPathfindingObstacleProjectionOptions {
  /** 当前截图坐标系矩形；SVG path 和友方士兵 mask 应使用同一份页面标定。 */
  boundsRect: ReadonlyRef<BoundsRect>;
  /** 寻路 mask 派生应复用页面 cache，避免 route/simulation mask 重复膨胀。 */
  cache: GraphwarPathfindingCacheController;
  detection: {
    /** 自动识别或手工编辑后的障碍 mask。 */
    obstacles: ReadonlyRef<DetectedObstacleMap | undefined>;
    /** 当前识别士兵；关闭友伤时其中一部分会写入障碍 mask。 */
    soldiers: ReadonlyRef<readonly GraphwarDetectionBox[]>;
    /** 友方判定应由目标规则 Module 提供，避免这里重复 Graphwar 坐标语义。 */
    isFriendlyObstacleSoldier: (soldier: GraphwarDetectionBox) => boolean;
  };
  modes: {
    /** 关闭友伤且已有路径时，友方士兵应写入所有寻路任务的基础 mask。 */
    hasFriendlySoldierObstacles: ReadonlyRef<boolean>;
    /** 普通模式不应把 route tolerance mask 用作公式模拟碰撞。 */
    isEffectiveSmartPathfindingEnabled: ReadonlyRef<boolean>;
    /** 只有智能寻路展示启用时才绘制 route/simulation 派生障碍。 */
    isPathfindingObstacleEdgesActive: ReadonlyRef<boolean>;
    /** 手工解算和模拟器是否检查碰撞；寻路任务始终强制检查。 */
    isCollisionCheckEnabled: ReadonlyRef<boolean>;
  };
  settings: {
    /** 弹道模拟边界收缩值和 simulation tolerance 同源，避免边界另起一套安全距离。 */
    activeSimulationBoundaryInset: ComputedRef<number>;
    /** 友方士兵障碍应使用真实命中半径；无有效 bounds 时不可构造。 */
    getSoldierHitRadiusPixels: () => number | undefined;
    /** 边界和容差校验结果应由 settings controller 保持原错误优先级。 */
    parsedBounds: ComputedRef<ParsedBounds>;
    parsedObstacleTolerances: ComputedRef<ParsedObstacleTolerances>;
  };
}

/** 派生寻路、模拟与展示障碍 mask 的控制器。 */
export interface GraphwarPathfindingObstacleProjectionController {
  /** 普通障碍 SVG 边线；智能寻路显示派生障碍时应隐藏。 */
  visibleObstacleEdgePath: ComputedRef<string>;
  /** 普通障碍 SVG 填充；智能寻路显示派生障碍时应隐藏。 */
  visibleObstacleFillPath: ComputedRef<string>;
  /** 公式模拟使用的障碍 mask。 */
  simulationObstacleMask: ComputedRef<Uint8Array | undefined>;
  /** 智能寻路和一键清图使用的 simulation tolerance 障碍 mask。 */
  smartPathfindingSimulationObstacleMask: ComputedRef<Uint8Array | undefined>;
  /** 写入友方士兵后的智能寻路基础障碍 mask。 */
  smartPathfindingBaseObstacleMask: ComputedRef<Uint8Array | undefined>;
  /** Route tolerance 派生障碍 SVG 边线。 */
  smartPathfindingObstacleRouteEdgePath: ComputedRef<string>;
  /** Route tolerance 派生障碍 SVG 填充。 */
  smartPathfindingObstacleRouteFillPath: ComputedRef<string>;
  /** Simulation tolerance 派生障碍 SVG 边线。 */
  smartPathfindingObstacleSimulationEdgePath: ComputedRef<string>;
  /** Simulation tolerance 派生障碍 SVG 填充。 */
  smartPathfindingObstacleSimulationFillPath: ComputedRef<string>;
  /** 轨迹采样碰撞设置；无碰撞场景返回 undefined，保留原短路语义。 */
  trajectoryCollisionSettings: ComputedRef<GraphwarTrajectoryCollisionSettings | undefined>;
}

/** 计算目标选择和几何寻路共享的边界收缩值；边界按 route tolerance 作为硬障碍处理。 */
export function useGraphwarPathfindingRouteBoundaryInset(
  options: GraphwarPathfindingRouteBoundaryInsetOptions,
): ComputedRef<number> {
  return computed(() =>
    (options.modes.isCollisionCheckEnabled.value || options.modes.isPathfindingObstacleEdgesActive.value) &&
    options.settings.parsedObstacleTolerances.value.ok
      ? options.settings.parsedObstacleTolerances.value.routeBoundaryInsetPlanePixels
      : 0,
  );
}

/** 集中寻路障碍 mask、SVG path 和轨迹碰撞设置；页面应只注入当前状态入口。 */
export function useGraphwarPathfindingObstacleProjection(
  options: GraphwarPathfindingObstacleProjectionOptions,
): GraphwarPathfindingObstacleProjectionController {
  const visibleObstacleEdgePath = computed(() => {
    const obstacleMap = options.detection.obstacles.value;
    if (!obstacleMap || options.modes.isPathfindingObstacleEdgesActive.value) {
      return "";
    }

    return buildObstacleEdgePath(obstacleMap.mask, options.boundsRect.value);
  });

  const visibleObstacleFillPath = computed(() => {
    const obstacleMap = options.detection.obstacles.value;
    if (!obstacleMap || options.modes.isPathfindingObstacleEdgesActive.value) {
      return "";
    }

    return buildObstacleFillPath(obstacleMap.mask, options.boundsRect.value);
  });

  const smartPathfindingBaseObstacleMask = computed(() => {
    const obstacleMap = options.detection.obstacles.value;
    if (!obstacleMap || !options.modes.hasFriendlySoldierObstacles.value || !options.settings.parsedBounds.value.ok) {
      return obstacleMap?.mask;
    }

    const friendlySoldiers = options.detection.soldiers.value.filter(options.detection.isFriendlyObstacleSoldier);
    if (friendlySoldiers.length === 0) {
      return obstacleMap.mask;
    }

    const soldierHitRadiusPixels = options.settings.getSoldierHitRadiusPixels();
    if (soldierHitRadiusPixels === undefined) {
      return obstacleMap.mask;
    }

    return options.cache.getCachedFriendlyObstacleMask(
      obstacleMap.mask,
      options.boundsRect.value,
      friendlySoldiers,
      soldierHitRadiusPixels,
    );
  });

  const activePathfindingBaseObstacleMask = computed(() => {
    if (options.modes.isPathfindingObstacleEdgesActive.value) {
      return smartPathfindingBaseObstacleMask.value;
    }
    return options.detection.obstacles.value?.mask;
  });

  const smartPathfindingVisibleRouteTolerance = computed(() => {
    const tolerances = options.settings.parsedObstacleTolerances.value;
    if (!tolerances.ok) {
      return 0;
    }
    return tolerances.routePlanningTolerancePlanePixels;
  });

  const smartPathfindingObstacleRouteEdgePath = computed(() => {
    const obstacleMask = getPathfindingObstacleMaskForSvgPath();
    if (!obstacleMask || !options.settings.parsedObstacleTolerances.value.ok) {
      return "";
    }

    return buildObstacleEdgePath(
      options.cache.getCachedRouteMask(obstacleMask, smartPathfindingVisibleRouteTolerance.value).mask,
      options.boundsRect.value,
    );
  });

  const smartPathfindingObstacleRouteFillPath = computed(() => {
    const obstacleMask = getPathfindingObstacleMaskForSvgPath();
    if (!obstacleMask || !options.settings.parsedObstacleTolerances.value.ok) {
      return "";
    }

    return buildObstacleFillPath(
      options.cache.getCachedRouteMask(obstacleMask, smartPathfindingVisibleRouteTolerance.value).mask,
      options.boundsRect.value,
    );
  });

  const smartPathfindingObstacleSimulationEdgePath = computed(() => {
    const obstacleMask = getPathfindingObstacleMaskForSvgPath();
    const tolerances = options.settings.parsedObstacleTolerances.value;
    if (!obstacleMask || !tolerances.ok) {
      return "";
    }

    return buildObstacleEdgePath(
      options.cache.getCachedRouteMask(obstacleMask, tolerances.simulationTolerancePlanePixels).mask,
      options.boundsRect.value,
    );
  });

  const smartPathfindingObstacleSimulationFillPath = computed(() => {
    const obstacleMask = getPathfindingObstacleMaskForSvgPath();
    const tolerances = options.settings.parsedObstacleTolerances.value;
    if (!obstacleMask || !tolerances.ok) {
      return "";
    }

    return buildObstacleFillPath(
      options.cache.getCachedRouteMask(obstacleMask, tolerances.simulationTolerancePlanePixels).mask,
      options.boundsRect.value,
    );
  });

  const smartPathfindingSimulationObstacleMask = computed(() => {
    const tolerances = options.settings.parsedObstacleTolerances.value;
    if (!tolerances.ok) {
      return undefined;
    }
    const obstacleMask = smartPathfindingBaseObstacleMask.value;
    return obstacleMask
      ? options.cache.getCachedRouteMask(obstacleMask, tolerances.simulationTolerancePlanePixels).mask
      : undefined;
  });

  const simulationObstacleMask = computed(() => {
    const obstacleMap = options.detection.obstacles.value;
    if (!obstacleMap) {
      return undefined;
    }
    return options.modes.isEffectiveSmartPathfindingEnabled.value
      ? smartPathfindingSimulationObstacleMask.value
      : obstacleMap.mask;
  });

  const trajectoryCollisionSettings = computed<GraphwarTrajectoryCollisionSettings | undefined>(() => {
    if (!options.modes.isCollisionCheckEnabled.value && !options.modes.isPathfindingObstacleEdgesActive.value) {
      return undefined;
    }

    const obstacleMask = simulationObstacleMask.value;
    if (!obstacleMask) {
      return undefined;
    }

    return {
      boundaryExpansion: options.settings.activeSimulationBoundaryInset.value,
      mask: obstacleMask,
    };
  });

  /** SVG path 只应在寻路障碍显示启用时消费派生 mask，保持普通障碍显示短路语义。 */
  function getPathfindingObstacleMaskForSvgPath() {
    return options.modes.isPathfindingObstacleEdgesActive.value ? activePathfindingBaseObstacleMask.value : undefined;
  }

  return {
    simulationObstacleMask,
    smartPathfindingBaseObstacleMask,
    smartPathfindingObstacleRouteEdgePath,
    smartPathfindingObstacleRouteFillPath,
    smartPathfindingObstacleSimulationEdgePath,
    smartPathfindingObstacleSimulationFillPath,
    smartPathfindingSimulationObstacleMask,
    trajectoryCollisionSettings,
    visibleObstacleEdgePath,
    visibleObstacleFillPath,
  };
}
