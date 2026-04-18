import fs from "node:fs";
import path from "node:path";

import browserslist from "browserslist";
import { browserslistToTargets } from "lightningcss";
import { defineConfig, type DefaultTheme } from "vitepress";
import { chineseSearchOptimize, pagefindPlugin } from "vitepress-plugin-pagefind";
import { RSSOptions, RssPlugin } from "vitepress-plugin-rss";

import pkg from "../../package.json";

const baseUrl = "https://howiehz.top";
const basePath = "/misc/";
const githubRepoUrl = "https://github.com/HowieHz/howiehz-misc";

const DOCS_ROOT = path.resolve(__dirname, "..");
const POST_GROUPS = ["junk"] as const;

const ROOT_INFO_SIDEBAR: DefaultTheme.SidebarItem[] = [
  {
    items: [
      { text: "关于", link: "/about/" },
      { text: "投稿指南", link: "/contributing/" },
      { text: "版权说明", link: "/license/" },
    ],
  },
];

const EN_INFO_SIDEBAR: DefaultTheme.SidebarItem[] = [
  {
    items: [
      { text: "About", link: "/en/about/" },
      { text: "Contribution Guide", link: "/en/contributing/" },
      { text: "License Overview", link: "/en/license/" },
    ],
  },
];

const ROOT_TOOLS_SIDEBAR: DefaultTheme.SidebarItem[] = [
  {
    text: "工具",
    items: [{ text: "工具首页", link: "/tools/" }, ...collectTools("root")],
  },
];

const EN_TOOLS_SIDEBAR: DefaultTheme.SidebarItem[] = [
  {
    text: "Tools",
    items: [{ text: "Tools Home", link: "/en/tools/" }, ...collectTools("en")],
  },
];

type LocaleKey = "root" | "en";

const POST_LABELS: Record<
  LocaleKey,
  {
    header: string;
    overview: string;
    prefix: string;
    categories: Record<(typeof POST_GROUPS)[number], string>;
  }
> = {
  root: {
    header: "文章分类",
    overview: "分类概览",
    prefix: "",
    categories: {
      junk: "过时/低质量文章归档",
    },
  },
  en: {
    header: "Categories",
    overview: "Overview",
    prefix: "/en",
    categories: {
      junk: "Junk",
    },
  },
};

function buildPostSidebar(locale: LocaleKey): DefaultTheme.SidebarItem[] {
  const meta = POST_LABELS[locale];
  const sidebar: DefaultTheme.SidebarItem[] = [
    {
      text: meta.header,
      items: [{ text: meta.overview, link: `${meta.prefix}/posts/` }],
    },
  ];

  for (const key of POST_GROUPS) {
    const articles = collectPosts(locale, key);
    sidebar.push({
      text: meta.categories[key],
      collapsed: true,
      items: [{ text: meta.categories[key], link: `${meta.prefix}/posts/${key}/` }, ...articles],
    });
  }

  return sidebar;
}

function collectPosts(locale: LocaleKey, category: (typeof POST_GROUPS)[number]): DefaultTheme.SidebarItem[] {
  const baseDir = path.join(DOCS_ROOT, locale === "root" ? "" : "en", "posts", category);
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  return fs
    .readdirSync(baseDir)
    .filter((file) => file.endsWith(".md") && file !== "index.md")
    .sort()
    .map((file) => {
      const filePath = path.join(baseDir, file);
      const slug = file.replace(/\.md$/, "");
      const linkPrefix = POST_LABELS[locale].prefix;
      const link = `${linkPrefix}/posts/${category}/${slug}`;
      return {
        text: extractTitle(filePath) ?? slug,
        link,
      } satisfies DefaultTheme.SidebarItem;
    });
}

