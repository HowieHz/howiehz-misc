import {
  createGraphwarSoldierTemplateCanonicalData,
  type GraphwarSoldierTemplateCanonicalData,
} from "../../detection/objects";
import {
  createGraphwarSoldierTemplateProfileData,
  defaultGraphwarMaximumSoldierCount,
  defaultGraphwarSoldierTemplateCandidateTopRatio,
  defaultGraphwarTemplateMatchingWorkerCount,
} from "../../detection/profile/soldier-template";
import type { GraphwarDetectionWorkerTask } from "../../detection/runtime/protocol";
import type { GraphwarExpressionProgram } from "../../formula/expression/program";
import { isGraphwarExpressionProgram } from "../../formula/expression/program";
import type { GraphwarTrajectoryFormulaSettings } from "../../formula/trajectory/sampling";
import {
  createGraphwarRoutePolicyData,
  createGraphwarThetaStarLookaheadColumnOffsetData,
} from "../../pathfinding/routing/canonical-data";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../game/constants";
import type { AlgorithmMode, EquationMode, GraphBounds } from "../types";

/** Route context record size shared by route and composition adapters. */
export const graphwarWasmRouteContextByteLength = 264;
import {
  GraphwarWasmAdapterError,
  copyGraphwarWasmFloat64Values,
  copyGraphwarWasmUint32Values,
  validateGraphwarWasmEnumValue,
  validateGraphwarWasmFiniteNumber,
  validateGraphwarWasmPathError,
  validateGraphwarWasmProtectionBits,
  validateGraphwarWasmU32,
  writeGraphwarWasmBytes,
  writeGraphwarWasmFloat64Values,
  writeGraphwarWasmUint32Values,
  type GraphwarWasmArenaMemorySource,
  type GraphwarWasmMemorySlice,
  type GraphwarWasmMemorySource,
} from "./abi";

/** 每个 simulator attempt 只写入一次的规范 expression VM layout。 */
export interface GraphwarWasmPackedExpressionProgram {
  constants: GraphwarWasmMemorySlice;
  maximumStackSize: number;
  opcodes: GraphwarWasmMemorySlice;
}

/** 在 detection begin 边界只写入一次的 RGBA bytes 与尺寸。 */
export interface GraphwarWasmPackedRgbaImage {
  height: number;
  rgba: GraphwarWasmMemorySlice;
  width: number;
}

/** One immutable upload of the canonical soldier-template tables used by a detection instance/task. */
export interface GraphwarWasmPackedSoldierTemplates {
  baseFlags: GraphwarWasmMemorySlice;
  baseGeometry: GraphwarWasmMemorySlice;
  basePixelRanges: GraphwarWasmMemorySlice;
  pixelCoordinates: GraphwarWasmMemorySlice;
  profile: GraphwarWasmMemorySlice;
  signatureColors: GraphwarWasmMemorySlice;
  templateNames: readonly string[];
  templateRecords: GraphwarWasmMemorySlice;
}

/** Flat point array 使用 SoA，避免 WASM 热循环中的 JS 对象传输。 */
export interface GraphwarWasmPackedPointSoA {
  length: number;
  x: GraphwarWasmMemorySlice;
  y: GraphwarWasmMemorySlice;
}

/** Trajectory、target、observation 与 route Adapter 接受的最小数值点。 */
export interface GraphwarWasmPoint {
  x: number;
  y: number;
}

/** 用户或上游求解器提供的二阶发射角；两种单位必须证明来自同一个值。 */
export interface GraphwarWasmSecondOrderLaunchAngle {
  degrees: number;
  radians: number;
}

/** 原子 structured-formula descriptor；源 settings 与 points 不会跨 attempt 拆分。 */
export interface GraphwarWasmFormulaInputDescriptor {
  bounds: GraphBounds;
  points: readonly GraphwarWasmPoint[];
  /** 用户输入角或上游求解角必须原子携带两种展示单位。 */
  secondOrderLaunchAngle?: GraphwarWasmSecondOrderLaunchAngle;
  settings: GraphwarTrajectoryFormulaSettings;
  soldierCenter: GraphwarWasmPoint;
}

/** 标准 stop target；所属集合决定 ordered、unordered-required 或 tracking 语义。 */
export interface GraphwarWasmStopTarget {
  center: GraphwarWasmPoint;
  radius: number;
}

/** Collision evidence 为原子状态：boundary expansion 不能脱离 mask 存在。 */
export type GraphwarWasmCollisionPolicy =
  | { type: "none" }
  | { boundaryExpansion: number; mask: Uint8Array; type: "mask" };

