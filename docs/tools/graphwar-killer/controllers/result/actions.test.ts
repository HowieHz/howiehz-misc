import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import type { ToolWorkflowMode } from "../../core/types";
import { useGraphwarResultActions } from "./actions";

describe("useGraphwarResultActions", () => {
  const toolWorkflowMode = ref<ToolWorkflowMode>("solver");
  const solverFormulaText = ref("1/2*x");
  const simulatorFormulaText = ref("");
  const simulatorLaunchAngleText = ref("");
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    toolWorkflowMode.value = "solver";
    solverFormulaText.value = "1/2*x";
    simulatorFormulaText.value = "";
    simulatorLaunchAngleText.value = "";
    writeText.mockClear();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
  });

  it("copies the page-projected solver text without reprocessing it", async () => {
    const controller = useGraphwarResultActions({
      getCopyMessages: () => ({
        buttonDefault: "Copy",
        buttonError: "Error",
        buttonSuccess: "Copied",
        error: "Copy failed",
        success: "Copied",
      }),
      simulatorFormulaText,
      simulatorLaunchAngleText,
      solverFormulaText,
      toolWorkflowMode,
    });

    await controller.copyFormula();

    expect(writeText).toHaveBeenCalledWith("1/2*x");
    controller.dispose();
  });

  it("keeps simulator input as entered", async () => {
    toolWorkflowMode.value = "simulator";
    simulatorFormulaText.value = "0.5*x";
    const controller = useGraphwarResultActions({
      getCopyMessages: () => ({
        buttonDefault: "Copy",
        buttonError: "Error",
        buttonSuccess: "Copied",
        error: "Copy failed",
        success: "Copied",
      }),
      simulatorFormulaText,
      simulatorLaunchAngleText,
      solverFormulaText,
      toolWorkflowMode,
    });

    await controller.copyFormula();

    expect(writeText).toHaveBeenCalledWith("0.5*x");
    controller.dispose();
  });
});
