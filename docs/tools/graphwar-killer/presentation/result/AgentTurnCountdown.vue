<script setup lang="ts">
import { computed } from "vue";

import {
  formatGraphwarAgentTurnCountdown,
  type GraphwarAgentTurnCountdownDisplayState,
} from "../../controllers/agent/turn-countdown";
import type { GraphwarKillerLocale } from "../../locale-types";

const props = defineProps<{
  /** Stable countdown state; only this leaf subscribes to its changing refs. */
  countdown: GraphwarAgentTurnCountdownDisplayState;
  /** Page locale used to format the visible remaining-time message. */
  locale: GraphwarKillerLocale;
}>();

const countdownText = computed(() => {
  const remainingMilliseconds = props.countdown.remainingMilliseconds.value;
  const time = remainingMilliseconds === undefined ? "--.-" : formatGraphwarAgentTurnCountdown(remainingMilliseconds);
  return props.locale.ui.result.turnTimeRemaining(time);
});

const isMuted = computed(
  () => props.countdown.remainingMilliseconds.value === undefined || props.countdown.isZeroVisible.value,
);
</script>

<template>
  <span
    class="graphwar-killer__agent-turn-countdown"
    :class="{ 'graphwar-killer__agent-turn-countdown--expired': isMuted }"
  >
    {{ countdownText }}
  </span>
</template>