/** 粗粒度 trajectory command 接受的生产 stop policy。 */
export type GraphwarWasmStopPolicy =
  | { type: "natural" }
  | {
      boundsRect: { height: number; width: number; x: number; y: number };
      collision: GraphwarWasmCollisionPolicy;
      continueAfterTargetsUntilGraphX: { type: "none" } | { graphX: number; type: "value" };
      orderedTargets: readonly GraphwarWasmStopTarget[];
      qualityPoints: readonly GraphwarWasmPoint[];
      requiredTargets: readonly GraphwarWasmStopTarget[];
      shouldCollectVisiblePixels: boolean;
      shouldStopOnTargetsComplete: boolean;
      trackedTargets: readonly GraphwarWasmStopTarget[];
      type: "targets";
    }
  | {
      observationXs: readonly number[];
      stopX: number;
      type: "stop-x-observations";
    };

/** Packed stop policy 把每种可选资源保留为判别分支。 */
export type GraphwarWasmPackedStopPolicy =
  | { type: "natural" }
  | {
      boundsRect: { height: number; width: number; x: number; y: number };
      collision: { type: "none" } | { boundaryExpansion: number; mask: GraphwarWasmMemorySlice; type: "mask" };
      continueAfterTargetsUntilGraphX: { type: "none" } | { graphX: number; type: "value" };
      orderedTargetCount: number;
      qualityPoints: GraphwarWasmPackedPointSoA;
      requiredTargetCount: number;
      shouldCollectVisiblePixels: boolean;
      shouldStopOnTargetsComplete: boolean;
      targetRecords: GraphwarWasmMemorySlice;
      trackedTargetCount: number;
      type: "targets";
    }
  | {
      observationXs: GraphwarWasmMemorySlice;
      stopX: number;
      type: "stop-x-observations";
    };

/** Detection task 与已完成 pack 的浏览器图像边界。 */
export type GraphwarWasmPackedDetectionInput =
  | { image: GraphwarWasmPackedRgbaImage; type: "detect-bounds-only" }
  | {
      image: GraphwarWasmPackedRgbaImage;
      settings: GraphwarWasmMemorySlice;
      templates: GraphwarWasmPackedSoldierTemplates;
      type: "detect-auto";
    }
  | {
      edgeRect: GraphwarWasmMemorySlice;
      image: GraphwarWasmPackedRgbaImage;
      settings: GraphwarWasmMemorySlice;
      templates: GraphwarWasmPackedSoldierTemplates;
      type: "detect-bounds";
    };

/** WASM route context 的共享静态输入；source mask、预处理身份与路由参数在同一次命令写入。 */
interface GraphwarWasmRouteContextInputBase {
  boundaryExpansion: number;
  bounds: { maxX: number; maxY: number; minX: number; minY: number };
  boundsRect: { height: number; width: number; x: number; y: number };
  routeOriginPoint: GraphwarWasmPoint;
  routeTolerancePlanePixels: number;
  sourceMask: Uint8Array;
  /** Step state and numerical settings are one optional capability of the retained route context. */
  stepRouteModel?: GraphwarWasmStepRouteModelInput;
}

/** 基础 mask 与它的全部 morphology 输入必须原子同行。 */
interface GraphwarWasmBaseMaskRouteContextInput extends GraphwarWasmRouteContextInputBase {
  friendlySoldierCenters: readonly GraphwarWasmPoint[];
  simulationTolerancePlanePixels: number;
  soldierHitRadiusPixels: number;
  sourceMaskType: "base";
}

/** 已处理 route mask 不再携带任何会重复修改 mask 的输入；真实 route tolerance 仅保留 contour 身份。 */
interface GraphwarWasmPreprocessedRouteContextInput extends GraphwarWasmRouteContextInputBase {
  friendlySoldierCenters?: never;
  simulationTolerancePlanePixels?: never;
  soldierHitRadiusPixels?: never;
  sourceMaskType: "route";
}

export type GraphwarWasmRouteContextInput =
  | GraphwarWasmBaseMaskRouteContextInput
  | GraphwarWasmPreprocessedRouteContextInput;

/** Canonical Step route model consumed directly by the WASM edge evaluator. */
export interface GraphwarWasmStepRouteModelInput {
  decimalPlaces: number;
  equation: "ddy" | "dy" | "y";
  formulaSteepness: number;
  originY: number;
  qualityTargetPlanePixels: number;
}

/** Packed route context 原子携带全部长期数据，不允许 policy/mask 半状态。 */
export interface GraphwarWasmPackedRouteContextInput {
  context: GraphwarWasmMemorySlice;
  friendlySoldierCenters: GraphwarWasmPackedPointSoA;
  routePolicy: GraphwarWasmMemorySlice;
  sourceMask: GraphwarWasmMemorySlice;
  stepRouteModel?: GraphwarWasmMemorySlice;
  thetaStarLookaheadColumnOffsets: GraphwarWasmMemorySlice;
}

/** 可并行派发的无状态几何 edge job；Step 状态证据由后续公式 descriptor Adapter 原子附加。 */
export interface GraphwarWasmPathfindingGeometryJob {
  fromNodeId: number;
  jobId: number;
  startPoint: GraphwarWasmPoint;
  targetPoint: GraphwarWasmPoint;
  toNodeId: number;
}

