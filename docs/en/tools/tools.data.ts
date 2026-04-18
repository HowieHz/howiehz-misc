import { createTitleLoader } from "../../.vitepress/data/title-loader";

export default createTitleLoader("en/tools/{*.md,*/index.md}", "/en/tools/", {
  locale: "en",
});
