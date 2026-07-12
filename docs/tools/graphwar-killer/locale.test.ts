import { describe, expect, it } from "vitest";

import { graphwarKillerLocale as englishGraphwarKillerLocale } from "../../en/tools/graphwar-killer/locale";
import { graphwarKillerLocale } from "./locale";

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
  it("separates game mode names from formula prefixes", () => {
    expect(graphwarKillerLocale.equationModes.map((mode) => mode.label)).toEqual(["y", "y'", "y''"]);
    expect(graphwarKillerLocale.equationModes.map((mode) => mode.formulaPrefix)).toEqual(["y=", "y'=", "y''="]);
  });

  it("does not expose translatable internal English terms", () => {
    expect(
      [
        ...chineseLocaleStrings,
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
    const supportedConfirmation = graphwarKillerLocale.ui.pathfinding.managedModeConfirmation(settings, [], false);
    expect(supportedConfirmation).toContain("房间内会自动准备本地玩家");
    expect(supportedConfirmation).toContain("当前算法设定：\ny：双绝对值函数\ny'：阶跃函数（邪道模式）\ny''：阶跃函数");
    expect(
      graphwarKillerLocale.ui.pathfinding.managedModeConfirmation(
        settings,
        [
          { algorithm: "双绝对值函数", equation: "y", properties: [] },
          { algorithm: "阶跃函数", equation: "y'", properties: ["邪道模式"] },
        ],
        true,
      ),
    ).toContain(
      "当前算法设定：\ny：双绝对值函数\ny'：阶跃函数（邪道模式）\ny''：阶跃函数\n\n以下游戏模式需要调整算法设定：\ny：当前算法不支持一键清图，将设为双绝对值函数\ny'：当前算法不支持一键清图，将设为阶跃函数（邪道模式）",
    );
  });
});

describe("English Graphwar Killer locale", () => {
  it("keeps ordinary titles compact", () => {
    expect(englishCompactTitles.filter((value) => value.endsWith("."))).toEqual([]);
  });

  it("states that managed mode automatically marks local room players ready", () => {
    expect(
      englishGraphwarKillerLocale.ui.pathfinding.managedModeConfirmation(
        [
          { algorithm: "Double Absolute Value", equation: "y", properties: [] },
          { algorithm: "Step", equation: "y'", properties: ["Glitch Mode"] },
          { algorithm: "Step", equation: "y''", properties: [] },
        ],
        [],
        false,
      ),
    ).toContain("Local players in the room are marked ready automatically");
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
      ),
    ).toContain(
      "Current algorithm settings:\ny: Double Absolute Value\ny': Step (Glitch Mode)\ny'': Step\n\nThese game modes need different algorithm settings:\ny: the current algorithm does not support One-Click Clear; it will be set to Double Absolute Value",
    );
  });
});
