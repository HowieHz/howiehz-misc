<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";

import { normalizePeople } from "../utils/people";

const { page } = useData();

const isEnglish = computed(() => page.value.relativePath?.startsWith("en/") ?? false);
interface FrontmatterReference {
  name?: string;
  title?: string;
  type?: string;
  link?: string;
  archive?: {
    ia?: string;
  };
}

interface NormalizedReference {
  label: string;
  url: string;
  archives?: {
    type: string;
    url: string;
  }[];
}

const labels = computed(() =>
  isEnglish.value
    ? {
        contributors: "Page contributors",
        references: "References",
      }
    : {
        contributors: "本页贡献者",
        references: "参考资料",
      },
);

const frontmatter = computed(() => page.value.frontmatter || {});
const shouldRender = computed(() => {
  if (frontmatter.value?.layout === "home") {
    return false;
  }

  return Boolean(frontmatter.value.authors || frontmatter.value.references);
});

const contributors = computed(() => normalizePeople(frontmatter.value.authors));
const references = computed(() => normalizeReferences(frontmatter.value.references));

function normalizeReferences(
  value: FrontmatterReference | FrontmatterReference[] | string | undefined,
): NormalizedReference[] {
  if (!value) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];
  return list
    .map((entry) => {
      if (!entry) {
        return undefined;
      }

      if (typeof entry === "string") {
        return buildReference(entry, entry);
      }

      const label = entry.name?.trim() || entry.title?.trim() || entry.type?.trim() || entry.link?.trim();
      const url = entry.link?.trim();
      const archives = entry.archive
        ? Object.entries(entry.archive)
            .filter(([, value]) => value && typeof value === "string")
            .map(([type, url]) => ({ type: type.trim(), url: (url as string).trim() }))
        : [];
      if (!label || !url) {
        return undefined;
      }
      return buildReference(label, url, archives);
    })
    .filter((item): item is NormalizedReference => Boolean(item));
}

function buildReference(label: string, url: string, archives?: { type: string; url: string }[]): NormalizedReference {
  return {
    label,
    url,
    archives,
  };
}
</script>

<template>
  <section v-if="shouldRender" class="post-meta">
    <div v-if="contributors.length" class="post-meta__row">
      <span class="post-meta__label">{{ labels.contributors }}：</span>
      <ul class="post-meta__list">
        <li v-for="(contributor, index) in contributors" :key="contributor.label + (contributor.link || '')">
          <template v-if="contributor.link">
            <a :href="contributor.link" target="_blank" rel="noreferrer">{{ contributor.label }}</a>
          </template>
          <template v-else>
            <span>{{ contributor.label }}</span>
          </template>
          <span v-if="index < contributors.length - 1" aria-hidden="true">, </span>
        </li>
      </ul>
    </div>
    <div v-if="references.length" class="post-meta__row">
      <span class="post-meta__label">{{ labels.references }}：</span>
      <ul class="post-meta__list">
        <li v-for="(reference, index) in references" :key="reference.url">
          <a :href="reference.url" target="_blank" rel="noreferrer">{{ reference.label }}</a>
          <a
            v-for="archive in reference.archives"
            :key="archive.type"
            :href="archive.url"
            target="_blank"
            rel="noreferrer"
            class="archive-link"
            >[{{ archive.type.toUpperCase() }}]</a
          >
          <span v-if="index < references.length - 1" aria-hidden="true">, </span>
        </li>
      </ul>
    </div>
  </section>
</template>
