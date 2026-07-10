<script setup lang="ts">
import type { BoundsRect, PixelPoint } from "../../core/types";

// SVG 坐标像素：点标签从可视圆边缘再外移一点，避免文字贴住路径点。
const pathPointLabelGapSvgPixels = 4;

/** SVG 线段 DTO；overlay 只消费已计算好的端点，不负责路径规则。 */
interface GraphwarStageOverlayLineSegment {
  /** 起点 x。 */
  x1: number;
  /** 终点 x。 */
  x2: number;
  /** 起点 y。 */
  y1: number;
  /** 终点 y。 */
  y2: number;
}

/** 截图上的识别框绘制 DTO，坐标均为截图像素。 */
interface GraphwarStageOverlayDetectionBox {
  /** 稳定 id，用于 SVG 列表渲染。 */
  id: string;
  /** 识别类型，直接映射到既有 BEM 修饰类。 */
  kind: string;
  /** 可视圆心 x。 */
  visualCenterX: number;
  /** 可视圆心 y。 */
  visualCenterY: number;
  /** 可视半径。 */
  visualRadius: number;
}

/** 障碍笔刷预览椭圆，父页面已经按当前 Graphwar 边界换算成截图像素。 */
interface GraphwarStageOverlayObstacleBrushPreview {
  /** 预览中心。 */
  center: PixelPoint;
  /** X 半径。 */
  radiusX: number;
  /** Y 半径。 */
  radiusY: number;
}

/** 边界、坐标轴和可点击范围图层。 */
interface GraphwarStageOverlayBoundsLayer {
  /** 当前允许点击的目标范围。 */
  allowedTargetRect?: BoundsRect;
  /** 当前 Graphwar 坐标轴线段，已按截图像素投影。 */
  axisLines: readonly GraphwarStageOverlayLineSegment[];
  /** 障碍笔刷裁剪使用已落地边界，不能跟随手动框选预览。 */
  clipBoundsRect: BoundsRect;
  /** 边界自动识别成功后的高亮状态。 */
  flashActive: boolean;
  /** 正在手动框选边界时的第一个点。 */
  firstPoint?: PixelPoint;
  /** 当前 Graphwar 坐标网格线段，已按截图像素投影。 */
  gridLines: readonly GraphwarStageOverlayLineSegment[];
  /** 正在手动框选边界时的预览矩形。 */
  previewRect?: BoundsRect;
  /** 当前用于弹道验证的障碍边界矩形。 */
  visibleBoundaryExpansionRect?: BoundsRect;
  /** 当前边界矩形；可能是手动框选预览。 */
  visibleRect: BoundsRect;
}

/** 障碍 mask 和笔刷预览图层。 */
interface GraphwarStageOverlayObstacleLayer {
  /** 障碍笔刷是否处于擦除模式。 */
  brushEraseEnabled: boolean;
  /** 障碍笔刷预览。 */
  brushPreview?: GraphwarStageOverlayObstacleBrushPreview;
  /** 当前是否显示寻路膨胀后的障碍边界。 */
  pathfindingEdgesActive: boolean;
  /** 寻路几何障碍边界 path。 */
  routeEdgePath: string;
  /** 寻路几何障碍填充 path。 */
  routeFillPath: string;
  /** 弹道模拟障碍边界 path。 */
  simulationEdgePath: string;
  /** 弹道模拟障碍填充 path。 */
  simulationFillPath: string;
  /** 普通障碍是否显示；Agent 模式可在智能光标关闭时继续展示它们。 */
  visible: boolean;
  /** 普通障碍边界 path。 */
  visibleEdgePath: string;
  /** 普通障碍填充 path。 */
  visibleFillPath: string;
}

/** 检测框和检测闪烁图层。 */
interface GraphwarStageOverlayDetectionLayer {
  /** 当前可选对象的可视圆。 */
  boxes: readonly GraphwarStageOverlayDetectionBox[];
  /** 当前悬停的士兵 id。 */
  hoveredSoldierId?: string;
  /** 已识别但当前不可选的士兵提示圆；仅展示，不参与 hover 或点击。 */
  inactiveBoxes: readonly GraphwarStageOverlayDetectionBox[];
  /** 一键清图命中后的闪烁状态。 */
  oneClickClearHitFlashActive: boolean;
  /** 一键清图命中的士兵。 */
  oneClickClearHitFlashBoxes: readonly GraphwarStageOverlayDetectionBox[];
  /** 是否播放士兵识别闪烁。 */
  soldierFlashActive: boolean;
  /** 士兵识别完成后的闪烁对象。 */
  soldierFlashBoxes: readonly GraphwarStageOverlayDetectionBox[];
  /** 士兵识别圆是否显示；不代表智能光标交互可用。 */
  visible: boolean;
}