/** 稳定 job 顺序的 flat f64 record。 */
export interface GraphwarWasmPackedPathfindingGeometryJobs {
  jobCount: number;
  records: GraphwarWasmMemorySlice;
}

/** WASM preview event 的 raw layout；所有 index 都引用同一份 point SoA。 */
export interface GraphwarWasmPathfindingPreviewEventLayout {
  acceptedEdgePointIndexes: GraphwarWasmMemorySlice;
  bestPathPointIndexes: GraphwarWasmMemorySlice;
  candidatePointIndexes: GraphwarWasmMemorySlice;
  currentPointIndex: number;
  isMirrored: number;
  points: GraphwarWasmPackedPointSoA;
}

/** 立即复制出的 pathfinding preview event，不保留任意 WASM view。 */
export interface GraphwarWasmPathfindingPreviewEvent {
  acceptedEdges: readonly [GraphwarWasmPoint, GraphwarWasmPoint][];
  bestPath: readonly GraphwarWasmPoint[];
  candidates: readonly GraphwarWasmPoint[];
  current?: GraphwarWasmPoint;
  isMirrored: boolean;
}

/** Pathfinding output 的公共 raw layout；point、path error 与 protection 作为一份结果验证。 */
export interface GraphwarWasmPathfindingResultLayout {
  pathError?: unknown;
  points: GraphwarWasmPackedPointSoA;
  protectionBits: unknown;
}

/** Pathfinding output 的 owned 结果。 */
export interface GraphwarWasmPathfindingResult {
  pathError?: number;
  points: readonly GraphwarWasmPoint[];
  protectionBits: number;
}

/** 验证并写入规范 expression program，不重新解析源文本。 */
export function packGraphwarWasmExpressionProgram(
  arena: GraphwarWasmArenaMemorySource,
  program: GraphwarExpressionProgram,
  minimumPointer = 0,
): GraphwarWasmPackedExpressionProgram {
  if (!isGraphwarExpressionProgram(program)) {
    throw new GraphwarWasmAdapterError(
      "invalid-expression-program",
      "Graphwar expression program is malformed",
      "input",
    );
  }
  return {
    constants: writeGraphwarWasmFloat64Values(arena, program.constants, minimumPointer),
    maximumStackSize: validateGraphwarWasmU32(program.maximumStackSize, "maximumStackSize", "input"),
    opcodes: writeGraphwarWasmBytes(arena, program.opcodes, minimumPointer),
  };
}

/** 验证 RGBA 尺寸并写入一个不可变图像快照。 */
export function packGraphwarWasmRgbaImage(
  arena: GraphwarWasmArenaMemorySource,
  image: Pick<ImageData, "data" | "height" | "width">,
  minimumPointer = 0,
): GraphwarWasmPackedRgbaImage {
  const width = validatePositiveU32(image.width, "image.width");
  const height = validatePositiveU32(image.height, "image.height");
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > Math.floor(0xffff_ffff / 4)) {
    throw new GraphwarWasmAdapterError(
      "invalid-image-data",
      "Graphwar image dimensions overflow RGBA memory32",
      "input",
    );
  }
  const expectedByteLength = pixelCount * 4;
  if (!(image.data instanceof Uint8ClampedArray) || image.data.length !== expectedByteLength) {
    throw new GraphwarWasmAdapterError(
      "invalid-image-data",
      "Graphwar image RGBA length does not match dimensions",
      "input",
    );
  }
  const bytes = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return { height, rgba: writeGraphwarWasmBytes(arena, bytes, minimumPointer), width };
}

/** 验证有限点并一次写入 x/y array。 */
export function packGraphwarWasmPointSoA(
  arena: GraphwarWasmArenaMemorySource,
  points: readonly GraphwarWasmPoint[],
  minimumPointer = 0,
): GraphwarWasmPackedPointSoA {
  if (!Array.isArray(points)) {
    throw new GraphwarWasmAdapterError("invalid-point-data", "Graphwar points must be an array", "input");
  }
  const x = new Float64Array(points.length);
  const y = new Float64Array(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (typeof point !== "object" || point === null) {
      throw new GraphwarWasmAdapterError("invalid-point-data", `points[${index}] must be an object`, "input");
    }
    x[index] = validateGraphwarWasmFiniteNumber(point.x, `points[${index}].x`, "input");
    y[index] = validateGraphwarWasmFiniteNumber(point.y, `points[${index}].y`, "input");
  }
  return {
    length: validateGraphwarWasmU32(points.length, "points.length", "input"),
    x: writeGraphwarWasmFloat64Values(arena, x, minimumPointer),
    y: writeGraphwarWasmFloat64Values(arena, y, minimumPointer),
  };
}

