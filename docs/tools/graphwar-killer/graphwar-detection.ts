/** 从 Graphwar 截图像素中识别棋盘、士兵和障碍 mask。 */
import {
  GRAPHWAR_PLANE_HEIGHT,
  GRAPHWAR_PLANE_LENGTH,
  GRAPHWAR_SOLDIER_RADIUS,
  GRAPHWAR_SOLDIER_VISIBLE_SIZE,
} from "./graphwar";
import { clampNumber, formatSvgNumber } from "./numbers";
import { createPixelPoint } from "./types";
import type { BoundsRect, PixelPoint } from "./types";

/** 当前识别系统只把士兵作为可点击/可击杀目标。 */
export type GraphwarDetectionKind = "soldier";

/** 截图上的检测框，坐标均为图片像素。 */
export interface GraphwarDetectionBox extends BoundsRect {
  /** Graphwar 士兵源码坐标中心；发射、命中和路径点都应使用这个点。 */
  sourceCenterX: number;
  /** Graphwar 士兵源码坐标中心；发射、命中和路径点都应使用这个点。 */
  sourceCenterY: number;
  /** 可见士兵贴图外框中心；只用于 UI 选中圈和视觉路径圈。 */
  visualCenterX: number;
  /** 可见士兵贴图外框中心；只用于 UI 选中圈和视觉路径圈。 */
  visualCenterY: number;
  /** Graphwar 源码里的命中半径换算到截图后的像素长度。 */
  hitRadius: number;
  /** Graphwar 原版士兵可见贴图外框半径换算到截图后的像素长度，用于 UI 圈。 */
  visualRadius: number;
  /** Graphwar 原版士兵可见贴图外框半径换算到截图后的像素长度，用于选中和路径圈。 */
  selectionRadius: number;
  /** 匹配到的 Graphwar 士兵模板名，来自 rsc/soldiers/*.png。 */
  templateName: string;
  /** Graphwar 渲染时该士兵贴图是否横向镜像。 */
  mirrored: boolean;
  /** 模板匹配置信度，1 表示高置信匹配。 */
  confidence: number;
  /** 稳定检测 id，用于路径、缓存和一键清图 route 串联。 */
  id: string;
  /** 检测类型。 */
  kind: GraphwarDetectionKind;
}

/** 障碍识别阈值；页面负责解析输入，识别 Module 只消费数值。 */
export interface GraphwarObstacleDetectionThresholds {
  /** 最小障碍连通域面积，单位为 Graphwar 原始平面像素。 */
  minArea: number;
}

/** 士兵识别设定；页面负责解析输入，识别 Module 只消费数值。 */
export interface GraphwarSoldierDetectionSettings {
  /** 最终保留的士兵数量上限。 */
  maximumSoldierCount: number;
  /** 模板评分前只保留投票排名靠前的候选比例，取值 0 到 1。 */
  candidateTopRatio: number;
  /** 士兵模板匹配阶段使用的 worker 数量。 */
  templateMatchingWorkerCount: number;
}

/** 障碍识别结果，mask 使用 Graphwar 原始 770x450 平面。 */
export interface DetectedObstacleMap {
  /** 障碍 mask，1 表示障碍。 */
  mask: Uint8Array;
  /** 过滤后障碍连通域数量。 */
  count: number;
}

/** 识别成功但过程中出现了可回退的异常。 */
export interface GraphwarDetectionWarning {
  /** 稳定警告代码，供页面选择本地化展示文案。 */
  code: "template-matching-worker-fallback";
  /** 具体异常信息，保留原始错误方便调试。 */
  message: string;
}

/** 指定棋盘边界内的一次完整对象识别结果。 */
export interface GraphwarObjectsDetectionResult {
  /** 识别出的士兵检测框。 */
  soldiers: GraphwarDetectionBox[];
  /** 过滤后的障碍 mask。 */
  obstacles: DetectedObstacleMap;
  /** 识别成功但有部分阶段发生回退时的调试警告。 */
  warnings?: GraphwarDetectionWarning[];
}

/** 对象识别内部阶段，用于调试耗时拆分。 */
export type GraphwarObjectDetectionStage =
  | "building-obstacle-mask"
  | "collecting-soldier-candidates"
  | "filtering-obstacle-components"
  | "matching-soldier-templates";

/** 对象识别阶段计时钩子；runner 和 worker 用它收集同一套耗时指标。 */
export interface GraphwarObjectDetectionInstrumentation {
  /** 调用方提供阶段计时器；识别算法本身不依赖具体时钟实现。 */
  measureStage: <TResult>(stage: GraphwarObjectDetectionStage, task: () => TResult) => TResult;
}

/** Graphwar 原始平面网格点。 */
export interface PlaneGridPoint {
  /** 平面 x。 */
  x: number;
  /** 平面 y。 */
  y: number;
}

/** 连通域框，识别士兵和障碍时会附带面积和中心点。 */
interface ComponentBox extends BoundsRect {
  /** 连通域像素面积。 */
  area: number;
  /** 连通域中心 x。 */
  centerX: number;
  /** 连通域中心 y。 */
  centerY: number;
}

/** 可能的坐标轴线段组。 */
interface AxisGroup {
  /** 组起始扫描坐标。 */
  start: number;
  /** 组结束扫描坐标。 */
  end: number;
  /** 组中心坐标。 */
  coordinate: number;
  /** 黑色轴线密度得分。 */
  score: number;
}

/** 由左/中/右或上/中/下三条轴线组成的棋盘候选。 */
interface AxisTriplet {
  /** 第一条边界轴。 */
  first: AxisGroup;
  /** 中心轴。 */
  middle: AxisGroup;
  /** 最后一条边界轴。 */
  last: AxisGroup;
  /** 组合得分。 */
  score: number;
}

/** Graphwar 士兵贴图源码画布是 20x20，Soldier.x/y 位于画布中心。 */
const graphwarSoldierCanvasCenter = 10;
/** 非镜像士兵 alpha 外框在 20x20 画布里的视觉中心 x。 */
const graphwarSoldierVisibleCenterX = 9.5;
/** 士兵 alpha 外框在 20x20 画布里的视觉中心 y。 */
const graphwarSoldierVisibleCenterY = 9.5;
/** 镜像士兵 alpha 外框在 20x20 画布里的视觉中心 x。 */
const graphwarSoldierMirrorVisibleCenterX = 10.5;
/** Graphwar 原版 10 帧士兵动画资源名。 */
const graphwarSoldierTemplateNames = [
  "soldierNormal.png",
  "soldier1.png",
  "soldier2.png",
  "soldier3.png",
  "soldier4.png",
  "soldier5.png",
  "soldier6.png",
  "soldier7.png",
  "soldier8.png",
  "soldier9.png",
] as const;
/** 固定像素分数阈值来自测试素材最终匹配点全局最低分；-0.05 容忍压缩、缩放和抗锯齿。 */
const graphwarSoldierTemplateMinimumFixedScore = 0.80524047124047127 - 0.05;
/** 前景形状分数阈值来自测试素材最终匹配点全局最低分；-0.05 容忍压缩、缩放和抗锯齿。 */
const graphwarSoldierTemplateMinimumForegroundScore = 0.69445266272189365 - 0.05;
/** 玩家色分数阈值来自测试素材最终匹配点全局最低分；-0.05 容忍压缩、缩放和抗锯齿。 */
const graphwarSoldierTemplateMinimumPlayerScore = 0.60552198292591419 - 0.05;
/** 动画签名分数阈值来自测试素材最终匹配点全局最低分；-0.05 容忍压缩、缩放和抗锯齿。 */
const graphwarSoldierTemplateMinimumSignatureScore = 0.71937830687830706 - 0.05;
/** 测试素材里无限制候选最终匹配点都在 votes 前 10%，因此模板评分前默认只保留前 10%。 */
const defaultGraphwarSoldierTemplateCandidateTopRatio = 0.1;
/** Graphwar 游戏设定默认最多 40 个士兵；用于重叠抑制后的最终检测数量上限。 */
const defaultGraphwarMaximumSoldierCount = 40;
/** 模板匹配默认并行 worker 数；页面会限制用户输入范围。 */
const defaultGraphwarTemplateMatchingWorkerCount = 4;
/** 同一士兵附近会产生多个高分中心候选；低于这个源码像素间距的匹配视为同一士兵。 */
const graphwarSoldierGenerationMinimumAxisGap = 20;
/** 从 10 帧士兵动画里挑出的差异像素坐标，用于区分 soldierNormal/soldier1..9。 */
const graphwarSoldierAnimationSignatureCoordinates = [
  [13, 6],
  [14, 6],
  [15, 6],
  [11, 7],
  [12, 7],
  [13, 7],
  [14, 7],
  [15, 7],
  [9, 8],
  [10, 8],
  [11, 8],
  [12, 8],
  [13, 8],
  [14, 8],
  [15, 8],
  [13, 9],
  [14, 9],
  [15, 9],
  [13, 10],
  [14, 10],
  [15, 10],
] as const;
/** 上面签名坐标在各动画帧中的固定颜色，来自 GraphPlane#addHelmet 合成后的士兵贴图量测。 */
const graphwarSoldierAnimationSignatureColorsByName = {
  "soldierNormal.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "fbfbfc",
    "fffffe",
    "fdfdfd",
    "b5b5b5",
    "d3d367",
    "d3d7da",
    "ffffff",
    "fffffe",
    "ffffff",
    "fafaf9",
    "797979",
    "b3b386",
    "fffffe",
    "ffffff",
    "ffffbf",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
  "soldier1.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "fbfbfc",
    "fdfdfc",
    "b5b5b5",
    "d3d3d3",
    "ffff7d",
    "d3d7da",
    "ffffff",
    "fffffe",
    "fafafa",
    "797978",
    "b3b3b3",
    "ffffc0",
    "fffffe",
    "ffffff",
    "ffffbf",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
  "soldier2.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "fbfbfc",
    "fdfdfc",
    "b5b5b5",
    "d3d3d3",
    "ffff7d",
    "d3d7da",
    "ffffff",
    "fffffe",
    "fafafa",
    "797978",
    "b3b3b3",
    "ffffc0",
    "fffffe",
    "ffffff",
    "ffffbf",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
  "soldier3.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "f9f9fa",
    "b5b5b4",
    "d3d3d3",
    "ffffff",
    "ffff7d",
    "d3d7da",
    "ffffff",
    "fafaf9",
    "797979",
    "b3b3b2",
    "ffffff",
    "ffffc0",
    "fffffe",
    "ffffff",
    "ffffbf",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
  "soldier4.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "b2b2b3",
    "d3d3d2",
    "ffffff",
    "ffffff",
    "ffff7d",
    "d3d7da",
    "fafafa",
    "797978",
    "b3b3b3",
    "fffffe",
    "ffffff",
    "ffffc0",
    "fffffe",
    "ffffff",
    "ffffbf",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
  "soldier5.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "d0d0d1",
    "fffffe",
    "ffffff",
    "ffffff",
    "ffff7d",
    "cfd3d6",
    "797979",
    "b3b3b2",
    "ffffff",
    "fffffe",
    "ffffff",
    "ffffc0",
    "fffffe",
    "ffffff",
    "ffffbf",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
  "soldier6.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "fbfbfc",
    "fffffe",
    "ffffff",
    "ffffff",
    "ffff7d",
    "d3d7da",
    "ffffff",
    "fffffe",
    "ffffff",
    "fdfdfc",
    "b5b5b5",
    "d3d39e",
    "fafaf9",
    "797979",
    "b3b386",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
  "soldier7.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "fbfbfc",
    "fffffe",
    "ffffff",
    "ffffff",
    "ffff7d",
    "d3d7da",
    "ffffff",
    "fffffe",
    "ffffff",
    "fffffe",
    "ffffff",
    "ffffc0",
    "fdfdfc",
    "b5b5b5",
    "d3d39e",
    "fafafa",
    "797979",
    "b3b354",
  ],
  "soldier8.png": [
    "ffffff",
    "ffffb2",
    "ffff16",
    "fbfbfc",
    "fffffe",
    "fdfdfd",
    "b5b5b5",
    "d3d367",
    "d3d7da",
    "ffffff",
    "fffffe",
    "ffffff",
    "fafaf9",
    "797979",
    "b3b386",
    "fffffe",
    "ffffff",
    "ffffbf",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
  "soldier9.png": [
    "fdfdfd",
    "b5b57e",
    "d3d312",
    "fbfbfc",
    "fffffe",
    "fafafa",
    "797979",
    "b3b357",
    "d3d7da",
    "ffffff",
    "fffffe",
    "ffffff",
    "fffffe",
    "ffffff",
    "ffffc0",
    "fffffe",
    "ffffff",
    "ffffbf",
    "ffffff",
    "ffffff",
    "ffff78",
  ],
} as const;

