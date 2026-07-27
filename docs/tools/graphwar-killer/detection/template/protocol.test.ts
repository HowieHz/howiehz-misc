import { describe, expect, it } from "vitest";

import type { GraphwarBackendAttemptIdentity } from "../../core/algorithm-backend";
import {
  isGraphwarSoldierTemplateWorkerRequest,
  isGraphwarSoldierTemplateWorkerResponse,
  isGraphwarSoldierTemplateWorkerResponseForRequest,
} from "./protocol";

const attempt = {
  attemptId: 4,
  backendGeneration: 0,
  outerTaskId: 3,
} satisfies GraphwarBackendAttemptIdentity;

describe("Graphwar soldier template Worker protocol", () => {
  it("carries the parent detection attempt through request and response", () => {
    const request = createRequest();
    const response = {
      attempt,
      elapsedMs: 2,
      id: request.id,
      matches: [createMatch()],
      type: "success",
    };

    expect(isGraphwarSoldierTemplateWorkerRequest(request)).toBe(true);
    expect(isGraphwarSoldierTemplateWorkerResponse(response)).toBe(true);
    expect(isGraphwarSoldierTemplateWorkerResponseForRequest(request, response)).toBe(true);
  });

  it("rejects missing, invalid and mismatched request identities", () => {
    const request = createRequest();
    const response = {
      attempt,
      id: request.id,
      message: "failed",
      type: "error",
    };

    expect(isGraphwarSoldierTemplateWorkerRequest({ ...request, attempt: undefined })).toBe(false);
    expect(isGraphwarSoldierTemplateWorkerRequest({ ...request, candidates: [{}] })).toBe(false);
    expect(isGraphwarSoldierTemplateWorkerResponse({ ...response, attempt: { ...attempt, outerTaskId: -1 } })).toBe(
      false,
    );
    expect(
      isGraphwarSoldierTemplateWorkerResponse({
        attempt,
        elapsedMs: 1,
        id: request.id,
        matches: [{}],
        type: "success",
      }),
    ).toBe(false);
    expect(isGraphwarSoldierTemplateWorkerResponseForRequest(request, { ...response, id: request.id + 1 })).toBe(false);
    expect(
      isGraphwarSoldierTemplateWorkerResponseForRequest(request, {
        ...response,
        attempt: { ...attempt, attemptId: attempt.attemptId + 1 },
      }),
    ).toBe(false);
  });
});

function createRequest() {
  return {
    attempt,
    candidates: [{ isMirrored: false, votes: 2, x: 10, y: 20 }],
    edgeRect: { height: 450, width: 770, x: 0, y: 0 },
    id: 2,
    imageData: {
      data: new Uint8ClampedArray(4),
      height: 1,
      width: 1,
    } as ImageData,
    scale: 1,
  };
}

function createMatch() {
  return {
    fixedScore: 1,
    foregroundScore: 1,
    isMirrored: false,
    playerScore: 1,
    score: 1,
    signatureScore: 1,
    sourceCenterX: 10,
    sourceCenterY: 20,
    templateName: "soldier.png",
    votes: 2,
  };
}
