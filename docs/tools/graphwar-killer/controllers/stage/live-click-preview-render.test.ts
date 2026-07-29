import { beforeAll, describe, expect, it, vi } from "vitest";

import { createGraphPoint } from "../../core/types";
import { readGraphwarKernelBytes } from "../../core/wasm/kernel-test-fixture";
import { instantiateGraphwarWasmRuntime, type GraphwarWasmKernelRuntime } from "../../core/wasm/runtime";
import { renderGraphwarLiveClickPreview, renderGraphwarLiveClickPreviewWithWasm } from "./live-click-preview-render";

const bounds = { maxX: 25, maxY: 15, minX: -25, minY: -15 };
const boundsRect = { height: 450, width: 770, x: 0, y: 0 };
let kernelModule: WebAssembly.Module;

beforeAll(async () => {
  kernelModule = await WebAssembly.compile(await readGraphwarKernelBytes());
});

describe("live click preview WASM renderer", () => {
  it("uses the WASM expression VM while preserving the TS preview output", async () => {
    const runtime = await createRuntime();
    const input = {
      bounds,
      boundsRect,
      equation: "y" as const,
      expression: "x",
      soldierCenter: createGraphPoint(-10, 0),
      type: "expression" as const,
    };
    const typescript = renderGraphwarLiveClickPreview(input);
    const runFormula = vi.spyOn(runtime, "runFormula");
    const wasm = renderGraphwarLiveClickPreviewWithWasm(runtime, input);

    expect(runFormula).toHaveBeenCalled();
    expect(wasm.curvePoints).toBe(typescript.curvePoints);
  });

  it("uses the coarse WASM trajectory command for formula previews", async () => {
    const runtime = await createRuntime();
    const input = {
      bounds,
      boundsRect,
      points: [createGraphPoint(-10, 0), createGraphPoint(10, 0)],
      settings: {
        algorithm: "abs" as const,
        decimalPlaces: 4,
        equation: "y" as const,
        isStepGlitchModeEnabled: false,
        isStepOverflowProtectionEnabled: true,
        steepness: 3,
      },
      type: "formula" as const,
    };
    const runTrajectory = vi.spyOn(runtime, "runTrajectory");
    const wasm = renderGraphwarLiveClickPreviewWithWasm(runtime, input);

    expect(runTrajectory).toHaveBeenCalledOnce();
    expect(wasm.curvePoints).toBeTruthy();
  });
});

async function createRuntime(): Promise<GraphwarWasmKernelRuntime> {
  return instantiateGraphwarWasmRuntime(kernelModule, { initialArenaCapacity: 65_536 });
}
