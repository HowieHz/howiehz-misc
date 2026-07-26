/** Step DAG 节点在相邻边之间传递的原子公式平台状态。 */
export interface GraphwarOneClickClearStepRouteState {
  /** Canonical 打印系数累计身份。 */
  resolvedStateKey: string;
  /** 实际累计高度。 */
  resolvedY: number;
}

/** Worker job/result Adapter 只接受有限高度和 canonical BigInt 身份，避免半合法状态进入寻路器。 */
export function isGraphwarOneClickClearStepRouteState(value: unknown): value is GraphwarOneClickClearStepRouteState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("resolvedStateKey" in value) ||
    !("resolvedY" in value) ||
    typeof value.resolvedStateKey !== "string" ||
    typeof value.resolvedY !== "number" ||
    !Number.isFinite(value.resolvedY)
  ) {
    return false;
  }
  try {
    return BigInt(value.resolvedStateKey).toString() === value.resolvedStateKey;
  } catch {
    return false;
  }
}
