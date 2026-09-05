<script setup lang="ts">
import { Download, Play, Upload, X } from "@lucide/vue";
import { PDFDocument } from "pdf-lib";
import { computed, ref } from "vue";

import { redactFooterTracking } from "./redact-footer.ts";

type ConversionState = "ready" | "converted" | "failed";

interface QueuedPdf {
  file: File;
  output?: Uint8Array;
  state: ConversionState;
}

const queuedPdf = ref<QueuedPdf>();
const isConverting = ref(false);
const isDropTarget = ref(false);
const errorMessage = ref<string>();

const canConvert = computed(
  () => queuedPdf.value !== undefined && queuedPdf.value.state !== "converted" && !isConverting.value,
);
const canDownload = computed(() => queuedPdf.value?.state === "converted" && !isConverting.value);

function addSelectedFile(event: Event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  addFile(input.files?.[0]);
  // Resetting lets the user select the same local file after removing it.
  input.value = "";
}

function addDroppedFile(event: DragEvent) {
  isDropTarget.value = false;
  addFile(event.dataTransfer?.files[0]);
}

function addFile(file: File | undefined) {
  if (isConverting.value) {
    return;
  }
  errorMessage.value = undefined;
  if (!file) {
    return;
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    errorMessage.value = "请选择 PDF 文件。";
    return;
  }
  queuedPdf.value = { file, state: "ready" };
}

function removeFile() {
  queuedPdf.value = undefined;
  errorMessage.value = undefined;
}

async function convertPdf() {
  const queued = queuedPdf.value;
  if (!queued || !canConvert.value) {
    return;
  }

  isConverting.value = true;
  errorMessage.value = undefined;
  try {
    const document = await PDFDocument.load(await queued.file.arrayBuffer(), { updateMetadata: false });
    if (redactFooterTracking(document) === 0) {
      throw new Error("未找到可替换的页脚时间和 32 位标识。该文件可能不是此工具支持的版式。");
    }
    const creationDate = document.getCreationDate();
    if (creationDate && Number.isFinite(creationDate.getTime())) {
      // The archived copy should keep the source creation time instead of exposing the conversion time.
      document.setModificationDate(creationDate);
    }
    queuedPdf.value = {
      ...queued,
      output: await document.save({ useObjectStreams: true }),
      state: "converted",
    };
  } catch (error) {
    queuedPdf.value = { ...queued, state: "failed" };
    errorMessage.value = error instanceof Error ? error.message : "转换失败。";
  } finally {
    isConverting.value = false;
  }
}

