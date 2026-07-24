import { describe, expect, it } from "vitest";

import { graphwarKillerLocale as englishGraphwarKillerLocale } from "../../en/tools/graphwar-killer/locale";
import { graphwarKillerLocale } from "./locale";

const fullPrecisionAngleText = "-64.6230664748477";
const managedTiming = { pollIntervalSeconds: "1", shotReserveSeconds: "3" };
const chineseLocaleStrings: string[] = [];
const pendingChineseLocaleValues: unknown[] = [graphwarKillerLocale];
while (pendingChineseLocaleValues.length > 0) {
  const value = pendingChineseLocaleValues.pop();
  if (typeof value === "string") {
    chineseLocaleStrings.push(value);
  } else if (value && typeof value === "object") {
    pendingChineseLocaleValues.push(...Object.values(value));
  }
}
chineseLocaleStrings.push(
  graphwarKillerLocale.status.secondOrderAngleHint("45"),
  graphwarKillerLocale.status.secondOrderAngleHintTitle("45"),
  graphwarKillerLocale.ui.point.coordinateTitle("路径 1", "x"),
);

const englishCompactTitles: string[] = [];
const pendingEnglishLocaleValues: { key: string; value: unknown }[] = [{ key: "", value: englishGraphwarKillerLocale }];
while (pendingEnglishLocaleValues.length > 0) {
  const current = pendingEnglishLocaleValues.pop();
  if (!current || current.key === "debugDetails" || current.key === "debugStages") continue;
  if (typeof current.value === "string") {
    if (current.key === "title" || current.key.endsWith("Title")) englishCompactTitles.push(current.value);
  } else if (current.value && typeof current.value === "object") {
    for (const [key, value] of Object.entries(current.value)) pendingEnglishLocaleValues.push({ key, value });
  }
}
englishCompactTitles.push(englishGraphwarKillerLocale.ui.point.coordinateTitle("Path 1", "x"));

