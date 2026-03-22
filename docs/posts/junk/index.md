---
publish: false
---

# 过时/低质量文章归档

<script setup lang="ts">
import { data as posts } from "./posts.data.ts";
import { withBase } from "vitepress";
</script>

存档过时或低质量的内容，仅供参考。

## 文章列表

<ul class="category-post-list">
 <li v-for="post in posts" :key="post.url">
  <a :href="withBase(post.url)">{{ post.title }}</a>
    <span v-if="post.lastUpdated" class="category-post-date">（{{ post.lastUpdated }}）</span>
 </li>
</ul>

## 未达到收录阈值

::: details 详情

- higan-haozi 主题样式展示与使用指导
  - 链接：`/archives/higan-hz-style-guide`
  - 分类：`资源图谱 > 博客生态 > 主题工坊`
  - 标签：`2025` `简体中文` `软件-HaloCMS`
  - 描述：主题样式展示与使用指导
  - 发布时间：2025-04-20T20:33:39+08:00
  - 访问量：944
  - 评论量：1
  - 删除原因：现在应参考[《样式参考 | Higan Haozi》](https://howiehz.top/halo-theme-higan-haozi/guide/style-reference)。
- 重要通知：我们的 QQ 群与百度、必应和谷歌等搜索引擎建立了战略合作伙伴关系
  - 链接：`/archives/our-group-has-established-strategic-partnerships-with-search-engines`
  - 分类：`<无分类>`
  - 标签：`2024` `简体中文`
  - 描述：把“我们的 QQ 群与百度、必应和谷歌等搜索引擎建立了战略合作伙伴关系。这意味着群里的每个人都可以通过这些引擎免费获得大多数问题的答案，这是提供给所有成员的福利。”用当时最新的 AI 翻译成了 8 种语言。
  - 发布时间：2024-08-09T19:45:45+08:00
  - 访问量：11
  - 评论量：0
  - 删除原因：描述已经把内容描述完了。
- 网站 Favicon 下载工具 v1.2.1 发布
  - 链接：`/archives/1710332430816`
  - 分类：`资源图谱 > 工具集 > 项目发布 > 开源项目`
  - 标签：`2024` `简体中文`
  - 描述：复制了一遍软件的新版 README。
  - 发布时间：2024-03-13T20:20:30+08:00
  - 访问量：104
  - 评论量：0
  - 删除原因：看[《网站 Favicon 下载工具发布》](https://howiehz.top/archives/1706706766154)就够了。
- Vditor 样式测试
  - 链接：`/archives/vditor-yang-shi-ce-shi`
  - 分类：`测试用`
  - 标签：`2024` `简体中文`
  - 描述：复制了一遍 Vditor 的样式测试和 Mermaid 的样式测试并做了一点修改。
  - 发布时间：2024-03-05T20:28:53+08:00
  - 访问量：351
  - 评论量：0
  - 删除原因：现在应参考[《样式参考 | Higan Haozi》](https://howiehz.top/halo-theme-higan-haozi/guide/style-reference)。

:::
