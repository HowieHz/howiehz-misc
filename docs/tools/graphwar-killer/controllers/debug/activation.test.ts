import { afterEach, describe, expect, it, vi } from "vitest";

import { useGraphwarDebugActivation } from "./activation";

afterEach(() => {
  vi.useRealTimers();
});

describe("Graphwar debug activation", () => {
  it("toggles advanced settings once after a short pointer press", () => {
    const toggleAdvancedSettings = vi.fn();
    const controller = useGraphwarDebugActivation({ toggleAdvancedSettings });

    controller.startHold({ button: 0 } as PointerEvent);
    controller.finishHold();
    controller.toggleAdvancedSettings();

    expect(toggleAdvancedSettings).toHaveBeenCalledOnce();
    expect(controller.debugInfoEnabled.value).toBe(false);
    controller.dispose();
  });

  it("consumes the click emitted after a long press enables debug info", () => {
    vi.useFakeTimers();
    const toggleAdvancedSettings = vi.fn();
    const controller = useGraphwarDebugActivation({ toggleAdvancedSettings });

    controller.startHold({ button: 0 } as PointerEvent);
    vi.advanceTimersByTime(3000);
    controller.finishHold();
    controller.toggleAdvancedSettings();

    expect(controller.debugInfoEnabled.value).toBe(true);
    expect(toggleAdvancedSettings).not.toHaveBeenCalled();

    controller.toggleAdvancedSettings();
    expect(toggleAdvancedSettings).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
