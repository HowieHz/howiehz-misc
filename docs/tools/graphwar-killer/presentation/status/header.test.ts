import { describe, expect, it } from "vitest";

import { getSmartPathfindingHeaderStatus } from "./header";

describe("getSmartPathfindingHeaderStatus", () => {
  it("keeps task results visible while path planning is disabled", () => {
    expect(
      getSmartPathfindingHeaderStatus({
        enableHintMessage: "开启路径规划",
        hintMessage: "路径规划提示",
        isSmartPathfindingEnabled: false,
        smartPathfindingSettingsMessage: "",
        smartPathfindingStatusKind: "success",
        smartPathfindingStatusMessage: "一键清图完成",
      }),
    ).toEqual({ kind: "success", message: "一键清图完成" });
  });

  it("shows the enable hint when path planning and task status are both inactive", () => {
    expect(
      getSmartPathfindingHeaderStatus({
        enableHintMessage: "开启路径规划",
        hintMessage: "路径规划提示",
        isSmartPathfindingEnabled: false,
        smartPathfindingSettingsMessage: "",
        smartPathfindingStatusKind: "info",
        smartPathfindingStatusMessage: "",
      }),
    ).toEqual({ kind: "info", message: "开启路径规划" });
  });

  it("keeps setting errors ahead of task status and the ordinary hint", () => {
    expect(
      getSmartPathfindingHeaderStatus({
        enableHintMessage: "开启路径规划",
        hintMessage: "路径规划提示",
        isSmartPathfindingEnabled: true,
        smartPathfindingSettingsMessage: "请修正障碍容差",
        smartPathfindingStatusKind: "warning",
        smartPathfindingStatusMessage: "正在一键清图",
      }),
    ).toEqual({ kind: "error", message: "请修正障碍容差" });
  });

  it.each(["info", "success", "warning", "error"] as const)(
    "preserves the %s task status ahead of the ordinary hint",
    (kind) => {
      expect(
        getSmartPathfindingHeaderStatus({
          enableHintMessage: "开启路径规划",
          hintMessage: "路径规划提示",
          isSmartPathfindingEnabled: true,
          smartPathfindingSettingsMessage: "",
          smartPathfindingStatusKind: kind,
          smartPathfindingStatusMessage: "寻路任务状态",
        }),
      ).toEqual({ kind, message: "寻路任务状态" });
    },
  );

  it("falls back to the ordinary hint when path planning has no higher-priority status", () => {
    expect(
      getSmartPathfindingHeaderStatus({
        enableHintMessage: "开启路径规划",
        hintMessage: "路径规划提示",
        isSmartPathfindingEnabled: true,
        smartPathfindingSettingsMessage: "",
        smartPathfindingStatusKind: "info",
        smartPathfindingStatusMessage: "",
      }),
    ).toEqual({ kind: "info", message: "路径规划提示" });
  });
});
