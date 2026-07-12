<script setup lang="ts">
defineProps<{
  /** Optional DOM id referenced by the related control's aria-describedby. */
  id?: string;
  /** Visible reason why the related control is unavailable or inactive. */
  message: string;
}>();
</script>

<template>
  <p
    :id="id"
    class="graphwar-killer-control-reason"
  >
    <span
      class="graphwar-killer-control-reason__icon"
      aria-hidden="true"
    >!</span>
    {{ message }}
  </p>
</template>

<style scoped>
.graphwar-killer-control-reason {
  color: #b45309;
  display: flex;
  font-size: 0.82rem;
  font-weight: 700;
  gap: 5px;
  line-height: 1.4;
  margin: 0;
  overflow-wrap: anywhere;
}

.graphwar-killer-control-reason__icon {
  align-items: center;
  border: 1px solid currentcolor;
  border-radius: 50%;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 0.7rem;
  height: 15px;
  justify-content: center;
  margin-top: 1px;
  width: 15px;
}
</style>