describe("Chinese Graphwar Killer locale", () => {
  it("describes shared One-Click Clear target assignment in labels and HTML titles", () => {
    expect(graphwarKillerLocale.ui.pathfinding.debugDetails).not.toHaveProperty("build-dag-targets");
    expect(graphwarKillerLocale.ui.pathfinding.debugDetails["assign-clear-targets"]).toEqual({
      label: "- 清图分配目标",
      title: "为全部一键清图模式选择圆心或严格圆内的 x+ 安全边缘，并按同初始 x 稳定分配命中圈控制点",
    });
    expect(graphwarKillerLocale.ui.pathfinding.oneClickClearTitle).toContain("x+ 侧命中圈");
  });

  it("separates game mode names from formula prefixes", () => {
    expect(graphwarKillerLocale.equationModes.map((mode) => mode.label)).toEqual(["y", "y'", "y''"]);
    expect(graphwarKillerLocale.equationModes.map((mode) => mode.formulaPrefix)).toEqual(["y=", "y'=", "y''="]);
  });

  it("describes workflows and per-mode settings directly", () => {
    expect(graphwarKillerLocale.toolWorkflowModes.map((mode) => mode.title)).toEqual([
      "从路径点生成可复制到 Graphwar 的函数",
      "输入函数并预览 Graphwar 轨迹",
    ]);
    expect(englishGraphwarKillerLocale.toolWorkflowModes.map((mode) => mode.title)).toEqual([
      "Generate a Graphwar function from path points",
      "Enter a function and preview its Graphwar trajectory",
    ]);
    expect(graphwarKillerLocale.ui.settings.gameModeSettingsHint).toBe("不同游戏模式的设定会分别保存");
    expect(englishGraphwarKillerLocale.ui.settings.gameModeSettingsHint).toBe(
      "Settings are saved separately for each game mode",
    );
  });

  it("marks only rounded launch angle hints as approximate", () => {
    expect(graphwarKillerLocale.status.secondOrderAngleHint("0.00")).toBe("需要用键盘上下键把发射角调到 0.00°");
    expect(graphwarKillerLocale.status.secondOrderAngleHint("0.00", "1e-27")).toBe(
      "需要用键盘上下键把发射角调到约 0.00°（1e-27°）",
    );
    expect(graphwarKillerLocale.status.secondOrderAngleHint("12.34")).toBe("需要用键盘上下键把发射角调到 12.34°");
    expect(graphwarKillerLocale.status.secondOrderAngleHintTitle(fullPrecisionAngleText)).toBe(
      `需要用键盘上下键把发射角调到 ${fullPrecisionAngleText}°`,
    );
  });

  it("does not expose translatable internal English terms", () => {
    expect(
      [
        ...chineseLocaleStrings.filter((value) => value !== graphwarKillerLocale.ui.pathfinding.debugResultCacheHit),
        graphwarKillerLocale.ui.detection.debugDetails["template-matching-mode"].label("parallel", 4),
        graphwarKillerLocale.ui.detection.debugDetails["template-matching-mode"].label("parallel-fallback", 4),
        graphwarKillerLocale.ui.detection.debugDetails["template-matching-worker"].label(1),
        graphwarKillerLocale.ui.pathfinding.debugDetails["dag-edge-mode"].label("parallel", 4),
        graphwarKillerLocale.ui.pathfinding.debugDetails["dag-edge-mode"].label("parallel-fallback", 4),
        graphwarKillerLocale.ui.pathfinding.debugDetails["dag-edge-worker"].label(1),
      ].filter((value) => /\b(?:Bug|DAG|DP|ImageData|Step|Worker|async|canvas|mask|scanner|worker)\b/.test(value)),
    ).toEqual([]);
  });

  it("does not end compact UI copy with a Chinese full stop", () => {
    expect(chineseLocaleStrings.filter((value) => value.endsWith("。"))).toEqual([]);
  });

  it("lists current managed-mode algorithms before any repairs", () => {
    const settings = [
      { algorithm: "双绝对值函数", equation: "y", properties: [] },
      { algorithm: "阶跃函数", equation: "y'", properties: ["邪道模式"] },
      { algorithm: "阶跃函数", equation: "y''", properties: [] },
    ];
    const supportedConfirmation = graphwarKillerLocale.ui.pathfinding.managedModeConfirmation(
      settings,
      [],
      false,
      managedTiming,
    );
    expect(supportedConfirmation).toContain("在房间内会自动准备");
    expect(supportedConfirmation).toContain("发射预留时间：3 秒\n状态轮询间隔：1 秒");
    expect(supportedConfirmation).toContain("当前算法设定：\ny：双绝对值函数\ny'：阶跃函数（邪道模式）\ny''：阶跃函数");
    expect(
      graphwarKillerLocale.ui.pathfinding.managedModeConfirmation(
        settings,
        [
          { algorithm: "双绝对值函数", equation: "y", properties: [] },
          { algorithm: "阶跃函数", equation: "y'", properties: ["邪道模式"] },
        ],
        true,
        managedTiming,
      ),
    ).toContain(
      "当前算法设定：\ny：双绝对值函数\ny'：阶跃函数（邪道模式）\ny''：阶跃函数\n\n以下游戏模式需要调整算法设定：\ny：当前算法不支持一键清图，将设为双绝对值函数\ny'：当前算法不支持一键清图，将设为阶跃函数（邪道模式）",
    );
  });

  it("uses the configured shot reserve in managed deadline statuses", () => {
    expect(graphwarKillerLocale.smartPathfinding.managed.deadlineFired("10")).toBe(
      "剩余 10 秒中断，已发射当前最优方案",
    );
    expect(graphwarKillerLocale.smartPathfinding.managed.deadlineNoPlan("10")).toBe(
      "剩余 10 秒中断，无法提交跳过回合公式",
    );
    expect(graphwarKillerLocale.smartPathfinding.managed.deadlinePlan("10", "1.2 秒")).toBe(
      "托管计算在剩余 10 秒时中断，已采用当前最优方案，耗时 1.2 秒",
    );
  });
});