function collectTools(locale: LocaleKey): DefaultTheme.SidebarItem[] {
  const baseDir = path.join(DOCS_ROOT, locale === "root" ? "" : "en", "tools");
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const linkPrefix = locale === "root" ? "" : "/en";
  const collator = new Intl.Collator(locale === "root" ? "zh-Hans-CN" : "en");
  const toolFiles = collectToolMarkdownFiles(baseDir);

  return toolFiles
    .map((filePath) => {
      const relativePath = path.relative(baseDir, filePath);
      const slug = relativePath
        .replace(/\\/g, "/")
        .replace(/\/index\.md$/, "")
        .replace(/\.md$/, "");
      const link = slug.length > 0 ? `${linkPrefix}/tools/${slug}` : `${linkPrefix}/tools/`;
      return {
        text: extractH1Title(filePath) ?? path.basename(slug || "tools"),
        link,
      } satisfies DefaultTheme.SidebarItem;
    })
    .sort((a, b) => collator.compare(a.text, b.text));
}

function collectToolMarkdownFiles(baseDir: string): string[] {
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(baseDir, entry.name);
      if (entry.isDirectory()) {
        const indexFilePath = path.join(entryPath, "index.md");
        return fs.existsSync(indexFilePath) ? [indexFilePath] : [];
      }

      return entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md" ? [entryPath] : [];
    });
}

