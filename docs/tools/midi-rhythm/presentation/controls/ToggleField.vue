<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  /** Stable DOM id connecting the switch, label, and description. */
  id: string;
  /** Current preference. */
  checked: boolean;
  /** User-facing switch label. */
  label: string;
  /** Optional supporting description rendered under the control. */
  description?: string;
  /** Optional hover text. */
  title?: string;
  /** Disables the switch while keeping it visible. */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const describedBy = computed(() => (props.description ? `${props.id}-description` : undefined));
</script>

<template>
  <div class="midi-toggle-field">
    <!-- The prop is the only switch state; a button cannot drift from it like a native checkbox can. -->
    <button
      :id="id"
      :aria-checked="checked"
      :aria-describedby="describedBy"
      class="midi-toggle-field__control"
      :disabled="disabled"
      role="switch"
      :title="title"
      type="button"
      @click="emit('toggle')"
    >
      <span class="midi-toggle-field__text">{{ label }}</span>
      <span
        class="midi-toggle-field__track"
        aria-hidden="true"
      >
        <span class="midi-toggle-field__thumb" />
      </span>
    </button>
    <p
      v-if="description"
      :id="`${id}-description`"
      class="midi-toggle-field__description"
    >
      {{ description }}
    </p>
  </div>
</template>

<style scoped>
.midi-toggle-field {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 50%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 82%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 4px;
  justify-self: start;
  min-width: 0;
  padding: 7px 8px;
}

.midi-toggle-field__control {
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

.midi-toggle-field__control:disabled {
  cursor: not-allowed;
  opacity: 68%;
}

.midi-toggle-field__text {
  align-items: center;
  display: flex;
  font-size: 0.9rem;
  font-weight: 700;
  gap: 4px;
  line-height: 1.3;
  overflow-wrap: anywhere;
  transition: color 0.2s ease;
}

.midi-toggle-field__track {
  background: var(--vp-c-divider);
  border: 1px solid color-mix(in srgb, var(--vp-c-text-2) 24%, var(--vp-c-divider));
  border-radius: 999px;
  box-sizing: border-box;
  display: block;
  height: 22px;
  padding: 2px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
  width: 38px;
}

.midi-toggle-field__control:hover:not(:disabled) .midi-toggle-field__text {
  color: var(--vp-c-brand-1);
}

.midi-toggle-field__control:hover:not(:disabled) .midi-toggle-field__track {
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, var(--vp-c-divider));
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 54%, var(--vp-c-divider));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
}

.midi-toggle-field__thumb {
  background: var(--vp-c-bg);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgb(15 23 42 / 20%);
  display: block;
  height: 16px;
  transition: transform 0.2s ease;
  width: 16px;
}

.midi-toggle-field__control[aria-checked="true"] .midi-toggle-field__track {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.midi-toggle-field__control[aria-checked="true"]:hover:not(:disabled) .midi-toggle-field__track {
  background: color-mix(in srgb, var(--vp-c-brand-1) 86%, var(--vp-c-text-1));
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 86%, var(--vp-c-text-1));
}

.midi-toggle-field__control[aria-checked="true"] .midi-toggle-field__track .midi-toggle-field__thumb {
  transform: translateX(16px);
}

.midi-toggle-field__control:focus-visible .midi-toggle-field__track {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: 2px solid color-mix(in srgb, var(--vp-c-brand-1) 52%, var(--vp-c-divider));
  outline-offset: 1px;
}

.midi-toggle-field__description {
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  line-height: 1.4;
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