/** 复制并验证 point result；不允许指向可变 WASM memory 的 TypedArray view 逃逸。 */
export function copyGraphwarWasmPointSoA(
  memory: GraphwarWasmMemorySource,
  points: GraphwarWasmPackedPointSoA,
  minimumPointer = 0,
): GraphwarWasmPoint[] {
  const length = validateGraphwarWasmU32(points.length, "points.length", "output");
  if (points.x.length !== length || points.y.length !== length) {
    throw new GraphwarWasmAdapterError("invalid-point-data", "Graphwar point SoA lengths do not match", "output");
  }
  const x = copyGraphwarWasmFloat64Values(memory, points.x, minimumPointer);
  const y = copyGraphwarWasmFloat64Values(memory, points.y, minimumPointer);
  const result: GraphwarWasmPoint[] = [];
  for (let index = 0; index < length; index += 1) {
    result.push({
      x: validateGraphwarWasmFiniteNumber(x[index], `points[${index}].x`, "output"),
      y: validateGraphwarWasmFiniteNumber(y[index], `points[${index}].y`, "output"),
    });
  }
  return result;
}

/**
 * 在唯一 TS→WASM descriptor 边界验证二阶角证据。
 *
 * WASM 仍会验证弧度范围，因为线性内存是独立的运行时边界；单位一致性只在对象 Adapter 校验。
 */
export function validateGraphwarWasmSecondOrderLaunchAngle(
  equation: EquationMode,
  value: unknown,
): GraphwarWasmSecondOrderLaunchAngle | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    equation !== "ddy" ||
    typeof value !== "object" ||
    value === null ||
    !("degrees" in value) ||
    !("radians" in value)
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Only second-order formulas can carry launch-angle evidence",
      "input",
    );
  }
  const degrees = validateGraphwarWasmFiniteNumber(value.degrees, "secondOrderLaunchAngle.degrees", "input");
  const radians = validateGraphwarWasmFiniteNumber(value.radians, "secondOrderLaunchAngle.radians", "input");
  if (radians < -Math.PI / 2 || radians > Math.PI / 2) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Second-order launch angle must stay within Graphwar's firing range",
      "input",
    );
  }
  if (!Object.is(degrees, (radians * 180) / Math.PI)) {
    throw new GraphwarWasmAdapterError(
      "invalid-formula-input",
      "Second-order launch angle degrees and radians do not describe the same value",
      "input",
    );
  }
  return { degrees, radians };
}

/** 打包三种合法生产 stop mode，不产生 optional handle/work 半状态。 */
export function packGraphwarWasmStopPolicy(
  arena: GraphwarWasmArenaMemorySource,
  policy: GraphwarWasmStopPolicy,
  minimumPointer = 0,
): GraphwarWasmPackedStopPolicy {
  if (policy.type === "natural") {
    return { type: "natural" };
  }
  if (policy.type === "stop-x-observations") {
    const observationXs = Float64Array.from(policy.observationXs, (value, index) =>
      validateGraphwarWasmFiniteNumber(value, `observationXs[${index}]`, "input"),
    );
    for (let index = 1; index < observationXs.length; index += 1) {
      if (observationXs[index] < observationXs[index - 1]) {
        throw new GraphwarWasmAdapterError(
          "invalid-formula-input",
          "Trajectory observation x values must be non-decreasing",
          "input",
        );
      }
    }
    return {
      observationXs: writeGraphwarWasmFloat64Values(arena, observationXs, minimumPointer),
      stopX: validateGraphwarWasmFiniteNumber(policy.stopX, "stopX", "input"),
      type: "stop-x-observations",
    };
  }
  if (
    typeof policy.shouldCollectVisiblePixels !== "boolean" ||
    typeof policy.shouldStopOnTargetsComplete !== "boolean"
  ) {
    throw new GraphwarWasmAdapterError(
      "invalid-enum",
      "Trajectory target stop-policy booleans must be explicit",
      "input",
    );
  }
  const orderedTargetCount = validateGraphwarWasmU32(policy.orderedTargets.length, "orderedTargets.length", "input");
  const requiredTargetCount = validateGraphwarWasmU32(policy.requiredTargets.length, "requiredTargets.length", "input");
  const trackedTargetCount = validateGraphwarWasmU32(policy.trackedTargets.length, "trackedTargets.length", "input");
  const targetCount = orderedTargetCount + requiredTargetCount + trackedTargetCount;
  if (!Number.isSafeInteger(targetCount) || targetCount > Math.floor(0xffff_ffff / 24)) {
    throw new GraphwarWasmAdapterError("invalid-memory-buffer", "Trajectory targets overflow memory32", "input");
  }
  const targetRecords = new Float64Array(targetCount * 3);
  let targetIndex = 0;
  for (const targets of [policy.orderedTargets, policy.requiredTargets, policy.trackedTargets]) {
    for (const target of targets) {
      targetRecords[targetIndex] = validateGraphwarWasmFiniteNumber(target.center.x, "target.center.x", "input");
      targetRecords[targetIndex + 1] = validateGraphwarWasmFiniteNumber(target.center.y, "target.center.y", "input");
      const radius = validateGraphwarWasmFiniteNumber(target.radius, "target.radius", "input");
      if (radius < 0) {
        throw new GraphwarWasmAdapterError("invalid-finite-number", "target.radius must be non-negative", "input");
      }
      targetRecords[targetIndex + 2] = radius;
      targetIndex += 3;
    }
  }
  const collision =
    policy.collision.type === "none"
      ? ({ type: "none" } as const)
      : {
          boundaryExpansion: validateNonNegativeFiniteNumber(
            policy.collision.boundaryExpansion,
            "collision.boundaryExpansion",
          ),
          mask: packGraphwarPlaneMask(arena, policy.collision.mask, minimumPointer),
          type: "mask" as const,
        };
  const continueAfterTargetsUntilGraphX =
    policy.continueAfterTargetsUntilGraphX.type === "none"
      ? ({ type: "none" } as const)
      : {
          graphX: validateGraphwarWasmFiniteNumber(
            policy.continueAfterTargetsUntilGraphX.graphX,
            "continueAfterTargetsUntilGraphX.graphX",
            "input",
          ),
          type: "value" as const,
        };
  return {
    boundsRect: {
      height: validatePositiveFiniteNumber(policy.boundsRect.height, "boundsRect.height"),
      width: validatePositiveFiniteNumber(policy.boundsRect.width, "boundsRect.width"),
      x: validateGraphwarWasmFiniteNumber(policy.boundsRect.x, "boundsRect.x", "input"),
      y: validateGraphwarWasmFiniteNumber(policy.boundsRect.y, "boundsRect.y", "input"),
    },
    collision,
    continueAfterTargetsUntilGraphX,
    orderedTargetCount,
    qualityPoints: packGraphwarWasmPointSoA(arena, policy.qualityPoints, minimumPointer),
    requiredTargetCount,
    shouldCollectVisiblePixels: policy.shouldCollectVisiblePixels,
    shouldStopOnTargetsComplete: policy.shouldStopOnTargetsComplete,
    targetRecords: writeGraphwarWasmFloat64Values(arena, targetRecords, minimumPointer),
    trackedTargetCount,
    type: "targets",
  };
}