function extractTitle(filePath: string): string | undefined {
  const content = fs.readFileSync(filePath, "utf8");
  const frontmatterMatch = content.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (frontmatterMatch) {
    const titleLine = frontmatterMatch[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("title:"));
    if (titleLine) {
      return titleLine
        .replace(/^title:\s*/, "")
        .replace(/^['"]|['"]$/g, "")
        .trim();
    }
  }

  const headingMatch = content.match(/^#\s+(.+)$/m);
  return headingMatch ? headingMatch[1].trim() : undefined;
}

function extractH1Title(filePath: string): string | undefined {
  const content = fs.readFileSync(filePath, "utf8");
  const headingMatch = content.match(/^\s*#\s+(.+?)(?:\r?\n|$)/m);
  return headingMatch ? headingMatch[1].trim() : undefined;
}

// https://vitepress.dev/reference/site-config
export default defineConfig({
  vite: {
    plugins: [
      // Pagefind search plugin
      pagefindPlugin({
        customSearchQuery: chineseSearchOptimize,
        showDate: (date: number, lang: string) => {
          const now = Date.now();
          const diff = date - now; // 正值表示未来，负值表示过去
          const sign = Math.sign(diff);
          const absDiff = Math.abs(diff);

          const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });

          // 时间单位及其对应的毫秒数
          if (absDiff < 60000) {
            // 小于 1 分钟
            const timeDiff = sign * Math.floor(absDiff / 1000);
            return rtf.format(timeDiff, "second");
          } else if (absDiff < 3600000) {
            // 小于 1 小时
            const timeDiff = sign * Math.floor(absDiff / 60000);
            return rtf.format(timeDiff, "minute");
          } else if (absDiff < 86400000) {
            // 小于 1 天
            const timeDiff = sign * Math.floor(absDiff / 3600000);
            return rtf.format(timeDiff, "hour");
          } else if (absDiff < 604800000) {
            // 小于 1 周
            const timeDiff = sign * Math.floor(absDiff / 86400000);
            return rtf.format(timeDiff, "day");
          } else if (absDiff < 2592000000) {
            // 小于 30 天
            const timeDiff = sign * Math.floor(absDiff / 604800000);
            return rtf.format(timeDiff, "week");
          } else if (absDiff < 31536000000) {
            // 小于 365 天
            const timeDiff = sign * Math.floor(absDiff / 2592000000);
            return rtf.format(timeDiff, "month");
          } else {
            // 默认按年为单位
            const timeDiff = sign * Math.floor(absDiff / 31536000000);
            return rtf.format(timeDiff, "year");
          }
        },
        locales: {
          root: {
            btnPlaceholder: "搜索",
            placeholder: "搜索文档",
            emptyText: "空空如也",
            heading: "共 {{searchResult}} 条结果",
            toSelect: "选择",
            toNavigate: "切换",
            toClose: "关闭",
            searchBy: "搜索提供者",
          },
          en: {
            btnPlaceholder: "Search",
            placeholder: "Search Docs...",
            emptyText: "No results",
            heading: "Total {{searchResult}} results",
          },
        },
      }),
      // RSS feed plugin
      RssPlugin({
        baseUrl,
        title: "皓子的杂站",
        copyright: "版权所有 © 2023-至今 HowieHz",
        description: "放不进主站的内容都在这里。",
        language: "zh-Hans",
        feed: `${baseUrl}${basePath}rss.xml`,
        filename: "rss.xml",
        locales: {
          root: {
            feed: `${baseUrl}${basePath}rss.zh-hans.xml`,
            filename: "rss.zh-hans.xml",
          },
          en: {
            title: "HowieHz's Junk Drawer",
            copyright: "Copyright © 2023-present HowieHz",
            description: "For things that don't belong on the main site.",
            language: "en",
            feed: `${baseUrl}${basePath}rss.en.xml`,
            filename: "rss.en.xml",
          },
        },
      } satisfies RSSOptions),
    ],
    ssr: {
      noExternal: ["@nolebase/vitepress-plugin-highlight-targeted-heading"],
    },
    css: {
      transformer: "lightningcss",
      lightningcss: {
        // https://cn.vitejs.dev/guide/features#lightning-css
        targets: browserslistToTargets(browserslist(pkg.browserslist)),
      },
    },
    build: {
      cssMinify: "lightningcss",
    },
  },

  async transformHtml(code) {
    // 在 body 开头插入 GTM 的 noscript 回退（便于不支持 JS 的环境统计）
    const noscript = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-T447LW69" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
    return code.replace(/<body([^>]*)>/, `<body$1>${noscript}`).replace(/^\s*[\r\n]/gm, "");
  },

  base: basePath,

  head: [
    ["link", { rel: "icon", type: "image/png", href: `${basePath}haozi-logo.png` }],
    ["meta", { name: "theme-color", content: "#5f67ee" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "皓子的杂站" }],
    [
      "meta",
      {
        property: "og:image",
        content: `${baseUrl}${basePath}haozi-logo.png`,
      },
    ],
    ["meta", { property: "og:url", content: `${baseUrl}${basePath}` }],
    // <script defer src="https://um.howiehz.top/script.js" data-website-id="7b461ac5-155d-45a8-a118-178d0a2936e4" data-domains="howiehz.top" data-performance="true"></script>
    [
      "script",
      {
        defer: "",
        src: "https://um.howiehz.top/script.js",
        "data-website-id": "7b461ac5-155d-45a8-a118-178d0a2936e4",
        "data-domains": "howiehz.top",
        "data-performance": "true",
      },
    ],
    // <script defer src="https://um.howiehz.top/recorder.js" data-website-id="7b461ac5-155d-45a8-a118-178d0a2936e4" data-domains="howiehz.top" data-sample-rate="1" data-mask-level="moderate" data-max-duration="300000"></script>
    [
      "script",
      {
        defer: "",
        src: "https://um.howiehz.top/recorder.js",
        "data-website-id": "7b461ac5-155d-45a8-a118-178d0a2936e4",
        "data-domains": "howiehz.top",
        "data-sample-rate": "1",
        "data-mask-level": "moderate",
        "data-max-duration": "300000",
      },
    ],
    // Google Tag Manager (head)
    [
      "script",
      {},
      `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-T447LW69');`,
    ],
  ],

  lastUpdated: true,
  cleanUrls: true,
  metaChunk: true,

  sitemap: {
    hostname: `${baseUrl}${basePath}`,
    xmlns: {
      // trim the xml namespace
      news: true, // flip to false to omit the xml namespace for news
      xhtml: true,
      image: true,
      video: true,
      custom: [
        'xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd"',
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
      ],
    },
  },

  themeConfig: {
    logo: { src: "/haozi-logo.png", width: 24, height: 24 },
  },

  markdown: {
    image: {
      lazyLoading: true,
    },
  },

  locales: {
    root: {
      title: "皓子的杂站",
      titleTemplate: ":title | 皓子的杂站",
      description: "放不进主站的内容都在这里。",
      label: "简体中文",
      lang: "zh-Hans",
      dir: "ltr",
      // 主题配置放在 locales 里是为了覆盖默认语言
      themeConfig: {
        socialLinks: [{ icon: "github", link: githubRepoUrl }],
        nav: [
          {
            text: "文章分类",
            items: [{ text: "过时/低质量文章归档", link: "/posts/junk/" }],
          },
          { text: "工具", link: "/tools/" },
          {
            text: "关于",
            items: [
              { text: "关于本站", link: "/about/" },
              { text: "投稿指南", link: "/contributing/" },
              { text: "版权说明", link: "/license/" },
            ],
          },
        ],
        sidebar: {
          "/posts/": buildPostSidebar("root"),
          "/tools/": ROOT_TOOLS_SIDEBAR,
          "/contributing/": ROOT_INFO_SIDEBAR,
          "/about/": ROOT_INFO_SIDEBAR,
          "/license/": ROOT_INFO_SIDEBAR,
        },
        footer: {
          message: `代码 MIT · 文稿 CC BY-SA 4.0 + SATA · <a href="${basePath}license/">版权说明</a>`,
          copyright: "版权所有 © 2023-至今 HowieHz",
        },

        docFooter: {
          prev: "上一页",
          next: "下一页",
        },

        editLink: {
          pattern: `${githubRepoUrl}/edit/main/docs/:path`,
          text: "在 GitHub 上编辑此页面",
        },

        outline: {
          label: "本页大纲",
        },

        lastUpdated: {
          text: "最后更新于",
        },

        notFound: {
          title: "页面未找到",
          quote: "但如果你不改变方向，并且继续寻找，你可能最终会到达你所前往的地方。",
          linkLabel: "前往首页",
          linkText: "带我回首页",
        },

        langMenuLabel: "多语言",
        returnToTopLabel: "回到顶部",
        sidebarMenuLabel: "菜单",
        darkModeSwitchLabel: "主题",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式",
        skipToContentLabel: "跳转到内容",
      },
    },
    en: {
      title: "HowieHz's Junk Drawer",
      titleTemplate: ":title | HowieHz's Junk Drawer",
      description: "For things that don't belong on the main site.",
      label: "English",
      lang: "en-US",
      dir: "ltr",
      themeConfig: {
        socialLinks: [{ icon: "github", link: githubRepoUrl }],
        nav: [
          {
            text: "Categories",
            items: [{ text: "Junk", link: "/en/posts/junk/" }],
          },
          { text: "Tools", link: "/en/tools/" },
          {
            text: "About",
            items: [
              { text: "About This Site", link: "/en/about/" },
              { text: "Contribution Guide", link: "/en/contributing/" },
              { text: "License Overview", link: "/en/license/" },
            ],
          },
        ],
        sidebar: {
          "/en/posts/": buildPostSidebar("en"),
          "/en/tools/": EN_TOOLS_SIDEBAR,
          "/en/contributing/": EN_INFO_SIDEBAR,
          "/en/about/": EN_INFO_SIDEBAR,
          "/en/license/": EN_INFO_SIDEBAR,
        },
        footer: {
          message: `Code MIT · Content CC BY-SA 4.0 + SATA · <a href="${basePath}en/license/">License details</a>`,
          copyright: "Copyright © 2023-present HowieHz",
        },
        editLink: {
          pattern: `${githubRepoUrl}/edit/main/docs/:path`,
        },
      },
    },
  },
});
