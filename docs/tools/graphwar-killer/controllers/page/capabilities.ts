import type { ToolWorkflowMode } from "../../core/types";

/** The page's selected scene source; Agent configuration is tracked independently. */
export type GraphwarSceneSource = "screenshot" | "agent";

/** Minimal identity retained with recognised scene data so stale Agent data cannot qualify new commands. */
export type GraphwarSceneProvenance =
  | { source: "screenshot" }
  | {
      source: "agent";
      normalizedAgentBaseUrl: string;
      gameInstanceId: string;
      battleRevision: string;
    };

/** Stable, locale-independent reasons shared by visible messages and command guards. */
export type GraphwarCapabilityReason =
  | "managed-lock"
  | "pathfinding-busy"
  | "agent-read-busy"
  | "agent-fire-busy"
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
  | "pathfinding-worker-count-invalid"
  | "obstacle-tolerances-invalid"
  | "delete-check-radius-invalid";

/** A control's complete interaction state; disabled remains a presentation-layer derivation. */
export type GraphwarControlCapability =
  | { state: "normal"; reason?: never }
  | { state: "blocked"; reason?: GraphwarCapabilityReason }
  | { state: "dormant" | "busy"; reason: GraphwarCapabilityReason };

/** Plain page facts consumed by capability derivation without importing Vue or localisation. */
export interface GraphwarCapabilityFacts {
  workflowMode: ToolWorkflowMode;
  activeSource: GraphwarSceneSource;
  scene: {
    imageAvailable: boolean;
    boundsAvailable: boolean;
    soldiersAvailable: boolean;
    obstaclesAvailable: boolean;
    provenance?: GraphwarSceneProvenance;
  };
  agent: {
    enabled: boolean;
    /** Present only when the enabled Agent URL parsed and was normalised successfully. */
    normalizedBaseUrl?: string;
  };
  formula: {
    settingsValid: boolean;
    /** Includes dormant settings that a later Agent-selected managed profile may consume. */
    managedSettingsValid: boolean;
    oneClickClearSupported: boolean;
    /** True only for an effective Step ODE glitch configuration. */
    usesStepGlitchRouting: boolean;
  };
  pathfinding: {
    pathStartAvailable: boolean;
    workerCountValid: boolean;
    obstacleTolerancesValid: boolean;
    deleteCheckRadiusValid: boolean;
  };
  resultAvailable: boolean;
  busy: {
    pathfinding: boolean;
    agentRead: boolean;
    agentExport: boolean;
    agentFire: boolean;
    managedMode: boolean;
  };
}

/** Preferences needed to decide whether a retained value currently has an effect. */
export interface GraphwarCapabilityPreferences {
  snapSoldiersEnabled: boolean;
  collisionCheckEnabled: boolean;
  pathPlanningEnabled: boolean;
  deleteOptimizationEnabled: boolean;
}

/** First-phase capabilities consumed by controls, visible reasons, and guarded commands. */
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

/** Checks both source and normalised URL; configuration alone never proves that Agent scene data is current. */
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

/** Returns the first scene action required before a forced-collision pathfinding command may run. */
function getGraphwarPathfindingSceneReason(facts: GraphwarCapabilityFacts): GraphwarCapabilityReason | undefined {
  if (facts.activeSource === "agent") {
    if (!facts.agent.enabled) {
      return "agent-disabled";
    }
    if (!facts.agent.normalizedBaseUrl) {
      return "agent-url-invalid";
    }
    if (!isCurrentGraphwarAgentScene(facts.agent.normalizedBaseUrl, facts.scene.provenance)) {
      return "agent-scene-required";
    }
  } else if (!facts.scene.imageAvailable) {
    return "image-required";
  }

  if (!facts.scene.boundsAvailable) {
    return "bounds-required";
  }
  // Visible objects from another source may remain on screen, but they cannot qualify the active screenshot workflow.
  if (facts.activeSource === "screenshot" && facts.scene.provenance?.source !== "screenshot") {
    return "obstacles-required";
  }
  if (!facts.scene.obstaclesAvailable) {
    return "obstacles-required";
  }
  return undefined;
}

