import type { ComputedRef, Ref } from "vue";

import { normalizePathPoint, imageToGraphPoint } from "../../core/geometry";
import { graphXAdvancesStrictly } from "../../core/numbers";
import type { BoundsRect, GraphBounds, GraphPoint, PixelPoint, ToolWorkflowMode } from "../../core/types";
import type {
  GraphwarTrajectoryFormulaSettings,
  GraphwarTrajectoryTargetCircle,
} from "../../formula/trajectory/sampling";
import {
  createGraphwarSmartPathfindingTrajectoryResult,
  type GraphwarSmartPathfindingHitTarget,
} from "../../pathfinding/smart/trajectory";
import type { GraphwarSmartPathfindingRunWorkflowController } from "../pathfinding/smart/workflow";
import type { ParsedBounds, ParsedObstacleTolerances } from "../settings/validation";

interface ReadonlyRef<T> {
  readonly value: T;
}

interface GraphwarPathAppendWorkflowOptions<TSoldier, TSmartTarget> {
  geometry: {
    /** 当前截图坐标系矩形；点规范化和 Graphwar 坐标映射应使用同一份页面标定。 */
    boundsRect: ReadonlyRef<BoundsRect>;
    /** 当前路径的 Graphwar 坐标应由页面统一投影，避免这里重复维护 computed。 */
    getMappedPathPoints: () => readonly GraphPoint[];
    /** 坐标边界校验应沿用 settings controller 的原错误优先级。 */
    parsedBounds: ComputedRef<ParsedBounds>;
  };
  messages: {
    /** 当前路径无法继续 x+ 前进时的本地化提示。 */
    getForwardPathMessage: () => string;
    /** 当前公式未命中路径尾点时的本地化提示。 */
    getSmartPathfindingCurrentPathBlockedMessage: () => string;
  };
  modes: {
    /** 智能寻路开关应由页面折叠算法模式和用户开关后注入。 */
    isSmartPathfindingEnabled: () => boolean;
    /** 模拟器模式的路径语义不同，只保留一个规范化点。 */
    toolWorkflowMode: ReadonlyRef<ToolWorkflowMode>;
  };
  path: {
    /** 当前工作流路径。 */
    pathPixels: Ref<PixelPoint[]>;
    /** 路径状态文案仍由页面展示。 */
    pathStatus: Ref<string>;
    /** 路径落地应走页面统一入口，以保留缓存失效和状态清理语义。 */
    setPathPixels: (points: PixelPoint[]) => void;
    /** 点击士兵时应同步当前轨迹颜色。 */
    trajectoryStrokeColor: Ref<string>;
  };
  smartPathfinding: {
    /** 首个路径点落地后应清掉旧智能寻路状态。 */
    clearStatus: () => void;
    /** 短暂标记阻止启动智能寻路的当前轨迹撞击位置。 */
    flashBlockedPoint: (point: PixelPoint | undefined) => void;
    /** 单目标智能寻路运行生命周期仍由专用 workflow 管理。 */
    runWorkflow: GraphwarSmartPathfindingRunWorkflowController<PixelPoint | TSmartTarget>;
    /** 当前路径预检失败时应复用智能寻路状态栏。 */
    setStatus: (message: string, kind: "error") => void;
  };
  targets: {
    /** 普通路径点追加时按当前目标区域推进到合法 x+ 点。 */
    createMinimumForwardTargetPoint: (point: PixelPoint) => PixelPoint | undefined;
    /** 非智能寻路点击士兵时，中心不可达则取士兵圆内最小 x+ 瞄点。 */
    createSearchStartSoldierAimPoint: (startPoint: PixelPoint | undefined, soldier: TSoldier) => PixelPoint | undefined;
    /** 智能寻路点击士兵时，几何目标和真实命中圆应一起构造。 */
    createSmartPathfindingSoldierTarget: (startPoint: PixelPoint, soldier: TSoldier) => TSmartTarget | undefined;
    /** 当前尾点若落在士兵命中圈内，预检应使用真实士兵半径。 */
    createSoldierHitCircle: (soldier: TSoldier) => GraphwarTrajectoryTargetCircle;
    /** 点击士兵的路径点应使用 Graphwar 源码中心。 */
    getDetectionBoxCenter: (soldier: TSoldier) => PixelPoint;
    /** 点击士兵时应沿用识别出的士兵颜色，缺失时使用原默认色。 */
    getDetectedSoldierColor: (soldier: TSoldier) => string | undefined;
    /** 当前识别士兵列表；只用于路径尾点命中圈预检。 */
    getSoldiers: () => readonly TSoldier[];
    /** 判断当前路径尾点是否已经落在士兵真实命中圈内。 */
    soldierContainsHitCircle: (soldier: TSoldier, point: PixelPoint) => boolean;
  };
  trajectory: {
    /** 边界收缩和障碍容差应沿用设置校验结果。 */
    parsedObstacleTolerances: ComputedRef<ParsedObstacleTolerances>;
    /** 当前公式采样设置由轨迹结果 Module 统一生成。 */
    getFormulaSettings: () => GraphwarTrajectoryFormulaSettings;
    /** 当前公式模拟障碍 mask。 */
    getSimulationObstacleMask: () => Uint8Array | undefined;
    /** 普通点命中的默认真实半径；无有效 bounds 时不可用。 */
    getTargetHitRadiusPixels: () => number | undefined;
  };
}

