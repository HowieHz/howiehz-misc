import { createContentLoader, type ContentOptions } from "vitepress";

import type { ContentLoader } from "./content-loader";

export interface TitleLinkItem {
  title: string;
  url: string;
}

interface LoaderOptions {
  locale?: string;
  sort?: (a: TitleLinkItem, b: TitleLinkItem) => number;
}

function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function extractH1Title(content?: string): string | undefined {
  if (!content) {
    return undefined;
  }

  const match = content.match(/^\s*#\s+(.+?)(?:\r?\n|$)/m);
  return match?.[1]?.trim();
}

/**
 * Create a content loader that lists Markdown pages by their top-level heading.
 *
 * Pages without an H1 are skipped. The index page itself is excluded.
 *
 * @param globPattern Glob pattern used by `createContentLoader` to find pages.
 * @param indexUrl URL of the index page itself; this page is excluded from the returned list.
 * @param options Optional loader settings, such as locale-aware sorting.
 */
export function createTitleLoader(
  globPattern: string,
  indexUrl: string,
  options: LoaderOptions = {},
): ContentLoader<TitleLinkItem[]> {
  const loaderOptions: ContentOptions<TitleLinkItem[]> = {
    includeSrc: true,
    excerpt: false,
    transform(items) {
      const pages = items
        .filter((item) => normalizeUrl(item.url) !== normalizeUrl(indexUrl))
        .map((item) => {
          const title = extractH1Title(item.src);
          if (!title) {
            return undefined;
          }

          return {
            title,
            url: item.url,
          } satisfies TitleLinkItem;
        })
        .filter((item): item is TitleLinkItem => Boolean(item));

      const collator = options.locale ? new Intl.Collator(options.locale) : new Intl.Collator();

      return options.sort ? [...pages].sort(options.sort) : pages.sort((a, b) => collator.compare(a.title, b.title));
    },
  };

  return createContentLoader<TitleLinkItem[]>(globPattern, loaderOptions) as ContentLoader<TitleLinkItem[]>;
}
