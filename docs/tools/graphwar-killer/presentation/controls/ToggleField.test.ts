// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, nextTick, ref } from "vue";

import ToggleField from "./ToggleField.vue";

describe("ToggleField", () => {
  it("keeps a dormant preference interactive and exposes its visible reason", async () => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: true,
        id: "collision-check",
        label: "Collision check",
        reason: "Requires obstacle data",
        state: "dormant",
      },
    });
    const control = wrapper.get('[role="switch"]');

    expect(control.attributes("aria-checked")).toBe("true");
    expect(control.attributes("aria-describedby")).toBe("collision-check-reason");
    expect(control.attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("Requires obstacle data");

    await control.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("keeps a blocked reason visible while disabling the native control", () => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: false,
        id: "control-blocked",
        label: "Control",
        reason: "Unavailable",
        state: "blocked",
        title: "Original title",
      },
    });
    const control = wrapper.get('[role="switch"]');

    expect(control.attributes()).toHaveProperty("disabled");
    expect(control.attributes("aria-describedby")).toBe("control-blocked-reason");
    expect(control.attributes("title")).toBe("Original title");
    expect(wrapper.get("#control-blocked-reason").text()).toContain("Unavailable");
  });

  it("moves a busy reason before the original title without rendering it visibly", () => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: false,
        description: "Supporting description",
        id: "control-busy",
        label: "Control",
        reason: "Temporarily unavailable",
        state: "busy",
        title: "Original title",
      },
    });
    const control = wrapper.get('[role="switch"]');

    expect(control.attributes()).toHaveProperty("disabled");
    expect(control.attributes("aria-describedby")).toBe("control-busy-description");
    expect(control.attributes("title")).toBe("Temporarily unavailable\nOriginal title");
    expect(wrapper.find("#control-busy-reason").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Temporarily unavailable");
  });

  it("keeps the rendered state unchanged when the parent rejects a toggle request", async () => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: false,
        id: "managed-mode",
        label: "Managed mode",
        state: "normal",
      },
    });
    const control = wrapper.get('[role="switch"]');

    await control.trigger("click");

    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect(control.attributes("aria-checked")).toBe("false");
  });

  it("renders the state accepted by the parent", async () => {
    const wrapper = mount(ToggleField, {
      props: {
        checked: false,
        id: "managed-mode",
        label: "Managed mode",
        state: "normal",
      },
    });
    const control = wrapper.get('[role="switch"]');

    await control.trigger("click");
    await wrapper.setProps({ checked: true });

    expect(control.attributes("aria-checked")).toBe("true");
  });

  it("shows a synchronous state change accepted by the parent", async () => {
    const wrapper = mount(
      defineComponent({
        components: { ToggleField },
        setup() {
          return { checked: ref(false) };
        },
        template: `
          <ToggleField
            id="collision-check"
            :checked="checked"
            label="Collision check"
            state="normal"
            @toggle="checked = !checked"
          />
        `,
      }),
    );
    (wrapper.get(".graphwar-killer-toggle-field__track").element as HTMLElement).click();
    await nextTick();

    expect(wrapper.get('[role="switch"]').attributes("aria-checked")).toBe("true");
  });
});