/** 已选路径点和路径线图层。 */
interface GraphwarStageOverlayPathLayer {
  /** 当前悬停路径点索引。 */
  hoveredPointIndex?: number;
  /** 已选路径点之间的可视连接线。 */
  lineSegments: readonly GraphwarStageOverlayLineSegment[];
  /** 当前路径点。 */
  points: readonly PixelPoint[];
  /** 士兵标签中的 self 文案。 */
  selfLabel: string;
  /** 用于绘制路径点和阻塞点的选择半径。 */
  selectionRadius: number;
}

/** 实时点击预览图层。 */
interface GraphwarStageOverlayLiveClickPreviewLayer {
  /** 实时点击预览轨迹。 */
  curvePoints: string;
  /** 实时点击预览轨迹颜色，应跟随当前主轨迹颜色。 */
  curveStrokeColor: string;
  /** 实时点击预览点标签。 */
  label: string;
  /** 实时点击预览连接线。 */
  lineSegments: readonly GraphwarStageOverlayLineSegment[];
  /** 实时点击预览点。 */
  point?: PixelPoint;
}

/** 智能寻路搜索动画和阻塞提示图层。 */
interface GraphwarStageOverlayPathfindingLayer {
  /** 被当前轨迹预检拦截的位置。 */
  blockedPoint?: PixelPoint;
  /** 已有 Step 路径中首个严格域失败的控制段。 */
  blockedSegment?: GraphwarStageOverlayLineSegment;
  /** 当前是否有智能寻路运行中。 */
  inProgress: boolean;
  /** 寻路优化阶段当前尝试点。 */
  optimizationPreviewPoint?: PixelPoint;
  /** 寻路优化阶段当前尝试点半径，单位为截图/SVG 坐标像素。 */
  optimizationPreviewRadius: number;
  /** 寻路预览里的已接受边。 */
  previewAcceptedEdges: readonly GraphwarStageOverlayLineSegment[];
  /** 寻路起点到目标点的预览连接线。 */
  previewConnection?: GraphwarStageOverlayLineSegment;
  /** 寻路预览当前点。 */
  previewCurrentPoint?: PixelPoint;
  /** 寻路尝试路径的 polyline points。 */
  previewPathPoints: string;
  /** 寻路预览候选点。 */
  previewPoints: readonly PixelPoint[];
}

/** 当前公式或模拟器轨迹图层。 */
interface GraphwarStageOverlayTrajectoryLayer {
  /** 当前公式或模拟器轨迹。 */
  curvePoints: string;
  /** 当前轨迹颜色。 */
  strokeColor: string;
}

/** SVG 视口尺寸。 */
interface GraphwarStageOverlayViewport {
  /** SVG viewBox 高度。 */
  imageHeight: number;
  /** SVG viewBox 宽度。 */
  imageWidth: number;
}

/** 舞台 SVG overlay 的完整展示模型；父页面负责把业务状态投影成该 DTO。 */
export interface GraphwarStageOverlayModel {
  /** 边界、坐标轴和可点击范围图层。 */
  bounds: GraphwarStageOverlayBoundsLayer;
  /** 检测框和检测闪烁图层。 */
  detection: GraphwarStageOverlayDetectionLayer;
  /** 实时点击预览图层。 */
  liveClickPreview: GraphwarStageOverlayLiveClickPreviewLayer;
  /** 障碍 mask 和笔刷预览图层。 */
  obstacles: GraphwarStageOverlayObstacleLayer;
  /** 已选路径点和路径线图层。 */
  path: GraphwarStageOverlayPathLayer;
  /** 智能寻路搜索动画和阻塞提示图层。 */
  pathfinding: GraphwarStageOverlayPathfindingLayer;
  /** 当前公式或模拟器轨迹图层。 */
  trajectory: GraphwarStageOverlayTrajectoryLayer;
  /** SVG 视口尺寸。 */
  viewport: GraphwarStageOverlayViewport;
}

