import { describe, expect, it } from "vitest";

import { getGraphwarScreenshotHeaderStatus, type GraphwarScreenshotHeaderStatus } from "./screenshot";

const calculationStatus: GraphwarScreenshotHeaderStatus = {
  kind: "success",
  message: "calculated",
  title: "calculated in 12 ms",
};

describe("screenshot header status", () => {
  it("prioritizes path errors over calculation status and the Agent recommendation", () => {
    expect(
      getGraphwarScreenshotHeaderStatus({
        agentRecommendation: "use Agent",
        calculationStatus,
        pathError: "invalid path",
      }),
    ).toEqual({
      kind: "error",
      message: "invalid path",
      title: "invalid path",
    });
  });

  it("prioritizes calculation status over the Agent recommendation", () => {
    expect(
      getGraphwarScreenshotHeaderStatus({
        agentRecommendation: "use Agent",
        calculationStatus,
        pathError: "",
      }),
    ).toBe(calculationStatus);
  });

  it("falls back to the Agent recommendation and then the empty status", () => {
    const emptyCalculation: GraphwarScreenshotHeaderStatus = { kind: "warning", message: "", title: "" };
    expect(
      getGraphwarScreenshotHeaderStatus({
        agentRecommendation: "use Agent",
        calculationStatus: emptyCalculation,
        pathError: "",
      }),
    ).toMatchObject({ kind: "warning", message: "use Agent" });
    expect(
      getGraphwarScreenshotHeaderStatus({
        agentRecommendation: "",
        calculationStatus: emptyCalculation,
        pathError: "",
      }).message,
    ).toBe("");
  });
});
