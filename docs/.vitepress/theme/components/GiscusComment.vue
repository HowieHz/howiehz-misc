<template>
  <div
    v-if="shouldShow"
    class="giscus-wrapper"
  >
    <Giscus
      :repo="repo"
      :repo-id="repoId"
      :category="category"
      :category-id="categoryId"
      :mapping="mapping"
      :term="term"
      :theme="giscusTheme"
      :strict="giscusStrict"
      :reactions-enabled="giscusReactionsEnabled"
      :emit-metadata="giscusEmitMetadata"
      :input-position="inputPosition"
      :lang="giscusLang"
      :loading="loading"
    />
  </div>
</template>

<script setup lang="ts">
import Giscus, { type AvailableLanguage, type GiscusProps } from "@giscus/vue";
import { useData } from "vitepress";
import { computed, type ComputedRef } from "vue";

// 使用 Omit 排除需要重新定义的布尔属性，然后扩展
interface Props extends Omit<GiscusProps, "strict" | "reactionsEnabled" | "emitMetadata" | "mapping"> {
  // 重新定义为布尔类型，提供更直观的 API
  strict?: boolean;
  reactionsEnabled?: boolean;
  emitMetadata?: boolean;
  mapping?: GiscusProps["mapping"];
}

/* oxlint-disable eslint(no-undef) */
const props = withDefaults(defineProps<Props>(), {
  mapping: "pathname",
  strict: true,
  reactionsEnabled: true,
  emitMetadata: false,
  inputPosition: "top",
  theme: "preferred_color_scheme",
  lang: "zh-CN",
  loading: "lazy",
});

const { page, isDark } = useData();

// 路径前缀到 Giscus 语言代码的映射
const pathToLang: Record<string, AvailableLanguage> = {
  root: "zh-CN",
  en: "en",
};

const giscusLang = computed((): AvailableLanguage => {
  const path = page.value.relativePath || "";
  let rt = pathToLang["root"]; // 默认语言
  for (const [prefix, langCode] of Object.entries(pathToLang)) {
    if (prefix !== "root" && path.startsWith(`${prefix}/`)) {
      rt = langCode;
      break;
    }
  }
  return rt;
});

const giscusTheme: ComputedRef<"light" | "dark"> = computed(() => (isDark.value ? "dark" : "light"));

const giscusStrict: ComputedRef<"0" | "1"> = computed(() => (props.strict ? "1" : "0"));
const giscusReactionsEnabled: ComputedRef<"0" | "1"> = computed(() => (props.reactionsEnabled ? "1" : "0"));
const giscusEmitMetadata: ComputedRef<"0" | "1"> = computed(() => (props.emitMetadata ? "1" : "0"));

const shouldShow = computed(() => {
  // 不在 publish: false 页面显示
  return page.value?.frontmatter?.publish !== false;
});
</script>

<style scoped>
.giscus-wrapper {
  border-top: 1px solid var(--vp-c-divider);
  margin-top: 2rem;
  padding-top: 2rem;
}
</style>