/** Java2D GraphPlane#addHelmet 后 alpha>=128 的 20x20 可见模板。 */
const graphwarSoldierSolidGrid = [
  "....................",
  "....................",
  "......########......",
  ".....##########.....",
  "....###########.....",
  "...#############....",
  "..###############...",
  "..###############...",
  "..###############...",
  "..################..",
  "..################..",
  "..###############...",
  "..###############...",
  "...##############...",
  "....############....",
  ".....##########.....",
  "......########......",
  ".........##.........",
  "....................",
  "....................",
] as const;

/** GraphPlane#addHelmet 中受玩家随机颜色影响的 alpha>=128 像素。 */
const graphwarSoldierPlayerColorGrid = [
  "....................",
  "....................",
  "......########......",
  ".....##########.....",
  "....###########.....",
  "...###########......",
  "..##########........",
  "..#########.........",
  "..########..........",
  "..######............",
  "..#####.............",
  "..####..............",
  "..##................",
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
] as const;

/** GraphPlane#addHelmet 中不受玩家随机颜色影响的 alpha>=128 固定像素。 */
const graphwarSoldierFixedColorGrid = [
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
  "..............##....",
  "............#####...",
  "...........######...",
  "..........#######...",
  "........##########..",
  ".......###########..",
  "......###########...",
  "....#############...",
  "...##############...",
  "....############....",
  ".....##########.....",
  "......########......",
  ".........##.........",
  "....................",
  "....................",
] as const;

/** GraphPlane#addHelmet 后固定黄色/白色高亮信号；只用于反推候选，最终中心由模板验证决定。 */
const graphwarSoldierFixedSeedGrid = [
  "....................",
  "....................",
  "....................",
  "....................",
  "....................",
  ".............###....",
  "...............##...",
  "...............###..",
  "................##..",
  "........#.......##..",
  ".......##......###..",
  ".....#####.....###..",
  "....##############..",
  "...##############...",
  "....############....",
  ".....##########.....",
  "......########......",
  ".......######.......",
  "....................",
  "....................",
] as const;

/** 士兵模板中的一个画布像素坐标。 */
interface SoldierTemplatePixel {
  /** 模板画布内 x 坐标。 */
  x: number;
  /** 模板画布内 y 坐标。 */
  y: number;
}

/** 士兵模板中需要同时匹配固定颜色的像素。 */
interface SoldierTemplateColorPixel extends SoldierTemplatePixel {
  /** GraphPlane#addHelmet 合成后的固定 RGB 颜色。 */
  color: string;
}

/** 单个动画帧和朝向展开后的士兵模板。 */
interface SoldierTemplate {
  /** Graphwar 源码资源名。 */
  name: string;
  /** 是否按 GraphPlane#drawSoldiers 镜像绘制。 */
  mirrored: boolean;
  /** Alpha>=128 的合成前景像素。 */
  foregroundPixels: SoldierTemplatePixel[];
  /** 受玩家随机颜色影响的前景像素。 */
  playerPixels: SoldierTemplatePixel[];
  /** 不受玩家随机颜色影响的固定前景像素。 */
  fixedPixels: SoldierTemplatePixel[];
  /** 用于从固定颜色种子反推源码中心的像素。 */
  seedPixels: SoldierTemplatePixel[];
  /** 各 soldierNormal/soldier1..9 帧真实差异像素，用于区分源码动画模板。 */
  signaturePixels: SoldierTemplateColorPixel[];
  /** 可见 alpha 外框中心在 20x20 画布内的 x。 */
  visualCenterX: number;
  /** 可见 alpha 外框中心在 20x20 画布内的 y。 */
  visualCenterY: number;
}

/** 同一朝向下所有动画帧共享的模板像素集合。 */
interface SoldierTemplateBase {
  /** 是否按 GraphPlane#drawSoldiers 镜像绘制。 */
  mirrored: boolean;
  /** Alpha>=128 的合成前景像素。 */
  foregroundPixels: SoldierTemplatePixel[];
  /** 受玩家随机颜色影响的前景像素。 */
  playerPixels: SoldierTemplatePixel[];
  /** 不受玩家随机颜色影响的固定前景像素。 */
  fixedPixels: SoldierTemplatePixel[];
  /** 用于从固定颜色种子反推源码中心的像素。 */
  seedPixels: SoldierTemplatePixel[];
  /** 同一朝向下的 10 帧动画模板。 */
  templates: SoldierTemplate[];
  /** 签名像素完全相同的动画帧只保留首个模板，避免重复评分。 */
  uniqueSignatureTemplates: SoldierTemplate[];
  /** 可见 alpha 外框中心在 20x20 画布内的 x。 */
  visualCenterX: number;
  /** 可见 alpha 外框中心在 20x20 画布内的 y。 */
  visualCenterY: number;
}

/** 候选源码中心完成模板评分后的最佳匹配结果。 */
export interface SoldierMatchCandidate {
  /** 源码 Soldier.x 对应的截图像素 x。 */
  sourceCenterX: number;
  /** 源码 Soldier.y 对应的截图像素 y。 */
  sourceCenterY: number;
  /** 匹配到的 Graphwar 士兵模板名，来自 rsc/soldiers/*.png。 */
  templateName: string;
  /** Graphwar 渲染时该士兵贴图是否横向镜像。 */
  mirrored: boolean;
  /** 综合模板匹配分数。 */
  score: number;
  /** 固定像素匹配分数。 */
  fixedScore: number;
  /** 前景形状匹配分数。 */
  foregroundScore: number;
  /** 估计出的玩家颜色一致性分数。 */
  playerScore: number;
  /** 固定动画差异像素分数。 */
  signatureScore: number;
  /** 固定黄色种子反投票数，用于同分时优先保留更可信的源码中心。 */
  votes: number;
}

/** 从黄色/白色固定种子反推出来的源码中心候选。 */
export interface SoldierTemplateCenterCandidate {
  /** 该候选源码中心对应的士兵绘制方向。 */
  mirrored: boolean;
  /** 截图像素 x。 */
  x: number;
  /** 截图像素 y。 */
  y: number;
  /** 固定黄色种子反投票数。 */
  votes: number;
}

/** 与具体动画帧无关、同一朝向可复用的模板评分。 */
interface SoldierTemplateBaseScore {
  /** 周围背景像素疑似仍属于士兵时扣除的惩罚。 */
  backgroundPenalty: number;
  /** 固定颜色像素匹配分数。 */
  fixedScore: number;
  /** Alpha 前景形状匹配分数。 */
  foregroundScore: number;
  /** 玩家随机颜色一致性分数。 */
  playerScore: number;
}

/** 按朝向预构建的士兵模板基础数据，避免每次识别重复展开网格。 */
const graphwarSoldierTemplateBases = createGraphwarSoldierTemplateBases();

/** 使用 Canvas 像素自动检测 Graphwar 棋盘边界，再按该边界识别士兵和障碍。 */
export function detectGraphwarObjectsInBounds(
  imageData: ImageData,
  edgeRect: BoundsRect,
  thresholds: GraphwarObstacleDetectionThresholds,
  soldierSettings?: GraphwarSoldierDetectionSettings,
  instrumentation?: GraphwarObjectDetectionInstrumentation,
): GraphwarObjectsDetectionResult {
  const soldierMatches = detectSoldierMatches(imageData, edgeRect, soldierSettings, instrumentation);
  const soldiers = createSoldierDetectionBoxes(soldierMatches.matches, edgeRect);
  return {
    soldiers,
    obstacles: detectGraphwarObstaclesInBounds(imageData, edgeRect, thresholds, soldiers, instrumentation),
  };
}

/** 通过 Graphwar 的黑色坐标轴三线结构推断棋盘区域。 */
export function detectGraphwarPlayArea(imageData: ImageData): BoundsRect | undefined {
  const targetAspectRatio = 770 / 450;
  const verticalTriplets = buildAxisTriplets(detectAxisGroups(imageData, "vertical"));
  const horizontalTriplets = buildAxisTriplets(detectAxisGroups(imageData, "horizontal"));
  let bestRect: BoundsRect | undefined;
  let bestScore = 0;

  for (const vertical of verticalTriplets) {
    for (const horizontal of horizontalTriplets) {
      const rect = createGraphwarPlaneRect(vertical, horizontal);
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const aspectRatio = rect.width / rect.height;
      if (aspectRatio < targetAspectRatio * 0.7 || aspectRatio > targetAspectRatio * 1.28) {
        continue;
      }

      const expectedAxisX = rect.x + rect.width / 2;
      const expectedAxisY = rect.y + rect.height / 2;
      const axisOffset =
        Math.abs(vertical.middle.coordinate - expectedAxisX) / rect.width +
        Math.abs(horizontal.middle.coordinate - expectedAxisY) / rect.height;
      if (axisOffset > 0.16) {
        continue;
      }

      const aspectPenalty = Math.min(Math.abs(aspectRatio - targetAspectRatio) / targetAspectRatio, 0.5);
      const score =
        rect.width * rect.height * vertical.score * horizontal.score * (1 - aspectPenalty) * (1 - axisOffset);
      if (score > bestScore) {
        bestScore = score;
        bestRect = rect;
      }
    }
  }

  if (!bestRect) {
    return undefined;
  }

  return bestRect;
}

