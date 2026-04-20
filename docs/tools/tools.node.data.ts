import type { ContentLoader } from "../.vitepress/data/content-loader";
import { createTitleLoader } from "../.vitepress/data/title-loader";
import type { TitleLinkItem } from "../.vitepress/data/title-loader";

const toolsData: ContentLoader<TitleLinkItem[]> = createTitleLoader("tools/{*.md,*/index.md}", "/tools/", {
  locale: "zh-Hans-CN",
});

declare const data: TitleLinkItem[];
export { data };
export default toolsData;
