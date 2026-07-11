import { afterEach, describe, expect, it, vi } from "vitest";

import { useGraphwarScreenshotWorkflow } from "./workflow";

describe("Graphwar screenshot workflow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores a file read invalidated before its load event", () => {
    let finishRead: (() => void) | undefined;
    class FakeFileReader {
      result: string | ArrayBuffer | null = null;

      addEventListener(type: string, listener: () => void) {
        if (type === "load") {
          finishRead = () => {
            this.result = "data:image/png;base64,stale";
            listener();
          };
        }
      }

      readAsDataURL() {
        return undefined;
      }
    }
    vi.stubGlobal("FileReader", FakeFileReader);
    const onImageApplied = vi.fn();
    const workflow = useGraphwarScreenshotWorkflow({
      imageText: {
        defaultStatus: "Choose an image",
        pastedName: "Pasted image",
        screenCaptureIncomplete: "Capture incomplete",
        screenCaptureName: "Screen capture",
        screenCaptureUnavailable: "Capture unavailable",
        screenCaptureUnsupported: "Capture unsupported",
      },
      onImageApplied,
    });

    workflow.handlePaste({
      clipboardData: {
        items: [{ getAsFile: () => ({ name: "stale.png" }), type: "image/png" }],
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent);
    workflow.invalidatePendingUserImageRequests();
    finishRead?.();

    expect(workflow.imageUrl.value).toBe("");
    expect(onImageApplied).not.toHaveBeenCalled();
  });

  it("stops but does not apply a screen stream resolved after invalidation", async () => {
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const streamPromise = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    const stop = vi.fn();
    const onImageApplied = vi.fn();
    const video = {
      addEventListener: (type: string, listener: () => void) => {
        if (type === "loadedmetadata") {
          queueMicrotask(listener);
        }
      },
      muted: false,
      play: () => Promise.resolve(),
      playsInline: false,
      srcObject: undefined,
      videoHeight: 450,
      videoWidth: 770,
    };
    const canvas = {
      getContext: () => ({ drawImage: vi.fn() }),
      height: 0,
      toDataURL: () => "data:image/png;base64,stale-capture",
      width: 0,
    };
    vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: () => streamPromise } });
    vi.stubGlobal("document", {
      createElement: (tagName: string) => (tagName === "video" ? video : canvas),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const workflow = useGraphwarScreenshotWorkflow({
      imageText: {
        defaultStatus: "Choose an image",
        pastedName: "Pasted image",
        screenCaptureIncomplete: "Capture incomplete",
        screenCaptureName: "Screen capture",
        screenCaptureUnavailable: "Capture unavailable",
        screenCaptureUnsupported: "Capture unsupported",
      },
      onImageApplied,
    });

    const capture = workflow.captureScreenImage();
    workflow.invalidatePendingUserImageRequests();
    resolveStream?.({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await capture;

    expect(workflow.imageUrl.value).toBe("");
    expect(onImageApplied).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });
});
