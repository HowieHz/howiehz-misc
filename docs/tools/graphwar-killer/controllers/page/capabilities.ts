import type { ToolWorkflowMode } from "../../core/types";

/** 页面当前选择的局面来源；Agent 配置独立跟踪。 */
export type GraphwarSceneSource = "screenshot" | "agent";

/** 随已识别局面保留的最小来源标识，防止陈旧 Agent 数据满足新命令条件。 */
export type GraphwarSceneProvenance =
  | { source: "screenshot" }
  | {
      source: "agent";
      normalizedAgentBaseUrl: string;
      gameInstanceId: string;
      battleRevision: string;
    };

/** 可见提示和命令守卫共用的稳定原因，不依赖语言环境。 */
export type GraphwarCapabilityReason =
  | "managed-lock"
  | "pathfinding-busy"
  | "agent-read-busy"
  | "agent-fire-busy"
  | "result-required"
  | "solver-required"
  | "agent-disabled"
  | "agent-url-invalid"
  | "agent-scene-required"
  | "image-required"
  | "bounds-required"
  | "soldiers-required"
  | "obstacles-required"
  | "path-start-required"
  | "formula-unsupported"
  | "formula-settings-invalid"
  | "managed-timing-invalid"
  | "pathfinding-worker-count-invalid"
  | "obstacle-tolerances-invalid"
  | "delete-check-radius-invalid";

/** 控件的完整交互状态；disabled 仍由展示层派生。 */
export type GraphwarControlCapability =
  | { state: "normal"; reason?: never }
  | { state: "blocked"; reason?: GraphwarCapabilityReason }
  | { state: "dormant" | "busy"; reason: GraphwarCapabilityReason };

/** 能力派生消费的页面事实，不引入 Vue 或本地化依赖。 */
export interface GraphwarCapabilityFacts {
  workflowMode: ToolWorkflowMode;
  activeSource: GraphwarSceneSource;
  scene: {
    hasImage: boolean;
    hasBounds: boolean;
    hasSoldiers: boolean;
    hasObstacles: boolean;
    provenance?: GraphwarSceneProvenance;
  };
  agent: {
    isEnabled: boolean;
    /** 仅在已启用的 Agent URL 成功解析并规范化后存在。 */
    normalizedBaseUrl?: string;
  };
  formula: {
    isSettingsValid: boolean;
    /** 包含后续由 Agent 选择的托管 profile 可能消费的休眠设定。 */
    isManagedSettingsValid: boolean;
    isOneClickClearSupported: boolean;
    /** 当前 Step ODE 是否实际使用固定邪道扫描器。 */
    isStepGlitchRoutingUsed: boolean;
  };
  pathfinding: {
    hasPathStart: boolean;
    isWorkerCountValid: boolean;
    /** 托管轮询与发射预留输入是否都能精确换算为允许范围内的整数毫秒。 */
    isManagedTimingValid: boolean;
    hasValidObstacleTolerances: boolean;
    isDeleteCheckRadiusValid: boolean;
  };
  hasResult: boolean;
  busy: {
    isPathfindingBusy: boolean;
    isAgentReadBusy: boolean;
    isAgentExportBusy: boolean;
    isAgentFireBusy: boolean;
    isManagedModeBusy: boolean;
  };
}

/** 判断保留值当前是否生效所需的偏好设定。 */
export interface GraphwarCapabilityPreferences {
  isSnapSoldiersEnabled: boolean;
  isCollisionCheckEnabled: boolean;
  isPathPlanningEnabled: boolean;
  isDeleteOptimizationEnabled: boolean;
}

/** 控件、可见原因和命令守卫消费的第一阶段能力。 */
export interface GraphwarCapabilities {
  semanticControls: GraphwarControlCapability;
  agentRead: GraphwarControlCapability;
  agentExport: GraphwarControlCapability;
  agentFire: GraphwarControlCapability;
  snapSoldiers: GraphwarControlCapability;
  collisionCheck: GraphwarControlCapability;
  pathPlanning: GraphwarControlCapability;
  obstacleEditing: GraphwarControlCapability;
  oneClickClear: GraphwarControlCapability;
  managedMode: GraphwarControlCapability;
}

const normalCapability = { state: "normal" } as const;

/** 同时校验来源和规范化 URL；仅有配置不能证明 Agent 局面数据仍为当前数据。 */
export function isCurrentGraphwarAgentScene(
  normalizedAgentBaseUrl: string | undefined,
  provenance: GraphwarSceneProvenance | undefined,
) {
  return (
    normalizedAgentBaseUrl !== undefined &&
    provenance?.source === "agent" &&
    provenance.normalizedAgentBaseUrl === normalizedAgentBaseUrl
  );
}