/** 获取检测框中心点。 */
export function getDetectionBoxCenter(box: GraphwarDetectionBox) {
  return createPixelPoint(box.sourceCenterX, box.sourceCenterY);
}

/** 将友方士兵写入障碍 mask，关闭友伤时避免路径穿过友方。 */
export function addSoldierAreasToObstacleMask(
  mask: Uint8Array,
  edgeRect: BoundsRect,
  soldiers: readonly GraphwarDetectionBox[],
  soldierMarkerRadius: number,
) {
  const radius = Math.ceil((soldierMarkerRadius / edgeRect.width) * GRAPHWAR_PLANE_LENGTH) + 2;
  for (const soldier of soldiers) {
    const center = imagePointToPlaneGridPoint(getDetectionBoxCenter(soldier), edgeRect);
    fillMaskDisk(mask, center, radius);
  }
}

/** 正半径用于安全外扩；负半径复用同一入口做内缩，供容差扫描使用。 */
export function dilateObstacleMask(mask: Uint8Array, radius: number) {
  const normalizedRadius = Number.isFinite(radius) ? radius : 0;
  if (normalizedRadius < 0) {
    return erodeObstacleMaskByRadius(mask, -normalizedRadius);
  }

  const dilated = new Uint8Array(mask.length);
  const dilationRadius = Math.max(0, normalizedRadius);
  const dilationOffsetLimit = Math.ceil(dilationRadius);
  const dilationRadiusSquared = dilationRadius * dilationRadius;
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      if (!mask[y * GRAPHWAR_PLANE_LENGTH + x]) {
        continue;
      }
      for (let offsetY = -dilationOffsetLimit; offsetY <= dilationOffsetLimit; offsetY += 1) {
        for (let offsetX = -dilationOffsetLimit; offsetX <= dilationOffsetLimit; offsetX += 1) {
          if (!offsetIsInsideRadius(offsetX, offsetY, dilationRadiusSquared)) {
            continue;
          }
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (isInsidePlane(nextX, nextY)) {
            dilated[nextY * GRAPHWAR_PLANE_LENGTH + nextX] = 1;
          }
        }
      }
    }
  }
  return dilated;
}

/** 将障碍 mask 的外边界转成 SVG path，供页面显示识别/容差轮廓。 */
export function buildObstacleEdgePath(mask: Uint8Array, edgeRect: BoundsRect) {
  const commands: string[] = [];
  const appendEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const start = planeToImagePoint({ x: x1, y: y1 }, edgeRect);
    const end = planeToImagePoint({ x: x2, y: y2 }, edgeRect);
    commands.push(
      `M${formatSvgNumber(start.x)} ${formatSvgNumber(start.y)}L${formatSvgNumber(end.x)} ${formatSvgNumber(end.y)}`,
    );
  };

  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      if (!mask[y * GRAPHWAR_PLANE_LENGTH + x]) {
        continue;
      }

      if (y === 0 || !mask[(y - 1) * GRAPHWAR_PLANE_LENGTH + x]) {
        appendEdge(x, y + 0.5, x + 1, y + 0.5);
      }
      if (x === GRAPHWAR_PLANE_LENGTH - 1 || !mask[y * GRAPHWAR_PLANE_LENGTH + x + 1]) {
        appendEdge(x + 0.5, y, x + 0.5, y + 1);
      }
      if (y === GRAPHWAR_PLANE_HEIGHT - 1 || !mask[(y + 1) * GRAPHWAR_PLANE_LENGTH + x]) {
        appendEdge(x + 1, y + 0.5, x, y + 0.5);
      }
      if (x === 0 || !mask[y * GRAPHWAR_PLANE_LENGTH + x - 1]) {
        appendEdge(x + 0.5, y + 1, x + 0.5, y);
      }
    }
  }

  return commands.join("");
}

/** 将障碍 mask 的内部转成按行合并的 SVG path，供页面显示淡色遮罩。 */
export function buildObstacleFillPath(mask: Uint8Array, edgeRect: BoundsRect) {
  const commands: string[] = [];
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    let x = 0;
    while (x < GRAPHWAR_PLANE_LENGTH) {
      while (x < GRAPHWAR_PLANE_LENGTH && !mask[y * GRAPHWAR_PLANE_LENGTH + x]) {
        x += 1;
      }

      if (x >= GRAPHWAR_PLANE_LENGTH) {
        break;
      }

      const startX = x;
      while (x < GRAPHWAR_PLANE_LENGTH && mask[y * GRAPHWAR_PLANE_LENGTH + x]) {
        x += 1;
      }

      commands.push(createPlaneRectPathCommand(startX, y, x - startX, 1, edgeRect));
    }
  }
  return commands.join("");
}

/** 将单个平面网格矩形转换成 SVG path 命令。 */
function createPlaneRectPathCommand(x: number, y: number, width: number, height: number, edgeRect: BoundsRect) {
  const topLeft = planeToImagePoint({ x, y }, edgeRect);
  const bottomRight = planeToImagePoint({ x: x + width, y: y + height }, edgeRect);
  return `M${formatSvgNumber(topLeft.x)} ${formatSvgNumber(topLeft.y)}H${formatSvgNumber(bottomRight.x)}V${formatSvgNumber(bottomRight.y)}H${formatSvgNumber(topLeft.x)}Z`;
}

/** 将 Graphwar 原始平面坐标映射到截图像素。 */
export function planeToImagePoint(point: PlaneGridPoint, edgeRect: BoundsRect) {
  return createPixelPoint(
    edgeRect.x + (point.x / GRAPHWAR_PLANE_LENGTH) * edgeRect.width,
    edgeRect.y + (point.y / GRAPHWAR_PLANE_HEIGHT) * edgeRect.height,
  );
}

/** 将截图像素映射到平面网格，并裁剪到 770x450 内。 */
export function imagePointToPlaneGridPoint(point: PixelPoint, edgeRect: BoundsRect): PlaneGridPoint {
  const rawPoint = imagePointToRawPlaneGridPoint(point, edgeRect);
  return {
    x: clampNumber(rawPoint.x, 0, GRAPHWAR_PLANE_LENGTH - 1),
    y: clampNumber(rawPoint.y, 0, GRAPHWAR_PLANE_HEIGHT - 1),
  };
}

/** 统计障碍 mask 里当前的 4 邻域连通域数量。 */
export function countObstacleMaskComponents(mask: Uint8Array) {
  return collectComponents(mask, GRAPHWAR_PLANE_LENGTH).length;
}

/** 用圆形笔刷直接修改当前障碍 mask；直径单位为 Graphwar 原始平面像素。 */
export function paintObstacleMaskDisk(mask: Uint8Array, center: PlaneGridPoint, diameter: number, value: 0 | 1) {
  const nextMask = new Uint8Array(mask);
  const radius = Math.max(0.5, diameter / 2);
  const offsetLimit = Math.ceil(radius);
  const radiusSquared = radius * radius;
  let changed = false;

  for (let offsetY = -offsetLimit; offsetY <= offsetLimit; offsetY += 1) {
    for (let offsetX = -offsetLimit; offsetX <= offsetLimit; offsetX += 1) {
      if (!offsetIsInsideRadius(offsetX, offsetY, radiusSquared)) {
        continue;
      }

      const x = center.x + offsetX;
      const y = center.y + offsetY;
      if (isInsidePlane(x, y)) {
        const index = y * GRAPHWAR_PLANE_LENGTH + x;
        if (nextMask[index] !== value) {
          nextMask[index] = value;
          changed = true;
        }
      }
    }
  }

  return changed ? nextMask : mask;
}

/** 用圆形笔刷沿线段连续修改当前障碍 mask；直径单位为 Graphwar 原始平面像素。 */
export function paintObstacleMaskStroke(
  mask: Uint8Array,
  start: PlaneGridPoint,
  end: PlaneGridPoint,
  diameter: number,
  value: 0 | 1,
) {
  const nextMask = new Uint8Array(mask);
  const radius = Math.max(0.5, diameter / 2);
  const offsetLimit = Math.ceil(radius);
  const radiusSquared = radius * radius;
  const minX = Math.max(0, Math.min(start.x, end.x) - offsetLimit);
  const maxX = Math.min(GRAPHWAR_PLANE_LENGTH - 1, Math.max(start.x, end.x) + offsetLimit);
  const minY = Math.max(0, Math.min(start.y, end.y) - offsetLimit);
  const maxY = Math.min(GRAPHWAR_PLANE_HEIGHT - 1, Math.max(start.y, end.y) + offsetLimit);
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  let changed = false;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!pointIsInsideStrokeRadius(x, y, start, deltaX, deltaY, lengthSquared, radiusSquared)) {
        continue;
      }

      const index = y * GRAPHWAR_PLANE_LENGTH + x;
      if (nextMask[index] !== value) {
        nextMask[index] = value;
        changed = true;
      }
    }
  }

  return changed ? nextMask : mask;
}

/** 判断像素是否属于玩家/士兵主体颜色，而非棋盘和障碍。 */
export function isPlayerColorPixel(red: number, green: number, blue: number) {
  if (
    isAxisBlackPixel(red, green, blue) ||
    isSoldierTemplateSeedPixel(red, green, blue) ||
    isPlaneWhitePixel(red, green, blue) ||
    isPlaneGreenPixel(red, green, blue)
  ) {
    return false;
  }

  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  return maxChannel - minChannel >= 34 && red + green + blue >= 72 && red + green + blue <= 700;
}

