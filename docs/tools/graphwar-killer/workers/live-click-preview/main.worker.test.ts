import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { GraphwarLiveClickPreviewWorkerResponse } from "../../controllers/stage/live-click-preview-render";
import type { GraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const attempt = {
  attemptId: 1,
  backendGeneration: 0,
  outerTaskId: 1,
} satisfies GraphwarBackendAttemptIdentity;
const postMessage = vi.fn<(message: GraphwarLiveClickPreviewWorkerResponse) => void>();
let handleMessage: ((event: MessageEvent<unknown>) => void) | undefined;

beforeAll(async () => {
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: {
      addEventListener(type: string, listener: EventListener) {
        if (type === "message") {
          handleMessage = listener as (event: MessageEvent<unknown>) => void;
        }
      },
      postMessage,
    },
  });
  await import("./main.worker");
});

afterAll(() => {
  if (originalSelfDescriptor) {
    Object.defineProperty(globalThis, "self", originalSelfDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "self");
  }
});

describe("Live-preview Worker request boundary", () => {
  it("ignores an unidentifiable request and attributes an invalid payload with complete identity", () => {
    dispatch(null);
    expect(postMessage).not.toHaveBeenCalled();

    dispatch({ attempt, id: 7, input: null });
    expect(postMessage).toHaveBeenCalledWith({
      attempt,
      id: 7,
      message: "Invalid live preview worker request",
      type: "error",
    });
  });
});

function dispatch(request: unknown) {
  if (!handleMessage) {
    throw new Error("Live-preview worker message handler was not registered");
  }
  handleMessage({ data: request } as MessageEvent<unknown>);
}
