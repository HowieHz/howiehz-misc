// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ToggleField from "./ToggleField.vue";

describe("ToggleField", () => {
  it("reflects the prop as the switch state and emits toggle on click", async () => {
    const wrapper = mount(ToggleField, {
      props: { checked: true, id: "metronome", label: "Metronome" },
    });
    const control = wrapper.get('[role="switch"]');

    expect(control.attributes("aria-checked")).toBe("true");

    await control.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect(control.attributes("aria-checked")).toBe("true");
  });

  it("keeps the rendered state unchanged until the parent accepts a toggle", async () => {
    const wrapper = mount(ToggleField, {
      props: { checked: false, id: "metronome", label: "Metronome" },
    });
    const control = wrapper.get('[role="switch"]');

    await control.trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect(control.attributes("aria-checked")).toBe("false");
  });

  it("links the description through aria-describedby", () => {
    const wrapper = mount(ToggleField, {
      props: { checked: false, description: "Click during play", id: "metronome", label: "Metronome" },
    });
    const control = wrapper.get('[role="switch"]');

    expect(control.attributes("aria-describedby")).toBe("metronome-description");
    expect(wrapper.get("#metronome-description").text()).toContain("Click during play");
  });

  it("disables the switch while keeping it visible", () => {
    const wrapper = mount(ToggleField, {
      props: { checked: true, disabled: true, id: "metronome", label: "Metronome" },
    });

    expect(wrapper.get('[role="switch"]').attributes()).toHaveProperty("disabled");
  });
});
