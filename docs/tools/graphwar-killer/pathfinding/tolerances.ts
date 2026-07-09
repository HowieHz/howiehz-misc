/** Graphwar 平面外本身就是障碍；正容差向内留安全距离，负容差不能放宽真实边界到平面外。 */
export function createBoundaryInsetFromObstacleTolerance(tolerancePlanePixels: number) {
  return Math.max(0, Math.floor(tolerancePlanePixels));
}
