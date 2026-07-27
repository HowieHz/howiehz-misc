import { describe, expect, it } from "vitest";

import { parseGraphwarExpressionProgram } from "../../formula/expression/evaluator";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import {
  copyGraphwarWasmBytes,
  copyGraphwarWasmFloat64Values,
  GraphwarWasmAdapterError,
  writeGraphwarWasmUint32Values,
  type GraphwarWasmAdapterErrorCode,
} from "./abi";
import {
  copyGraphwarWasmPointSoA,
  copyGraphwarWasmPathfindingPreviewEvent,
  copyGraphwarWasmPathfindingResult,
  packGraphwarPlaneMask,
  packGraphwarWasmDetectionInput,
  packGraphwarWasmExpressionProgram,
  packGraphwarWasmFormulaInput,
  packGraphwarWasmPointSoA,
  packGraphwarWasmPathfindingGeometryJobs,
  packGraphwarWasmRgbaImage,
  packGraphwarWasmRouteSessionInput,
  packGraphwarWasmStopPolicy,
} from "./task-adapter";

class TestGraphwarWasmArena {
  readonly arenaBase = 8;
  readonly memory = new WebAssembly.Memory({ initial: 1 });
  #cursor = 8;

  get arenaCursor() {
    return this.#cursor;
  }

  get buffer() {
    return this.memory.buffer;
  }

  reserveArena(byteLength: number, alignment: number) {
    this.#cursor = Math.ceil(this.#cursor / alignment) * alignment;
    while (this.#cursor + byteLength > this.memory.buffer.byteLength) {
      this.memory.grow(1);
    }
    const pointer = this.#cursor;
    this.#cursor += byteLength;
    return pointer;
  }
}

