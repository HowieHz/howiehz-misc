import { describe, expect, it } from "vitest";

import type { GraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";
import { GRAPHWAR_PLANE_HEIGHT, GRAPHWAR_PLANE_LENGTH } from "../../core/game/constants";
import { isGraphwarDetectionWorkerRequest, isGraphwarDetectionWorkerResponse } from "./protocol";

const attempt = {
  attemptId: 1,
  backendGeneration: 0,
  outerTaskId: 2,
} satisfies GraphwarBackendAttemptIdentity;

describe("Graphwar detection Worker protocol", () => {
  it("requires a complete backend attempt on requests", () => {
    const request = {
      attempt,
      id: 3,
      task: {
        imageData: createImageData(),
        type: "detect-bounds-only",
      },
    };

    expect(isGraphwarDetectionWorkerRequest(request)).toBe(true);
    expect(isGraphwarDetectionWorkerRequest({ id: request.id, task: request.task })).toBe(false);
    expect(
      isGraphwarDetectionWorkerRequest({
        ...request,
        attempt: { ...attempt, backendGeneration: -1 },
      }),
    ).toBe(false);
  });

  it("requires the same complete envelope shape on stage, success and error responses", () => {
    expect(
      isGraphwarDetectionWorkerResponse({
        attempt,
        id: 3,
        stage: "detecting-bounds",
        type: "stage",
      }),
    ).toBe(true);
    expect(
      isGraphwarDetectionWorkerResponse({
        attempt,
        id: 3,
        result: {
          obstacles: { count: 0, mask: new Uint8Array(GRAPHWAR_PLANE_LENGTH * GRAPHWAR_PLANE_HEIGHT) },
          soldiers: [],
        },
        taskType: "detect-bounds",
        timings: [],
        type: "success",
      }),
    ).toBe(true);
    expect(
      isGraphwarDetectionWorkerResponse({
        attempt,
        id: 3,
        result: { edgeRect: undefined },
        taskType: "detect-bounds-only",
        timings: [{ elapsedMs: 1, stage: "detecting-bounds" }],
        type: "success",
      }),
    ).toBe(true);
    expect(
      isGraphwarDetectionWorkerResponse({
        attempt,
        id: 3,
        message: "failed",
        type: "error",
      }),
    ).toBe(true);

    expect(isGraphwarDetectionWorkerResponse({ id: 3, stage: "detecting-bounds", type: "stage" })).toBe(false);
    expect(
      isGraphwarDetectionWorkerResponse({
        attempt: { ...attempt, attemptId: -1 },
        id: 3,
        message: "failed",
        type: "error",
      }),
    ).toBe(false);
    expect(
      isGraphwarDetectionWorkerResponse({
        attempt,
        id: 3,
        result: null,
        taskType: "detect-auto",
        timings: [],
        type: "success",
      }),
    ).toBe(false);
    expect(
      isGraphwarDetectionWorkerResponse({
        attempt,
        id: 3,
        result: { edgeRect: { height: 450, width: 770, x: 0, y: 0 } },
        taskType: "detect-auto",
        timings: [],
        type: "success",
      }),
    ).toBe(false);
    expect(
      isGraphwarDetectionWorkerResponse({
        attempt,
        id: 3,
        result: {},
        taskType: "detect-bounds",
        timings: [],
        type: "success",
      }),
    ).toBe(false);
  });
});

function createImageData() {
  return {
    data: new Uint8ClampedArray(4),
    height: 1,
    width: 1,
  } as ImageData;
}