/** 通过同一个 RGBA/settings Adapter 打包三种 detection command。 */
export function packGraphwarWasmDetectionInput(
  arena: GraphwarWasmArenaMemorySource,
  task: GraphwarDetectionWorkerTask,
  minimumPointer = 0,
): GraphwarWasmPackedDetectionInput {
  const image = packGraphwarWasmRgbaImage(arena, task.imageData, minimumPointer);
  if (task.type === "detect-bounds-only") {
    return { image, type: "detect-bounds-only" };
  }
  const templates = packGraphwarWasmSoldierTemplates(
    arena,
    createGraphwarSoldierTemplateCanonicalData(),
    minimumPointer,
  );
  const settings = writeGraphwarWasmFloat64Values(
    arena,
    new Float64Array([
      validateNonNegativeFiniteNumber(task.thresholds.minArea, "thresholds.minArea"),
      validateGraphwarCandidateTopRatio(
        task.soldierSettings?.candidateTopRatio ?? defaultGraphwarSoldierTemplateCandidateTopRatio,
      ),
      validatePositiveU32(
        task.soldierSettings?.maximumSoldierCount ?? defaultGraphwarMaximumSoldierCount,
        "soldierSettings.maximumSoldierCount",
      ),
      validatePositiveU32(
        task.soldierSettings?.templateMatchingWorkerCount ?? defaultGraphwarTemplateMatchingWorkerCount,
        "soldierSettings.templateMatchingWorkerCount",
      ),
    ]),
    minimumPointer,
  );
  if (task.type === "detect-auto") {
    return { image, settings, templates, type: "detect-auto" };
  }
  return {
    edgeRect: writeGraphwarWasmFloat64Values(
      arena,
      new Float64Array([
        validateGraphwarWasmFiniteNumber(task.edgeRect.x, "edgeRect.x", "input"),
        validateGraphwarWasmFiniteNumber(task.edgeRect.y, "edgeRect.y", "input"),
        validatePositiveFiniteNumber(task.edgeRect.width, "edgeRect.width"),
        validatePositiveFiniteNumber(task.edgeRect.height, "edgeRect.height"),
      ]),
      minimumPointer,
    ),
    image,
    settings,
    templates,
    type: "detect-bounds",
  };
}

