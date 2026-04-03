<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";

const { page, site } = useData();

const base = computed(() => site.value.base);

const isEnglish = computed(() => page.value.relativePath?.startsWith("en/") ?? false);
const copy = computed(() => {
  if (isEnglish.value) {
    return {
      prefix: "All content on this page is released under ",
      ccText: "CC BY-SA 4.0",
      connector: " and ",
      sataText: "the SATA License",
      suffix: "; please also follow any supplementary notices referenced in this article.",
      ccHref: `${base.value}en/license/#content-license`,
      sataHref: `${base.value}en/license/#content-license`,
    } as const;
  }
  return {
    prefix: "本页面全部内容遵循 ",
    ccText: "CC BY-SA 4.0",
    connector: " 和 ",
    sataText: "SATA 协议",
    suffix: " 条款，如文稿另有补充说明请一并遵守。",
    ccHref: `${base.value}license/#content-license`,
    sataHref: `${base.value}license/#content-license`,
  } as const;
});
</script>

<template>
  <div class="page-copyright">
    <span>
      {{ copy.prefix }}
      <a :href="copy.ccHref" target="_blank" rel="noreferrer">{{ copy.ccText }}</a>
      {{ copy.connector }}
      <a :href="copy.sataHref" target="_blank" rel="noreferrer">{{ copy.sataText }}</a>
      {{ copy.suffix }}
    </span>
  </div>
</template>