/** 由轴线 triplet 的外侧边界生成棋盘矩形。 */
function createGraphwarPlaneRect(vertical: AxisTriplet, horizontal: AxisTriplet): BoundsRect {
  const left = vertical.first.end;
  const right = vertical.last.start + 1;
  const top = horizontal.first.end;
  const bottom = horizontal.last.start + 1;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/** 沿水平或竖直方向统计黑色轴线密度，输出可能的边界/中轴线候选组。 */
function detectAxisGroups(imageData: ImageData, direction: "horizontal" | "vertical") {
  const { width, height } = imageData;
  const axisLength = direction === "vertical" ? height : width;
  const scanLength = direction === "vertical" ? width : height;
  const counts: number[] = [];

  for (let coordinate = 0; coordinate < scanLength; coordinate += 1) {
    let count = 0;
    for (let position = 0; position < axisLength; position += 1) {
      if (hasBlackPixelInAxisBand(imageData, direction, coordinate, position)) {
        count += 1;
      }
    }
    counts.push(count);
  }

  const minScore = axisLength * 0.25;
  const ranked = counts
    .map((score, coordinate) => ({ coordinate, score }))
    .filter((item) => item.score >= minScore)
    .sort((left, right) => right.score - left.score);
  const groups: AxisGroup[] = [];

  for (const item of ranked) {
    if (groups.some((group) => item.coordinate >= group.start - 4 && item.coordinate <= group.end + 4)) {
      continue;
    }

    const groupThreshold = item.score * 0.82;
    let start = item.coordinate;
    let end = item.coordinate;
    while (start > 0 && counts[start - 1] >= groupThreshold) {
      start -= 1;
    }
    while (end < scanLength - 1 && counts[end + 1] >= groupThreshold) {
      end += 1;
    }
    groups.push({
      start,
      end,
      coordinate: (start + end) / 2,
      score: item.score,
    });
    if (groups.length >= 12) {
      break;
    }
  }
  return groups.sort((left, right) => left.coordinate - right.coordinate);
}

/** 在轴线附近 3 像素带内检查黑色像素，容忍截图缩放和抗锯齿偏移。 */
function hasBlackPixelInAxisBand(
  imageData: ImageData,
  direction: "horizontal" | "vertical",
  coordinate: number,
  position: number,
) {
  const { width, height, data } = imageData;
  for (let offset = -1; offset <= 1; offset += 1) {
    const x = direction === "vertical" ? coordinate + offset : position;
    const y = direction === "vertical" ? position : coordinate + offset;
    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    const index = (y * width + x) * 4;
    if (isAxisBlackPixel(data[index], data[index + 1], data[index + 2])) {
      return true;
    }
  }
  return false;
}

/** 组合“左/中/右”或“上/中/下”三条轴线，用中轴居中程度给棋盘候选排序。 */
function buildAxisTriplets(groups: AxisGroup[]) {
  const triplets: AxisTriplet[] = [];
  for (let firstIndex = 0; firstIndex < groups.length; firstIndex += 1) {
    for (let middleIndex = firstIndex + 1; middleIndex < groups.length; middleIndex += 1) {
      for (let lastIndex = middleIndex + 1; lastIndex < groups.length; lastIndex += 1) {
        const first = groups[firstIndex];
        const middle = groups[middleIndex];
        const last = groups[lastIndex];
        const span = last.coordinate - first.coordinate;
        if (span <= 0) {
          continue;
        }

        const middleOffset = Math.abs(middle.coordinate - (first.coordinate + last.coordinate) / 2) / span;
        if (middleOffset > 0.18) {
          continue;
        }

        triplets.push({
          first,
          middle,
          last,
          score: (first.score + middle.score + last.score) * (1 - middleOffset),
        });
      }
    }
  }
  return triplets.sort((left, right) => right.score - left.score).slice(0, 16);
}

/** 使用 Graphwar 20x20 源码士兵模板识别 Soldier.x/y。 */
function detectSoldierMatches(
  imageData: ImageData,
  edgeRect: BoundsRect,
  settings: GraphwarSoldierDetectionSettings | undefined,
  instrumentation?: GraphwarObjectDetectionInstrumentation,
) {
  const scale = edgeRect.width / GRAPHWAR_PLANE_LENGTH;
  const resolvedSettings = resolveGraphwarSoldierDetectionSettings(settings);
  const candidates = measureObjectDetectionStage(instrumentation, "collecting-soldier-candidates", () =>
    createSoldierTemplateCenterCandidates(imageData, edgeRect, scale, resolvedSettings.candidateTopRatio),
  );
  const matches = measureObjectDetectionStage(instrumentation, "matching-soldier-templates", () =>
    finalizeSoldierTemplateMatches(
      matchSoldierTemplates(imageData, edgeRect, scale, candidates),
      scale,
      resolvedSettings,
    ),
  );
  return { matches };
}

/** 归一化士兵识别设置，避免 UI 输入越界影响模板匹配。 */
function resolveGraphwarSoldierDetectionSettings(
  settings?: GraphwarSoldierDetectionSettings,
): GraphwarSoldierDetectionSettings {
  return {
    candidateTopRatio:
      settings?.candidateTopRatio && Number.isFinite(settings.candidateTopRatio)
        ? clampNumber(settings.candidateTopRatio, Number.EPSILON, 1)
        : defaultGraphwarSoldierTemplateCandidateTopRatio,
    maximumSoldierCount:
      settings?.maximumSoldierCount && Number.isFinite(settings.maximumSoldierCount)
        ? Math.max(1, Math.floor(settings.maximumSoldierCount))
        : defaultGraphwarMaximumSoldierCount,
    templateMatchingWorkerCount:
      settings?.templateMatchingWorkerCount && Number.isFinite(settings.templateMatchingWorkerCount)
        ? Math.max(1, Math.floor(settings.templateMatchingWorkerCount))
        : defaultGraphwarTemplateMatchingWorkerCount,
  };
}

/** 通过 instrumentation 包装对象识别阶段，未启用调试时直接执行。 */
function measureObjectDetectionStage<TResult>(
  instrumentation: GraphwarObjectDetectionInstrumentation | undefined,
  stage: GraphwarObjectDetectionStage,
  task: () => TResult,
) {
  return instrumentation ? instrumentation.measureStage(stage, task) : task();
}

/** 将源码中心匹配结果转换成页面使用的士兵检测框。 */
export function createSoldierDetectionBoxes(matches: SoldierMatchCandidate[], edgeRect: BoundsRect) {
  const scale = edgeRect.width / GRAPHWAR_PLANE_LENGTH;
  const hitRadius = GRAPHWAR_SOLDIER_RADIUS * scale;
  const visualRadius = (GRAPHWAR_SOLDIER_VISIBLE_SIZE / 2) * scale;
  const visualSize = visualRadius * 2;
  return matches.map((match, index) => {
    const sourceCenter = createPixelPoint(match.sourceCenterX, match.sourceCenterY);
    const visualCenter = getGraphwarSoldierVisualCenter(sourceCenter, match.mirrored, scale);
    const roundedPlaneX = Math.round(((sourceCenter.x - edgeRect.x) / edgeRect.width) * GRAPHWAR_PLANE_LENGTH);
    const roundedPlaneY = Math.round(((sourceCenter.y - edgeRect.y) / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT);
    return {
      confidence: match.score,
      height: visualSize,
      hitRadius,
      id: `soldier-${roundedPlaneX}-${roundedPlaneY}-${match.mirrored ? "mirror" : "normal"}-${index}`,
      kind: "soldier" as const,
      mirrored: match.mirrored,
      selectionRadius: visualRadius,
      sourceCenterX: sourceCenter.x,
      sourceCenterY: sourceCenter.y,
      templateName: match.templateName,
      visualCenterX: visualCenter.x,
      visualCenterY: visualCenter.y,
      visualRadius,
      width: visualSize,
      x: visualCenter.x - visualRadius,
      y: visualCenter.y - visualRadius,
    };
  });
}

/** 构造寻路障碍 mask：过滤坐标轴/士兵/小噪点，同时保留跨辅助线的真实障碍连续性。 */
export function detectGraphwarObstaclesInBounds(
  imageData: ImageData,
  edgeRect: BoundsRect,
  thresholds: GraphwarObstacleDetectionThresholds,
  soldiers: readonly GraphwarDetectionBox[],
  instrumentation?: GraphwarObjectDetectionInstrumentation,
): DetectedObstacleMap {
  const sourceMask = measureObjectDetectionStage(instrumentation, "building-obstacle-mask", () =>
    buildObstacleMask(imageData, edgeRect, thresholds.minArea),
  );
  return measureObjectDetectionStage(instrumentation, "filtering-obstacle-components", () => {
    const detectionMask = new Uint8Array(sourceMask);
    removeGraphwarGuideLines(detectionMask);
    bridgeObstacleGapsAcrossGuideLines(detectionMask);
    removeSoldierAreasFromObstacleMask(detectionMask, edgeRect, soldiers);

    const restoreMask = new Uint8Array(sourceMask);
    removeGraphwarCenterGuideLines(restoreMask);
    bridgeObstacleGapsAcrossGuideLines(restoreMask);
    removeSoldierAreasFromObstacleMask(restoreMask, edgeRect, soldiers);

    const componentMask = openObstacleMask(detectionMask);

    const filteredMask = new Uint8Array(sourceMask.length);
    let count = 0;
    for (const component of collectComponents(componentMask, GRAPHWAR_PLANE_LENGTH)) {
      if (component.area < thresholds.minArea) {
        continue;
      }

      if (addConnectedSourceComponentsFromComponent(filteredMask, restoreMask, componentMask, component)) {
        count += 1;
      }
    }

    return {
      count,
      mask: filteredMask,
    };
  });
}

/** 收集可传给模板 worker 的士兵源码中心候选点。 */
export function collectSoldierTemplateCenterCandidatesForMatching(
  imageData: ImageData,
  edgeRect: BoundsRect,
  settings?: GraphwarSoldierDetectionSettings,
) {
  const scale = edgeRect.width / GRAPHWAR_PLANE_LENGTH;
  return createSoldierTemplateCenterCandidates(
    imageData,
    edgeRect,
    scale,
    resolveGraphwarSoldierDetectionSettings(settings).candidateTopRatio,
  );
}

/** 暴露统一归一化后的士兵识别设置，供 worker 复用。 */
export function getGraphwarSoldierDetectionSettings(settings?: GraphwarSoldierDetectionSettings) {
  return resolveGraphwarSoldierDetectionSettings(settings);
}

/** 根据棋盘宽度计算 Graphwar 原始平面到截图像素的缩放比例。 */
export function getGraphwarDetectionScale(edgeRect: BoundsRect) {
  return edgeRect.width / GRAPHWAR_PLANE_LENGTH;
}

/** 按候选源码中心尝试完整 20x20 模板评分。 */
export function matchSoldierTemplates(
  imageData: ImageData,
  edgeRect: BoundsRect,
  scale: number,
  candidates: readonly SoldierTemplateCenterCandidate[],
) {
  const matches: SoldierMatchCandidate[] = [];
  for (const candidate of candidates) {
    const snapped = findBestSoldierTemplateMatch(
      imageData,
      edgeRect,
      scale,
      candidate.x,
      candidate.y,
      candidate.mirrored,
      candidate.votes,
    );
    if (!snapped) {
      continue;
    }
    matches.push(snapped);
  }
  return matches;
}

/** 过滤低分士兵匹配并按重叠关系保留最可信结果。 */
export function finalizeSoldierTemplateMatches(
  matches: SoldierMatchCandidate[],
  scale: number,
  settings: GraphwarSoldierDetectionSettings,
) {
  return suppressOverlappingSoldierMatches(filterAcceptedSoldierMatches(matches), scale, settings.maximumSoldierCount);
}

/** 应用各子分数阈值，并按综合分和投票数排序候选。 */
function filterAcceptedSoldierMatches(matches: SoldierMatchCandidate[]) {
  return matches
    .filter(
      (match) =>
        match.fixedScore >= graphwarSoldierTemplateMinimumFixedScore &&
        match.foregroundScore >= graphwarSoldierTemplateMinimumForegroundScore &&
        match.playerScore >= graphwarSoldierTemplateMinimumPlayerScore &&
        match.signatureScore >= graphwarSoldierTemplateMinimumSignatureScore,
    )
    .sort((left, right) => right.score - left.score || right.votes - left.votes);
}

/** 固定黄色/白色像素在所有模板坐标上反投票，避免连通域 bbox 成为真值。 */
function createSoldierTemplateCenterCandidates(
  imageData: ImageData,
  edgeRect: BoundsRect,
  scale: number,
  candidateTopRatio: number,
) {
  const votes = new Map<string, { count: number; mirrored: boolean; x: number; y: number }>();
  const stride = Math.max(1, Math.floor(scale / 2));

  for (let y = 0; y < edgeRect.height; y += stride) {
    for (let x = 0; x < edgeRect.width; x += stride) {
      const pixel = getImagePixel(imageData, edgeRect.x + x, edgeRect.y + y);
      if (!isSoldierYellowPixel(pixel.red, pixel.green, pixel.blue)) {
        continue;
      }

      for (const templateBase of graphwarSoldierTemplateBases) {
        for (const templatePixel of templateBase.seedPixels) {
          const centerX = edgeRect.x + x - getSoldierTemplatePixelOffset(templatePixel.x, scale);
          const centerY = edgeRect.y + y - getSoldierTemplatePixelOffset(templatePixel.y, scale);
          if (!soldierTemplateCenterFitsRect(centerX, centerY, edgeRect)) {
            continue;
          }

          const planeX = Math.round(((centerX - edgeRect.x) / edgeRect.width) * GRAPHWAR_PLANE_LENGTH);
          const planeY = Math.round(((centerY - edgeRect.y) / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT);
          if (!isInsidePlane(planeX, planeY)) {
            continue;
          }
          const mirrored = expectedSoldierTemplateMirroredForPlaneX(planeX);
          if (templateBase.mirrored !== mirrored) {
            continue;
          }

          const sourceCenter = planeToImagePoint({ x: planeX, y: planeY }, edgeRect);
          const key = `${planeX}:${planeY}`;
          const existing = votes.get(key);
          if (existing) {
            existing.count += 1;
            existing.mirrored = mirrored;
            existing.x = sourceCenter.x;
            existing.y = sourceCenter.y;
          } else {
            votes.set(key, { count: 1, mirrored, x: sourceCenter.x, y: sourceCenter.y });
          }
        }
      }
    }
  }

  const rankedCandidates = [...votes.values()]
    .map((vote) => ({
      mirrored: vote.mirrored,
      x: vote.x,
      y: vote.y,
      votes: vote.count,
    }))
    .sort((left, right) => right.votes - left.votes);

  const percentileLimit = Math.ceil(rankedCandidates.length * candidateTopRatio);
  return rankedCandidates.slice(0, percentileLimit);
}

/** 对同一个源码中心尝试所有正常/镜像源码模板，返回分数最高者。 */
function findBestSoldierTemplateMatch(
  imageData: ImageData,
  rect: BoundsRect,
  scale: number,
  sourceCenterX: number,
  sourceCenterY: number,
  expectedMirrored: boolean,
  votes: number,
) {
  let best: SoldierMatchCandidate | undefined;
  const baseScores = graphwarSoldierTemplateBases
    .filter((templateBase) => templateBase.mirrored === expectedMirrored)
    .map((templateBase) => ({
      score: scoreSoldierTemplateBaseAt(imageData, rect, scale, sourceCenterX, sourceCenterY, templateBase),
      templateBase,
    }));
  for (const { score: baseScore, templateBase } of baseScores) {
    for (const template of templateBase.uniqueSignatureTemplates) {
      const signatureScore = scoreTemplateSignaturePixels(
        imageData,
        rect,
        scale,
        sourceCenterX,
        sourceCenterY,
        template.signaturePixels,
      );
      const score = scoreSoldierTemplateThresholdExcess(
        baseScore.fixedScore,
        baseScore.foregroundScore,
        baseScore.playerScore,
        signatureScore,
        baseScore.backgroundPenalty,
      );
      if (!best || score > best.score) {
        best = {
          fixedScore: baseScore.fixedScore,
          foregroundScore: baseScore.foregroundScore,
          mirrored: template.mirrored,
          playerScore: baseScore.playerScore,
          score,
          signatureScore,
          sourceCenterX,
          sourceCenterY,
          templateName: template.name,
          votes,
        };
      }
    }
  }
  return best;
}

/** Graphwar 原版士兵在右半平面使用镜像模板。 */
function expectedSoldierTemplateMirroredForPlaneX(planeX: number) {
  return planeX >= GRAPHWAR_PLANE_LENGTH / 2;
}

/** 模板评分分离固定像素、随机玩家色像素和前景形状，避免把任一颜色当唯一真值。 */
function scoreSoldierTemplateBaseAt(
  imageData: ImageData,
  rect: BoundsRect,
  scale: number,
  sourceCenterX: number,
  sourceCenterY: number,
  template: SoldierTemplateBase,
): SoldierTemplateBaseScore {
  const fixedScore = scoreTemplatePixelGroup(
    imageData,
    rect,
    scale,
    sourceCenterX,
    sourceCenterY,
    template.fixedPixels,
    {
      scorer: scoreSoldierFixedPixel,
    },
  );

  const foregroundScore = scoreTemplatePixelGroup(
    imageData,
    rect,
    scale,
    sourceCenterX,
    sourceCenterY,
    template.foregroundPixels,
    { scorer: scoreSoldierForegroundPixel },
  );

  const playerColor = estimateTemplatePlayerColor(imageData, rect, scale, sourceCenterX, sourceCenterY, template);
  const playerScore = scoreTemplatePixelGroup(
    imageData,
    rect,
    scale,
    sourceCenterX,
    sourceCenterY,
    template.playerPixels,
    { scorer: (pixel) => scoreSoldierPlayerColorPixel(pixel, playerColor) },
  );

  const backgroundPenalty = scoreTemplateBackgroundPenalty(
    imageData,
    rect,
    scale,
    sourceCenterX,
    sourceCenterY,
    template,
  );
  return {
    backgroundPenalty,
    fixedScore,
    foregroundScore,
    playerScore,
  };
}

/** 把各子分数超过阈值的余量合成为最终置信度。 */
function scoreSoldierTemplateThresholdExcess(
  fixedScore: number,
  foregroundScore: number,
  playerScore: number,
  signatureScore: number,
  backgroundPenalty: number,
) {
  return clampNumber(
    (normalizeScoreAboveThreshold(fixedScore, graphwarSoldierTemplateMinimumFixedScore) +
      normalizeScoreAboveThreshold(foregroundScore, graphwarSoldierTemplateMinimumForegroundScore) +
      normalizeScoreAboveThreshold(playerScore, graphwarSoldierTemplateMinimumPlayerScore) +
      normalizeScoreAboveThreshold(signatureScore, graphwarSoldierTemplateMinimumSignatureScore)) /
      4 -
      backgroundPenalty,
    0,
    1,
  );
}

/** 将阈值以上的得分压缩到 0..1，低于阈值视为无贡献。 */
function normalizeScoreAboveThreshold(score: number, threshold: number) {
  return clampNumber((score - threshold) / (1 - threshold), 0, 1);
}

/** 对模板像素组做双线性采样评分，只统计仍在棋盘矩形内的像素。 */
function scoreTemplatePixelGroup(
  imageData: ImageData,
  rect: BoundsRect,
  scale: number,
  sourceCenterX: number,
  sourceCenterY: number,
  pixels: readonly SoldierTemplatePixel[],
  options: { scorer: (pixel: { red: number; green: number; blue: number }) => number },
) {
  if (pixels.length === 0) {
    return 0;
  }

  let score = 0;
  let visiblePixels = 0;
  for (const pixel of pixels) {
    const imageX = sourceCenterX + getSoldierTemplatePixelOffset(pixel.x, scale);
    const imageY = sourceCenterY + getSoldierTemplatePixelOffset(pixel.y, scale);
    if (!pointIsInsideRect(imageX, imageY, rect)) {
      continue;
    }
    visiblePixels += 1;
    score += options.scorer(sampleImagePixelBilinear(imageData, imageX, imageY));
  }
  return visiblePixels > 0 ? score / visiblePixels : 0;
}

/** 从模板玩家色区域估计当前士兵颜色，降低不同玩家配色的影响。 */
function estimateTemplatePlayerColor(
  imageData: ImageData,
  rect: BoundsRect,
  scale: number,
  sourceCenterX: number,
  sourceCenterY: number,
  template: { playerPixels: readonly SoldierTemplatePixel[] },
) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (const pixel of template.playerPixels) {
    const imageX = sourceCenterX + getSoldierTemplatePixelOffset(pixel.x, scale);
    const imageY = sourceCenterY + getSoldierTemplatePixelOffset(pixel.y, scale);
    if (!pointIsInsideRect(imageX, imageY, rect)) {
      continue;
    }

    const sampled = sampleImagePixelBilinear(imageData, imageX, imageY);
    const chroma =
      Math.max(sampled.red, sampled.green, sampled.blue) - Math.min(sampled.red, sampled.green, sampled.blue);
    const sampleWeight = 1 + chroma / 255;
    red += sampled.red * sampleWeight;
    green += sampled.green * sampleWeight;
    blue += sampled.blue * sampleWeight;
    weight += sampleWeight;
  }

  return weight > 0 ? { red: red / weight, green: green / weight, blue: blue / weight } : { red: 0, green: 0, blue: 0 };
}

/** 对动画签名像素评分，用于区分不同士兵帧。 */
function scoreTemplateSignaturePixels(
  imageData: ImageData,
  rect: BoundsRect,
  scale: number,
  sourceCenterX: number,
  sourceCenterY: number,
  pixels: readonly SoldierTemplateColorPixel[],
) {
  if (pixels.length === 0) {
    return 0;
  }

  let score = 0;
  let visiblePixels = 0;
  for (const pixel of pixels) {
    const imageX = sourceCenterX + getSoldierTemplatePixelOffset(pixel.x, scale);
    const imageY = sourceCenterY + getSoldierTemplatePixelOffset(pixel.y, scale);
    if (!pointIsInsideRect(imageX, imageY, rect)) {
      continue;
    }
    visiblePixels += 1;
    score += scoreSoldierSignaturePixel(sampleImagePixelBilinear(imageData, imageX, imageY), pixel.color);
  }
  return visiblePixels > 0 ? score / visiblePixels : 0;
}

/** 按 RGB 曼哈顿距离评分单个动画签名像素。 */
function scoreSoldierSignaturePixel(pixel: { red: number; green: number; blue: number }, color: string) {
  const expectedRed = Number.parseInt(color.slice(0, 2), 16);
  const expectedGreen = Number.parseInt(color.slice(2, 4), 16);
  const expectedBlue = Number.parseInt(color.slice(4, 6), 16);
  const distance =
    Math.abs(pixel.red - expectedRed) + Math.abs(pixel.green - expectedGreen) + Math.abs(pixel.blue - expectedBlue);
  return clampNumber(1 - distance / 360, 0, 1);
}

/** 检查士兵外圈是否仍像士兵颜色，抑制贴近真实士兵边缘的误匹配。 */
function scoreTemplateBackgroundPenalty(
  imageData: ImageData,
  rect: BoundsRect,
  scale: number,
  sourceCenterX: number,
  sourceCenterY: number,
  template: { mirrored: boolean },
) {
  const visualCenter = getGraphwarSoldierVisualCenter(
    createPixelPoint(sourceCenterX, sourceCenterY),
    template.mirrored,
    scale,
  );
  const radius = (GRAPHWAR_SOLDIER_VISIBLE_SIZE / 2) * scale;
  const sampleOffsets = [
    [-1.25, -1.25],
    [0, -1.45],
    [1.25, -1.25],
    [-1.45, 0],
    [1.45, 0],
    [-1.25, 1.25],
    [0, 1.45],
    [1.25, 1.25],
  ] as const;
  let suspicious = 0;
  for (const [offsetX, offsetY] of sampleOffsets) {
    const x = visualCenter.x + offsetX * radius;
    const y = visualCenter.y + offsetY * radius;
    if (!pointIsInsideRect(x, y, rect)) {
      suspicious += 0.5;
      continue;
    }
    const pixel = sampleImagePixelBilinear(imageData, x, y);
    if (
      isSoldierTemplateSeedPixel(pixel.red, pixel.green, pixel.blue) ||
      isPlayerColorPixel(pixel.red, pixel.green, pixel.blue)
    ) {
      suspicious += 1;
    }
  }
  return Math.min(0.06, suspicious * 0.01);
}

/** 对固定黄色、高光和深色轮廓像素评分。 */
function scoreSoldierFixedPixel(pixel: { red: number; green: number; blue: number }) {
  if (isSoldierTemplateSeedPixel(pixel.red, pixel.green, pixel.blue)) {
    return 1;
  }
  if (isSoldierWhiteHighlightPixel(pixel.red, pixel.green, pixel.blue)) {
    return 0.88;
  }
  if (isSoldierDarkOutlinePixel(pixel.red, pixel.green, pixel.blue)) {
    return 0.78;
  }
  return scoreSoldierForegroundPixel(pixel) * 0.48;
}

/** 对士兵前景形状评分，排除棋盘底色并弱化坐标轴干扰。 */
function scoreSoldierForegroundPixel(pixel: { red: number; green: number; blue: number }) {
  if (isPlaneWhitePixel(pixel.red, pixel.green, pixel.blue) || isPlaneGreenPixel(pixel.red, pixel.green, pixel.blue)) {
    return 0;
  }
  if (isAxisBlackPixel(pixel.red, pixel.green, pixel.blue)) {
    return 0.2;
  }
  const chroma = Math.max(pixel.red, pixel.green, pixel.blue) - Math.min(pixel.red, pixel.green, pixel.blue);
  const brightness = pixel.red + pixel.green + pixel.blue;
  if (brightness < 40 || brightness > 745) {
    return 0.28;
  }
  return clampNumber(0.5 + chroma / 260, 0, 1);
}

/** 对玩家颜色像素评分，兼顾与估计颜色的距离和色度。 */
function scoreSoldierPlayerColorPixel(
  pixel: { red: number; green: number; blue: number },
  playerColor: { red: number; green: number; blue: number },
) {
  if (isPlaneWhitePixel(pixel.red, pixel.green, pixel.blue) || isPlaneGreenPixel(pixel.red, pixel.green, pixel.blue)) {
    return 0;
  }

  const distance =
    Math.abs(pixel.red - playerColor.red) +
    Math.abs(pixel.green - playerColor.green) +
    Math.abs(pixel.blue - playerColor.blue);
  const chroma = Math.max(pixel.red, pixel.green, pixel.blue) - Math.min(pixel.red, pixel.green, pixel.blue);
  return clampNumber(1 - distance / 420 + chroma / 900, 0, 1);
}

/** 判断模板源码中心是否仍落在棋盘截图矩形内。 */
function soldierTemplateCenterFitsRect(centerX: number, centerY: number, rect: BoundsRect) {
  return centerX >= rect.x && centerX <= rect.x + rect.width && centerY >= rect.y && centerY <= rect.y + rect.height;
}

/** 判断截图像素点是否在棋盘矩形内。 */
function pointIsInsideRect(x: number, y: number, rect: BoundsRect) {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** 读取最近邻像素，并把越界采样裁剪到图像范围内。 */
function getImagePixel(imageData: ImageData, x: number, y: number) {
  const clampedX = clampNumber(Math.round(x), 0, imageData.width - 1);
  const clampedY = clampNumber(Math.round(y), 0, imageData.height - 1);
  const index = (clampedY * imageData.width + clampedX) * 4;
  return {
    red: imageData.data[index],
    green: imageData.data[index + 1],
    blue: imageData.data[index + 2],
  };
}

/** 对非整数截图坐标做双线性采样，适配缩放后的模板像素。 */
function sampleImagePixelBilinear(imageData: ImageData, x: number, y: number) {
  const left = clampNumber(Math.floor(x), 0, imageData.width - 1);
  const top = clampNumber(Math.floor(y), 0, imageData.height - 1);
  const right = clampNumber(left + 1, 0, imageData.width - 1);
  const bottom = clampNumber(top + 1, 0, imageData.height - 1);
  const tx = clampNumber(x - left, 0, 1);
  const ty = clampNumber(y - top, 0, 1);
  const topLeft = getImagePixel(imageData, left, top);
  const topRight = getImagePixel(imageData, right, top);
  const bottomLeft = getImagePixel(imageData, left, bottom);
  const bottomRight = getImagePixel(imageData, right, bottom);
  return {
    red: interpolateBilinear(topLeft.red, topRight.red, bottomLeft.red, bottomRight.red, tx, ty),
    green: interpolateBilinear(topLeft.green, topRight.green, bottomLeft.green, bottomRight.green, tx, ty),
    blue: interpolateBilinear(topLeft.blue, topRight.blue, bottomLeft.blue, bottomRight.blue, tx, ty),
  };
}

/** 执行单通道双线性插值。 */
function interpolateBilinear(
  topLeft: number,
  topRight: number,
  bottomLeft: number,
  bottomRight: number,
  tx: number,
  ty: number,
) {
  const top = topLeft + (topRight - topLeft) * tx;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
  return top + (bottom - top) * ty;
}

/** 将 20x20 士兵模板像素坐标转换成相对源码中心的截图偏移。 */
function getSoldierTemplatePixelOffset(pixelCoordinate: number, scale: number) {
  return (pixelCoordinate + 0.5 - graphwarSoldierCanvasCenter) * scale;
}

/** 创建正常和镜像两套士兵模板基础数据。 */
function createGraphwarSoldierTemplateBases(): SoldierTemplateBase[] {
  return [createGraphwarSoldierTemplateBase(false), createGraphwarSoldierTemplateBase(true)];
}

/** 从模板网格构造一套固定像素、玩家色像素和动画签名模板。 */
function createGraphwarSoldierTemplateBase(mirrored: boolean): SoldierTemplateBase {
  const fixedPixels = createTemplatePixelsFromGrid(graphwarSoldierFixedColorGrid, mirrored);
  const foregroundPixels = createTemplatePixelsFromGrid(graphwarSoldierSolidGrid, mirrored);
  const playerPixels = createTemplatePixelsFromGrid(graphwarSoldierPlayerColorGrid, mirrored);
  const seedPixels = createTemplatePixelsFromGrid(graphwarSoldierFixedSeedGrid, mirrored);
  const visualCenterX = mirrored ? graphwarSoldierMirrorVisibleCenterX : graphwarSoldierVisibleCenterX;
  const visualCenterY = graphwarSoldierVisibleCenterY;
  const templates = graphwarSoldierTemplateNames.map((name) =>
    createGraphwarSoldierTemplate({
      fixedPixels,
      foregroundPixels,
      mirrored,
      name,
      playerPixels,
      seedPixels,
      visualCenterX,
      visualCenterY,
    }),
  );
  return {
    fixedPixels,
    foregroundPixels,
    mirrored,
    playerPixels,
    seedPixels,
    templates,
    uniqueSignatureTemplates: collectUniqueSoldierSignatureTemplates(templates),
    visualCenterX,
    visualCenterY,
  };
}

/** 将基础像素组和某个动画帧签名组合成完整士兵模板。 */
function createGraphwarSoldierTemplate(options: {
  fixedPixels: SoldierTemplatePixel[];
  foregroundPixels: SoldierTemplatePixel[];
  name: (typeof graphwarSoldierTemplateNames)[number];
  mirrored: boolean;
  playerPixels: SoldierTemplatePixel[];
  seedPixels: SoldierTemplatePixel[];
  visualCenterX: number;
  visualCenterY: number;
}): SoldierTemplate {
  return {
    fixedPixels: options.fixedPixels,
    foregroundPixels: options.foregroundPixels,
    mirrored: options.mirrored,
    name: options.name,
    playerPixels: options.playerPixels,
    seedPixels: options.seedPixels,
    signaturePixels: createSoldierTemplateSignaturePixels(options.name, options.mirrored),
    visualCenterX: options.visualCenterX,
    visualCenterY: options.visualCenterY,
  };
}

/** 去掉签名像素完全相同的动画帧，避免重复评分同一模板。 */
function collectUniqueSoldierSignatureTemplates(templates: SoldierTemplate[]) {
  const seenSignatures = new Set<string>();
  const uniqueTemplates: SoldierTemplate[] = [];
  for (const template of templates) {
    const key = createSoldierTemplateSignatureKey(template.signaturePixels);
    if (seenSignatures.has(key)) {
      continue;
    }
    seenSignatures.add(key);
    uniqueTemplates.push(template);
  }
  return uniqueTemplates;
}

/** 为动画签名像素创建去重 key。 */
function createSoldierTemplateSignatureKey(signaturePixels: readonly SoldierTemplateColorPixel[]) {
  return signaturePixels.map((pixel) => pixel.color).join(";");
}

/** 将字符串网格中的模板像素提取成坐标列表，并按需镜像 x。 */
function createTemplatePixelsFromGrid(grid: readonly string[], mirrored: boolean) {
  const pixels: SoldierTemplatePixel[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (grid[y][x] === "#") {
        pixels.push({
          x: mirrored ? 19 - x : x,
          y,
        });
      }
    }
  }
  return pixels;
}

/** 创建指定动画帧的签名颜色像素，镜像模板需要同步镜像 x。 */
function createSoldierTemplateSignaturePixels(name: (typeof graphwarSoldierTemplateNames)[number], mirrored: boolean) {
  return graphwarSoldierAnimationSignatureCoordinates.map(([x, y], index) => ({
    color: graphwarSoldierAnimationSignatureColorsByName[name][index] ?? "000000",
    x: mirrored ? 19 - x : x,
    y,
  }));
}

/** 按源码中心间距抑制同一士兵的重叠匹配，只保留高分候选。 */
function suppressOverlappingSoldierMatches(
  matches: SoldierMatchCandidate[],
  scale: number,
  maximumSoldierCount: number,
) {
  const kept: SoldierMatchCandidate[] = [];
  const minimumAxisGap = graphwarSoldierGenerationMinimumAxisGap * scale;
  for (const match of matches) {
    if (
      kept.every(
        (candidate) =>
          Math.abs(match.sourceCenterX - candidate.sourceCenterX) >= minimumAxisGap ||
          Math.abs(match.sourceCenterY - candidate.sourceCenterY) >= minimumAxisGap,
      )
    ) {
      kept.push(match);
      if (kept.length >= maximumSoldierCount) {
        break;
      }
    }
  }
  return kept;
}

/** 从开运算后的种子组件回填原始 mask 连通块，避免细节被形态学过滤永久丢失。 */
function addConnectedSourceComponentsFromComponent(
  targetMask: Uint8Array,
  sourceMask: Uint8Array,
  seedMask: Uint8Array,
  component: ComponentBox,
) {
  let added = false;
  for (let y = component.y; y < component.y + component.height; y += 1) {
    for (let x = component.x; x < component.x + component.width; x += 1) {
      const index = y * GRAPHWAR_PLANE_LENGTH + x;
      if (!seedMask[index] || !sourceMask[index] || targetMask[index]) {
        continue;
      }

      added = floodSourceMaskComponent(targetMask, sourceMask, index) || added;
    }
  }
  return added;
}

/** 从种子像素 flood fill 原始障碍连通块，恢复开运算删掉的细节。 */
function floodSourceMaskComponent(targetMask: Uint8Array, sourceMask: Uint8Array, start: number) {
  const stack = [start];
  let added = false;
  while (stack.length) {
    const current = stack.pop() ?? 0;
    if (!sourceMask[current] || targetMask[current]) {
      continue;
    }

    targetMask[current] = 1;
    added = true;

    const x = current % GRAPHWAR_PLANE_LENGTH;
    const neighbors = [current - 1, current + 1, current - GRAPHWAR_PLANE_LENGTH, current + GRAPHWAR_PLANE_LENGTH];
    for (const next of neighbors) {
      if (
        next < 0 ||
        next >= sourceMask.length ||
        targetMask[next] ||
        !sourceMask[next] ||
        (next === current - 1 && x === 0) ||
        (next === current + 1 && x === GRAPHWAR_PLANE_LENGTH - 1)
      ) {
        continue;
      }
      stack.push(next);
    }
  }
  return added;
}

/** 对障碍 mask 做开运算，先去除孤立噪点再恢复主体轮廓。 */
function openObstacleMask(mask: Uint8Array) {
  return dilateObstacleMask(erodeObstacleMask(mask), Math.SQRT2);
}

/** 3x3 腐蚀，用于开运算去除孤立噪点。 */
function erodeObstacleMask(mask: Uint8Array) {
  const eroded = new Uint8Array(mask.length);
  for (let y = 1; y < GRAPHWAR_PLANE_HEIGHT - 1; y += 1) {
    for (let x = 1; x < GRAPHWAR_PLANE_LENGTH - 1; x += 1) {
      let isSolid = true;
      for (let offsetY = -1; offsetY <= 1 && isSolid; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!mask[(y + offsetY) * GRAPHWAR_PLANE_LENGTH + x + offsetX]) {
            isSolid = false;
            break;
          }
        }
      }
      if (isSolid) {
        eroded[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
      }
    }
  }
  return eroded;
}

/** 按指定半径腐蚀障碍 mask，供负 route tolerance 使用。 */
function erodeObstacleMaskByRadius(mask: Uint8Array, radius: number) {
  const eroded = new Uint8Array(mask.length);
  const erosionRadius = Math.max(0, radius);
  const erosionOffsetLimit = Math.ceil(erosionRadius);
  const erosionRadiusSquared = erosionRadius * erosionRadius;
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      if (!mask[y * GRAPHWAR_PLANE_LENGTH + x]) {
        continue;
      }

      let isSolid = true;
      for (let offsetY = -erosionOffsetLimit; offsetY <= erosionOffsetLimit && isSolid; offsetY += 1) {
        for (let offsetX = -erosionOffsetLimit; offsetX <= erosionOffsetLimit; offsetX += 1) {
          if (!offsetIsInsideRadius(offsetX, offsetY, erosionRadiusSquared)) {
            continue;
          }
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (!isInsidePlane(nextX, nextY) || !mask[nextY * GRAPHWAR_PLANE_LENGTH + nextX]) {
            isSolid = false;
            break;
          }
        }
      }
      if (isSolid) {
        eroded[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
      }
    }
  }
  return eroded;
}

