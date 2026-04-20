import type { ContentLoader } from "../../.vitepress/data/content-loader";
import { createTitleLoader } from "../../.vitepress/data/title-loader";
import type { TitleLinkItem } from "../../.vitepress/data/title-loader";

const toolsData: ContentLoader<TitleLinkItem[]> = createTitleLoader("en/tools/{*.md,*/index.md}", "/en/tools/", {
  locale: "en",
});

export default toolsData;
