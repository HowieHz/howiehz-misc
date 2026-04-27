import type { ContentLoader } from "../../.vitepress/data/content-loader.ts";
import { createTitleLoader } from "../../.vitepress/data/title-loader.ts";
import type { TitleLinkItem } from "../../.vitepress/data/title-loader.ts";

const toolsData: ContentLoader<TitleLinkItem[]> = createTitleLoader("en/tools/{*.md,*/index.md}", "/en/tools/", {
  locale: "en",
});

declare const data: TitleLinkItem[];
export { data };
export default toolsData;