function downloadPdf() {
  const queued = queuedPdf.value;
  if (!queued?.output) {
    return;
  }
  const url = URL.createObjectURL(new Blob([Uint8Array.from(queued.output)], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = queued.file.name.replace(/\.pdf$/i, "-archived.pdf");
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Firefox and Safari can begin consuming the Blob URL after click returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function leaveDropZone(event: DragEvent) {
  const dropZone = event.currentTarget;
  if (!(dropZone instanceof HTMLElement) || dropZone.contains(event.relatedTarget as Node | null)) {
    return;
  }
  isDropTarget.value = false;
}

function formatFileSize(size: number) {
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
</script>

<template>
  <div class="pdf-footer-anonymizer">
    <p
      class="pdf-footer-anonymizer__notice"
      role="note"
    >
      <strong>使用限制：</strong>不得用于转换从 <code>print-gakufu.com</code> 下载的 PDF 格式乐谱。
    </p>
    <section class="pdf-footer-anonymizer__panel">
      <input
        id="pdf-footer-anonymizer-file-input"
        accept="application/pdf,.pdf"
        class="pdf-footer-anonymizer__file-input"
        type="file"
        :disabled="isConverting"
        @change="addSelectedFile"
      >
      <label
        class="pdf-footer-anonymizer__drop-zone"
        :class="{ 'pdf-footer-anonymizer__drop-zone--active': isDropTarget }"
        :aria-disabled="isConverting"
        for="pdf-footer-anonymizer-file-input"
        @dragenter.prevent="isDropTarget = true"
        @dragleave="leaveDropZone"
        @dragover.prevent="isDropTarget = true"
        @drop.prevent="addDroppedFile"
      >
        <Upload
          :size="24"
          aria-hidden="true"
        />
        <span>拖放 PDF 到这里</span>
        <span class="pdf-footer-anonymizer__drop-zone-action">选择 PDF</span>
      </label>

      <ol
        v-if="queuedPdf"
        class="pdf-footer-anonymizer__queue"
      >
        <li class="pdf-footer-anonymizer__queue-row">
          <div class="pdf-footer-anonymizer__queue-file">
            <strong :title="queuedPdf.file.name">{{ queuedPdf.file.name }}</strong>
            <span>{{ formatFileSize(queuedPdf.file.size) }}</span>
          </div>
          <span
            v-if="queuedPdf.state === 'converted'"
            class="pdf-footer-anonymizer__queue-status pdf-footer-anonymizer__queue-status--success"
          >
            已转换
          </span>
          <span
            v-else-if="queuedPdf.state === 'failed'"
            class="pdf-footer-anonymizer__queue-status pdf-footer-anonymizer__queue-status--error"
          >
            转换失败
          </span>
          <button
            type="button"
            class="pdf-footer-anonymizer__icon-button"
            aria-label="移除文件"
            :disabled="isConverting"
            title="移除文件"
            @click="removeFile"
          >
            <X
              :size="17"
              aria-hidden="true"
            />
          </button>
        </li>
      </ol>
    </section>

    <section class="pdf-footer-anonymizer__actions">
      <button
        type="button"
        class="pdf-footer-anonymizer__primary-button"
        :disabled="!canConvert"
        @click="convertPdf"
      >
        <Play
          :size="17"
          aria-hidden="true"
        />
        <span>{{ isConverting ? "转换中" : "转换" }}</span>
      </button>
      <button
        type="button"
        :disabled="!canDownload"
        title="下载转换后的 PDF"
        @click="downloadPdf"
      >
        <Download
          :size="17"
          aria-hidden="true"
        />
        <span>下载</span>
      </button>
    </section>
    <p
      v-if="errorMessage"
      class="pdf-footer-anonymizer__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>

<style scoped>
.pdf-footer-anonymizer {
  display: grid;
  gap: 12px;
  max-width: 720px;
}

.pdf-footer-anonymizer__panel,
.pdf-footer-anonymizer__actions {
  display: grid;
  gap: 8px;
}

.pdf-footer-anonymizer__notice {
  background: color-mix(in srgb, var(--vp-c-danger-soft) 54%, var(--vp-c-bg));
  border-inline-start: 3px solid var(--vp-c-danger-1);
  color: var(--vp-c-text-1);
  margin: 0;
  padding: 10px 12px;
}

.pdf-footer-anonymizer__notice strong {
  color: var(--vp-c-danger-1);
}

.pdf-footer-anonymizer__file-input {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.pdf-footer-anonymizer__drop-zone {
  background: color-mix(in srgb, var(--vp-c-bg-soft) 70%, var(--vp-c-bg));
  border: 1px dashed color-mix(in srgb, var(--vp-c-divider) 72%, var(--vp-c-text-2));
  border-radius: 8px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  display: grid;
  gap: 6px;
  min-height: 154px;
  padding: 18px;
  place-items: center center;
  text-align: center;
}

.pdf-footer-anonymizer__drop-zone:hover,
.pdf-footer-anonymizer__drop-zone--active {
  background: color-mix(in srgb, var(--vp-c-brand-soft) 54%, var(--vp-c-bg));
  border-color: var(--vp-c-brand-1);
}

.pdf-footer-anonymizer__drop-zone[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 58%;
}

.pdf-footer-anonymizer__drop-zone-action {
  color: var(--vp-c-brand-1);
  font-size: 0.9rem;
  font-weight: 700;
}

.pdf-footer-anonymizer__queue {
  display: grid;
  list-style: none;
  margin: 0;
  padding: 0;
}

.pdf-footer-anonymizer__queue-row {
  align-items: center;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 48%, var(--vp-c-bg));
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 76%, transparent);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) minmax(72px, auto) 34px;
  min-width: 0;
  padding: 7px 8px;
}

.pdf-footer-anonymizer__queue-file {
  display: grid;
  min-width: 0;
}

.pdf-footer-anonymizer__queue-file strong,
.pdf-footer-anonymizer__queue-status {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pdf-footer-anonymizer__queue-file strong {
  font-size: 0.9rem;
}

.pdf-footer-anonymizer__queue-file span,
.pdf-footer-anonymizer__queue-status {
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
}

.pdf-footer-anonymizer__queue-status--success {
  color: #15803d;
  font-weight: 700;
}

.pdf-footer-anonymizer__queue-status--error,
.pdf-footer-anonymizer__error {
  color: var(--vp-c-danger-1);
  font-weight: 700;
}

.pdf-footer-anonymizer__actions {
  display: flex;
}

.pdf-footer-anonymizer button {
  align-items: center;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  gap: 6px;
  justify-content: center;
  min-height: 34px;
  padding: 6px 10px;
}

.pdf-footer-anonymizer button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.pdf-footer-anonymizer button:disabled {
  cursor: not-allowed;
  opacity: 58%;
}

.pdf-footer-anonymizer button:focus-visible,
.pdf-footer-anonymizer__drop-zone:focus-within {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  outline: none;
}

.pdf-footer-anonymizer__primary-button {
  background: var(--vp-c-brand-1) !important;
  border-color: var(--vp-c-brand-1) !important;
  color: var(--vp-c-white) !important;
}

.pdf-footer-anonymizer__icon-button {
  grid-column: 3;
  padding: 0 !important;
  width: 34px;
}

.pdf-footer-anonymizer__error {
  margin: 0;
}

@media (width <= 520px) {
  .pdf-footer-anonymizer__queue-row {
    grid-template-columns: minmax(0, 1fr) 34px;
  }

  .pdf-footer-anonymizer__queue-status {
    grid-column: 1;
  }

  .pdf-footer-anonymizer__queue-row > .pdf-footer-anonymizer__icon-button {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
}
</style>