/** Packs the canonical template/profile tables without allowing a partial table set. */
export function packGraphwarWasmSoldierTemplates(
  arena: GraphwarWasmArenaMemorySource,
  data: GraphwarSoldierTemplateCanonicalData,
  minimumPointer = 0,
): GraphwarWasmPackedSoldierTemplates {
  return {
    baseFlags: writeGraphwarWasmBytes(arena, data.baseFlags, minimumPointer),
    baseGeometry: writeGraphwarWasmFloat64Values(arena, data.baseGeometry, minimumPointer),
    basePixelRanges: writeGraphwarWasmUint32Values(arena, data.basePixelRanges, minimumPointer),
    pixelCoordinates: writeGraphwarWasmBytes(arena, data.pixelCoordinates, minimumPointer),
    profile: writeGraphwarWasmFloat64Values(arena, createGraphwarSoldierTemplateProfileData(), minimumPointer),
    signatureColors: writeGraphwarWasmUint32Values(arena, data.signatureColors, minimumPointer),
    templateNames: data.templateNames,
    templateRecords: writeGraphwarWasmUint32Values(arena, data.templateRecords, minimumPointer),
  };
}

/** 一次写入 route context 的固定输入，后续碰撞与搜索命令只引用 context pointer。 */
export function packGraphwarWasmRouteContextInput(
  arena: GraphwarWasmArenaMemorySource,
  input: GraphwarWasmRouteContextInput,
  minimumPointer = 0,
): GraphwarWasmPackedRouteContextInput {
  const minX = validateGraphwarWasmFiniteNumber(input.bounds.minX, "bounds.minX", "input");
  const minY = validateGraphwarWasmFiniteNumber(input.bounds.minY, "bounds.minY", "input");
  const maxX = validateGraphwarWasmFiniteNumber(input.bounds.maxX, "bounds.maxX", "input");
  const maxY = validateGraphwarWasmFiniteNumber(input.bounds.maxY, "bounds.maxY", "input");
  if (minX === maxX || minY === maxY) {
    throw new GraphwarWasmAdapterError("invalid-point-data", "Graphwar route bounds must span both axes", "input");
  }
  if (input.sourceMaskType !== "base" && input.sourceMaskType !== "route") {
    throw new GraphwarWasmAdapterError("invalid-enum", "Graphwar route source mask type is invalid", "input");
  }
  const isBaseMask = input.sourceMaskType === "base";
  const context = new Float64Array([
    minX,
    maxX,
    minY,
    maxY,
    validateGraphwarWasmFiniteNumber(input.boundsRect.x, "boundsRect.x", "input"),
    validateGraphwarWasmFiniteNumber(input.boundsRect.y, "boundsRect.y", "input"),
    validatePositiveFiniteNumber(input.boundsRect.width, "boundsRect.width"),
    validatePositiveFiniteNumber(input.boundsRect.height, "boundsRect.height"),
    validateNonNegativeFiniteNumber(input.boundaryExpansion, "boundaryExpansion"),
    validateGraphwarWasmFiniteNumber(input.routeTolerancePlanePixels, "routeTolerancePlanePixels", "input"),
    isBaseMask
      ? validateGraphwarWasmFiniteNumber(
          input.simulationTolerancePlanePixels,
          "simulationTolerancePlanePixels",
          "input",
        )
      : 0,
    validateGraphwarWasmFiniteNumber(input.routeOriginPoint.x, "routeOriginPoint.x", "input"),
    validateGraphwarWasmFiniteNumber(input.routeOriginPoint.y, "routeOriginPoint.y", "input"),
    isBaseMask ? validateNonNegativeFiniteNumber(input.soldierHitRadiusPixels, "soldierHitRadiusPixels") : 0,
  ]);
  const stepRouteModel = input.stepRouteModel;
  let packedStepRouteModel: GraphwarWasmMemorySlice | undefined;
  if (stepRouteModel) {
    const decimalPlaces = validateGraphwarWasmU32(
      stepRouteModel.decimalPlaces,
      "stepRouteModel.decimalPlaces",
      "input",
    );
    if (decimalPlaces > 15) {
      throw new GraphwarWasmAdapterError(
        "invalid-formula-input",
        "stepRouteModel.decimalPlaces must be between 0 and 15",
        "input",
      );
    }
    const formulaSteepness = validatePositiveFiniteNumber(
      stepRouteModel.formulaSteepness,
      "stepRouteModel.formulaSteepness",
    );
    const equation =
      stepRouteModel.equation === "y"
        ? 1
        : stepRouteModel.equation === "dy"
          ? 2
          : stepRouteModel.equation === "ddy"
            ? 3
            : 0;
    if (equation === 0) {
      throw new GraphwarWasmAdapterError("invalid-formula-input", "stepRouteModel.equation is invalid", "input");
    }
    packedStepRouteModel = writeGraphwarWasmFloat64Values(
      arena,
      new Float64Array([
        validateGraphwarWasmFiniteNumber(stepRouteModel.originY, "stepRouteModel.originY", "input"),
        formulaSteepness,
        validateNonNegativeFiniteNumber(
          stepRouteModel.qualityTargetPlanePixels,
          "stepRouteModel.qualityTargetPlanePixels",
        ),
        decimalPlaces,
        equation,
      ]),
      minimumPointer,
    );
  }
  return {
    context: writeGraphwarWasmFloat64Values(arena, context, minimumPointer),
    friendlySoldierCenters: packGraphwarWasmPointSoA(
      arena,
      isBaseMask ? input.friendlySoldierCenters : [],
      minimumPointer,
    ),
    routePolicy: writeGraphwarWasmFloat64Values(arena, createGraphwarRoutePolicyData(), minimumPointer),
    sourceMask: packGraphwarPlaneMask(arena, input.sourceMask, minimumPointer),
    ...(packedStepRouteModel === undefined ? {} : { stepRouteModel: packedStepRouteModel }),
    thetaStarLookaheadColumnOffsets: writeGraphwarWasmBytes(
      arena,
      createGraphwarThetaStarLookaheadColumnOffsetData(),
      minimumPointer,
    ),
  };
}

