import type { GraphwarAgentState } from "./client";

/** Creates one connection-scoped ordering guard for concurrent live `/state` responses. */
export function createGraphwarAgentObservationOrder() {
  let activeAgentInstanceId: string | undefined;
  let latestObservationSequence = -1;
  const retiredAgentInstanceIds = new Set<string>();

  /** Accepts increasing observations and never revives a process replaced on this connection. */
  function accept(state: Pick<GraphwarAgentState, "agentInstanceId" | "observationSequence">) {
    if (state.agentInstanceId === activeAgentInstanceId) {
      if (state.observationSequence <= latestObservationSequence) {
        return false;
      }
    } else {
      if (retiredAgentInstanceIds.has(state.agentInstanceId)) {
        return false;
      }
      if (activeAgentInstanceId !== undefined) {
        retiredAgentInstanceIds.add(activeAgentInstanceId);
      }
      activeAgentInstanceId = state.agentInstanceId;
    }
    latestObservationSequence = state.observationSequence;
    return true;
  }

  /** Checks snapshot freshness after slower dependent reads without mutating observation order. */
  function isCurrent(state: Pick<GraphwarAgentState, "agentInstanceId" | "observationSequence">) {
    return state.agentInstanceId === activeAgentInstanceId && state.observationSequence === latestObservationSequence;
  }

  /** Starts a fresh ordering domain after the page changes Agent connection identity. */
  function clear() {
    activeAgentInstanceId = undefined;
    latestObservationSequence = -1;
    retiredAgentInstanceIds.clear();
  }

  return { accept, clear, isCurrent };
}
