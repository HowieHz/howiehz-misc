import { NolebaseHighlightTargetedHeading } from "@nolebase/vitepress-plugin-highlight-targeted-heading/client";
// https://vitepress.dev/guide/custom-theme
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { h } from "vue";

import GiscusComment from "./components/GiscusComment.vue";
import PageFooterNotice from "./components/PageFooterNotice.vue";

import "./style.css";
import PostMetadata from "./components/PostMetadata.vue";

import "@nolebase/vitepress-plugin-highlight-targeted-heading/client/style.css";

const theme: Theme = {
  extends: DefaultTheme,
  Layout(): ReturnType<typeof h> {
    return h(DefaultTheme.Layout, null, {
      "doc-footer-before": () => [h(PostMetadata), h(PageFooterNotice)],
      "doc-after": () =>
        h(GiscusComment, {
          repo: "HowieHz/howiehz-misc",
          repoId: "R_kgDORs1wPg",
          category: "Announcements",
          categoryId: "DIC_kwDORs1wPs4C4-5S",
        }),
      // 闪烁高亮当前的目标标题
      "layout-top": () => [h(NolebaseHighlightTargetedHeading)],
    });
  },
};

export default theme;
