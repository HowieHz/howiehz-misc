// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ToggleField from "./ToggleField.vue";

describe("ToggleField", () => {
  it("keeps a dormant preference interactive and exposes its visible reason", async () => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: true,
        id: "collision-check",
        label: "Collision check",
        reason: "Waiting for obstacles",
        state: "dormant",
      },
    });
    const input = wrapper.get("input");

    expect(input.attributes("role")).toBe("switch");
    expect(input.attributes("aria-describedby")).toBe("collision-check-reason");
    expect(input.attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("Waiting for obstacles");

    await input.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it.each(["blocked", "busy"] as const)("disables %s controls at the native input boundary", (state) => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: false,
        id: `control-${state}`,
        label: "Control",
        reason: "Unavailable",
        state,
      },
    });

    expect(wrapper.get("input").attributes()).toHaveProperty("disabled");
  });

  it("keeps the native state unchanged when the parent rejects a toggle request", async () => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: false,
        id: "managed-mode",
        label: "Managed mode",
        state: "normal",
      },
    });
    const input = wrapper.get("input");

    await input.trigger("click");

    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect((input.element as HTMLInputElement).checked).toBe(false);
  });

  it("commits the native state after the parent accepts a toggle request", async () => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: false,
        id: "managed-mode",
        label: "Managed mode",
        state: "normal",
      },
    });
    const input = wrapper.get("input");

    await input.trigger("click");
    await wrapper.setProps({ checked: true });

    expect((input.element as HTMLInputElement).checked).toBe(true);
  });
});