describe("English Graphwar Killer locale", () => {
  it("describes shared One-Click Clear target assignment in labels and HTML titles", () => {
    expect(englishGraphwarKillerLocale.ui.pathfinding.debugDetails).not.toHaveProperty("build-dag-targets");
    expect(englishGraphwarKillerLocale.ui.pathfinding.debugDetails["assign-clear-targets"]).toEqual({
      label: "- Assign clear targets",
      title:
        "For every One-Click Clear mode, choose each center or its strict x+ safe edge and stably assign hit-circle control points that share an initial x.",
    });
    expect(englishGraphwarKillerLocale.ui.pathfinding.oneClickClearTitle).toContain("x+ side");
    expect(graphwarKillerLocale.ui.result.turnTimeRemaining("58.0")).toBe("剩余 58.0 秒");
    expect(englishGraphwarKillerLocale.ui.result.turnTimeRemaining("58.0")).toBe("58.0s left");
  });

  it("marks only rounded launch angle hints as approximate", () => {
    expect(englishGraphwarKillerLocale.status.secondOrderAngleHint("0.00")).toBe(
      "Use the Up/Down keys to set the launch angle to 0.00 deg.",
    );
    expect(englishGraphwarKillerLocale.status.secondOrderAngleHint("0.00", "1e-27")).toBe(
      "Use the Up/Down keys to set the launch angle to approximately 0.00 deg (1e-27 deg).",
    );
    expect(englishGraphwarKillerLocale.status.secondOrderAngleHint("12.34")).toBe(
      "Use the Up/Down keys to set the launch angle to 12.34 deg.",
    );
    expect(englishGraphwarKillerLocale.status.secondOrderAngleHintTitle(fullPrecisionAngleText)).toBe(
      `Use the Up/Down keys to set the launch angle to ${fullPrecisionAngleText} deg.`,
    );
  });

  it("keeps ordinary titles compact", () => {
    expect(englishCompactTitles.filter((value) => value.endsWith("."))).toEqual([]);
  });

  it("states that managed mode automatically readies in rooms", () => {
    expect(
      englishGraphwarKillerLocale.ui.pathfinding.managedModeConfirmation(
        [
          { algorithm: "Double Absolute Value", equation: "y", properties: [] },
          { algorithm: "Step", equation: "y'", properties: ["Glitch Mode"] },
          { algorithm: "Step", equation: "y''", properties: [] },
        ],
        [],
        false,
        managedTiming,
      ),
    ).toContain("Automatically readies in rooms");
  });

  it("lists current managed-mode algorithms before any repairs", () => {
    expect(
      englishGraphwarKillerLocale.ui.pathfinding.managedModeConfirmation(
        [
          { algorithm: "Double Absolute Value", equation: "y", properties: [] },
          { algorithm: "Step", equation: "y'", properties: ["Glitch Mode"] },
          { algorithm: "Step", equation: "y''", properties: [] },
        ],
        [{ algorithm: "Double Absolute Value", equation: "y", properties: [] }],
        false,
        managedTiming,
      ),
    ).toContain(
      "Current algorithm settings:\ny: Double Absolute Value\ny': Step (Glitch Mode)\ny'': Step\n\nThese game modes need different algorithm settings:\ny: the current algorithm does not support One-Click Clear; it will be set to Double Absolute Value",
    );
  });

  it("uses the configured shot reserve in managed deadline statuses", () => {
    expect(englishGraphwarKillerLocale.smartPathfinding.managed.deadlineFired("10")).toBe(
      "Stopped with 10 seconds remaining and fired the current best plan",
    );
    expect(englishGraphwarKillerLocale.smartPathfinding.managed.deadlineNoPlan("10")).toBe(
      "Stopped with 10 seconds remaining but could not submit the skip-turn function",
    );
    expect(englishGraphwarKillerLocale.smartPathfinding.managed.deadlinePlan("10", "1.2 seconds")).toBe(
      "Managed calculation stopped with 10 seconds remaining and kept the best plan after 1.2 seconds",
    );
    expect(englishGraphwarKillerLocale.smartPathfinding.managed.deadlineFired("1")).toBe(
      "Stopped with 1 second remaining and fired the current best plan",
    );
    expect(
      englishGraphwarKillerLocale.ui.pathfinding.managedModeConfirmation([], [], false, {
        pollIntervalSeconds: "1",
        shotReserveSeconds: "1",
      }),
    ).toContain("Shot reserve time: 1 second\nState polling interval: 1 second");
  });
});
