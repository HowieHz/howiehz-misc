import type { FormulaModeContract } from "../../formula/mode-contract";
import type { GraphwarPathfindingRouteMode } from "./mode";

/**
 * 公式契约派生出的共享路线选择。
 *
 * 普通与 Step-stateful 路线保留用户几何路由偏好；Step-glitch 使用独立的 x+ 扫描，不伪装成普通路线算法。
 */
export type GraphwarPathSearchPolicy =
  | { readonly routeMode: GraphwarPathfindingRouteMode; readonly type: "stateless" }
  | { readonly routeMode: GraphwarPathfindingRouteMode; readonly type: "step-stateful" }
  | { readonly type: "step-glitch" };

/** 绑定本次 job 必需 runtime 后的合法路线状态；两种 stateful runtime 都不能脱离其策略存在。 */
export type GraphwarPathSearchRuntimePolicy<StepRuntime, StepGlitchRuntime> =
  | Extract<GraphwarPathSearchPolicy, { type: "stateless" }>
  | (Extract<GraphwarPathSearchPolicy, { type: "step-stateful" }> & { readonly runtime: StepRuntime })
  | (Extract<GraphwarPathSearchPolicy, { type: "step-glitch" }> & { readonly runtime: StepGlitchRuntime });

/** 在页面或 Worker Adapter 从已解析公式契约生成唯一合法的路线选择。 */
export function resolveGraphwarPathSearchPolicy(
  contract: FormulaModeContract,
  routeMode: GraphwarPathfindingRouteMode,
): GraphwarPathSearchPolicy {
  return contract.pathSearchPolicy.type === "step-glitch"
    ? { type: "step-glitch" }
    : { routeMode, type: contract.pathSearchPolicy.type };
}