/** 从障碍 mask 中清掉士兵身体区域，避免寻路把目标/己方士兵当作地形。 */
function removeSoldierAreasFromObstacleMask(
  mask: Uint8Array,
  edgeRect: BoundsRect,
  soldiers: readonly GraphwarDetectionBox[],
) {
  for (const soldier of soldiers) {
    const center = imagePointToPlaneGridPoint(getDetectionBoxCenter(soldier), edgeRect);
    const radiusX = (soldier.hitRadius / edgeRect.width) * GRAPHWAR_PLANE_LENGTH;
    const radiusY = (soldier.hitRadius / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT;
    clearMaskDisk(mask, center, Math.ceil(Math.max(radiusX, radiusY)) + 2);
  }
}

/** 将截图像素重采样到 Graphwar 原始 770x450 平面，后续寻路都在这个固定网格上运行。 */
function buildObstacleMask(imageData: ImageData, edgeRect: BoundsRect, minArea: number) {
  const rawSolidMask = new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      const source = samplePlaneImagePixel(imageData, edgeRect, x, y);
      if (isObstacleSolidPixel(source.red, source.green, source.blue)) {
        rawSolidMask[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
      }
    }
  }

  const solidMask = filterObstacleSolidMask(rawSolidMask, minArea);
  return addObstacleAntialiasEdgePixels(imageData, edgeRect, solidMask);
}

