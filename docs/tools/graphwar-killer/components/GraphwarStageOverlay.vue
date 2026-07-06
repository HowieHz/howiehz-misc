<script setup lang="ts">
import type { BoundsRect, PixelPoint } from "../core/types";

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

withDefaults(
  defineProps<{
    /** 当前允许点击的目标范围。 */
    allowedTargetRect?: BoundsRect;
    /** 边界自动识别成功后的高亮状态。 */
    boundsFlashActive: boolean;
    /** 正在手动框选边界时的第一个点。 */
    boundsFirstPoint?: PixelPoint;
    /** 正在手动框选边界时的预览矩形。 */
    boundsPreviewRect?: BoundsRect;
    /** 当前实例使用的障碍笔刷裁剪 id，主舞台和放大镜必须不同。 */
    clipPathId: string;
    /** 障碍笔刷裁剪使用已落地边界，不能跟随手动框选预览。 */
    clipBoundsRect: BoundsRect;
    /** 已识别对象的可视圆。 */
    detectionBoxes: readonly GraphwarStageOverlayDetectionBox[];
    /** 士兵识别完成后的闪烁对象。 */
    detectedSoldiers: readonly GraphwarStageOverlayDetectionBox[];
    /** 是否播放士兵识别闪烁。 */
    detectionSoldierFlashActive: boolean;
    /** SVG viewBox 高度。 */
    imageHeight: number;
    /** SVG viewBox 宽度。 */
    imageWidth: number;
    /** 当前悬停的士兵 id。 */
    hoveredDetectedSoldierId?: string;
    /** 当前悬停路径点索引。 */
    hoveredPathPointIndex?: number;
    /** 当前实例的 key 前缀；放大镜实例用它避免复用主舞台 key 语义。 */
    keyPrefix?: string;
    /** 实时点击预览轨迹。 */
    liveClickPreviewCurvePoints: string;
    /** 实时点击预览点标签。 */
    liveClickPreviewLabel: string;
    /** 实时点击预览连接线。 */
    liveClickPreviewLineSegments: readonly GraphwarStageOverlayLineSegment[];
    /** 实时点击预览点。 */
    liveClickPreviewPoint?: PixelPoint;
    /** 障碍笔刷是否处于擦除模式。 */
    obstacleBrushEraseEnabled: boolean;
    /** 障碍笔刷预览。 */
    obstacleBrushPreview?: GraphwarStageOverlayObstacleBrushPreview;
    /** 一键清图命中后的闪烁状态。 */
    oneClickClearHitFlashActive: boolean;
    /** 一键清图命中的士兵。 */
    oneClickClearHitFlashSoldiers: readonly GraphwarStageOverlayDetectionBox[];
    /** 已选路径点之间的可视连接线。 */
    pathLineSegments: readonly GraphwarStageOverlayLineSegment[];
    /** 当前路径点。 */
    pathPixels: readonly PixelPoint[];
    /** 当前是否显示寻路膨胀后的障碍边界。 */
    pathfindingObstacleEdgesActive: boolean;
    /** 寻路优化阶段当前尝试点。 */
    pathfindingOptimizationPreviewPoint?: PixelPoint;
    /** 当前公式或模拟器轨迹。 */
    plottedCurvePoints: string;
    /** 当前轨迹颜色。 */
    trajectoryStrokeColor: string;
    /** 用于绘制路径点和阻塞点的选择半径。 */
    soldierSelectionRadius: number;
    /** 用于绘制智能寻路优化预览点的士兵标记半径。 */
    soldierMarkerRadius: number;
    /** 士兵标签中的 self 文案。 */
    selfLabel: string;
    /** 是否显示智能光标识别层。 */
    smartCursorEnabled: boolean;
    /** 当前是否有智能寻路运行中。 */
    smartPathfindingInProgress: boolean;
    /** 寻路预览里的已接受边。 */
    smartPathfindingPreviewAcceptedEdges: readonly GraphwarStageOverlayLineSegment[];
    /** 寻路起点到目标点的预览连接线。 */
    smartPathfindingPreviewConnection?: GraphwarStageOverlayLineSegment;
    /** 寻路预览当前点。 */
    smartPathfindingPreviewCurrentPoint?: PixelPoint;
    /** 寻路尝试路径的 polyline points。 */
    smartPathfindingPreviewPathPoints: string;
    /** 寻路预览候选点。 */
    smartPathfindingPreviewPoints: readonly PixelPoint[];
    /** 被当前轨迹预检拦截的位置。 */
    smartPathfindingBlockedPoint?: PixelPoint;
    /** 当前用于弹道验证的障碍边界矩形。 */
    visibleBoundaryExpansionRect?: BoundsRect;
    /** 当前边界矩形；可能是手动框选预览。 */
    visibleBoundsRect: BoundsRect;
    /** 普通障碍边界 path。 */
    visibleObstacleEdgePath: string;
    /** 普通障碍填充 path。 */
    visibleObstacleFillPath: string;
    /** 寻路几何障碍边界 path。 */
    smartPathfindingObstacleRouteEdgePath: string;
    /** 寻路几何障碍填充 path。 */
    smartPathfindingObstacleRouteFillPath: string;
    /** 弹道模拟障碍边界 path。 */
    smartPathfindingObstacleSimulationEdgePath: string;
    /** 弹道模拟障碍填充 path。 */
    smartPathfindingObstacleSimulationFillPath: string;
  }>(),
  {
    allowedTargetRect: undefined,
    boundsFirstPoint: undefined,
    boundsPreviewRect: undefined,
    hoveredDetectedSoldierId: undefined,
    hoveredPathPointIndex: undefined,
    keyPrefix: "",
    liveClickPreviewPoint: undefined,
    obstacleBrushPreview: undefined,
    pathfindingOptimizationPreviewPoint: undefined,
    smartPathfindingBlockedPoint: undefined,
    smartPathfindingPreviewConnection: undefined,
    smartPathfindingPreviewCurrentPoint: undefined,
    visibleBoundaryExpansionRect: undefined,
  },
);
</script>