/** 按稳定 job id 顺序写入无状态几何 edge work，并在边界拒绝重复 id。 */
export function packGraphwarWasmPathfindingGeometryJobs(
  arena: GraphwarWasmArenaMemorySource,
  jobs: readonly GraphwarWasmPathfindingGeometryJob[],
  minimumPointer = 0,
): GraphwarWasmPackedPathfindingGeometryJobs {
  if (!Array.isArray(jobs)) {
    throw new GraphwarWasmAdapterError("invalid-work-batch", "Graphwar pathfinding jobs must be an array", "input");
  }
  const jobCount = validateGraphwarWasmU32(jobs.length, "jobs.length", "input");
  if (jobCount > Math.floor(0x1_0000_0000 / (7 * Float64Array.BYTES_PER_ELEMENT))) {
    throw new GraphwarWasmAdapterError("range-overflow", "Graphwar pathfinding job records exceed memory32", "input");
  }
  const jobIds = new Set<number>();
  const records = new Float64Array(jobCount * 7);
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (!job || typeof job !== "object") {
      throw new GraphwarWasmAdapterError("invalid-work-batch", `jobs[${index}] must be an object`, "input");
    }
    const jobId = validateGraphwarWasmU32(job.jobId, `jobs[${index}].jobId`, "input");
    if (jobIds.has(jobId)) {
      throw new GraphwarWasmAdapterError("duplicate-work-id", `jobs contains duplicate id ${jobId}`, "input");
    }
    jobIds.add(jobId);
    const fromNodeId = validateGraphwarPathfindingNodeId(job.fromNodeId, `jobs[${index}].fromNodeId`, true);
    const toNodeId = validateGraphwarPathfindingNodeId(job.toNodeId, `jobs[${index}].toNodeId`, false);
    const offset = index * 7;
    records.set(
      [
        jobId,
        fromNodeId,
        toNodeId,
        validateGraphwarWasmFiniteNumber(job.startPoint.x, `jobs[${index}].startPoint.x`, "input"),
        validateGraphwarWasmFiniteNumber(job.startPoint.y, `jobs[${index}].startPoint.y`, "input"),
        validateGraphwarWasmFiniteNumber(job.targetPoint.x, `jobs[${index}].targetPoint.x`, "input"),
        validateGraphwarWasmFiniteNumber(job.targetPoint.y, `jobs[${index}].targetPoint.y`, "input"),
      ],
      offset,
    );
  }
  return {
    jobCount,
    records: writeGraphwarWasmFloat64Values(arena, records, minimumPointer),
  };
}

/** 复制并完整验证一次 pathfinding preview event 的 point/index 关系。 */
export function copyGraphwarWasmPathfindingPreviewEvent(
  memory: GraphwarWasmMemorySource,
  layout: GraphwarWasmPathfindingPreviewEventLayout,
  minimumPointer = 0,
): GraphwarWasmPathfindingPreviewEvent {
  const points = copyGraphwarWasmPointSoA(memory, layout.points, minimumPointer);
  const acceptedEdgePointIndexes = copyGraphwarWasmUint32Values(
    memory,
    layout.acceptedEdgePointIndexes,
    minimumPointer,
  );
  if (acceptedEdgePointIndexes.length % 2 !== 0) {
    throw new GraphwarWasmAdapterError("invalid-index", "accepted edge index count must be even", "output");
  }
  const bestPathPointIndexes = copyGraphwarWasmUint32Values(memory, layout.bestPathPointIndexes, minimumPointer);
  const candidatePointIndexes = copyGraphwarWasmUint32Values(memory, layout.candidatePointIndexes, minimumPointer);
  const currentPointIndex = validateGraphwarWasmU32(layout.currentPointIndex, "currentPointIndex", "output");
  const isMirrored = validateGraphwarWasmEnumValue(layout.isMirrored, [0, 1] as const, "isMirrored") === 1;
  const acceptedEdges: [GraphwarWasmPoint, GraphwarWasmPoint][] = [];
  for (let index = 0; index < acceptedEdgePointIndexes.length; index += 2) {
    acceptedEdges.push([
      getGraphwarWasmPathfindingPoint(points, acceptedEdgePointIndexes[index], "acceptedEdgePointIndexes"),
      getGraphwarWasmPathfindingPoint(points, acceptedEdgePointIndexes[index + 1], "acceptedEdgePointIndexes"),
    ]);
  }
  const bestPath = Array.from(bestPathPointIndexes, (index) =>
    getGraphwarWasmPathfindingPoint(points, index, "bestPathPointIndexes"),
  );
  const candidates = Array.from(candidatePointIndexes, (index) =>
    getGraphwarWasmPathfindingPoint(points, index, "candidatePointIndexes"),
  );
  return {
    acceptedEdges,
    bestPath,
    candidates,
    ...(currentPointIndex === 0xffff_ffff
      ? {}
      : { current: getGraphwarWasmPathfindingPoint(points, currentPointIndex, "currentPointIndex") }),
    isMirrored,
  };
}