/** 只保留能通过开运算和面积筛选的深色主体，先排除名字、轨迹和 UI 文本。 */
function filterObstacleSolidMask(rawSolidMask: Uint8Array, minArea: number) {
  const seedMask = openObstacleMask(rawSolidMask);
  const coreMask = new Uint8Array(rawSolidMask.length);
  for (const component of collectComponents(seedMask, GRAPHWAR_PLANE_LENGTH)) {
    if (component.area < minArea) {
      continue;
    }
    for (let y = component.y; y < component.y + component.height; y += 1) {
      for (let x = component.x; x < component.x + component.width; x += 1) {
        const index = y * GRAPHWAR_PLANE_LENGTH + x;
        if (seedMask[index]) {
          coreMask[index] = 1;
        }
      }
    }
  }
  return addAdjacentRawSolidPixels(rawSolidMask, coreMask);
}

/** 回补主体旁一圈黑色边缘，但不沿相连黑字/标签无限 flood。 */
function addAdjacentRawSolidPixels(rawSolidMask: Uint8Array, coreMask: Uint8Array) {
  const mask = new Uint8Array(coreMask);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      const index = y * GRAPHWAR_PLANE_LENGTH + x;
      if (!mask[index] && rawSolidMask[index] && hasNeighborObstaclePixel(coreMask, x, y)) {
        mask[index] = 1;
      }
    }
  }
  return mask;
}