/** Derives every first-phase state with explicit command-specific priority and no hidden mutable state. */
export function deriveGraphwarCapabilities(
  facts: GraphwarCapabilityFacts,
  preferences: GraphwarCapabilityPreferences,
): GraphwarCapabilities {
  const sceneReason = getGraphwarPathfindingSceneReason(facts);

  return {
    semanticControls: facts.busy.managedMode ? { state: "busy", reason: "managed-lock" } : normalCapability,
    agentRead: facts.busy.managedMode
      ? { state: "busy", reason: "managed-lock" }
      : facts.busy.agentRead || facts.busy.agentExport
        ? { state: "busy", reason: "agent-read-busy" }
        : !facts.agent.enabled
          ? { state: "blocked", reason: "agent-disabled" }
          : !facts.agent.normalizedBaseUrl
            ? { state: "blocked", reason: "agent-url-invalid" }
            : normalCapability,
    // 导出只读取 revision 一致的快照而不应用局面，因此可以与托管并行。
    agentExport:
      facts.busy.agentRead || facts.busy.agentExport
        ? { state: "busy", reason: "agent-read-busy" }
        : !facts.agent.enabled
          ? { state: "blocked", reason: "agent-disabled" }
          : !facts.agent.normalizedBaseUrl
            ? { state: "blocked", reason: "agent-url-invalid" }
            : normalCapability,
    agentFire: facts.busy.managedMode
      ? { state: "busy", reason: "managed-lock" }
      : facts.busy.pathfinding
        ? { state: "busy", reason: "pathfinding-busy" }
        : facts.busy.agentFire
          ? { state: "busy", reason: "agent-fire-busy" }
          : !facts.agent.enabled
            ? { state: "blocked", reason: "agent-disabled" }
            : !facts.agent.normalizedBaseUrl
              ? { state: "blocked", reason: "agent-url-invalid" }
              : !facts.formula.settingsValid
                ? { state: "blocked", reason: "formula-settings-invalid" }
                : !facts.resultAvailable
                  ? { state: "blocked" }
                  : normalCapability,
    snapSoldiers: facts.busy.managedMode
      ? { state: "busy", reason: "managed-lock" }
      : preferences.snapSoldiersEnabled && !facts.scene.soldiersAvailable
        ? { state: "dormant", reason: "soldiers-required" }
        : normalCapability,
    collisionCheck: facts.busy.managedMode
      ? { state: "busy", reason: "managed-lock" }
      : preferences.collisionCheckEnabled && !facts.scene.obstaclesAvailable
        ? { state: "dormant", reason: "obstacles-required" }
        : normalCapability,
    pathPlanning: deriveGraphwarPathPlanningCapability(facts, preferences, sceneReason),
    obstacleEditing: facts.busy.managedMode
      ? { state: "busy", reason: "managed-lock" }
      : !facts.scene.obstaclesAvailable
        ? { state: "blocked", reason: "obstacles-required" }
        : normalCapability,
    oneClickClear: deriveGraphwarOneClickClearCapability(facts, preferences, sceneReason),
    managedMode: deriveGraphwarManagedModeCapability(facts, preferences),
  };
}

/** Keeps the preference configurable while marking every currently ineffective path-planning prerequisite dormant. */
function deriveGraphwarPathPlanningCapability(
  facts: GraphwarCapabilityFacts,
  preferences: GraphwarCapabilityPreferences,
  sceneReason: GraphwarCapabilityReason | undefined,
): GraphwarControlCapability {
  if (facts.busy.managedMode) {
    return { state: "busy", reason: "managed-lock" };
  }
  if (facts.busy.pathfinding) {
    return { state: "busy", reason: "pathfinding-busy" };
  }
  if (facts.workflowMode === "simulator") {
    return { state: "dormant", reason: "solver-required" };
  }
  if (!preferences.pathPlanningEnabled) {
    return normalCapability;
  }
  if (sceneReason) {
    return { state: "dormant", reason: sceneReason };
  }
  if (!facts.formula.settingsValid) {
    return { state: "dormant", reason: "formula-settings-invalid" };
  }
  if (!facts.pathfinding.obstacleTolerancesValid) {
    return { state: "dormant", reason: "obstacle-tolerances-invalid" };
  }
  return normalCapability;
}

