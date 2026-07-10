/** 为 Step 寻路提供严格包络构造和固定 Graphwar 平面上的 O(1) 闭域判空。 */
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import type { GraphBounds } from "../../core/types";

/** Graphwar 坐标中的轴对齐闭域。 */
export interface GraphClosedRegion {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

/** Graphwar 原始平面 mask 中的轴对齐闭域；四个端点都是包含关系。 */
export interface PlaneMaskClosedRegion {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

/** 最终 Step 中心和解析补偿后的平台高度，均使用 Graphwar 坐标。 */
export interface GraphwarStepEnvelopeInput {
  centerX: number;
  endX: number;
  resolvedEndY: number;
  resolvedStartY: number;
  startX: number;
}

/** 一段 Step 的水平前缀和两块半高矩形。 */
export interface GraphwarStepEnvelope {
  /** 跳转前的水平前缀 H。 */
  h: GraphClosedRegion;
  /** 第一块半高矩形 R0。 */
  r0: GraphClosedRegion;
  /** 第二块半高矩形 R1。 */
  r1: GraphClosedRegion;
  /** 两个平台高度的中点 ym。 */
  ym: number;
  /** 最终中心关于终点的对称点 xs。 */
  xs: number;
}

export type GraphwarStepEnvelopeInvalidReason =
  | "center-outside-segment"
  | "non-finite"
  | "non-forward"
  | "symmetric-start-before-segment";

export type GraphwarStepEnvelopeResult =
  | { envelope: GraphwarStepEnvelope; ok: true }
  | { ok: false; reason: GraphwarStepEnvelopeInvalidReason };

/** Step 包络映射到原始平面 mask 后的三个闭域。 */
export interface PlaneMaskStepEnvelope {
  h: PlaneMaskClosedRegion;
  r0: PlaneMaskClosedRegion;
  r1: PlaneMaskClosedRegion;
}

/** 固定 770x450 mask 的二维前缀和；第 0 行和第 0 列是空边界。 */
export interface GraphwarPlaneMaskSummedArea {
  readonly data: Uint32Array;
  readonly height: number;
  readonly stride: number;
  readonly width: number;
}

/**
 * 用最终舍入后的中心构造严格 Step 包络。
 *
 * Xs 落在段起点左侧意味着该 sigmoid 需要更早开始，当前边不能通过裁剪来放宽。
 */
export function createGraphwarStepEnvelope(input: GraphwarStepEnvelopeInput): GraphwarStepEnvelopeResult {
  const { centerX, endX, resolvedEndY, resolvedStartY, startX } = input;
  if (![centerX, endX, resolvedEndY, resolvedStartY, startX].every(Number.isFinite)) {
    return { ok: false, reason: "non-finite" };
  }
  if (!(endX > startX)) {
    return { ok: false, reason: "non-forward" };
  }
  if (centerX > endX) {
    return { ok: false, reason: "center-outside-segment" };
  }

  // c - (x1 - c) 避免 2*c 在大坐标下先溢出。
  const xs = centerX - (endX - centerX);
  const ym = resolvedStartY / 2 + resolvedEndY / 2;
  if (!Number.isFinite(xs) || !Number.isFinite(ym)) {
    return { ok: false, reason: "non-finite" };
  }
  if (xs < startX) {
    return { ok: false, reason: "symmetric-start-before-segment" };
  }

  return {
    envelope: {
      h: createGraphClosedRegion(startX, xs, resolvedStartY, resolvedStartY),
      r0: createGraphClosedRegion(xs, centerX, resolvedStartY, ym),
      r1: createGraphClosedRegion(centerX, endX, ym, resolvedEndY),
      xs,
      ym,
    },
    ok: true,
  };
}

/** 将任意两个 Graphwar 端点归一化为轴对齐闭域。 */
export function createGraphClosedRegion(startX: number, endX: number, startY: number, endY: number): GraphClosedRegion {
  return {
    maxX: Math.max(startX, endX),
    maxY: Math.max(startY, endY),
    minX: Math.min(startX, endX),
    minY: Math.min(startY, endY),
  };
}

/** 为一个固定 Graphwar 原始平面 mask 构建二维前缀和；非零 mask 值都按一个障碍 cell 计数。 */
export function createGraphwarPlaneMaskSummedArea(mask: Uint8Array): GraphwarPlaneMaskSummedArea {
  const expectedLength = GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT;
  if (mask.length !== expectedLength) {
    throw new RangeError(`Expected a ${expectedLength}-cell Graphwar plane mask, received ${mask.length}.`);
  }

  const stride = GRAPHWAR_PLANE_LENGTH + 1;
  const data = new Uint32Array(stride * (GRAPHWAR_PLANE_HEIGHT + 1));
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    const maskRowOffset = y * GRAPHWAR_PLANE_LENGTH;
    const previousRowOffset = y * stride;
    const rowOffset = (y + 1) * stride;
    let rowCount = 0;
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      rowCount += mask[maskRowOffset + x] ? 1 : 0;
      data[rowOffset + x + 1] = data[previousRowOffset + x + 1] + rowCount;
    }
  }