/** 复制并验证 pathfinding 终态，合法 +Infinity pathError 不会被误判为 fault。 */
export function copyGraphwarWasmPathfindingResult(
  memory: GraphwarWasmMemorySource,
  layout: GraphwarWasmPathfindingResultLayout,
  allowedProtectionBits: number,
  minimumPointer = 0,
): GraphwarWasmPathfindingResult {
  const pathError = validateGraphwarWasmPathError(layout.pathError);
  return {
    ...(pathError === undefined ? {} : { pathError }),
    points: copyGraphwarWasmPointSoA(memory, layout.points, minimumPointer),
    protectionBits: validateGraphwarWasmProtectionBits(layout.protectionBits, allowedProtectionBits),
  };
}

/** Trajectory 与 pathfinding command 的 plane mask 共用唯一规范固定长度。 */
export function packGraphwarPlaneMask(arena: GraphwarWasmArenaMemorySource, mask: Uint8Array, minimumPointer = 0) {
  if (!(mask instanceof Uint8Array) || mask.length !== GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT) {
    throw new GraphwarWasmAdapterError("invalid-image-data", "Graphwar plane mask has an invalid byte length", "input");
  }
  return writeGraphwarWasmBytes(arena, mask, minimumPointer);
}

export function getGraphwarWasmFormulaAlgorithmTag(algorithm: AlgorithmMode) {
  switch (algorithm) {
    case "abs":
      return 1;
    case "step":
      return 2;
    case "pchip":
      return 3;
    case "akima":
      return 4;
    default:
      throw new GraphwarWasmAdapterError("invalid-enum", "Graphwar formula algorithm is unsupported", "input");
  }
}

export function getGraphwarWasmFormulaEquationTag(equation: EquationMode) {
  switch (equation) {
    case "y":
      return 1;
    case "dy":
      return 2;
    case "ddy":
      return 3;
    default:
      throw new GraphwarWasmAdapterError("invalid-enum", "Graphwar equation mode is unsupported", "input");
  }
}

function validatePositiveU32(value: unknown, fieldName: string) {
  const result = validateGraphwarWasmU32(value, fieldName, "input");
  if (result === 0) {
    throw new GraphwarWasmAdapterError("invalid-u32", `${fieldName} must be positive`, "input");
  }
  return result;
}

function validatePositiveFiniteNumber(value: unknown, fieldName: string) {
  const result = validateGraphwarWasmFiniteNumber(value, fieldName, "input");
  if (result <= 0) {
    throw new GraphwarWasmAdapterError("invalid-finite-number", `${fieldName} must be positive`, "input");
  }
  return result;
}

function validateNonNegativeFiniteNumber(value: unknown, fieldName: string) {
  const result = validateGraphwarWasmFiniteNumber(value, fieldName, "input");
  if (result < 0) {
    throw new GraphwarWasmAdapterError("invalid-finite-number", `${fieldName} must be non-negative`, "input");
  }
  return result;
}

function validateGraphwarCandidateTopRatio(value: unknown) {
  const result = validateGraphwarWasmFiniteNumber(value, "soldierSettings.candidateTopRatio", "input");
  if (result <= 0 || result > 1) {
    throw new GraphwarWasmAdapterError(
      "invalid-finite-number",
      "soldierSettings.candidateTopRatio must be greater than zero and at most one",
      "input",
    );
  }
  return result;
}

function validateGraphwarPathfindingNodeId(value: unknown, fieldName: string, canUseStartSentinel: boolean) {
  if (canUseStartSentinel && value === -1) {
    return -1;
  }
  return validateGraphwarWasmU32(value, fieldName, "input");
}

function getGraphwarWasmPathfindingPoint(points: readonly GraphwarWasmPoint[], index: number, fieldName: string) {
  const point = points[index];
  if (!point) {
    throw new GraphwarWasmAdapterError(
      "invalid-index",
      `${fieldName} contains out-of-range point index ${index}`,
      "output",
    );
  }
  return point;
}
