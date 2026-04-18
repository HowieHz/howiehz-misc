import { createTitleLoader } from "../.vitepress/data/title-loader";

export default createTitleLoader("tools/{*.md,*/index.md}", "/tools/", {
  locale: "zh-Hans-CN",
});
