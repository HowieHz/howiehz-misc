import { describe, expect, it } from "vitest";

import {
  deriveGraphwarCapabilities,
  isCurrentGraphwarAgentScene,
  type GraphwarCapabilities,
  type GraphwarCapabilityFacts,
  type GraphwarCapabilityPreferences,
  type GraphwarControlCapability,
} from "./capabilities";

const currentAgentProvenance = {
  source: "agent",
  normalizedAgentBaseUrl: "http://127.0.0.1:17900",
  gameInstanceId: "game-1",
  battleRevision: "sha256:battle-1",
} as const;

type GraphwarCapabilityFactsOverrides = Omit<
  Partial<GraphwarCapabilityFacts>,
  "scene" | "agent" | "formula" | "pathfinding" | "busy"
> & {
  scene?: Partial<GraphwarCapabilityFacts["scene"]>;
  agent?: Partial<GraphwarCapabilityFacts["agent"]>;
  formula?: Partial<GraphwarCapabilityFacts["formula"]>;
  pathfinding?: Partial<GraphwarCapabilityFacts["pathfinding"]>;
  busy?: Partial<GraphwarCapabilityFacts["busy"]>;
};

/** Creates a complete Solver scene so each table entry changes only facts relevant to the asserted rule. */
function createFacts(overrides: GraphwarCapabilityFactsOverrides = {}): GraphwarCapabilityFacts {
  return {
    workflowMode: overrides.workflowMode ?? "solver",
    activeSource: overrides.activeSource ?? "screenshot",
    scene: {
      hasImage: true,
      hasBounds: true,
      hasSoldiers: true,
      hasObstacles: true,
      provenance: { source: "screenshot" },
      ...overrides.scene,
    },
    agent: {
      isEnabled: true,
      normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl,
      ...overrides.agent,
    },
    formula: {
      isManagedSettingsValid: true,
      isSettingsValid: true,
      isOneClickClearSupported: true,
      isStepGlitchRoutingUsed: false,
      ...overrides.formula,
    },
    pathfinding: {
      hasPathStart: true,
      hasValidObstacleTolerances: true,
      isDeleteCheckRadiusValid: true,
      isManagedTimingValid: true,
      isWorkerCountValid: true,
      ...overrides.pathfinding,
    },
    hasResult: overrides.hasResult ?? true,
    busy: {
      isAgentExportBusy: false,
      isAgentFireBusy: false,
      isAgentReadBusy: false,
      isManagedModeBusy: false,
      isPathfindingBusy: false,
      ...overrides.busy,
    },
  };
}

/** Creates enabled interaction preferences while keeping deletion opt-in explicit. */
function createPreferences(overrides: Partial<GraphwarCapabilityPreferences> = {}): GraphwarCapabilityPreferences {
  return {
    isSnapSoldiersEnabled: true,
    isCollisionCheckEnabled: true,
    isPathPlanningEnabled: true,
    isDeleteOptimizationEnabled: false,
    ...overrides,
  };
}

/** Reads one named capability without recursively traversing the result object. */
function deriveCapability(
  name: keyof GraphwarCapabilities,
  facts: GraphwarCapabilityFacts,
  preferences = createPreferences(),
): GraphwarControlCapability {
  return deriveGraphwarCapabilities(facts, preferences)[name];
}

