import fs from "node:fs";
import path from "node:path";

import { createContentLoader } from "vitepress";

import { formatDateToYMD } from "../utils/formatDate";

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
  const match = content.match(/^\s*#+\s+(.+?)(?:\n|$)/m);
  return match?.[1]?.trim() || "";
}

/**
 * Create a VitePress content loader for a category listing page.
 *
 * @param globPattern Glob pattern used by `createContentLoader` to find category posts.
 * @param categoryIndexUrl URL of the category index page itself; this page is excluded from the returned post list.
 * @param options Optional loader settings, such as a custom sort function.
 */
export function createCategoryLoader(globPattern: string, categoryIndexUrl: string, options: LoaderOptions = {}) {
  return createContentLoader(globPattern, {
    excerpt: false,
    transform(items) {
      const posts: CategoryPostMeta[] = items
        .filter((item) => normalizeUrl(item.url) !== normalizeUrl(categoryIndexUrl))
        .map((item) => {
          const { frontmatter = {}, url } = item;
          let title = frontmatter.title;

          // 如果 frontmatter 中没有 title，尝试从文件内容中提取
          if (!title) {
            try {
              // 根据 url 推断文件路径
              const docRoot = process.cwd();
              const filePath = path.join(docRoot, "docs", url.replace(/\/$/, "") + ".md");
              if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, "utf-8");
                title = getDefaultTitle(fileContent);
              }
            } catch {
              // 文件读取失败，继续使用备选方案
            }
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
  });
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
