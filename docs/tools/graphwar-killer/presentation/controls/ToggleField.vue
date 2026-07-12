<script setup lang="ts">
import { computed } from "vue";

import type { GraphwarControlCapability } from "../../controllers/page/capabilities";
import ControlReason from "./ControlReason.vue";

const props = defineProps<{
  /** Stable DOM id used to connect the switch, label, and visible explanations. */
  id: string;
  /** Current persisted preference. */
  checked: boolean;
  /** User-facing switch label. */
  label: string;
  /** Optional supporting description shown before a state reason. */
  description?: string;
  /** Visible explanation for dormant, blocked, or busy state. */
  reason?: string;
  /** Capability state shared with the parent command guard. */
  state: GraphwarControlCapability["state"];
  /** Supplementary hover text; important guidance must remain visible. */
  title?: string;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const describedBy = computed(
  () =>
    [props.description ? `${props.id}-description` : undefined, props.reason ? `${props.id}-reason` : undefined]
      .filter(Boolean)
      .join(" ") || undefined,
);
</script>

<template>
  <div
    class="graphwar-killer-toggle-field"
    :class="`graphwar-killer-toggle-field--${state}`"
  >
    <!-- The prop is the only switch state; a button cannot drift from it like a native checkbox can. -->
    <button
      :id="id"
      :aria-checked="checked"
      :aria-describedby="describedBy"
      class="graphwar-killer-toggle-field__control"
      :disabled="state === 'blocked' || state === 'busy'"
      role="switch"
      :title="title"
      type="button"
      @click="emit('toggle')"
    >
      <span class="graphwar-killer-toggle-field__text">{{ label }}</span>
      <span
        class="graphwar-killer-toggle-field__track"
        aria-hidden="true"
      >
        <span class="graphwar-killer-toggle-field__thumb" />
      </span>
    </button>
    <p
      v-if="description"
      :id="`${id}-description`"
      class="graphwar-killer-toggle-field__description"
    >
      {{ description }}
    </p>
    <ControlReason
      v-if="reason"
      :id="`${id}-reason`"
      :message="reason"
    />
  </div>
</template>

<style scoped>
.graphwar-killer-toggle-field {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 50%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 82%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 7px 8px;
}

.graphwar-killer-toggle-field--dormant {
  background: color-mix(in srgb, #f59e0b 7%, var(--vp-c-bg));
  border-color: color-mix(in srgb, #d97706 48%, var(--vp-c-divider));
}

.graphwar-killer-toggle-field--blocked,
.graphwar-killer-toggle-field--busy {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 74%, var(--vp-c-bg));
  border-color: var(--vp-c-divider);
}

.graphwar-killer-toggle-field__control {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 8px;
  justify-content: flex-start;
  margin: 0;
  padding: 0;
  text-align: left;
}

.graphwar-killer-toggle-field__control:disabled {
  cursor: not-allowed;
  opacity: 68%;
}

.graphwar-killer-toggle-field__text {
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.graphwar-killer-toggle-field__track {
  background: var(--vp-c-divider);
  border: 1px solid color-mix(in srgb, var(--vp-c-text-2) 24%, var(--vp-c-divider));
  border-radius: 999px;
  box-sizing: border-box;
  display: block;
  height: 22px;
  padding: 2px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  width: 38px;
}

.graphwar-killer-toggle-field__thumb {
  background: var(--vp-c-bg);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgb(15 23 42 / 20%);
  display: block;
  height: 16px;
  transition: transform 0.2s ease;
  width: 16px;
}

.graphwar-killer-toggle-field__control[aria-checked="true"] .graphwar-killer-toggle-field__track {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.graphwar-killer-toggle-field__control[aria-checked="true"]
  .graphwar-killer-toggle-field__track
  .graphwar-killer-toggle-field__thumb {
  transform: translateX(16px);
}

.graphwar-killer-toggle-field__control:focus-visible .graphwar-killer-toggle-field__track {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: 2px solid color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  outline-offset: 1px;
}

.graphwar-killer-toggle-field__description {
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  line-height: 1.4;
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
