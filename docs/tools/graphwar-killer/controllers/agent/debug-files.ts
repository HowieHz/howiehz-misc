import type { GraphwarAgentAvailableState } from "./client";

export interface GraphwarAgentDebugFilePair {
  obstacleBuffer: ArrayBuffer;
  state: GraphwarAgentAvailableState;
}

export interface GraphwarAgentDebugFiles {
  /** 丢弃当前未消费的文件配对。 */
  clear: () => void;
  /** 写入障碍文件，并在状态文件已就绪时返回完整配对。 */
  setObstacleBuffer: (buffer: ArrayBuffer) => GraphwarAgentDebugFilePair | undefined;
  /** 写入状态文件；替换旧状态时同时丢弃属于旧状态的障碍文件。 */
  setState: (state: GraphwarAgentAvailableState) => GraphwarAgentDebugFilePair | undefined;
}

/** 缓存一对调试导出文件；页面成功应用后必须 clear，避免下一局与旧文件混配。 */
export function createGraphwarAgentDebugFiles(): GraphwarAgentDebugFiles {
  let obstacleBuffer: ArrayBuffer | undefined;
  let state: GraphwarAgentAvailableState | undefined;

  /** 只有两份文件都存在时才向页面暴露可应用的快照输入。 */
  function getPair() {
    return state && obstacleBuffer ? { obstacleBuffer, state } : undefined;
  }

  return {
    clear: () => {
      obstacleBuffer = undefined;
      state = undefined;
    },
    setObstacleBuffer: (buffer) => {
      obstacleBuffer = buffer;
      return getPair();
    },
    setState: (nextState) => {
      if (state) {
        obstacleBuffer = undefined;
      }
      state = nextState;
      return getPair();
    },
  };
}