/** 只从深色地形主体向外吸附抗锯齿灰边，避免把孤立名字、轨迹和 UI 文本当成地形。 */
function addObstacleAntialiasEdgePixels(imageData: ImageData, edgeRect: BoundsRect, solidMask: Uint8Array) {
  const mask = new Uint8Array(solidMask);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      const index = y * GRAPHWAR_PLANE_LENGTH + x;
      if (mask[index] || !hasNeighborObstaclePixel(solidMask, x, y)) {
        continue;
      }

      const source = samplePlaneImagePixel(imageData, edgeRect, x, y);
      if (isObstacleAntialiasEdgePixel(source.red, source.green, source.blue)) {
        mask[index] = 1;
      }
    }
  }
  return mask;
}

/** 判断周围 8 邻域是否已有深色地形主体。 */
function hasNeighborObstaclePixel(mask: Uint8Array, x: number, y: number) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (isInsidePlane(nextX, nextY) && mask[nextY * GRAPHWAR_PLANE_LENGTH + nextX]) {
        return true;
      }
    }
  }
  return false;
}

/** 移除 Graphwar 坐标轴和边界辅助线，避免它们被识别成地形障碍。 */
function removeGraphwarGuideLines(mask: Uint8Array) {
  removeGraphwarCenterGuideLines(mask);
  removeGraphwarPlaneBoundaryGuideLines(mask);
}

/** 移除中心横纵坐标轴。 */
function removeGraphwarCenterGuideLines(mask: Uint8Array) {
  const centerX = Math.floor(GRAPHWAR_PLANE_LENGTH / 2);
  const centerY = Math.floor(GRAPHWAR_PLANE_HEIGHT / 2);
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      if (Math.abs(x - centerX) <= 1 || Math.abs(y - centerY) <= 1) {
        mask[y * GRAPHWAR_PLANE_LENGTH + x] = 0;
      }
    }
  }
}

