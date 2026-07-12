import { describe, expect, it } from "vitest";

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

  it("states managed mode algorithm support and repairs explicitly", () => {
    expect(graphwarKillerLocale.ui.pathfinding.managedModeConfirmation([], false)).toContain(
      "三个游戏模式的算法设定都支持一键清图",
    );
    expect(
      graphwarKillerLocale.ui.pathfinding.managedModeConfirmation(
        [
          { algorithm: "双绝对值函数", equation: "y", properties: [] },
          { algorithm: "阶跃函数", equation: "y'", properties: ["邪道模式"] },
        ],
        true,
      ),
    ).toContain(
      "y：当前算法不支持一键清图，将设为双绝对值函数\ny'：当前算法不支持一键清图，将设为阶跃函数（邪道模式）",
    );
  });
});
