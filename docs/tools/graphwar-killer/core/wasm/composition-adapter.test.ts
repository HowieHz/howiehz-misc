import { describe, expect, it, vi } from "vitest";

import {
  beginGraphwarWasmOneClickClear,
  runGraphwarWasmSmartPathfinding,
  type GraphwarWasmOneClickEdgeResult,
} from "./composition-adapter";
import { readGraphwarKernelBytes } from "./kernel-test-fixture";
import { instantiateGraphwarWasmRuntime } from "./runtime";

const kernelModulePromise = readGraphwarKernelBytes().then((bytes) => WebAssembly.compile(bytes));

describe("Graphwar WASM composition adapter", () => {
  it("round-trips smart path output and performs owned point deletion", async () => {
    const runtime = await createRuntime();

    const result = runGraphwarWasmSmartPathfinding(runtime, {
      isDeleteOptimizationEnabled: true,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      sourcePointCount: 1,
      target: { x: 2, y: 2 },
      targetRadius: 0,
    });

    expect(result).toEqual({
      isValidated: true,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ],
      removedPointCount: 1,
      status: "success",
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("returns a normal smart no-candidate result without trapping", async () => {
    const runtime = await createRuntime();

    expect(
      runGraphwarWasmSmartPathfinding(runtime, {
        isDeleteOptimizationEnabled: false,
        points: [],
        sourcePointCount: 0,
        target: { x: 2, y: 2 },
        targetRadius: 1,
      }),
    ).toEqual({ points: [], removedPointCount: 0, status: "failure" });

    expect(
      runGraphwarWasmSmartPathfinding(runtime, {
        isDeleteOptimizationEnabled: false,
        points: [{ x: 0, y: 0 }],
        sourcePointCount: 0,
        target: { x: 2, y: 2 },
        targetRadius: 0,
      }),
    ).toEqual({ points: [], removedPointCount: 0, status: "failure" });
  });

  it("consumes one-click edge results by stable job id, independent of completion order", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    expect(started.targetOrder).toEqual([0, 1]);
    expect(started.edgeJobs.map(({ id, from, to }) => ({ from, id, to }))).toEqual([
      { from: -1, id: 0, to: 0 },
      { from: -1, id: 1, to: 1 },
      { from: 0, id: 2, to: 1 },
    ]);

    const result = started.handle.resume([
      {
        jobId: 2,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 0,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 1,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
    ]);
    expect(result).toEqual({
      path: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      selectedEdgeCount: 2,
      status: "complete",
      targetOrder: [0, 1],
    });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("supports descending target order for mirrored x+ maps", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [
        { hitCenter: { x: 20, y: 0 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: true },
      ],
      isTargetOrderDescending: true,
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status === "waiting-edge-batch") {
      expect(started.targetOrder).toEqual([0, 1]);
      started.handle.cancel();
    }
  });

  it("matches TS longest-path point-count and vertical-variation tie-breaks", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      verticalVariationScale: 1 / 15,
      candidates: [
        { hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 20, y: 0 }, hitRadius: 1, isEnemy: true },
      ],
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const result = started.handle.resume([
      {
        jobId: 0,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 5, y: 8 },
          { x: 10, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 1,
        requestNonce: started.handle.requestNonce,
        reachable: true,
        route: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        sessionNonce: started.handle.nonce,
      },
      {
        jobId: 2,
        requestNonce: started.handle.requestNonce,
        reachable: false,
        sessionNonce: started.handle.nonce,
      },
    ]);

    expect(result).toEqual({
      path: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      selectedEdgeCount: 1,
      status: "complete",
      targetOrder: [0, 1],
    });
  });

  it("keeps normal target ordering stable for equal x columns", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [
        { hitCenter: { x: 10, y: 2 }, hitRadius: 1, isEnemy: true },
        { hitCenter: { x: 10, y: 8 }, hitRadius: 1, isEnemy: true },
      ],
    });
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    expect(started.targetOrder).toEqual([1, 0]);
    started.handle.cancel();
  });

  it("rejects duplicate edge ids and invalidates the retained session", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    const duplicateResults: GraphwarWasmOneClickEdgeResult[] = [
      { jobId: 0, requestNonce: started.handle.requestNonce, reachable: false, sessionNonce: started.handle.nonce },
      { jobId: 0, requestNonce: started.handle.requestNonce, reachable: false, sessionNonce: started.handle.nonce },
      { jobId: 1, requestNonce: started.handle.requestNonce, reachable: false, sessionNonce: started.handle.nonce },
    ];
    expect(() => started.handle.resume(duplicateResults)).toThrow(/duplicated/u);
    expect(() => started.handle.resume(duplicateResults)).toThrow(/no longer active/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects an edge result from another task identity before touching the kernel", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    expect(() =>
      started.handle.resume(createReachableEdgeResults(started.handle.nonce, started.handle.requestNonce + 1)),
    ).toThrow(/belongs to another one-click session/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a reachable route whose endpoints belong to another edge", async () => {
    const runtime = await createRuntime();
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    expect(() =>
      started.handle.resume([
        {
          jobId: 0,
          requestNonce: started.handle.requestNonce,
          reachable: true,
          route: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
          ],
          sessionNonce: started.handle.nonce,
        },
        {
          jobId: 1,
          requestNonce: started.handle.requestNonce,
          reachable: false,
          sessionNonce: started.handle.nonce,
        },
        {
          jobId: 2,
          requestNonce: started.handle.requestNonce,
          reachable: false,
          sessionNonce: started.handle.nonce,
        },
      ]),
    ).toThrow(/endpoints do not match/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("keeps a paused session valid across linear-memory growth and supports cancellation", async () => {
    const runtime = await createRuntime(2_048);
    const started = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(started.status).toBe("waiting-edge-batch");
    if (started.status !== "waiting-edge-batch") return;

    runtime.reserveArena(runtime.buffer.byteLength * 2, 8);
    const result = started.handle.resume(createReachableEdgeResults(started.handle.nonce, started.handle.requestNonce));
    expect(result.status).toBe("complete");

    const secondRuntime = await createRuntime();
    const secondStarted = beginGraphwarWasmOneClickClear(secondRuntime, createOneClickInput());
    expect(secondStarted.status).toBe("waiting-edge-batch");
    if (secondStarted.status !== "waiting-edge-batch") return;
    secondStarted.handle.cancel();
    expect(() =>
      secondStarted.handle.resume(
        createReachableEdgeResults(secondStarted.handle.nonce, secondStarted.handle.requestNonce),
      ),
    ).toThrow(/no longer active/u);
    expect(secondRuntime.arenaCursor).toBe(secondRuntime.arenaBase);
    const restarted = beginGraphwarWasmOneClickClear(secondRuntime, createOneClickInput());
    expect(restarted.status).toBe("waiting-edge-batch");
    if (restarted.status === "waiting-edge-batch") restarted.handle.cancel();
  });

  it("does not cancel an existing session when a later begin command fails", async () => {
    const runtime = await createRuntime();
    const first = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(first.status).toBe("waiting-edge-batch");
    if (first.status !== "waiting-edge-batch") return;

    expect(() =>
      beginGraphwarWasmOneClickClear(runtime, {
        ...createOneClickInput(),
        requestNonce: 43,
      }),
    ).toThrow();

    const result = first.handle.resume(createReachableEdgeResults(first.handle.nonce, first.handle.requestNonce));
    expect(result.status).toBe("complete");
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("retries after a begin trap without retaining a half-published session", async () => {
    const runtime = await createRuntime();
    const begin = vi.spyOn(runtime, "beginOneClickClear").mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError("synthetic allocation trap");
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow(/allocation trap/u);
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);

    begin.mockRestore();
    const retried = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(retried.status).toBe("waiting-edge-batch");
    if (retried.status === "waiting-edge-batch") retried.handle.cancel();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("cancels a session published before a begin-boundary fault and permits restart", async () => {
    const runtime = await createRuntime();
    const begin = runtime.beginOneClickClear.bind(runtime);
    const cancel = vi.spyOn(runtime, "cancelOneClickClear");
    const beginSpy = vi.spyOn(runtime, "beginOneClickClear").mockImplementationOnce((pointer, byteLength) => {
      begin(pointer, byteLength);
      throw new Error("post-begin fault");
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow("post-begin fault");
    expect(cancel).toHaveBeenCalledOnce();
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);

    beginSpy.mockRestore();
    const restarted = beginGraphwarWasmOneClickClear(runtime, createOneClickInput());
    expect(restarted.status).toBe("waiting-edge-batch");
    if (restarted.status === "waiting-edge-batch") {
      restarted.handle.cancel();
    }
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("reports an empty candidate set as a normal failure", async () => {
    const runtime = await createRuntime();
    const result = beginGraphwarWasmOneClickClear(runtime, {
      ...createOneClickInput(),
      candidates: [],
    });

    expect(result).toEqual({ path: [{ x: 0, y: 0 }], selectedEdgeCount: 0, status: "failure", targetOrder: [] });
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });

  it("rejects a complete result whose selected edge count exceeds its target count", async () => {
    const runtime = await createRuntime();
    vi.spyOn(runtime, "beginOneClickClear").mockImplementation(() => {
      const pointer = runtime.reserveArena(52, 8);
      const view = new DataView(runtime.buffer, pointer, 52);
      view.setUint32(0, 0x4f43_5253, true);
      view.setUint32(4, 0, true);
      view.setUint32(8, 0, true);
      view.setUint32(12, 0, true);
      view.setUint32(16, 0, true);
      view.setUint32(20, 0, true);
      view.setUint32(24, 0, true);
      view.setUint32(28, 0, true);
      view.setUint32(32, 0, true);
      view.setUint32(36, 0, true);
      view.setUint32(40, 1, true);
      view.setUint32(44, 1, true);
      view.setUint32(48, 42, true);
      return pointer;
    });

    expect(() => beginGraphwarWasmOneClickClear(runtime, createOneClickInput())).toThrow(
      /selected edge count exceeds target count/u,
    );
    expect(runtime.arenaCursor).toBe(runtime.arenaBase);
  });
});

function createOneClickInput() {
  return {
    candidates: [
      { hitCenter: { x: 10, y: 0 }, hitRadius: 1, isEnemy: true },
      { hitCenter: { x: 20, y: 0 }, hitRadius: 1, isEnemy: true },
    ],
    isDeleteOptimizationEnabled: true,
    isStepStateful: false,
    path: [{ x: 0, y: 0 }],
    requestNonce: 42,
  } as const;
}

function createReachableEdgeResults(sessionNonce: number, requestNonce: number): GraphwarWasmOneClickEdgeResult[] {
  return [
    {
      jobId: 0,
      requestNonce,
      reachable: true,
      route: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      sessionNonce,
    },
    {
      jobId: 1,
      requestNonce,
      reachable: true,
      route: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      sessionNonce,
    },
    {
      jobId: 2,
      requestNonce,
      reachable: true,
      route: [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      sessionNonce,
    },
  ];
}

async function createRuntime(initialArenaCapacity = 65_536) {
  return instantiateGraphwarWasmRuntime(await kernelModulePromise, { initialArenaCapacity });
}
