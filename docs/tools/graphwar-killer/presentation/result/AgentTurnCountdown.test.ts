// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { computed, nextTick, ref } from "vue";

import { graphwarKillerLocale as englishGraphwarKillerLocale } from "../../../../en/tools/graphwar-killer/locale";
import { graphwarKillerLocale } from "../../locale";
import AgentTurnCountdown from "./AgentTurnCountdown.vue";

describe("AgentTurnCountdown", () => {
  it.each([
    [graphwarKillerLocale, "剩余 58.0 秒", "剩余 0.0 秒", "剩余 --.- 秒"],
    [englishGraphwarKillerLocale, "58.0s left", "0.0s left", "--.-s left"],
  ])(
    "renders active, zero, and placeholder states for one locale",
    async (locale, activeText, zeroText, placeholderText) => {
      const remainingMilliseconds = ref<number>();
      const wrapper = mount(AgentTurnCountdown, {
        props: {
          countdown: {
            isZeroVisible: computed(() => remainingMilliseconds.value === 0),
            remainingMilliseconds,
          },
          locale,
        },
      });

      expect(wrapper.text()).toBe(placeholderText);
      expect(wrapper.classes()).toContain("graphwar-killer__agent-turn-countdown--expired");

      remainingMilliseconds.value = 58_000;
      await nextTick();
      expect(wrapper.text()).toBe(activeText);
      expect(wrapper.classes()).not.toContain("graphwar-killer__agent-turn-countdown--expired");

      remainingMilliseconds.value = 0;
      await nextTick();
      expect(wrapper.text()).toBe(zeroText);
      expect(wrapper.classes()).toContain("graphwar-killer__agent-turn-countdown--expired");
    },
  );
});