describe("Graphwar WASM task Adapter", () => {
  it("packs the canonical expression program without reparsing", () => {
    const arena = new TestGraphwarWasmArena();
    const program = parseGraphwarExpressionProgram("x / y^2");
    expect(program).toBeDefined();
    if (!program) {
      throw new Error("expected expression program");
    }
    const packed = packGraphwarWasmExpressionProgram(arena, program, 8);

    expect([...copyGraphwarWasmBytes(arena, packed.opcodes, 8)]).toEqual([...program.opcodes]);
    expect([...copyGraphwarWasmFloat64Values(arena, packed.constants, 8)]).toEqual([2]);
    expect(packed.maximumStackSize).toBe(program.maximumStackSize);
    expectAdapterError(
      () => packGraphwarWasmExpressionProgram(arena, { ...program, maximumStackSize: 99 }, 8),
      "invalid-expression-program",
    );
  });

  it("validates and packs one immutable RGBA detection task", () => {
    const arena = new TestGraphwarWasmArena();
    const imageData = {
      data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]),
      height: 1,
      width: 2,
    } as ImageData;
    const packed = packGraphwarWasmDetectionInput(
      arena,
      {
        imageData,
        thresholds: { minArea: 10 },
        type: "detect-auto",
      },
      8,
    );
    expect(packed.type).toBe("detect-auto");
    if (packed.type !== "detect-auto") {
      throw new Error("expected auto detection input");
    }
    expect([...copyGraphwarWasmBytes(arena, packed.image.rgba, 8)]).toEqual([...imageData.data]);
    expect([...copyGraphwarWasmFloat64Values(arena, packed.settings, 8)]).toEqual([10, 0.1, 40, 4]);

    imageData.data[0] = 99;
    expect(copyGraphwarWasmBytes(arena, packed.image.rgba, 8)[0]).toBe(1);
    expectAdapterError(
      () => packGraphwarWasmRgbaImage(arena, { data: new Uint8ClampedArray(7), height: 1, width: 2 } as ImageData, 8),
      "invalid-image-data",
    );
  });

  it("packs structured formula settings, points, and the optional Step-glitch mask atomically", () => {
    const arena = new TestGraphwarWasmArena();
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    mask[17] = 1;
    const packed = packGraphwarWasmFormulaInput(
      arena,
      {
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        settings: {
          algorithm: "step",
          decimalPlaces: 4,
          equation: "ddy",
          formulaPathSteepness: 2,
          isStepGlitchModeEnabled: true,
          isStepOverflowProtectionEnabled: true,
          secondOrderLaunchAngleMode: "display-rounded",
          steepness: 3,
          stepGlitchObstacleMask: mask,
        },
      },
      8,
    );

    expect([...copyGraphwarWasmFloat64Values(arena, packed.points.x, 8)]).toEqual([1, 3]);
    expect([...copyGraphwarWasmFloat64Values(arena, packed.points.y, 8)]).toEqual([2, 4]);
    expect([...copyGraphwarWasmFloat64Values(arena, packed.settings, 8)]).toEqual([2, 3, 4, 3, 1, 2, 1, 1, 1]);
    expect(copyGraphwarWasmBytes(arena, packed.stepGlitchObstacleMask, 8)[17]).toBe(1);
    expectAdapterError(
      () =>
        packGraphwarWasmFormulaInput(arena, {
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
          settings: { ...packedFormulaSettings(), stepGlitchObstacleMask: [] as unknown as Uint8Array },
        }),
      "invalid-image-data",
    );
  });

  it("packs all production stop-policy branches and rejects invalid target/collision data", () => {
    const arena = new TestGraphwarWasmArena();
    expect(packGraphwarWasmStopPolicy(arena, { type: "natural" }, 8)).toEqual({ type: "natural" });

    const observations = packGraphwarWasmStopPolicy(
      arena,
      { observationXs: [2, 4], stopX: 5, type: "stop-x-observations" },
      8,
    );
    expect(observations.type).toBe("stop-x-observations");
    if (observations.type === "stop-x-observations") {
      expect([...copyGraphwarWasmFloat64Values(arena, observations.observationXs, 8)]).toEqual([2, 4]);
    }

    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const targets = packGraphwarWasmStopPolicy(
      arena,
      {
        collision: { boundaryExpansion: 2, mask, type: "mask" },
        continueAfterTargetsUntilGraphX: { graphX: 8, type: "value" },
        orderedTargets: [{ center: { x: 1, y: 2 }, radius: 3 }],
        requiredTargets: [{ center: { x: 4, y: 5 }, radius: 6 }],
        shouldCollectVisiblePixels: true,
        trackedTargets: [{ center: { x: 7, y: 8 }, radius: 9 }],
        type: "targets",
      },
      8,
    );
    expect(targets).toMatchObject({ orderedTargetCount: 1, requiredTargetCount: 1, trackedTargetCount: 1 });
    if (targets.type === "targets") {
      expect([...copyGraphwarWasmFloat64Values(arena, targets.targetRecords, 8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }

    expectAdapterError(
      () =>
        packGraphwarWasmStopPolicy(
          arena,
          {
            collision: { boundaryExpansion: 0, mask: new Uint8Array(1), type: "mask" },
            continueAfterTargetsUntilGraphX: { type: "none" },
            orderedTargets: [],
            requiredTargets: [],
            shouldCollectVisiblePixels: false,
            trackedTargets: [],
            type: "targets",
          },
          8,
        ),
      "invalid-image-data",
    );
  });

  it("uses one plane-mask and point SoA boundary for route work and results", () => {
    const arena = new TestGraphwarWasmArena();
    const mask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const packedMask = packGraphwarPlaneMask(arena, mask, 8);
    expect(packedMask.length).toBe(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);

    const points = packGraphwarWasmPointSoA(
      arena,
      [
        { x: -1, y: 2 },
        { x: 3, y: -4 },
      ],
      8,
    );
    expect(points.length).toBe(2);
    expect(copyGraphwarWasmPointSoA(arena, points, 8)).toEqual([
      { x: -1, y: 2 },
      { x: 3, y: -4 },
    ]);
    expectAdapterError(() => copyGraphwarWasmPointSoA(arena, { ...points, length: 1 }, 8), "invalid-point-data");
    expectAdapterError(() => packGraphwarWasmPointSoA(arena, [{ x: Number.NaN, y: 0 }], 8), "invalid-finite-number");
    expect(GRAPHWAR_PLANE_HEIGHT).toBe(450);
  });

  it("packs one atomic route session and stable geometry job batch", () => {
    const arena = new TestGraphwarWasmArena();
    const routeMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
    const session = packGraphwarWasmRouteSessionInput(
      arena,
      {
        boundaryExpansion: 1,
        bounds: { maxX: 25, maxY: 15, minX: -25, minY: -15 },
        boundsRect: { height: 450, width: 770, x: 10, y: 20 },
        routeMask,
        routeMode: "visibility-graph",
        routeOriginPoint: { x: 100, y: 225 },
        routeTolerancePlanePixels: 2,
      },
      8,
    );
    expect([...copyGraphwarWasmFloat64Values(arena, session.context, 8)]).toEqual([
      -25, -15, 25, 15, 10, 20, 770, 450, 1, 2, 100, 225, 2,
    ]);
    expect(copyGraphwarWasmBytes(arena, session.routeMask, 8)).toEqual(routeMask);
    expectAdapterError(
      () =>
        packGraphwarWasmRouteSessionInput(arena, {
          boundaryExpansion: 1,
          bounds: { maxX: -25, maxY: 15, minX: 25, minY: -15 },
          boundsRect: { height: 450, width: 770, x: 10, y: 20 },
          routeMask,
          routeMode: "visibility-graph",
          routeOriginPoint: { x: 100, y: 225 },
          routeTolerancePlanePixels: 2,
        }),
      "invalid-point-data",
    );

    const jobs = packGraphwarWasmPathfindingGeometryJobs(
      arena,
      [
        {
          fromNodeId: -1,
          jobId: 3,
          startPoint: { x: 100, y: 225 },
          targetPoint: { x: 200, y: 225 },
          toNodeId: 0,
        },
      ],
      8,
    );
    expect(jobs.jobCount).toBe(1);
    expect([...copyGraphwarWasmFloat64Values(arena, jobs.records, 8)]).toEqual([3, -1, 0, 100, 225, 200, 225]);
    expectAdapterError(
      () =>
        packGraphwarWasmPathfindingGeometryJobs(
          arena,
          [
            { fromNodeId: -1, jobId: 3, startPoint: { x: 0, y: 0 }, targetPoint: { x: 1, y: 1 }, toNodeId: 0 },
            { fromNodeId: 0, jobId: 3, startPoint: { x: 1, y: 1 }, targetPoint: { x: 2, y: 2 }, toNodeId: 1 },
          ],
          8,
        ),
      "duplicate-work-id",
    );
  });

  it("copies pathfinding events and results without leaking views", () => {
    const arena = new TestGraphwarWasmArena();
    const points = packGraphwarWasmPointSoA(
      arena,
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ],
      8,
    );
    const event = copyGraphwarWasmPathfindingPreviewEvent(
      arena,
      {
        acceptedEdgePointIndexes: writeGraphwarWasmUint32Values(arena, new Uint32Array([0, 1]), 8),
        bestPathPointIndexes: writeGraphwarWasmUint32Values(arena, new Uint32Array([0, 2]), 8),
        candidatePointIndexes: writeGraphwarWasmUint32Values(arena, new Uint32Array([1]), 8),
        currentPointIndex: 2,
        isMirrored: 1,
        points,
      },
      8,
    );
    expect(event).toEqual({
      acceptedEdges: [
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      ],
      bestPath: [
        { x: 1, y: 2 },
        { x: 5, y: 6 },
      ],
      candidates: [{ x: 3, y: 4 }],
      current: { x: 5, y: 6 },
      isMirrored: true,
    });

    const result = copyGraphwarWasmPathfindingResult(
      arena,
      { pathError: Number.POSITIVE_INFINITY, points, protectionBits: 0b101 },
      0b111,
      8,
    );
    expect(result.pathError).toBe(Number.POSITIVE_INFINITY);
    expect(result.protectionBits).toBe(0b101);
    expect(result.points).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
    expectAdapterError(
      () =>
        copyGraphwarWasmPathfindingPreviewEvent(
          arena,
          {
            acceptedEdgePointIndexes: writeGraphwarWasmUint32Values(arena, new Uint32Array([0, 9]), 8),
            bestPathPointIndexes: { length: 0, pointer: 0 },
            candidatePointIndexes: { length: 0, pointer: 0 },
            currentPointIndex: 0xffff_ffff,
            isMirrored: 0,
            points,
          },
          8,
        ),
      "invalid-index",
    );
  });
});

/** 断言 Adapter 分类，不让测试耦合人类可读文案。 */
function expectAdapterError(task: () => unknown, code: GraphwarWasmAdapterErrorCode) {
  let error: unknown;
  try {
    task();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GraphwarWasmAdapterError);
  expect(error).toMatchObject({ code });
}

/** 构造启用 Step-glitch 的最小合法公式设置。 */
function packedFormulaSettings() {
  return {
    algorithm: "step" as const,
    decimalPlaces: 4,
    equation: "ddy" as const,
    isStepGlitchModeEnabled: true,
    isStepOverflowProtectionEnabled: true,
    steepness: 3,
  };
}