<template>
  <svg
    class="graphwar-killer__overlay"
    :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
    aria-hidden="true"
  >
    <defs>
      <clipPath :id="clipPathId">
        <rect
          :x="clipBoundsRect.x"
          :y="clipBoundsRect.y"
          :width="clipBoundsRect.width"
          :height="clipBoundsRect.height"
        />
      </clipPath>
    </defs>
    <rect
      class="graphwar-killer__bounds"
      :class="{
        'graphwar-killer__bounds--preview': boundsPreviewRect,
        'graphwar-killer__bounds--flash': boundsFlashActive && !boundsPreviewRect,
      }"
      :x="visibleBoundsRect.x"
      :y="visibleBoundsRect.y"
      :width="visibleBoundsRect.width"
      :height="visibleBoundsRect.height"
    />
    <rect
      v-if="allowedTargetRect"
      class="graphwar-killer__target-range"
      :x="allowedTargetRect.x"
      :y="allowedTargetRect.y"
      :width="allowedTargetRect.width"
      :height="allowedTargetRect.height"
    />
    <rect
      v-if="visibleBoundaryExpansionRect"
      class="graphwar-killer__boundary-expansion"
      :x="visibleBoundaryExpansionRect.x"
      :y="visibleBoundaryExpansionRect.y"
      :width="visibleBoundaryExpansionRect.width"
      :height="visibleBoundaryExpansionRect.height"
    />
    <line
      class="graphwar-killer__axis"
      :x1="visibleBoundsRect.x"
      :x2="visibleBoundsRect.x + visibleBoundsRect.width"
      :y1="visibleBoundsRect.y + visibleBoundsRect.height / 2"
      :y2="visibleBoundsRect.y + visibleBoundsRect.height / 2"
    />
    <line
      class="graphwar-killer__axis"
      :x1="visibleBoundsRect.x + visibleBoundsRect.width / 2"
      :x2="visibleBoundsRect.x + visibleBoundsRect.width / 2"
      :y1="visibleBoundsRect.y"
      :y2="visibleBoundsRect.y + visibleBoundsRect.height"
    />
    <path
      v-if="smartCursorEnabled && !pathfindingObstacleEdgesActive && visibleObstacleFillPath"
      class="graphwar-killer__obstacle-fill"
      :d="visibleObstacleFillPath"
    />
    <path
      v-if="smartCursorEnabled && !pathfindingObstacleEdgesActive && visibleObstacleEdgePath"
      class="graphwar-killer__obstacle-edge"
      :d="visibleObstacleEdgePath"
    />
    <template v-if="pathfindingObstacleEdgesActive">
      <path
        v-if="smartPathfindingObstacleRouteFillPath"
        class="graphwar-killer__obstacle-fill graphwar-killer__obstacle-fill--route"
        :d="smartPathfindingObstacleRouteFillPath"
      />
      <path
        v-if="smartPathfindingObstacleSimulationFillPath"
        class="graphwar-killer__obstacle-fill graphwar-killer__obstacle-fill--simulation"
        :d="smartPathfindingObstacleSimulationFillPath"
      />
      <path
        v-if="smartPathfindingObstacleRouteEdgePath"
        class="graphwar-killer__obstacle-edge graphwar-killer__obstacle-edge--route"
        :d="smartPathfindingObstacleRouteEdgePath"
      />
      <path
        v-if="smartPathfindingObstacleSimulationEdgePath"
        class="graphwar-killer__obstacle-edge graphwar-killer__obstacle-edge--simulation"
        :d="smartPathfindingObstacleSimulationEdgePath"
      />
    </template>
    <template v-if="smartCursorEnabled">
      <g
        v-for="box in detectionBoxes"
        :key="`${keyPrefix}${box.id}`"
        class="graphwar-killer__detection-group"
      >
        <circle
          class="graphwar-killer__detection"
          :class="[
            `graphwar-killer__detection--${box.kind}`,
            {
              'graphwar-killer__detection--hovered': box.id === hoveredDetectedSoldierId,
            },
          ]"
          :cx="box.visualCenterX"
          :cy="box.visualCenterY"
          :r="box.visualRadius"
        />
      </g>
    </template>
    <g
      v-if="detectionSoldierFlashActive"
      class="graphwar-killer__detection-flash-group"
    >
      <circle
        v-for="box in detectedSoldiers"
        :key="`${keyPrefix}detection-flash-${box.id}`"
        class="graphwar-killer__detection-flash-circle"
        :cx="box.visualCenterX"
        :cy="box.visualCenterY"
        :r="box.visualRadius"
      />
    </g>
    <g
      v-if="oneClickClearHitFlashActive"
      class="graphwar-killer__detection-flash-group"
    >
      <circle
        v-for="box in oneClickClearHitFlashSoldiers"
        :key="`${keyPrefix}one-click-clear-hit-flash-${box.id}`"
        class="graphwar-killer__detection-flash-circle graphwar-killer__detection-flash-circle--hit"
        :cx="box.visualCenterX"
        :cy="box.visualCenterY"
        :r="box.visualRadius"
      />
    </g>
    <ellipse
      v-if="obstacleBrushPreview"
      class="graphwar-killer__obstacle-brush-preview"
      :class="{ 'graphwar-killer__obstacle-brush-preview--erase': obstacleBrushEraseEnabled }"
      :clip-path="`url(#${clipPathId})`"
      :cx="obstacleBrushPreview.center.x"
      :cy="obstacleBrushPreview.center.y"
      :rx="obstacleBrushPreview.radiusX"
      :ry="obstacleBrushPreview.radiusY"
    />
    <circle
      v-if="boundsFirstPoint"
      class="graphwar-killer__bounds-point"
      :cx="boundsFirstPoint.x"
      :cy="boundsFirstPoint.y"
      r="7"
    />
    <line
      v-for="(segment, index) in pathLineSegments"
      :key="`${keyPrefix}path-line-${index}`"
      class="graphwar-killer__path-line"
      :x1="segment.x1"
      :y1="segment.y1"
      :x2="segment.x2"
      :y2="segment.y2"
    />
    <line
      v-for="(segment, index) in liveClickPreviewLineSegments"
      :key="`${keyPrefix}live-click-preview-line-${index}`"
      class="graphwar-killer__path-line graphwar-killer__path-line--live-click-preview"
      :x1="segment.x1"
      :y1="segment.y1"
      :x2="segment.x2"
      :y2="segment.y2"
    />
    <line
      v-if="smartPathfindingInProgress && smartPathfindingPreviewConnection"
      class="graphwar-killer__pathfinding-connection"
      :x1="smartPathfindingPreviewConnection.x1"
      :y1="smartPathfindingPreviewConnection.y1"
      :x2="smartPathfindingPreviewConnection.x2"
      :y2="smartPathfindingPreviewConnection.y2"
    />
    <polyline
      v-if="smartPathfindingInProgress && smartPathfindingPreviewPathPoints"
      class="graphwar-killer__pathfinding-try-path"
      :points="smartPathfindingPreviewPathPoints"
    />
    <circle
      v-if="smartPathfindingInProgress && pathfindingOptimizationPreviewPoint"
      class="graphwar-killer__pathfinding-optimization-point"
      :cx="pathfindingOptimizationPreviewPoint.x"
      :cy="pathfindingOptimizationPreviewPoint.y"
      :r="soldierMarkerRadius + 4"
    />
    <g
      v-if="smartPathfindingInProgress"
      class="graphwar-killer__pathfinding-preview"
    >
      <line
        v-for="(segment, index) in smartPathfindingPreviewAcceptedEdges"
        :key="`${keyPrefix}pathfinding-preview-edge-${index}`"
        class="graphwar-killer__pathfinding-accepted-edge"
        :x1="segment.x1"
        :y1="segment.y1"
        :x2="segment.x2"
        :y2="segment.y2"
      />
      <circle
        v-if="smartPathfindingPreviewCurrentPoint"
        class="graphwar-killer__pathfinding-current"
        :cx="smartPathfindingPreviewCurrentPoint.x"
        :cy="smartPathfindingPreviewCurrentPoint.y"
        r="4.2"
      />
      <circle
        v-for="(point, index) in smartPathfindingPreviewPoints"
        :key="`${keyPrefix}pathfinding-preview-${index}`"
        class="graphwar-killer__pathfinding-candidate"
        :cx="point.x"
        :cy="point.y"
        r="2.8"
      />
    </g>
    <polyline
      v-if="plottedCurvePoints"
      class="graphwar-killer__curve-line"
      :points="plottedCurvePoints"
      :style="{ stroke: trajectoryStrokeColor }"
    />
    <polyline
      v-if="liveClickPreviewCurvePoints"
      class="graphwar-killer__curve-line graphwar-killer__curve-line--live-click-preview"
      :points="liveClickPreviewCurvePoints"
    />
    <circle
      v-if="smartPathfindingBlockedPoint"
      class="graphwar-killer__pathfinding-blocked-point"
      :cx="smartPathfindingBlockedPoint.x"
      :cy="smartPathfindingBlockedPoint.y"
      :r="soldierSelectionRadius"
    />
    <g
      v-for="(point, index) in pathPixels"
      :key="`${keyPrefix}point-${index}`"
    >
      <circle
        class="graphwar-killer__point"
        :class="{
          'graphwar-killer__point--start': index === 0,
          'graphwar-killer__point--hovered': index === hoveredPathPointIndex,
        }"
        :cx="point.x"
        :cy="point.y"
        :r="soldierSelectionRadius"
      />
      <text
        class="graphwar-killer__point-label"
        :x="point.x + soldierSelectionRadius + 4"
        :y="point.y - soldierSelectionRadius - 4"
      >
        {{ index === 0 ? selfLabel : index }}
      </text>
    </g>
    <g v-if="liveClickPreviewPoint">
      <circle
        class="graphwar-killer__point graphwar-killer__point--live-click-preview"
        :cx="liveClickPreviewPoint.x"
        :cy="liveClickPreviewPoint.y"
        :r="soldierSelectionRadius"
      />
      <text
        class="graphwar-killer__point-label"
        :x="liveClickPreviewPoint.x + soldierSelectionRadius + 4"
        :y="liveClickPreviewPoint.y - soldierSelectionRadius - 4"
      >
        {{ liveClickPreviewLabel }}
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
  opacity: 78%;
  stroke: #f59e0b;
  stroke-dasharray: 3 5;
  stroke-width: 1.5;
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

.graphwar-killer__curve-line {
  animation: graphwar-killer-trajectory-blink 900ms ease-in-out infinite;
  fill: none;
  stroke: #ec4899;
  stroke-linecap: round;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.graphwar-killer__curve-line--live-click-preview {
  stroke: #f59e0b;
  stroke-dasharray: 9 5;
  stroke-width: 1.5;
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
  fill: color-mix(in srgb, #f59e0b 20%, transparent);
  pointer-events: none;
  stroke: #f59e0b;
  stroke-dasharray: 3 3;
  stroke-width: 2;
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
