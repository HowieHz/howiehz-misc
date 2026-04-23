import { describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({
  availableParallelism: () => 12,
  cpus: () => new Array(8).fill({}),
}));

describe("benchmark runtime", () => {
  it("defaults the worker count to detected cpu count minus four", async () => {
    const { getDefaultBenchmarkWorkerCount, getDetectedCpuCount } = await import("../benchmark/runtime.ts");

    expect(getDetectedCpuCount()).toBe(12);
    expect(getDefaultBenchmarkWorkerCount()).toBe(8);
  });

  it("parses an explicit worker count", async () => {
    const { parseBenchmarkWorkerCount } = await import("../benchmark/runtime.ts");

    expect(parseBenchmarkWorkerCount("3")).toBe(3);
    expect(() => parseBenchmarkWorkerCount("0")).toThrow("--workers must be an integer greater than or equal to 1");
  });
});