/** 移除棋盘边框辅助线。 */
function removeGraphwarPlaneBoundaryGuideLines(mask: Uint8Array) {
  for (let y = 0; y < GRAPHWAR_PLANE_HEIGHT; y += 1) {
    for (let x = 0; x < GRAPHWAR_PLANE_LENGTH; x += 1) {
      if (x <= 1 || x >= GRAPHWAR_PLANE_LENGTH - 2 || y <= 1 || y >= GRAPHWAR_PLANE_HEIGHT - 2) {
        mask[y * GRAPHWAR_PLANE_LENGTH + x] = 0;
      }
    }
  }
}

/** Graphwar 中心辅助线会割裂障碍，识别后把两侧相邻障碍重新桥接。 */
function bridgeObstacleGapsAcrossGuideLines(mask: Uint8Array) {
  const centerX = Math.floor(GRAPHWAR_PLANE_LENGTH / 2);
  const centerY = Math.floor(GRAPHWAR_PLANE_HEIGHT / 2);
  const bridged = new Uint8Array(mask);

  for (let y = 2; y < GRAPHWAR_PLANE_HEIGHT - 2; y += 1) {
    const hasLeftObstacle =
      mask[y * GRAPHWAR_PLANE_LENGTH + centerX - 2] || mask[y * GRAPHWAR_PLANE_LENGTH + centerX - 3];
    const hasRightObstacle =
      mask[y * GRAPHWAR_PLANE_LENGTH + centerX + 2] || mask[y * GRAPHWAR_PLANE_LENGTH + centerX + 3];
    if (!hasLeftObstacle || !hasRightObstacle) {
      continue;
    }

    for (let x = centerX - 1; x <= centerX + 1; x += 1) {
      bridged[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
    }
  }

  for (let x = 2; x < GRAPHWAR_PLANE_LENGTH - 2; x += 1) {
    const hasTopObstacle =
      mask[(centerY - 2) * GRAPHWAR_PLANE_LENGTH + x] || mask[(centerY - 3) * GRAPHWAR_PLANE_LENGTH + x];
    const hasBottomObstacle =
      mask[(centerY + 2) * GRAPHWAR_PLANE_LENGTH + x] || mask[(centerY + 3) * GRAPHWAR_PLANE_LENGTH + x];
    if (!hasTopObstacle || !hasBottomObstacle) {
      continue;
    }

    for (let y = centerY - 1; y <= centerY + 1; y += 1) {
      bridged[y * GRAPHWAR_PLANE_LENGTH + x] = 1;
    }
  }

  mask.set(bridged);
}

/** 从截图中取 Graphwar 平面 cell 中心对应像素，用于构造固定网格 mask。 */
function samplePlaneImagePixel(imageData: ImageData, edgeRect: BoundsRect, planeX: number, planeY: number) {
  const x = Math.floor(edgeRect.x + ((planeX + 0.5) / GRAPHWAR_PLANE_LENGTH) * edgeRect.width);
  const y = Math.floor(edgeRect.y + ((planeY + 0.5) / GRAPHWAR_PLANE_HEIGHT) * edgeRect.height);
  const clampedX = clampNumber(x, 0, imageData.width - 1);
  const clampedY = clampNumber(y, 0, imageData.height - 1);
  const index = (clampedY * imageData.width + clampedX) * 4;
  return {
    red: imageData.data[index],
    green: imageData.data[index + 1],
    blue: imageData.data[index + 2],
  };
}

/** 将截图像素映射到未裁剪的平面网格。 */
function imagePointToRawPlaneGridPoint(point: PixelPoint, edgeRect: BoundsRect): PlaneGridPoint {
  return {
    x: Math.floor(((point.x - edgeRect.x) / edgeRect.width) * GRAPHWAR_PLANE_LENGTH),
    y: Math.floor(((point.y - edgeRect.y) / edgeRect.height) * GRAPHWAR_PLANE_HEIGHT),
  };
}

/** 清除 mask 中一个圆形区域。 */
function clearMaskDisk(mask: Uint8Array, center: PlaneGridPoint, radius: number) {
  setMaskDisk(mask, center, radius, 0);
}

/** 填充 mask 中一个圆形区域。 */
function fillMaskDisk(mask: Uint8Array, center: PlaneGridPoint, radius: number) {
  setMaskDisk(mask, center, radius, 1);
}

/** 用圆盘写入 mask，士兵区域增删共用同一实现。 */
function setMaskDisk(mask: Uint8Array, center: PlaneGridPoint, radius: number, value: 0 | 1) {
  const radiusSquared = radius * radius;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (!offsetIsInsideRadius(offsetX, offsetY, radiusSquared)) {
        continue;
      }

      const x = center.x + offsetX;
      const y = center.y + offsetY;
      if (isInsidePlane(x, y)) {
        mask[y * GRAPHWAR_PLANE_LENGTH + x] = value;
      }
    }
  }
}

/** 判断圆形笔刷偏移是否落在半径内。 */
function offsetIsInsideRadius(offsetX: number, offsetY: number, radiusSquared: number) {
  return offsetX * offsetX + offsetY * offsetY <= radiusSquared;
}

/** 判断平面网格点是否落在圆形笔刷扫过线段的半径内。 */
function pointIsInsideStrokeRadius(
  x: number,
  y: number,
  start: PlaneGridPoint,
  deltaX: number,
  deltaY: number,
  lengthSquared: number,
  radiusSquared: number,
) {
  if (lengthSquared === 0) {
    return offsetIsInsideRadius(x - start.x, y - start.y, radiusSquared);
  }

  const projection = clampNumber(((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared, 0, 1);
  const closestX = start.x + deltaX * projection;
  const closestY = start.y + deltaY * projection;
  const distanceX = x - closestX;
  const distanceY = y - closestY;
  return distanceX * distanceX + distanceY * distanceY <= radiusSquared;
}

/** 判断平面网格点是否位于 Graphwar 原始平面内。 */
function isInsidePlane(x: number, y: number) {
  return x >= 0 && x < GRAPHWAR_PLANE_LENGTH && y >= 0 && y < GRAPHWAR_PLANE_HEIGHT;
}

/** 在二值 mask 中收集 4 邻域连通组件及其边界框。 */
function collectComponents(mask: Uint8Array, width: number): ComponentBox[] {
  const visited = new Uint8Array(mask.length);
  const components: ComponentBox[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) {
      continue;
    }

    const stack = [start];
    visited[start] = 1;
    const pixels: number[] = [];

    while (stack.length) {
      const current = stack.pop() ?? 0;
      const x = current % width;
      pixels.push(current);

      const neighbors = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbors) {
        if (
          next < 0 ||
          next >= mask.length ||
          visited[next] ||
          !mask[next] ||
          (next === current - 1 && x === 0) ||
          (next === current + 1 && x === width - 1)
        ) {
          continue;
        }
        visited[next] = 1;
        stack.push(next);
      }
    }

    components.push(createComponentBox(pixels, width));
  }
  return components;
}

/** 从 Graphwar Soldier.x/y 推出屏幕上的 17x17 非透明外框中心，用于视觉选中圈。 */
function getGraphwarSoldierVisualCenter(sourceCenter: PixelPoint, mirrored: boolean, scale: number) {
  const visibleCenterX = mirrored ? graphwarSoldierMirrorVisibleCenterX : graphwarSoldierVisibleCenterX;
  return createPixelPoint(
    sourceCenter.x + (visibleCenterX - graphwarSoldierCanvasCenter) * scale,
    sourceCenter.y + (graphwarSoldierVisibleCenterY - graphwarSoldierCanvasCenter) * scale,
  );
}

/** 根据连通域像素索引创建边界框和中心点。 */
function createComponentBox(pixels: number[], width: number): ComponentBox {
  let minX = width;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (const pixel of pixels) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const componentWidth = maxX - minX + 1;
  const componentHeight = maxY - minY + 1;
  const centerX = minX + componentWidth / 2;
  const centerY = minY + componentHeight / 2;

  return {
    x: minX,
    y: minY,
    width: componentWidth,
    height: componentHeight,
    area: pixels.length,
    centerX,
    centerY,
  };
}

/** 判断像素是否接近 Graphwar 坐标轴黑色。 */
function isAxisBlackPixel(red: number, green: number, blue: number) {
  return red <= 42 && green <= 42 && blue <= 42;
}

/** 判断像素是否属于深色地形主体。 */
function isObstacleSolidPixel(red: number, green: number, blue: number) {
  return red <= 104 && green <= 104 && blue <= 104 && getColorChroma(red, green, blue) <= 36;
}

/** 判断像素是否可能是地形主体边缘的抗锯齿灰色。 */
function isObstacleAntialiasEdgePixel(red: number, green: number, blue: number) {
  const maxChannel = Math.max(red, green, blue);
  return (
    !isPlaneWhitePixel(red, green, blue) &&
    !isPlaneGreenPixel(red, green, blue) &&
    maxChannel > 104 &&
    red <= 224 &&
    green <= 224 &&
    blue <= 224 &&
    getColorChroma(red, green, blue) <= 42
  );
}

/** 计算颜色通道跨度，用于区分灰阶和玩家高色度像素。 */
function getColorChroma(red: number, green: number, blue: number) {
  return Math.max(red, green, blue) - Math.min(red, green, blue);
}

/** 判断像素是否属于士兵黄色头盔范围。 */
function isSoldierYellowPixel(red: number, green: number, blue: number) {
  return red >= 170 && green >= 160 && blue <= 130 && red + green - blue >= 260;
}

/** 判断像素是否匹配 Graphwar 士兵固定黄色/高光种子。 */
function isSoldierTemplateSeedPixel(red: number, green: number, blue: number) {
  return isSoldierYellowPixel(red, green, blue) || isSoldierWhiteHighlightPixel(red, green, blue);
}

/** 判断像素是否接近 Graphwar 士兵白色高光。 */
function isSoldierWhiteHighlightPixel(red: number, green: number, blue: number) {
  return red >= 235 && green >= 235 && blue >= 220 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 36;
}

/** 判断像素是否接近 Graphwar 士兵深色轮廓。 */
function isSoldierDarkOutlinePixel(red: number, green: number, blue: number) {
  return red <= 145 && green <= 145 && blue <= 145 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 48;
}

/** 判断像素是否属于棋盘白色背景。 */
function isPlaneWhitePixel(red: number, green: number, blue: number) {
  return red >= 225 && green >= 225 && blue >= 210 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 35;
}

/** 判断像素是否属于 Graphwar 绿色棋盘背景。 */
function isPlaneGreenPixel(red: number, green: number, blue: number) {
  return (
    green >= 155 && red >= 115 && red <= 195 && blue >= 110 && blue <= 195 && green - red >= 20 && green - blue >= 20
  );
}