/** Applies one-click clear's own forced-pathfinding requirements without consulting manual interaction switches. */
function deriveGraphwarOneClickClearCapability(
  facts: GraphwarCapabilityFacts,
  preferences: GraphwarCapabilityPreferences,
  sceneReason: GraphwarCapabilityReason | undefined,
): GraphwarControlCapability {
  if (facts.busy.managedMode) {
    return { state: "busy", reason: "managed-lock" };
  }
  if (facts.busy.pathfinding) {
    return { state: "busy", reason: "pathfinding-busy" };
  }
  if (facts.workflowMode === "simulator") {
    return { state: "blocked", reason: "solver-required" };
  }
  if (sceneReason) {
    return { state: "blocked", reason: sceneReason };
  }
  if (!facts.scene.soldiersAvailable) {
    return { state: "blocked", reason: "soldiers-required" };
  }
  if (!facts.pathfinding.pathStartAvailable) {
    return { state: "blocked", reason: "path-start-required" };
  }
  if (!facts.formula.oneClickClearSupported) {
    return { state: "blocked", reason: "formula-unsupported" };
  }
  if (!facts.formula.settingsValid) {
    return { state: "blocked", reason: "formula-settings-invalid" };
  }
  // Manual Step ODE glitch routing uses its fixed scan and does not build the ordinary DAG.
  if (!facts.formula.usesStepGlitchRouting && !facts.pathfinding.workerCountValid) {
    return { state: "blocked", reason: "pathfinding-worker-count-invalid" };
  }
  if (!facts.pathfinding.obstacleTolerancesValid) {
    return { state: "blocked", reason: "obstacle-tolerances-invalid" };
  }
  if (preferences.deleteOptimizationEnabled && !facts.pathfinding.deleteCheckRadiusValid) {
    return { state: "blocked", reason: "delete-check-radius-invalid" };
  }
  return normalCapability;
}

/** Allows shutdown unconditionally, but validates all settings a future Agent-selected profile may consume on startup. */
function deriveGraphwarManagedModeCapability(
  facts: GraphwarCapabilityFacts,
  preferences: GraphwarCapabilityPreferences,
): GraphwarControlCapability {
  if (facts.busy.managedMode) {
    return normalCapability;
  }
  if (facts.busy.pathfinding) {
    return { state: "busy", reason: "pathfinding-busy" };
  }
  if (facts.busy.agentRead) {
    return { state: "busy", reason: "agent-read-busy" };
  }
  if (facts.busy.agentFire) {
    return { state: "busy", reason: "agent-fire-busy" };
  }
  if (facts.workflowMode === "simulator") {
    return { state: "blocked", reason: "solver-required" };
  }
  if (!facts.agent.enabled) {
    return { state: "blocked", reason: "agent-disabled" };
  }
  if (!facts.agent.normalizedBaseUrl) {
    return { state: "blocked", reason: "agent-url-invalid" };
  }
  if (!facts.formula.managedSettingsValid) {
    return { state: "blocked", reason: "formula-settings-invalid" };
  }
  // Managed mode always validates DAG capacity because the Agent may select an ordinary profile on a later turn.
  if (!facts.pathfinding.workerCountValid) {
    return { state: "blocked", reason: "pathfinding-worker-count-invalid" };
  }
  if (!facts.pathfinding.obstacleTolerancesValid) {
    return { state: "blocked", reason: "obstacle-tolerances-invalid" };
  }
  if (preferences.deleteOptimizationEnabled && !facts.pathfinding.deleteCheckRadiusValid) {
    return { state: "blocked", reason: "delete-check-radius-invalid" };
  }
  return normalCapability;
}
