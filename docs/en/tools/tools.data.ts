import { createTitleLoader } from "../../.vitepress/data/title-loader";

export default createTitleLoader("en/tools/*.md", "/en/tools/", {
  locale: "en",
});
