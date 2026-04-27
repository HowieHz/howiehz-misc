import type { ContentLoader } from "../.vitepress/data/content-loader.ts";
import { createTitleLoader } from "../.vitepress/data/title-loader.ts";
import type { TitleLinkItem } from "../.vitepress/data/title-loader.ts";

const toolsData: ContentLoader<TitleLinkItem[]> = createTitleLoader("tools/{*.md,*/index.md}", "/tools/", {
  locale: "zh-Hans-CN",
});

declare const data: TitleLinkItem[];
export { data };
export default toolsData;
