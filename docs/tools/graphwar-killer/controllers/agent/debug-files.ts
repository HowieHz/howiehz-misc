import type { GraphwarClearFailureExportKind } from "../pathfinding/one-click-clear/outcome";
import type { GraphwarAgentAvailableState } from "./client";

/** Agent 导出的状态 JSON 与障碍二进制文件对。 */
export interface GraphwarAgentDebugFilePair {
  obstacleBuffer: ArrayBuffer;
  state: GraphwarAgentAvailableState;
}

/** 单个可下载的 Agent 调试文件。 */
export interface GraphwarAgentDebugDownload {
  content: ArrayBuffer | string;
  fileName: string;
  mediaType: string;
}

/** Agent 调试文件导入、匹配与导出的统一状态。 */
export interface GraphwarAgentDebugFiles {
  /** 丢弃当前未消费的文件配对。 */
  clear: () => void;
  /** 写入障碍文件，并在状态文件已就绪时返回完整配对。 */
  setObstacleBuffer: (buffer: ArrayBuffer) => GraphwarAgentDebugFilePair | undefined;
  /** 写入状态文件；替换旧状态时同时丢弃属于旧状态的障碍文件。 */
  setState: (state: GraphwarAgentAvailableState) => GraphwarAgentDebugFilePair | undefined;
}

/** 调试文件命名选项；failureKind 只用于自动导出，手动导出不传。 */
export interface GraphwarAgentDebugDownloadOptions {
  exportedAt?: Date;
  failureKind?: GraphwarClearFailureExportKind;
}

/** 把同一 revision 的 Agent 局面序列化为调试导入控件接受的两份文件。 */
export function createGraphwarAgentDebugDownloads(
  state: GraphwarAgentAvailableState,
  worldObstacleMask: Uint8Array,
  options: GraphwarAgentDebugDownloadOptions = {},
): { obstacle: GraphwarAgentDebugDownload; state: GraphwarAgentDebugDownload } {
  // 两个文件共用不含非法字符的时间戳，之后从下载目录中也能直观看出它们属于同一局面。
  const suffix = (options.exportedAt ?? new Date()).toISOString().replaceAll(":", "-").replace(".", "-");
  const prefix = options.failureKind ? `clear-failure-${options.failureKind}-` : "";
  return {
    obstacle: {
      content: worldObstacleMask.slice().buffer,
      fileName: `${prefix}obstacle-mask-${suffix}.bin`,
      mediaType: "application/octet-stream",
    },
    state: {
      content: `${JSON.stringify(state, undefined, 2)}\n`,
      fileName: `${prefix}state-${suffix}.json`,
      mediaType: "application/json",
    },
  };
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
