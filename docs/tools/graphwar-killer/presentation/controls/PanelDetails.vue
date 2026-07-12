<script setup lang="ts">
defineProps<{
  /** 可见折叠标题。 */
  summary: string;
  /** 可选标题 id，供外部可访问性关系复用。 */
  summaryId?: string;
  /** 可选标题悬停说明。 */
  summaryTitle?: string;
}>();
</script>

<template>
  <!-- 不绑定 open，让所有设置和列表统一遵循原生 details 的默认折叠行为。 -->
  <details class="graphwar-killer-panel-details">
    <summary
      :id="summaryId"
      :title="summaryTitle"
    >
      {{ summary }}
    </summary>
    <slot />
  </details>
</template>

<style scoped>
.graphwar-killer-panel-details {
  background: var(--vp-c-bg-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 82%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 0;
  min-width: 0;
  padding: 8px;
}

.graphwar-killer-panel-details[open] {
  gap: 8px;
}

.graphwar-killer-panel-details > summary {
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.4;
  margin: -2px 0;
}

.graphwar-killer-panel-details > summary:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>