  return {
    data,
    height: GRAPHWAR_PLANE_HEIGHT,
    stride,
    width: GRAPHWAR_PLANE_LENGTH,
  };
}

/**
 * 将 Graphwar 闭域保守映射为 mask 闭域。
 *
 * 连续坐标恰好落在 cell 网格线上时，两侧相接的 cell 都会被纳入；水平镜像由反向 x bounds 自然处理。
 */
export function mapGraphClosedRegionToPlaneMask(
  region: GraphClosedRegion,
  bounds: GraphBounds,
): PlaneMaskClosedRegion | undefined {
  if (!graphRegionAndBoundsAreValid(region, bounds)) {
    return undefined;
  }

  const startPlaneX = graphXToPlaneBoundary(region.minX, bounds);
  const endPlaneX = graphXToPlaneBoundary(region.maxX, bounds);
  const startPlaneY = graphYToPlaneBoundary(region.minY, bounds);
  const endPlaneY = graphYToPlaneBoundary(region.maxY, bounds);
  return createConservativePlaneMaskRegion(startPlaneX, endPlaneX, startPlaneY, endPlaneY);
}

/** 一次映射 Step 的三个闭域；任一域越出有效 Graphwar bounds 时整段无效。 */
export function mapGraphwarStepEnvelopeToPlaneMask(
  envelope: GraphwarStepEnvelope,
  bounds: GraphBounds,
): PlaneMaskStepEnvelope | undefined {
  const h = mapGraphClosedRegionToPlaneMask(envelope.h, bounds);
  const r0 = mapGraphClosedRegionToPlaneMask(envelope.r0, bounds);
  const r1 = mapGraphClosedRegionToPlaneMask(envelope.r1, bounds);
  return h && r0 && r1 ? { h, r0, r1 } : undefined;
}

/** 判断一个 mask 闭域是否完全位于边界内收后的可用平面中。 */
export function planeMaskRegionFitsBoundaryInset(region: PlaneMaskClosedRegion, boundaryInset: number) {
  if (!planeMaskRegionIsValid(region) || !Number.isFinite(boundaryInset) || boundaryInset < 0) {
    return false;
  }

  const inset = Math.floor(boundaryInset);
  return (
    region.minX >= inset &&
    region.maxX < GRAPHWAR_PLANE_LENGTH - inset &&
    region.minY >= inset &&
    region.maxY < GRAPHWAR_PLANE_HEIGHT - inset
  );
}

/** 用四次前缀和读取统计闭域内的障碍 cell 数量；零宽或零高域无需特判。 */
export function countPlaneMaskRegionObstacles(summedArea: GraphwarPlaneMaskSummedArea, region: PlaneMaskClosedRegion) {
  if (
    !planeMaskRegionIsValid(region) ||
    summedArea.width !== GRAPHWAR_PLANE_LENGTH ||
    summedArea.height !== GRAPHWAR_PLANE_HEIGHT ||
    summedArea.stride !== GRAPHWAR_PLANE_LENGTH + 1 ||
    summedArea.data.length !== summedArea.stride * (summedArea.height + 1)
  ) {
    throw new RangeError("Invalid Graphwar plane summed-area query.");
  }

  const { data, stride } = summedArea;
  const beforeMinRow = region.minY * stride;
  const afterMaxRow = (region.maxY + 1) * stride;
  const minX = region.minX;
  const afterMaxX = region.maxX + 1;
  return (
    data[afterMaxRow + afterMaxX] -
    data[beforeMinRow + afterMaxX] -
    data[afterMaxRow + minX] +
    data[beforeMinRow + minX]
  );
}

/** 边界内收外部直接视为障碍，否则用二维前缀和执行 O(1) 闭域判空。 */
export function planeMaskRegionHitsObstacle(
  summedArea: GraphwarPlaneMaskSummedArea,
  region: PlaneMaskClosedRegion,
  boundaryInset: number,
) {
  return (
    !planeMaskRegionFitsBoundaryInset(region, boundaryInset) || countPlaneMaskRegionObstacles(summedArea, region) > 0
  );
}