export interface GraphwarPathAppendWorkflowController<TSoldier> {
  /** 追加普通截图点，按当前模式决定直连、智能寻路或模拟器单点路径。 */
  appendPathPoint: (point: PixelPoint) => Promise<boolean>;
  /** 追加识别士兵目标，按当前模式决定中心点、直连瞄点或智能寻路目标。 */
  appendDetectedSoldierPathPoint: (soldier: TSoldier) => Promise<boolean>;
  /** 当前最后路径点若对应识别士兵，则用真实士兵命中圈作为预检查目标。 */
  createCurrentLastPathHitTarget: () => GraphwarSmartPathfindingHitTarget | undefined;
}

/** 集中追加路径点、点击士兵目标和智能寻路前路径预检，页面应只分发交互事件。 */
export function useGraphwarPathAppendWorkflow<TSoldier, TSmartTarget>(
  options: GraphwarPathAppendWorkflowOptions<TSoldier, TSmartTarget>,
): GraphwarPathAppendWorkflowController<TSoldier> {
  /** 统一处理手动点、智能寻路点和一键清图重建，保证路径状态只有这一处落地。 */
  async function appendPathPoint(point: PixelPoint) {
    const bounds = getBounds();
    if (!bounds) {
      return false;
    }

    if (options.modes.toolWorkflowMode.value === "simulator") {
      options.path.setPathPixels([normalizePathPoint(point, options.geometry.boundsRect.value, bounds, undefined, 0)]);
      return true;
    }

    const targetPoint =
      options.path.pathPixels.value.length > 0 ? options.targets.createMinimumForwardTargetPoint(point) : point;
    if (!targetPoint) {
      options.path.pathStatus.value = options.messages.getForwardPathMessage();
      return false;
    }

    const nextPoint =
      options.path.pathPixels.value.length > 0
        ? targetPoint
        : normalizePathPoint(targetPoint, options.geometry.boundsRect.value, bounds, undefined, 0);
    if (!nextPoint) {
      return false;
    }

    if (options.path.pathPixels.value.length === 0) {
      options.path.setPathPixels([nextPoint]);
      options.smartPathfinding.clearStatus();
      return true;
    }

    if (options.modes.isSmartPathfindingEnabled()) {
      return options.smartPathfinding.runWorkflow.run({
        collectTarget: () => nextPoint,
        preflight: ensureCurrentPathReachesLastPointBeforeSmartPathfinding,
      });
    }

    if (!canAppendPathPoint(nextPoint)) {
      return false;
    }

    options.path.setPathPixels([...options.path.pathPixels.value, nextPoint]);
    return true;
  }

  /** 点士兵时优先命中士兵中心；已有路径时根据当前模式决定直连或绕障。 */
  async function appendDetectedSoldierPathPoint(soldier: TSoldier) {
    if (options.modes.toolWorkflowMode.value === "simulator" || options.path.pathPixels.value.length === 0) {
      options.path.trajectoryStrokeColor.value = options.targets.getDetectedSoldierColor(soldier) ?? "#ec4899";
      return appendPathPoint(options.targets.getDetectionBoxCenter(soldier));
    }

    if (options.modes.isSmartPathfindingEnabled()) {
      return appendDetectedSoldierSmartPathfindingPoint(soldier);
    }

    const targetPoint = options.targets.createSearchStartSoldierAimPoint(options.path.pathPixels.value.at(-1), soldier);
    return targetPoint ? appendPathPoint(targetPoint) : false;
  }

  /** 启动新寻路前先确认当前公式轨迹已经能到达当前最后路径点。 */
  function ensureCurrentPathReachesLastPointBeforeSmartPathfinding() {
    if (options.path.pathPixels.value.length < 2) {
      return true;
    }

    const settings = options.trajectory.getFormulaSettings();
    if (settings.algorithm === "step" && settings.equation === "dy" && settings.stepGlitchMode) {
      // 邪道 Worker 会先试最终直连公式；失败后才用 exact evidence 或一次旧整式回放准备 prefix。
      return true;
    }

    const currentTarget = createCurrentLastPathHitTarget();
    if (!currentTarget) {
      return true;
    }

    const result = createGraphwarSmartPathfindingTrajectoryResult({
      boundaryExpansion: getBoundaryExpansion(),
      bounds: getBounds(),
      boundsRect: options.geometry.boundsRect.value,
      hitTarget: currentTarget,
      obstacleMask: options.trajectory.getSimulationObstacleMask(),
      points: [...options.path.pathPixels.value],
      settings,
      targetHitRadiusPixels: options.trajectory.getTargetHitRadiusPixels(),
    });
    if (result.reachesTargetBeforeObstacle) {
      return true;
    }

    options.smartPathfinding.setStatus(options.messages.getSmartPathfindingCurrentPathBlockedMessage(), "error");
    options.smartPathfinding.flashBlockedPoint(result.blockedPoint ?? options.path.pathPixels.value.at(-1));
    return false;
  }

  /** 当前最后路径点若对应识别士兵，则用真实士兵命中圈作为预检查目标。 */
  function createCurrentLastPathHitTarget() {
    const lastPoint = options.path.pathPixels.value.at(-1);
    if (!lastPoint) {
      return undefined;
    }

    const soldier = options.targets
      .getSoldiers()
      .find((box) => options.targets.soldierContainsHitCircle(box, lastPoint));
    return soldier ? options.targets.createSoldierHitCircle(soldier) : lastPoint;
  }

  /** 针对士兵目标绕障；几何目标可被 x+ 推进，弹道仍校验士兵原命中圈。 */
  async function appendDetectedSoldierSmartPathfindingPoint(soldier: TSoldier) {
    if (!getBounds()) {
      return false;
    }

    let startPoint: PixelPoint | undefined;
    return options.smartPathfinding.runWorkflow.run({
      collectTarget: () =>
        startPoint ? options.targets.createSmartPathfindingSoldierTarget(startPoint, soldier) : undefined,
      collectTargetStage: "collect-targets",
      prepare: () => {
        startPoint = [...options.path.pathPixels.value].at(-1);
        return startPoint !== undefined;
      },
      preflight: ensureCurrentPathReachesLastPointBeforeSmartPathfinding,
    });
  }

  /** 在候选点标准化后执行 Graphwar 的 x+ 路径规则。 */
  function canAppendPathPoint(point: PixelPoint) {
    const bounds = getBounds();
    if (!bounds || options.path.pathPixels.value.length < 1) {
      return true;
    }

    const nextPoint = imageToGraphPoint(point, bounds, options.geometry.boundsRect.value);
    const previousPoint = options.geometry.getMappedPathPoints().at(-1);
    if (!previousPoint) {
      return true;
    }

    if (graphXAdvancesStrictly(previousPoint.x, nextPoint.x)) {
      return true;
    }

    options.path.pathStatus.value = options.messages.getForwardPathMessage();
    return false;
  }

  function getBoundaryExpansion() {
    const tolerances = options.trajectory.parsedObstacleTolerances.value;
    return tolerances.ok ? tolerances.simulationBoundaryInsetPlanePixels : 0;
  }

  function getBounds(): GraphBounds | undefined {
    const bounds = options.geometry.parsedBounds.value;
    return bounds.ok ? bounds.bounds : undefined;
  }

  return {
    appendDetectedSoldierPathPoint,
    appendPathPoint,
    createCurrentLastPathHitTarget,
  };
}