describe("Graphwar capabilities", () => {
  it("derives normal controls for a complete supported Solver scene", () => {
    expect(deriveGraphwarCapabilities(createFacts(), createPreferences())).toEqual({
      semanticControls: { state: "normal" },
      agentRead: { state: "normal" },
      agentExport: { state: "normal" },
      agentFire: { state: "normal" },
      snapSoldiers: { state: "normal" },
      collisionCheck: { state: "normal" },
      pathPlanning: { state: "normal" },
      obstacleEditing: { state: "normal" },
      oneClickClear: { state: "normal" },
      managedMode: { state: "normal" },
    });
  });

  it("blocks managed mode on a dormant formula setting without blocking the current one-click command", () => {
    const capabilities = deriveGraphwarCapabilities(
      createFacts({ formula: { isManagedSettingsValid: false, isSettingsValid: true } }),
      createPreferences(),
    );

    expect(capabilities.oneClickClear).toEqual({ state: "normal" });
    expect(capabilities.managedMode).toEqual({ state: "blocked", reason: "formula-settings-invalid" });
  });

  it("blocks only managed mode when managed timing is invalid", () => {
    const capabilities = deriveGraphwarCapabilities(
      createFacts({ pathfinding: { isManagedTimingValid: false } }),
      createPreferences(),
    );

    expect(capabilities.pathPlanning).toEqual({ state: "normal" });
    expect(capabilities.oneClickClear).toEqual({ state: "normal" });
    expect(capabilities.managedMode).toEqual({ state: "blocked", reason: "managed-timing-invalid" });
  });

  it.each([
    ["snapSoldiers", { scene: { hasSoldiers: false } }, { state: "dormant", reason: "soldiers-required" }],
    ["collisionCheck", { scene: { hasObstacles: false } }, { state: "dormant", reason: "obstacles-required" }],
    ["obstacleEditing", { scene: { hasObstacles: false } }, { state: "blocked", reason: "obstacles-required" }],
    ["agentRead", { agent: { isEnabled: false } }, { state: "blocked", reason: "agent-disabled" }],
    ["agentRead", { agent: { normalizedBaseUrl: undefined } }, { state: "blocked", reason: "agent-url-invalid" }],
    ["agentExport", { agent: { isEnabled: false } }, { state: "blocked", reason: "agent-disabled" }],
    ["agentExport", { agent: { normalizedBaseUrl: undefined } }, { state: "blocked", reason: "agent-url-invalid" }],
    ["agentFire", { hasResult: false }, { state: "blocked" }],
  ] satisfies [keyof GraphwarCapabilities, GraphwarCapabilityFactsOverrides, GraphwarControlCapability][])(
    "derives %s's local control state",
    (name, overrides, expected) => {
      expect(deriveCapability(name, createFacts(overrides))).toEqual(expected);
    },
  );

  it("keeps disabled preferences normal when missing data has no retained effect to suspend", () => {
    const capabilities = deriveGraphwarCapabilities(
      createFacts({
        scene: {
          hasImage: false,
          hasBounds: false,
          hasSoldiers: false,
          hasObstacles: false,
        },
      }),
      createPreferences({
        isSnapSoldiersEnabled: false,
        isCollisionCheckEnabled: false,
        isPathPlanningEnabled: false,
      }),
    );

    expect(capabilities.snapSoldiers).toEqual({ state: "normal" });
    expect(capabilities.collisionCheck).toEqual({ state: "normal" });
    expect(capabilities.pathPlanning).toEqual({ state: "normal" });
  });

  it("keeps path planning configurable while glitch routing is effective", () => {
    expect(
      deriveCapability(
        "pathPlanning",
        createFacts({ formula: { isStepGlitchRoutingUsed: true } }),
        createPreferences({ isPathPlanningEnabled: false }),
      ),
    ).toEqual({ state: "normal" });
  });

  it.each([
    [
      { hasImage: false, hasBounds: false, hasObstacles: false },
      { state: "dormant", reason: "image-required" },
      { state: "blocked", reason: "image-required" },
    ],
    [
      { hasImage: true, hasBounds: false, hasObstacles: false },
      { state: "dormant", reason: "bounds-required" },
      { state: "blocked", reason: "bounds-required" },
    ],
    [
      { hasImage: true, hasBounds: true, hasObstacles: false },
      { state: "dormant", reason: "obstacles-required" },
      { state: "blocked", reason: "obstacles-required" },
    ],
  ] satisfies [Partial<GraphwarCapabilityFacts["scene"]>, GraphwarControlCapability, GraphwarControlCapability][])(
    "uses the first actionable screenshot prerequisite",
    (scene, pathPlanning, oneClickClear) => {
      const capabilities = deriveGraphwarCapabilities(createFacts({ scene }), createPreferences());

      expect(capabilities.pathPlanning).toEqual(pathPlanning);
      expect(capabilities.oneClickClear).toEqual(oneClickClear);
    },
  );

  it.each([
    [
      { scene: { hasSoldiers: false }, pathfinding: { hasPathStart: false }, formula: {} },
      { state: "blocked", reason: "soldiers-required" },
    ],
    [
      { pathfinding: { hasPathStart: false }, formula: { isOneClickClearSupported: false } },
      { state: "blocked", reason: "path-start-required" },
    ],
    [
      { formula: { isOneClickClearSupported: false, isSettingsValid: false } },
      { state: "blocked", reason: "formula-unsupported" },
    ],
    [
      { formula: { isSettingsValid: false }, pathfinding: { isWorkerCountValid: false } },
      { state: "blocked", reason: "formula-settings-invalid" },
    ],
    [
      { pathfinding: { isWorkerCountValid: false, hasValidObstacleTolerances: false } },
      { state: "blocked", reason: "pathfinding-worker-count-invalid" },
    ],
  ] satisfies [GraphwarCapabilityFactsOverrides, GraphwarControlCapability][])(
    "returns only one ordered one-click-clear reason",
    (overrides, expected) => {
      expect(deriveCapability("oneClickClear", createFacts(overrides))).toEqual(expected);
    },
  );

  it("shows busy ownership before missing prerequisites", () => {
    const capabilities = deriveGraphwarCapabilities(
      createFacts({
        workflowMode: "simulator",
        scene: {
          hasImage: false,
          hasBounds: false,
          hasSoldiers: false,
          hasObstacles: false,
        },
        agent: { isEnabled: false, normalizedBaseUrl: undefined },
        busy: { isPathfindingBusy: true, isAgentReadBusy: true, isAgentFireBusy: true, isManagedModeBusy: false },
      }),
      createPreferences(),
    );

    expect(capabilities.pathPlanning).toEqual({ state: "busy", reason: "pathfinding-busy" });
    expect(capabilities.agentFire).toEqual({ state: "busy", reason: "pathfinding-busy" });
    expect(capabilities.oneClickClear).toEqual({ state: "busy", reason: "pathfinding-busy" });
    expect(capabilities.managedMode).toEqual({ state: "busy", reason: "pathfinding-busy" });
  });

  it.each([
    [undefined, false],
    [{ source: "screenshot" } as const, false],
    [currentAgentProvenance, true],
    [{ ...currentAgentProvenance, normalizedAgentBaseUrl: "http://127.0.0.1:18000" }, false],
  ])("qualifies Agent provenance only for the active normalised URL", (provenance, expected) => {
    expect(isCurrentGraphwarAgentScene(currentAgentProvenance.normalizedAgentBaseUrl, provenance)).toBe(expected);
  });

  it("keeps stale Agent objects visible without qualifying the screenshot workflow", () => {
    expect(
      deriveCapability(
        "pathPlanning",
        createFacts({ activeSource: "screenshot", scene: { provenance: currentAgentProvenance } }),
      ),
    ).toEqual({ state: "dormant", reason: "obstacles-required" });
  });

  it.each([
    [
      { isEnabled: false, normalizedBaseUrl: undefined },
      currentAgentProvenance,
      { state: "dormant", reason: "agent-disabled" },
    ],
    [
      { isEnabled: true, normalizedBaseUrl: undefined },
      currentAgentProvenance,
      { state: "dormant", reason: "agent-url-invalid" },
    ],
    [
      { isEnabled: true, normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl },
      undefined,
      { state: "dormant", reason: "agent-scene-required" },
    ],
    [
      { isEnabled: true, normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl },
      { source: "screenshot" } as const,
      { state: "dormant", reason: "agent-scene-required" },
    ],
    [
      { isEnabled: true, normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl },
      { ...currentAgentProvenance, normalizedAgentBaseUrl: "http://127.0.0.1:18000" },
      { state: "dormant", reason: "agent-scene-required" },
    ],
    [
      { isEnabled: true, normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl },
      currentAgentProvenance,
      { state: "normal" },
    ],
  ] satisfies [
    GraphwarCapabilityFacts["agent"],
    GraphwarCapabilityFacts["scene"]["provenance"],
    GraphwarControlCapability,
  ][])("separates Agent configuration from current scene provenance", (agent, provenance, expected) => {
    expect(
      deriveCapability("pathPlanning", createFacts({ activeSource: "agent", agent, scene: { provenance } })),
    ).toEqual(expected);
  });

  it("keeps Agent identity facts explicit after URL qualification", () => {
    expect(currentAgentProvenance).toMatchObject({
      source: "agent",
      gameInstanceId: "game-1",
      battleRevision: "sha256:battle-1",
    });
  });

  it("makes Simulator path planning dormant while blocking Solver-only tasks", () => {
    const capabilities = deriveGraphwarCapabilities(createFacts({ workflowMode: "simulator" }), createPreferences());

    expect(capabilities.pathPlanning).toEqual({ state: "dormant", reason: "solver-required" });
    expect(capabilities.oneClickClear).toEqual({ state: "blocked", reason: "solver-required" });
    expect(capabilities.managedMode).toEqual({ state: "blocked", reason: "solver-required" });
    expect(capabilities.collisionCheck).toEqual({ state: "normal" });
  });

  it("does not make one-click clear or managed mode depend on path planning or manual collision", () => {
    const capabilities = deriveGraphwarCapabilities(
      createFacts(),
      createPreferences({ isPathPlanningEnabled: false, isCollisionCheckEnabled: false }),
    );

    expect(capabilities.pathPlanning).toEqual({ state: "normal" });
    expect(capabilities.oneClickClear).toEqual({ state: "normal" });
    expect(capabilities.managedMode).toEqual({ state: "normal" });
  });

  it("allows managed polling without a scene while keeping one-click clear scene-bound", () => {
    const capabilities = deriveGraphwarCapabilities(
      createFacts({
        activeSource: "agent",
        scene: {
          hasImage: false,
          hasBounds: false,
          hasSoldiers: false,
          hasObstacles: false,
          provenance: undefined,
        },
      }),
      createPreferences(),
    );

    expect(capabilities.oneClickClear).toEqual({ state: "blocked", reason: "agent-scene-required" });
    expect(capabilities.managedMode).toEqual({ state: "normal" });
  });

  it("lets managed repair unsupported profiles without weakening the manual command guard", () => {
    const capabilities = deriveGraphwarCapabilities(
      createFacts({ formula: { isOneClickClearSupported: false } }),
      createPreferences(),
    );

    expect(capabilities.oneClickClear).toEqual({ state: "blocked", reason: "formula-unsupported" });
    expect(capabilities.managedMode).toEqual({ state: "normal" });
  });

  it("ignores the DAG worker count only for manual Step y' glitch one-click clear", () => {
    const facts = createFacts({
      formula: { isStepGlitchRoutingUsed: true },
      pathfinding: { isWorkerCountValid: false },
    });
    const capabilities = deriveGraphwarCapabilities(facts, createPreferences());

    expect(capabilities.oneClickClear).toEqual({ state: "normal" });
    expect(capabilities.managedMode).toEqual({
      state: "blocked",
      reason: "pathfinding-worker-count-invalid",
    });
  });

  it.each([
    [false, { state: "normal" }, { state: "normal" }],
    [
      true,
      { state: "blocked", reason: "delete-check-radius-invalid" },
      { state: "blocked", reason: "delete-check-radius-invalid" },
    ],
  ] satisfies [boolean, GraphwarControlCapability, GraphwarControlCapability][])(
    "validates deletion radius only while deletion optimisation is %s",
    (isDeleteOptimizationEnabled, oneClickClear, managedMode) => {
      const capabilities = deriveGraphwarCapabilities(
        createFacts({ pathfinding: { isDeleteCheckRadiusValid: false } }),
        createPreferences({ isDeleteOptimizationEnabled }),
      );

      expect(capabilities.pathPlanning).toEqual({ state: "normal" });
      expect(capabilities.oneClickClear).toEqual(oneClickClear);
      expect(capabilities.managedMode).toEqual(managedMode);
    },
  );

  it("locks semantic controls while always allowing managed mode to stop", () => {
    const capabilities = deriveGraphwarCapabilities(
      createFacts({
        workflowMode: "simulator",
        agent: { isEnabled: false, normalizedBaseUrl: undefined },
        busy: { isManagedModeBusy: true },
      }),
      createPreferences(),
    );

    expect(capabilities.semanticControls).toEqual({ state: "busy", reason: "managed-lock" });
    expect(capabilities.agentRead).toEqual({ state: "busy", reason: "managed-lock" });
    expect(capabilities.agentExport).toEqual({ state: "blocked", reason: "agent-disabled" });
    expect(capabilities.oneClickClear).toEqual({ state: "busy", reason: "managed-lock" });
    expect(capabilities.managedMode).toEqual({ state: "normal" });
  });

  it("keeps Agent export available during managed mode while serializing debug transfers", () => {
    expect(deriveCapability("agentExport", createFacts({ busy: { isManagedModeBusy: true } }))).toEqual({
      state: "normal",
    });
    expect(deriveCapability("agentExport", createFacts({ busy: { isAgentReadBusy: true } }))).toEqual({
      state: "busy",
      reason: "agent-read-busy",
    });
    expect(deriveCapability("agentExport", createFacts({ busy: { isAgentExportBusy: true } }))).toEqual({
      state: "busy",
      reason: "agent-read-busy",
    });
  });
});