/** Graphwar 闭域映射失败、触碰收缩边界或包含障碍时都返回 true。 */
export function graphClosedRegionHitsPlaneMask(
  region: GraphClosedRegion,
  bounds: GraphBounds,
  summedArea: GraphwarPlaneMaskSummedArea,
  boundaryInset: number,
) {
  const planeRegion = mapGraphClosedRegionToPlaneMask(region, bounds);
  return !planeRegion || planeMaskRegionHitsObstacle(summedArea, planeRegion, boundaryInset);
}

/** 严格检查 H ∪ R0 ∪ R1；三个域全部为空时才允许该 Step 边。 */
export function graphwarStepEnvelopeHitsPlaneMask(
  envelope: GraphwarStepEnvelope,
  bounds: GraphBounds,
  summedArea: GraphwarPlaneMaskSummedArea,
  boundaryInset: number,
) {
  const planeEnvelope = mapGraphwarStepEnvelopeToPlaneMask(envelope, bounds);
  return (
    !planeEnvelope ||
    planeMaskRegionHitsObstacle(summedArea, planeEnvelope.h, boundaryInset) ||
    planeMaskRegionHitsObstacle(summedArea, planeEnvelope.r0, boundaryInset) ||
    planeMaskRegionHitsObstacle(summedArea, planeEnvelope.r1, boundaryInset)
  );
}

function graphRegionAndBoundsAreValid(region: GraphClosedRegion, bounds: GraphBounds) {
  if (
    ![region.maxX, region.maxY, region.minX, region.minY, bounds.maxX, bounds.maxY, bounds.minX, bounds.minY].every(
      Number.isFinite,
    ) ||
    region.minX > region.maxX ||
    region.minY > region.maxY ||
    bounds.minX === bounds.maxX ||
    bounds.minY === bounds.maxY
  ) {
    return false;
  }

  const graphMinX = Math.min(bounds.minX, bounds.maxX);
  const graphMaxX = Math.max(bounds.minX, bounds.maxX);
  const graphMinY = Math.min(bounds.minY, bounds.maxY);
  const graphMaxY = Math.max(bounds.minY, bounds.maxY);
  return region.minX >= graphMinX && region.maxX <= graphMaxX && region.minY >= graphMinY && region.maxY <= graphMaxY;
}

function graphXToPlaneBoundary(x: number, bounds: GraphBounds) {
  return ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * GRAPHWAR_PLANE_LENGTH;
}

function graphYToPlaneBoundary(y: number, bounds: GraphBounds) {
  return ((bounds.maxY - y) / (bounds.maxY - bounds.minY)) * GRAPHWAR_PLANE_HEIGHT;
}

/** 闭域贴网格线时包含两侧 cell；平面外的一侧没有 cell，因此最后裁到固定 mask。 */
function createConservativePlaneMaskRegion(startX: number, endX: number, startY: number, endY: number) {
  const minPlaneX = snapToPlaneGridLine(Math.min(startX, endX));
  const maxPlaneX = snapToPlaneGridLine(Math.max(startX, endX));
  const minPlaneY = snapToPlaneGridLine(Math.min(startY, endY));
  const maxPlaneY = snapToPlaneGridLine(Math.max(startY, endY));
  const region: PlaneMaskClosedRegion = {
    maxX: Math.min(GRAPHWAR_PLANE_LENGTH - 1, Math.floor(maxPlaneX)),
    maxY: Math.min(GRAPHWAR_PLANE_HEIGHT - 1, Math.floor(maxPlaneY)),
    minX: Math.max(0, Math.ceil(minPlaneX) - 1),
    minY: Math.max(0, Math.ceil(minPlaneY) - 1),
  };
  return planeMaskRegionIsValid(region) ? region : undefined;
}

/** 折算产生的 ULP 残差不应让数学上精确的网格线漏掉一侧 cell。 */
function snapToPlaneGridLine(value: number) {
  const nearestInteger = Math.round(value);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(nearestInteger)) * 4;
  return Math.abs(value - nearestInteger) <= tolerance ? nearestInteger : value;
}

function planeMaskRegionIsValid(region: PlaneMaskClosedRegion) {
  return (
    Number.isInteger(region.minX) &&
    Number.isInteger(region.maxX) &&
    Number.isInteger(region.minY) &&
    Number.isInteger(region.maxY) &&
    region.minX >= 0 &&
    region.maxX < GRAPHWAR_PLANE_LENGTH &&
    region.minY >= 0 &&
    region.maxY < GRAPHWAR_PLANE_HEIGHT &&
    region.minX <= region.maxX &&
    region.minY <= region.maxY
  );
}
