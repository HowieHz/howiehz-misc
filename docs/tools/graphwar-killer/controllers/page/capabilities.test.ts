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
      imageAvailable: true,
      boundsAvailable: true,
      soldiersAvailable: true,
      obstaclesAvailable: true,
      provenance: { source: "screenshot" },
      ...overrides.scene,
    },
    agent: {
      enabled: true,
      normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl,
      ...overrides.agent,
    },
    formula: {
      managedSettingsValid: true,
      settingsValid: true,
      oneClickClearSupported: true,
      usesStepGlitchRouting: false,
      ...overrides.formula,
    },
    pathfinding: {
      pathStartAvailable: true,
      workerCountValid: true,
      obstacleTolerancesValid: true,
      deleteCheckRadiusValid: true,
      ...overrides.pathfinding,
    },
    resultAvailable: overrides.resultAvailable ?? true,
    busy: {
      pathfinding: false,
      agentRead: false,
      agentExport: false,
      agentFire: false,
      managedMode: false,
      ...overrides.busy,
    },
  };
}

/** Creates enabled interaction preferences while keeping deletion opt-in explicit. */
function createPreferences(overrides: Partial<GraphwarCapabilityPreferences> = {}): GraphwarCapabilityPreferences {
  return {
    snapSoldiersEnabled: true,
    collisionCheckEnabled: true,
    pathPlanningEnabled: true,
    deleteOptimizationEnabled: false,
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
      createFacts({ formula: { managedSettingsValid: false, settingsValid: true } }),
      createPreferences(),
    );

    expect(capabilities.oneClickClear).toEqual({ state: "normal" });
    expect(capabilities.managedMode).toEqual({ state: "blocked", reason: "formula-settings-invalid" });
  });

  it.each([
    ["snapSoldiers", { scene: { soldiersAvailable: false } }, { state: "dormant", reason: "soldiers-required" }],
    ["collisionCheck", { scene: { obstaclesAvailable: false } }, { state: "dormant", reason: "obstacles-required" }],
    ["obstacleEditing", { scene: { obstaclesAvailable: false } }, { state: "blocked", reason: "obstacles-required" }],
    ["agentRead", { agent: { enabled: false } }, { state: "blocked", reason: "agent-disabled" }],
    ["agentRead", { agent: { normalizedBaseUrl: undefined } }, { state: "blocked", reason: "agent-url-invalid" }],
    ["agentExport", { agent: { enabled: false } }, { state: "blocked", reason: "agent-disabled" }],
    ["agentExport", { agent: { normalizedBaseUrl: undefined } }, { state: "blocked", reason: "agent-url-invalid" }],
    ["agentFire", { resultAvailable: false }, { state: "blocked" }],
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
          imageAvailable: false,
          boundsAvailable: false,
          soldiersAvailable: false,
          obstaclesAvailable: false,
        },
      }),
      createPreferences({
        snapSoldiersEnabled: false,
        collisionCheckEnabled: false,
        pathPlanningEnabled: false,
      }),
    );

    expect(capabilities.snapSoldiers).toEqual({ state: "normal" });
    expect(capabilities.collisionCheck).toEqual({ state: "normal" });
    expect(capabilities.pathPlanning).toEqual({ state: "normal" });
  });

  it.each([
    [
      { imageAvailable: false, boundsAvailable: false, obstaclesAvailable: false },
      { state: "dormant", reason: "image-required" },
      { state: "blocked", reason: "image-required" },
    ],
    [
      { imageAvailable: true, boundsAvailable: false, obstaclesAvailable: false },
      { state: "dormant", reason: "bounds-required" },
      { state: "blocked", reason: "bounds-required" },
    ],
    [
      { imageAvailable: true, boundsAvailable: true, obstaclesAvailable: false },
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
      { scene: { soldiersAvailable: false }, pathfinding: { pathStartAvailable: false }, formula: {} },
      { state: "blocked", reason: "soldiers-required" },
    ],
    [
      { pathfinding: { pathStartAvailable: false }, formula: { oneClickClearSupported: false } },
      { state: "blocked", reason: "path-start-required" },
    ],
    [
      { formula: { oneClickClearSupported: false, settingsValid: false } },
      { state: "blocked", reason: "formula-unsupported" },
    ],
    [
      { formula: { settingsValid: false }, pathfinding: { workerCountValid: false } },
      { state: "blocked", reason: "formula-settings-invalid" },
    ],
    [
      { pathfinding: { workerCountValid: false, obstacleTolerancesValid: false } },
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
          imageAvailable: false,
          boundsAvailable: false,
          soldiersAvailable: false,
          obstaclesAvailable: false,
        },
        agent: { enabled: false, normalizedBaseUrl: undefined },
        busy: { pathfinding: true, agentRead: true, agentFire: true, managedMode: false },
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
      { enabled: false, normalizedBaseUrl: undefined },
      currentAgentProvenance,
      { state: "dormant", reason: "agent-disabled" },
    ],
    [
      { enabled: true, normalizedBaseUrl: undefined },
      currentAgentProvenance,
      { state: "dormant", reason: "agent-url-invalid" },
    ],
    [
      { enabled: true, normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl },
      undefined,
      { state: "dormant", reason: "agent-scene-required" },
    ],
    [
      { enabled: true, normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl },
      { source: "screenshot" } as const,
      { state: "dormant", reason: "agent-scene-required" },
    ],
    [
      { enabled: true, normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl },
      { ...currentAgentProvenance, normalizedAgentBaseUrl: "http://127.0.0.1:18000" },
      { state: "dormant", reason: "agent-scene-required" },
    ],
    [
      { enabled: true, normalizedBaseUrl: currentAgentProvenance.normalizedAgentBaseUrl },
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
      createPreferences({ pathPlanningEnabled: false, collisionCheckEnabled: false }),
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
          imageAvailable: false,
          boundsAvailable: false,
          soldiersAvailable: false,
          obstaclesAvailable: false,
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
      createFacts({ formula: { oneClickClearSupported: false } }),
      createPreferences(),
    );

    expect(capabilities.oneClickClear).toEqual({ state: "blocked", reason: "formula-unsupported" });
    expect(capabilities.managedMode).toEqual({ state: "normal" });
  });

  it("ignores the DAG worker count only for manual Step y' glitch one-click clear", () => {
    const facts = createFacts({
      formula: { usesStepGlitchRouting: true },
      pathfinding: { workerCountValid: false },
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
    (deleteOptimizationEnabled, oneClickClear, managedMode) => {
      const capabilities = deriveGraphwarCapabilities(
        createFacts({ pathfinding: { deleteCheckRadiusValid: false } }),
        createPreferences({ deleteOptimizationEnabled }),
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
        agent: { enabled: false, normalizedBaseUrl: undefined },
        busy: { managedMode: true },
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
    expect(deriveCapability("agentExport", createFacts({ busy: { managedMode: true } }))).toEqual({
      state: "normal",
    });
    expect(deriveCapability("agentExport", createFacts({ busy: { agentRead: true } }))).toEqual({
      state: "busy",
      reason: "agent-read-busy",
    });
    expect(deriveCapability("agentExport", createFacts({ busy: { agentExport: true } }))).toEqual({
      state: "busy",
      reason: "agent-read-busy",
    });
  });
});