/** 返回强制碰撞寻路命令执行前首个缺少的局面条件。 */
function getGraphwarPathfindingSceneReason(facts: GraphwarCapabilityFacts): GraphwarCapabilityReason | undefined {
  if (facts.activeSource === "agent") {
    if (!facts.agent.isEnabled) {
      return "agent-disabled";
    }
    if (!facts.agent.normalizedBaseUrl) {
      return "agent-url-invalid";
    }
    if (!isCurrentGraphwarAgentScene(facts.agent.normalizedBaseUrl, facts.scene.provenance)) {
      return "agent-scene-required";
    }
  } else if (!facts.scene.hasImage) {
    return "image-required";
  }

  if (!facts.scene.hasBounds) {
    return "bounds-required";
  }
  // 其他来源的可见对象可能仍留在页面上，但不能满足当前截图工作流的条件。
  if (facts.activeSource === "screenshot" && facts.scene.provenance?.source !== "screenshot") {
    return "obstacles-required";
  }
  if (!facts.scene.hasObstacles) {
    return "obstacles-required";
  }
  return undefined;
}

/** 按命令的显式优先级派生全部第一阶段状态，不依赖隐藏可变状态。 */
export function deriveGraphwarCapabilities(
  facts: GraphwarCapabilityFacts,
  preferences: GraphwarCapabilityPreferences,
): GraphwarCapabilities {
  const sceneReason = getGraphwarPathfindingSceneReason(facts);

  return {
    semanticControls: facts.busy.isManagedModeBusy ? { state: "busy", reason: "managed-lock" } : normalCapability,
    agentRead: !facts.agent.isEnabled
      ? { state: "blocked", reason: "agent-disabled" }
      : !facts.agent.normalizedBaseUrl
        ? { state: "blocked", reason: "agent-url-invalid" }
        : facts.busy.isManagedModeBusy
          ? { state: "busy", reason: "managed-lock" }
          : facts.busy.isAgentReadBusy || facts.busy.isAgentExportBusy
            ? { state: "busy", reason: "agent-read-busy" }
            : normalCapability,
    // 导出只读取 revision 一致的快照而不应用局面，因此可以与托管并行。
    agentExport: !facts.agent.isEnabled
      ? { state: "blocked", reason: "agent-disabled" }
      : !facts.agent.normalizedBaseUrl
        ? { state: "blocked", reason: "agent-url-invalid" }
        : facts.busy.isAgentReadBusy || facts.busy.isAgentExportBusy
          ? { state: "busy", reason: "agent-read-busy" }
          : normalCapability,
    agentFire: !facts.agent.isEnabled
      ? { state: "blocked", reason: "agent-disabled" }
      : !facts.agent.normalizedBaseUrl
        ? { state: "blocked", reason: "agent-url-invalid" }
        : !facts.formula.isSettingsValid
          ? { state: "blocked", reason: "formula-settings-invalid" }
          : !facts.hasResult
            ? { state: "blocked", reason: "result-required" }
            : facts.busy.isManagedModeBusy
              ? { state: "busy", reason: "managed-lock" }
              : facts.busy.isPathfindingBusy
                ? { state: "busy", reason: "pathfinding-busy" }
                : facts.busy.isAgentFireBusy
                  ? { state: "busy", reason: "agent-fire-busy" }
                  : normalCapability,
    snapSoldiers: facts.busy.isManagedModeBusy
      ? { state: "busy", reason: "managed-lock" }
      : preferences.isSnapSoldiersEnabled && !facts.scene.hasSoldiers
        ? { state: "dormant", reason: "soldiers-required" }
        : normalCapability,
    collisionCheck: facts.busy.isManagedModeBusy
      ? { state: "busy", reason: "managed-lock" }
      : preferences.isCollisionCheckEnabled && !facts.scene.hasObstacles
        ? { state: "dormant", reason: "obstacles-required" }
        : normalCapability,
    pathPlanning: deriveGraphwarPathPlanningCapability(facts, preferences, sceneReason),
    obstacleEditing: !facts.scene.hasObstacles
      ? { state: "blocked", reason: "obstacles-required" }
      : facts.busy.isManagedModeBusy
        ? { state: "busy", reason: "managed-lock" }
        : normalCapability,
    oneClickClear: deriveGraphwarOneClickClearCapability(facts, preferences, sceneReason),
    managedMode: deriveGraphwarManagedModeCapability(facts, preferences),
  };
}