withDefaults(
  defineProps<{
    /** 当前实例使用的障碍笔刷裁剪 id，主舞台和放大镜必须不同。 */
    clipPathId: string;
    /** 当前实例的 key 前缀；放大镜实例用它避免复用主舞台 key 语义。 */
    keyPrefix?: string;
    /** 已按图层分组的 overlay 展示模型。 */
    overlay: GraphwarStageOverlayModel;
  }>(),
  {
    keyPrefix: "",
  },
);
</script>

<template>
  <svg
    class="graphwar-killer__overlay"
    :viewBox="`0 0 ${overlay.viewport.imageWidth} ${overlay.viewport.imageHeight}`"
    aria-hidden="true"
  >
    <defs>
      <clipPath :id="clipPathId">
        <rect
          :x="overlay.bounds.clipBoundsRect.x"
          :y="overlay.bounds.clipBoundsRect.y"
          :width="overlay.bounds.clipBoundsRect.width"
          :height="overlay.bounds.clipBoundsRect.height"
        />
      </clipPath>
    </defs>
    <g
      v-if="overlay.bounds.gridLines.length"
      class="graphwar-killer__grid"
    >
      <line
        v-for="(segment, index) in overlay.bounds.gridLines"
        :key="`${keyPrefix}grid-${index}`"
        :x1="segment.x1"
        :y1="segment.y1"
        :x2="segment.x2"
        :y2="segment.y2"
      />
    </g>
    <rect
      class="graphwar-killer__bounds"
      :class="{
        'graphwar-killer__bounds--preview': overlay.bounds.previewRect,
        'graphwar-killer__bounds--flash': overlay.bounds.flashActive && !overlay.bounds.previewRect,
      }"
      :x="overlay.bounds.visibleRect.x"
      :y="overlay.bounds.visibleRect.y"
      :width="overlay.bounds.visibleRect.width"
      :height="overlay.bounds.visibleRect.height"
    />
    <rect
      v-if="overlay.bounds.allowedTargetRect"
      class="graphwar-killer__target-range"
      :x="overlay.bounds.allowedTargetRect.x"
      :y="overlay.bounds.allowedTargetRect.y"
      :width="overlay.bounds.allowedTargetRect.width"
      :height="overlay.bounds.allowedTargetRect.height"
    />
    <rect
      v-if="overlay.bounds.visibleBoundaryExpansionRect"
      class="graphwar-killer__boundary-expansion"
      :x="overlay.bounds.visibleBoundaryExpansionRect.x"
      :y="overlay.bounds.visibleBoundaryExpansionRect.y"
      :width="overlay.bounds.visibleBoundaryExpansionRect.width"
      :height="overlay.bounds.visibleBoundaryExpansionRect.height"
    />
    <line
      v-for="(segment, index) in overlay.bounds.axisLines"
      :key="`${keyPrefix}axis-${index}`"
      class="graphwar-killer__axis"
      :x1="segment.x1"
      :x2="segment.x2"
      :y1="segment.y1"
      :y2="segment.y2"
    />
    <path
      v-if="overlay.obstacles.visible && !overlay.obstacles.pathfindingEdgesActive && overlay.obstacles.visibleFillPath"
      class="graphwar-killer__obstacle-fill"
      :d="overlay.obstacles.visibleFillPath"
    />
    <path
      v-if="overlay.obstacles.visible && !overlay.obstacles.pathfindingEdgesActive && overlay.obstacles.visibleEdgePath"
      class="graphwar-killer__obstacle-edge"
      :d="overlay.obstacles.visibleEdgePath"
    />
    <template v-if="overlay.obstacles.pathfindingEdgesActive">
      <path
        v-if="overlay.obstacles.routeFillPath"
        class="graphwar-killer__obstacle-fill graphwar-killer__obstacle-fill--route"
        :d="overlay.obstacles.routeFillPath"
      />
      <path
        v-if="overlay.obstacles.simulationFillPath"
        class="graphwar-killer__obstacle-fill graphwar-killer__obstacle-fill--simulation"
        :d="overlay.obstacles.simulationFillPath"
      />
      <path
        v-if="overlay.obstacles.routeEdgePath"
        class="graphwar-killer__obstacle-edge graphwar-killer__obstacle-edge--route"
        :d="overlay.obstacles.routeEdgePath"
      />
      <path
        v-if="overlay.obstacles.simulationEdgePath"
        class="graphwar-killer__obstacle-edge graphwar-killer__obstacle-edge--simulation"
        :d="overlay.obstacles.simulationEdgePath"
      />
    </template>
    <template v-if="overlay.detection.visible">
      <g
        v-for="box in overlay.detection.inactiveBoxes"
        :key="`${keyPrefix}inactive-${box.id}`"
        class="graphwar-killer__detection-group"
      >
        <circle
          class="graphwar-killer__detection graphwar-killer__detection--inactive-soldier"
          :cx="box.visualCenterX"
          :cy="box.visualCenterY"
          :r="box.visualRadius"
        />
      </g>
      <g
        v-for="box in overlay.detection.boxes"
        :key="`${keyPrefix}${box.id}`"
        class="graphwar-killer__detection-group"
      >
        <circle
          class="graphwar-killer__detection"
          :class="[
            `graphwar-killer__detection--${box.kind}`,
            {
              'graphwar-killer__detection--hovered': box.id === overlay.detection.hoveredSoldierId,
            },
          ]"
          :cx="box.visualCenterX"
          :cy="box.visualCenterY"
          :r="box.visualRadius"
        />
      </g>
    </template>
    <g
      v-if="overlay.detection.soldierFlashActive"
      class="graphwar-killer__detection-flash-group"
    >
      <circle
        v-for="box in overlay.detection.soldierFlashBoxes"
        :key="`${keyPrefix}detection-flash-${box.id}`"
        class="graphwar-killer__detection-flash-circle"
        :cx="box.visualCenterX"
        :cy="box.visualCenterY"
        :r="box.visualRadius"
      />
    </g>
    <g
      v-if="overlay.detection.oneClickClearHitFlashActive"
      class="graphwar-killer__detection-flash-group"
    >
      <circle
        v-for="box in overlay.detection.oneClickClearHitFlashBoxes"
        :key="`${keyPrefix}one-click-clear-hit-flash-${box.id}`"
        class="graphwar-killer__detection-flash-circle graphwar-killer__detection-flash-circle--hit"
        :cx="box.visualCenterX"
        :cy="box.visualCenterY"
        :r="box.visualRadius"
      />
    </g>
    <ellipse
      v-if="overlay.obstacles.brushPreview"
      class="graphwar-killer__obstacle-brush-preview"
      :class="{ 'graphwar-killer__obstacle-brush-preview--erase': overlay.obstacles.brushEraseEnabled }"
      :clip-path="`url(#${clipPathId})`"
      :cx="overlay.obstacles.brushPreview.center.x"
      :cy="overlay.obstacles.brushPreview.center.y"
      :rx="overlay.obstacles.brushPreview.radiusX"
      :ry="overlay.obstacles.brushPreview.radiusY"
    />
    <circle
      v-if="overlay.bounds.firstPoint"
      class="graphwar-killer__bounds-point"
      :cx="overlay.bounds.firstPoint.x"
      :cy="overlay.bounds.firstPoint.y"
      r="7"
    />
    <line
      v-for="(segment, index) in overlay.path.lineSegments"
      :key="`${keyPrefix}path-line-${index}`"
      class="graphwar-killer__path-line"
      :x1="segment.x1"
      :y1="segment.y1"
      :x2="segment.x2"
      :y2="segment.y2"
    />
    <line
      v-for="(segment, index) in overlay.liveClickPreview.lineSegments"
      :key="`${keyPrefix}live-click-preview-line-${index}`"
      class="graphwar-killer__path-line graphwar-killer__path-line--live-click-preview"
      :x1="segment.x1"
      :y1="segment.y1"
      :x2="segment.x2"
      :y2="segment.y2"
    />
    <line
      v-if="overlay.pathfinding.inProgress && overlay.pathfinding.previewConnection"
      class="graphwar-killer__pathfinding-connection"
      :x1="overlay.pathfinding.previewConnection.x1"
      :y1="overlay.pathfinding.previewConnection.y1"
      :x2="overlay.pathfinding.previewConnection.x2"
      :y2="overlay.pathfinding.previewConnection.y2"
    />
    <polyline
      v-if="overlay.pathfinding.inProgress && overlay.pathfinding.previewPathPoints"
      class="graphwar-killer__pathfinding-try-path"
      :points="overlay.pathfinding.previewPathPoints"
    />
    <circle
      v-if="overlay.pathfinding.inProgress && overlay.pathfinding.optimizationPreviewPoint"
      class="graphwar-killer__pathfinding-optimization-point"
      :cx="overlay.pathfinding.optimizationPreviewPoint.x"
      :cy="overlay.pathfinding.optimizationPreviewPoint.y"
      :r="overlay.pathfinding.optimizationPreviewRadius"
    />
    <g
      v-if="overlay.pathfinding.inProgress"
      class="graphwar-killer__pathfinding-preview"
    >
      <line
        v-for="(segment, index) in overlay.pathfinding.previewAcceptedEdges"
        :key="`${keyPrefix}pathfinding-preview-edge-${index}`"
        class="graphwar-killer__pathfinding-accepted-edge"
        :x1="segment.x1"
        :y1="segment.y1"
        :x2="segment.x2"
        :y2="segment.y2"
      />
      <circle
        v-if="overlay.pathfinding.previewCurrentPoint"
        class="graphwar-killer__pathfinding-current"
        :cx="overlay.pathfinding.previewCurrentPoint.x"
        :cy="overlay.pathfinding.previewCurrentPoint.y"
        r="4.2"
      />
      <circle
        v-for="(point, index) in overlay.pathfinding.previewPoints"
        :key="`${keyPrefix}pathfinding-preview-${index}`"
        class="graphwar-killer__pathfinding-candidate"
        :cx="point.x"
        :cy="point.y"
        r="2.8"
      />
    </g>
    <polyline
      v-if="overlay.trajectory.curvePoints"
      class="graphwar-killer__curve-line"
      :points="overlay.trajectory.curvePoints"
      :style="{ stroke: overlay.trajectory.strokeColor }"
    />
    <polyline
      v-if="overlay.liveClickPreview.curvePoints"
      class="graphwar-killer__curve-line graphwar-killer__curve-line--live-click-preview"
      :points="overlay.liveClickPreview.curvePoints"
      :style="{ stroke: overlay.liveClickPreview.curveStrokeColor }"
    />
    <circle
      v-if="overlay.pathfinding.blockedPoint"
      class="graphwar-killer__pathfinding-blocked-point"
      :cx="overlay.pathfinding.blockedPoint.x"
      :cy="overlay.pathfinding.blockedPoint.y"
      :r="overlay.path.selectionRadius"
    />
    <line
      v-if="overlay.pathfinding.blockedSegment"
      class="graphwar-killer__pathfinding-blocked-segment"
      :x1="overlay.pathfinding.blockedSegment.x1"
      :y1="overlay.pathfinding.blockedSegment.y1"
      :x2="overlay.pathfinding.blockedSegment.x2"
      :y2="overlay.pathfinding.blockedSegment.y2"
    />
    <g
      v-for="(point, index) in overlay.path.points"
      :key="`${keyPrefix}point-${index}`"
    >
      <circle
        class="graphwar-killer__point"
        :class="{
          'graphwar-killer__point--start': index === 0,
          'graphwar-killer__point--hovered': index === overlay.path.hoveredPointIndex,
        }"
        :cx="point.x"
        :cy="point.y"
        :r="overlay.path.selectionRadius"
      />
      <text
        class="graphwar-killer__point-label"
        :x="point.x + overlay.path.selectionRadius + pathPointLabelGapSvgPixels"
        :y="point.y - overlay.path.selectionRadius - pathPointLabelGapSvgPixels"
      >
        {{ index === 0 ? overlay.path.selfLabel : index }}
      </text>
    </g>
    <g v-if="overlay.liveClickPreview.point">
      <circle
        class="graphwar-killer__point graphwar-killer__point--live-click-preview"
        :cx="overlay.liveClickPreview.point.x"
        :cy="overlay.liveClickPreview.point.y"
        :r="overlay.path.selectionRadius"
      />
      <text
        class="graphwar-killer__point-label"
        :x="overlay.liveClickPreview.point.x + overlay.path.selectionRadius + pathPointLabelGapSvgPixels"
        :y="overlay.liveClickPreview.point.y - overlay.path.selectionRadius - pathPointLabelGapSvgPixels"
      >
        {{ overlay.liveClickPreview.label }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.graphwar-killer__overlay {
  height: 100%;
  inset: 0;
  position: absolute;
  width: 100%;
}

.graphwar-killer__bounds {
  fill: color-mix(in srgb, var(--vp-c-brand-soft) 18%, transparent);
  stroke: var(--vp-c-brand-1);
  stroke-width: 1;
}

.graphwar-killer__bounds--preview {
  fill: color-mix(in srgb, #f97316 14%, transparent);
  stroke: #f97316;
}

.graphwar-killer__bounds--flash {
  animation: graphwar-killer-bounds-flash 1600ms ease-out;
}

.graphwar-killer__grid {
  pointer-events: none;
  stroke: color-mix(in srgb, var(--vp-c-divider) 56%, transparent);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__boundary-expansion {
  fill: none;
  pointer-events: none;
  stroke: #92400e;
  stroke-linecap: square;
  stroke-linejoin: miter;
  stroke-width: 1;
}

.graphwar-killer__bounds-point {
  fill: #f97316;
  stroke: var(--vp-c-bg);
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__axis {
  stroke: color-mix(in srgb, var(--vp-c-brand-1) 64%, transparent);
  stroke-width: 1;
}

.graphwar-killer__detection-group {
  pointer-events: none;
}

.graphwar-killer__detection {
  fill: none;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__detection--soldier {
  stroke: #2563eb;
}

.graphwar-killer__detection--inactive-soldier {
  stroke: #93c5fd;
  stroke-opacity: 82%;
}

.graphwar-killer__detection-flash-group {
  pointer-events: none;
}

.graphwar-killer__detection-flash-circle {
  animation: graphwar-killer-detection-soldier-flash 1600ms ease-out forwards;
  fill: none;
  stroke: #2563eb;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__detection-flash-circle--hit {
  stroke: #16a34a;
}

.graphwar-killer__detection--hovered {
  animation: graphwar-killer-curve-blink 900ms ease-in-out infinite;
  stroke: #16a34a;
}

.graphwar-killer__obstacle-edge {
  fill: none;
  stroke: #dc2626;
  stroke-linecap: square;
  stroke-linejoin: miter;
  stroke-width: 1;
}

.graphwar-killer__obstacle-fill {
  fill: rgb(220 38 38 / 10%);
  pointer-events: none;
}

.graphwar-killer__obstacle-fill--route {
  fill: rgb(244 114 182 / 7%);
}

.graphwar-killer__obstacle-fill--simulation {
  fill: rgb(220 38 38 / 7%);
}

.graphwar-killer__obstacle-edge--route {
  stroke: #f472b6;
}

.graphwar-killer__obstacle-edge--simulation {
  stroke: #dc2626;
}

.graphwar-killer__obstacle-brush-preview {
  animation: graphwar-killer-obstacle-brush-blink 1200ms ease-in-out infinite;
  fill: rgb(220 38 38 / 34%);
  pointer-events: none;
}

.graphwar-killer__obstacle-brush-preview--erase {
  fill: rgb(34 197 94 / 34%);
}

.graphwar-killer__target-range {
  fill: color-mix(in srgb, #86efac 14%, transparent);
  pointer-events: none;
}

.graphwar-killer__path-line {
  opacity: 42%;
  stroke: #38bdf8;
  stroke-dasharray: 7 6;
  stroke-linecap: round;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__path-line--live-click-preview {
  animation: graphwar-killer-live-click-path-line-blink 900ms ease-in-out infinite;
}

.graphwar-killer__pathfinding-preview {
  pointer-events: none;
}

.graphwar-killer__pathfinding-connection {
  animation: graphwar-killer-curve-blink 700ms ease-in-out infinite;
  pointer-events: none;
  stroke: #2563eb;
  stroke-dasharray: 8 6;
  stroke-linecap: round;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-try-path {
  animation: graphwar-killer-curve-blink 700ms ease-in-out infinite;
  fill: none;
  pointer-events: none;
  stroke: #0ea5e9;
  stroke-dasharray: 10 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-optimization-point {
  animation: graphwar-killer-curve-blink 450ms ease-in-out infinite;
  fill: color-mix(in srgb, #facc15 18%, transparent);
  pointer-events: none;
  stroke: #facc15;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-accepted-edge {
  stroke: #22c55e;
  stroke-dasharray: 5 5;
  stroke-linecap: round;
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-candidate {
  fill: #22c55e;
  stroke: var(--vp-c-bg);
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-current {
  animation: graphwar-killer-curve-blink 450ms ease-in-out infinite;
  fill: color-mix(in srgb, #facc15 22%, transparent);
  stroke: #facc15;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-blocked-point {
  animation: graphwar-killer-curve-blink 450ms ease-in-out infinite;
  fill: color-mix(in srgb, #dc2626 18%, transparent);
  pointer-events: none;
  stroke: #dc2626;
  stroke-dasharray: 5 4;
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__pathfinding-blocked-segment {
  animation: graphwar-killer-curve-blink 450ms ease-in-out infinite;
  pointer-events: none;
  stroke: #dc2626;
  stroke-dasharray: 5 4;
  stroke-linecap: round;
  stroke-width: 4;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__curve-line {
  animation: graphwar-killer-trajectory-blink 900ms ease-in-out infinite;
  fill: none;
  stroke: #ec4899;
  stroke-linecap: round;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__curve-line--live-click-preview {
  /* 实时预览应弱于主轨迹，避免覆盖已生成轨迹的视觉层级。 */
  stroke-opacity: 62%;
}

@keyframes graphwar-killer-live-click-path-line-blink {
  0%,
  100% {
    opacity: 24%;
  }

  50% {
    opacity: 96%;
  }
}

@keyframes graphwar-killer-trajectory-blink {
  0%,
  100% {
    opacity: 100%;
  }

  50% {
    opacity: 72%;
  }
}

@keyframes graphwar-killer-bounds-flash {
  0%,
  100% {
    opacity: 100%;
    stroke-width: 1;
  }

  16%,
  62% {
    opacity: 100%;
    stroke: #f97316;
    stroke-width: 5;
  }

  38% {
    opacity: 52%;
    stroke: #f97316;
    stroke-width: 5;
  }
}

@keyframes graphwar-killer-detection-soldier-flash {
  0% {
    opacity: 0%;
    stroke-width: 1.5;
  }

  16%,
  62% {
    opacity: 100%;
    stroke-width: 4;
  }

  38% {
    opacity: 52%;
    stroke-width: 4;
  }

  100% {
    opacity: 0%;
    stroke-width: 2;
  }
}

@keyframes graphwar-killer-curve-blink {
  0%,
  100% {
    opacity: 100%;
  }

  50% {
    opacity: 34%;
  }
}

@keyframes graphwar-killer-obstacle-brush-blink {
  0%,
  100% {
    opacity: 86%;
  }

  50% {
    opacity: 32%;
  }
}

.graphwar-killer__point {
  fill: color-mix(in srgb, #f97316 10%, transparent);
  stroke: #f97316;
  stroke-dasharray: 5 4;
  stroke-width: 1;
}

.graphwar-killer__point--start {
  fill: color-mix(in srgb, #16a34a 12%, transparent);
  stroke: #16a34a;
}

.graphwar-killer__point--hovered {
  animation: graphwar-killer-curve-blink 900ms ease-in-out infinite;
  fill: color-mix(in srgb, #16a34a 12%, transparent);
  stroke: #16a34a;
}

.graphwar-killer__point--live-click-preview {
  animation: graphwar-killer-live-click-point-spin 4500ms linear infinite;
  pointer-events: none;
  transform-box: fill-box;
  transform-origin: center;
}

@keyframes graphwar-killer-live-click-point-spin {
  100% {
    transform: rotate(360deg);
  }
}

.graphwar-killer__point-label {
  fill: var(--vp-c-text-1);
  font-size: 16px;
  font-weight: 800;
  paint-order: stroke;
  stroke: var(--vp-c-bg);
  stroke-width: 4;
}
</style>
