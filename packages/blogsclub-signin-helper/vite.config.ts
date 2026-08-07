import path from "node:path";

import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

import pkg from "./package.json" with { type: "json" };

const releaseAsset = path.posix.parse(pkg.releaseAsset);

export default defineConfig({
  build: {
    outDir: releaseAsset.dir,
  },
  plugins: [
    monkey({
      entry: "src/main.ts",
      userscript: {
        name: {
          "": "BlogsClub Check-in Helper",
          zh: "BlogsClub 签到助手",
          "zh-CN": "BlogsClub 签到助手",
          "zh-TW": "BlogsClub 簽到助手",
        },
        namespace: "https://howiehz.top",
        version: pkg.version,
        description: {
          "": "Checks BlogsClub check-in status in the background (BlogsClub pages by default) and supports manual CAPTCHA verification.",
          zh: "默认仅在 BlogsClub 页面后台检查签到状态，并支持手动完成验证码。",
          "zh-CN": "默认仅在 BlogsClub 页面后台检查签到状态，并支持手动完成验证码。",
          "zh-TW": "預設僅在 BlogsClub 頁面背景檢查簽到狀態，並支援手動完成驗證碼。",
        },
        author: "HowieHz",
        license: "MIT",
        homepageURL: "https://howiehz.top/misc/blogsclub-signin-helper/",
        supportURL: "https://github.com/HowieHz/howiehz-misc/issues",
        match: ["*://*/*"],
        noframes: true,
        "run-at": "document-idle",
        grant: [
          "GM_xmlhttpRequest",
          "GM_getValue",
          "GM_setValue",
          "GM_registerMenuCommand",
          "GM_unregisterMenuCommand",
          "GM_notification",
          "unsafeWindow",
        ],
        connect: ["www.blogsclub.org", "static.geetest.com"],
      },
      build: {
        fileName: releaseAsset.base,
      },
    }),
  ],
});