/** 保留偏好可配置，同时将当前不生效的寻路前置条件标记为休眠。 */
function deriveGraphwarPathPlanningCapability(
  facts: GraphwarCapabilityFacts,
  preferences: GraphwarCapabilityPreferences,
  sceneReason: GraphwarCapabilityReason | undefined,
): GraphwarControlCapability {
  if (facts.busy.isManagedModeBusy) {
    return { state: "busy", reason: "managed-lock" };
  }
  if (facts.busy.isPathfindingBusy) {
    return { state: "busy", reason: "pathfinding-busy" };
  }
  if (facts.workflowMode === "simulator") {
    return { state: "dormant", reason: "solver-required" };
  }
  if (preferences.isPathPlanningEnabled && sceneReason) {
    return { state: "dormant", reason: sceneReason };
  }
  if (preferences.isPathPlanningEnabled && !facts.formula.isSettingsValid) {
    return { state: "dormant", reason: "formula-settings-invalid" };
  }
  if (preferences.isPathPlanningEnabled && !facts.pathfinding.hasValidObstacleTolerances) {
    return { state: "dormant", reason: "obstacle-tolerances-invalid" };
  }
  return normalCapability;
}

/** 应用一键清图自身的强制寻路条件，不读取手动交互开关。 */
function deriveGraphwarOneClickClearCapability(
  facts: GraphwarCapabilityFacts,
  preferences: GraphwarCapabilityPreferences,
  sceneReason: GraphwarCapabilityReason | undefined,
): GraphwarControlCapability {
  if (facts.workflowMode === "simulator") {
    return { state: "blocked", reason: "solver-required" };
  }
  if (sceneReason) {
    return { state: "blocked", reason: sceneReason };
  }
  if (!facts.scene.hasSoldiers) {
    return { state: "blocked", reason: "soldiers-required" };
  }
  if (!facts.pathfinding.hasPathStart) {
    return { state: "blocked", reason: "path-start-required" };
  }
  if (!facts.formula.isOneClickClearSupported) {
    return { state: "blocked", reason: "formula-unsupported" };
  }
  if (!facts.formula.isSettingsValid) {
    return { state: "blocked", reason: "formula-settings-invalid" };
  }
  // 手动 ODE 邪道使用固定扫描器，不会构建普通 DAG。
  if (!facts.formula.isStepGlitchRoutingUsed && !facts.pathfinding.isWorkerCountValid) {
    return { state: "blocked", reason: "pathfinding-worker-count-invalid" };
  }
  if (!facts.pathfinding.hasValidObstacleTolerances) {
    return { state: "blocked", reason: "obstacle-tolerances-invalid" };
  }
  if (preferences.isDeleteOptimizationEnabled && !facts.pathfinding.isDeleteCheckRadiusValid) {
    return { state: "blocked", reason: "delete-check-radius-invalid" };
  }
  if (facts.busy.isManagedModeBusy) {
    return { state: "busy", reason: "managed-lock" };
  }
  if (facts.busy.isPathfindingBusy) {
    return { state: "busy", reason: "pathfinding-busy" };
  }
  return normalCapability;
}

/** 关闭时无条件允许操作；开启时校验未来 Agent 所选 profile 可能消费的全部设定。 */
function deriveGraphwarManagedModeCapability(
  facts: GraphwarCapabilityFacts,
  preferences: GraphwarCapabilityPreferences,
): GraphwarControlCapability {
  if (facts.busy.isManagedModeBusy) {
    return normalCapability;
  }
  if (facts.workflowMode === "simulator") {
    return { state: "blocked", reason: "solver-required" };
  }
  if (!facts.agent.isEnabled) {
    return { state: "blocked", reason: "agent-disabled" };
  }
  if (!facts.agent.normalizedBaseUrl) {
    return { state: "blocked", reason: "agent-url-invalid" };
  }
  if (!facts.formula.isManagedSettingsValid) {
    return { state: "blocked", reason: "formula-settings-invalid" };
  }
  if (!facts.pathfinding.isManagedTimingValid) {
    return { state: "blocked", reason: "managed-timing-invalid" };
  }
  // 托管模式始终校验 DAG 容量，因为 Agent 后续回合可能选择普通 profile。
  if (!facts.pathfinding.isWorkerCountValid) {
    return { state: "blocked", reason: "pathfinding-worker-count-invalid" };
  }
  if (!facts.pathfinding.hasValidObstacleTolerances) {
    return { state: "blocked", reason: "obstacle-tolerances-invalid" };
  }
  if (preferences.isDeleteOptimizationEnabled && !facts.pathfinding.isDeleteCheckRadiusValid) {
    return { state: "blocked", reason: "delete-check-radius-invalid" };
  }
  if (facts.busy.isPathfindingBusy) {
    return { state: "busy", reason: "pathfinding-busy" };
  }
  if (facts.busy.isAgentReadBusy) {
    return { state: "busy", reason: "agent-read-busy" };
  }
  if (facts.busy.isAgentFireBusy) {
    return { state: "busy", reason: "agent-fire-busy" };
  }
  return normalCapability;
}
