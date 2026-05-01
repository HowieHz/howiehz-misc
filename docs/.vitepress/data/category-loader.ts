import { createContentLoader, type ContentOptions } from "vitepress";

import { formatDateToYMD } from "../utils/formatDate.ts";
import type { ContentLoader } from "./content-loader.ts";

export interface CategoryPostMeta {
  title: string;
  url: string;
  lastUpdated?: string;
}

interface LoaderOptions {
  sort?: (a: CategoryPostMeta, b: CategoryPostMeta) => number;
}

function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function getDefaultTitle(content: string): string {
  const match = content.match(/^\s*#+\s+(.+?)(?:\r?\n|$)/m);
  return match?.[1]?.trim() || "";
}

/**
 * Create a VitePress content loader for a category listing page.
 *
 * @param globPattern Glob pattern used by `createContentLoader` to find category posts.
 * @param categoryIndexUrl URL of the category index page itself; this page is excluded from the returned post list.
 * @param options Optional loader settings, such as a custom sort function.
 */
export function createCategoryLoader(
  globPattern: string,
  categoryIndexUrl: string,
  options: LoaderOptions = {},
): ContentLoader<CategoryPostMeta[]> {
  return createContentLoader<CategoryPostMeta[]>(globPattern, {
    includeSrc: true,
    excerpt: false,
    transform(items) {
      const posts: CategoryPostMeta[] = items
        .filter((item) => normalizeUrl(item.url) !== normalizeUrl(categoryIndexUrl))
        .map((item) => {
          const { frontmatter = {}, src, url } = item;
          let title = frontmatter.title;

          // 如果 frontmatter 中没有 title，尝试从 Markdown 源内容中提取
          if (!title && src) {
            title = getDefaultTitle(src);
          }

          // 最后的备选方案：从 URL 推断
          title = title || inferTitleFromUrl(url);

          const rawDate = frontmatter.published;
          const lastUpdated = formatDateToYMD(rawDate) || rawDate;
          return { title, url, lastUpdated };
        });

      const sorted = options.sort ? [...posts].sort(options.sort) : posts.sort(sortByDateDesc);
      return sorted;
    },
  } satisfies ContentOptions<CategoryPostMeta[]>);
}

function inferTitleFromUrl(url: string): string {
  const slug = url.replace(/\/$/, "").split("/").filter(Boolean).pop() || url;
  return slug.replace(/-/g, " ");
}

function sortByDateDesc(a: CategoryPostMeta, b: CategoryPostMeta): number {
  const aDate = a.lastUpdated ? Date.parse(a.lastUpdated) : 0;
  const bDate = b.lastUpdated ? Date.parse(b.lastUpdated) : 0;
  return bDate - aDate;
}
