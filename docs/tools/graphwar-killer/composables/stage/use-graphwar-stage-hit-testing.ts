import { clampNumber } from "../../core/numbers";
import type { PixelPoint } from "../../core/types";
import { isPlayerColorPixel, type GraphwarDetectionBox } from "../../detection/graphwar-detection";
import { getGraphwarSoldierCenter, graphwarSoldierContainsHitPoint } from "../../pathfinding/graphwar-targeting";

interface GraphwarStageHitTestingOptions<TSoldier extends GraphwarDetectionBox> {
  /** 当前可见士兵列表；应由页面先应用工作流过滤，命中测试只负责逆序选中。 */
  getDetectionBoxes: () => readonly TSoldier[];
  /** 当前截图像素；不存在时颜色采样应保持原来的失败语义。 */
  getImageData: () => ImageData | undefined;
  /** 当前路径；路径点命中应按后绘制点优先。 */
  getPathPixels: () => readonly PixelPoint[];
  /** 当前士兵 UI 半径；路径点最小选中半径应保留 10px 下限。 */
  getPathPointSelectionRadius: () => number;
}

export interface GraphwarStageHitTestingController<TSoldier extends GraphwarDetectionBox> {
  /** 判断路径点是否落在 Graphwar 士兵实际命中圈内。 */
  detectionBoxContainsHitCircle: (box: TSoldier, point: PixelPoint) => boolean;
  /** 判断路径点是否命中士兵；应复用真实命中圈而不是可视选择圈。 */
  detectionBoxContainsPathPoint: (box: TSoldier, point: PixelPoint) => boolean;
  /** 返回 Graphwar 士兵源码中心；命中、发射和路径点都使用这个点。 */
  getDetectionBoxCenter: (box: TSoldier) => PixelPoint;
  /** 返回当前可见目标中被指针命中的士兵。 */
  getDetectedSoldierAtPoint: (point: PixelPoint) => TSoldier | undefined;
  /** 从士兵检测框内采样玩家颜色，供模拟器轨迹线匹配当前士兵。 */
  getDetectedSoldierColor: (box: TSoldier) => string | undefined;
  /** 命中最近的路径点索引。 */
  getPathPointIndexAtPoint: (point: PixelPoint) => number | undefined;
}

/** 集中舞台命中规则，避免交互层混用士兵可视选择圈和真实命中圈。 */
export function useGraphwarStageHitTesting<TSoldier extends GraphwarDetectionBox>(
  options: GraphwarStageHitTestingOptions<TSoldier>,
): GraphwarStageHitTestingController<TSoldier> {
  /** 命中最近的路径点索引，逆序让后绘制的点优先。 */
  function getPathPointIndexAtPoint(point: PixelPoint) {
    const radius = Math.max(10, options.getPathPointSelectionRadius());
    const pathPixels = options.getPathPixels();
    for (let index = pathPixels.length - 1; index >= 0; index -= 1) {
      const pathPoint = pathPixels[index];
      if (Math.hypot(point.x - pathPoint.x, point.y - pathPoint.y) <= radius) {
        return index;
      }
    }
    return undefined;
  }

  /** 返回当前可见目标中被指针命中的士兵。 */
  function getDetectedSoldierAtPoint(point: PixelPoint) {
    const boxes = options.getDetectionBoxes();
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      const box = boxes[index];
      if (detectionBoxContainsSelectionCircle(box, point)) {
        return box;
      }
    }
    return undefined;
  }

  /** 返回 Graphwar 士兵源码中心；命中、发射和路径点都使用这个点。 */
  function getDetectionBoxCenter(box: TSoldier) {
    return getGraphwarSoldierCenter(box);
  }

  /** 判断路径点是否命中士兵；应复用真实命中圈而不是可视选择圈。 */
  function detectionBoxContainsPathPoint(box: TSoldier, point: PixelPoint) {
    return detectionBoxContainsHitCircle(box, point);
  }

  /** 判断指针或路径点是否落在 Graphwar 士兵实际命中圈内。 */
  function detectionBoxContainsHitCircle(box: TSoldier, point: PixelPoint) {
    return graphwarSoldierContainsHitPoint(box, point);
  }

  /** 判断指针是否落在 Graphwar 士兵可视选择圈内。 */
  function detectionBoxContainsSelectionCircle(box: TSoldier, point: PixelPoint) {
    return Math.hypot(point.x - box.visualCenterX, point.y - box.visualCenterY) <= box.visualRadius;
  }

  /** 从士兵检测框内采样玩家颜色，供模拟器轨迹线匹配当前士兵。 */
  function getDetectedSoldierColor(box: TSoldier) {
    const imageData = options.getImageData();
    if (!imageData) {
      return undefined;
    }

    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let count = 0;
    const startX = clampNumber(Math.floor(box.x), 0, imageData.width - 1);
    const endX = clampNumber(Math.ceil(box.x + box.width), 0, imageData.width - 1);
    const startY = clampNumber(Math.floor(box.y), 0, imageData.height - 1);
    const endY = clampNumber(Math.ceil(box.y + box.height), 0, imageData.height - 1);

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const index = (y * imageData.width + x) * 4;
        const red = imageData.data[index];
        const green = imageData.data[index + 1];
        const blue = imageData.data[index + 2];
        if (!isPlayerColorPixel(red, green, blue)) {
          continue;
        }

        redSum += red;
        greenSum += green;
        blueSum += blue;
        count += 1;
      }
    }

    if (count === 0) {
      return undefined;
    }

    return `rgb(${Math.round(redSum / count)} ${Math.round(greenSum / count)} ${Math.round(blueSum / count)})`;
  }

  return {
    detectionBoxContainsHitCircle,
    detectionBoxContainsPathPoint,
    getDetectedSoldierAtPoint,
    getDetectionBoxCenter,
    getDetectedSoldierColor,
    getPathPointIndexAtPoint,
  };
}
