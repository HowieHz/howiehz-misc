import { createTitleLoader } from "../.vitepress/data/title-loader";

export default createTitleLoader("tools/*.md", "/tools/", {
  locale: "zh-Hans-CN",
});
