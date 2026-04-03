---
publish: false
---

# 投稿指南

欢迎通过 PR 提交或修订内容。

## 快速上手

1. 安装依赖：`pnpm install`
2. 启动文档站：`pnpm docs:dev`
3. 构建产物：`pnpm docs:build`
4. 预览产物：`pnpm docs:preview`
5. 提交前执行：`pnpm fmt`、`pnpm lint`

## 在 Markdown 使用 Vue

在 VitePress 中，每个 Markdown 文件都会被编译成 HTML，并作为 Vue 单文件组件处理。这意味着可以在 Markdown 中使用 Vue 的动态模板、组件以及 `<script>` 逻辑。开始修改相关页面前，请先阅读 [VitePress 官方文档](https://vitepress.dev/zh/guide/using-vue)。

在此基础上，请让原始 HTML 模板块保持连续、规整，不要在 `<select>...</select>` 这类容器内部随意插入空行，否则可能在 VitePress 开发或构建阶段触发由 `vite:vue` / Vue SFC 编译器报出的模板解析错误，例如 `Element is missing end tag`。

- 错误示例：

<!-- prettier-ignore-start -->
```html
<select v-model="dayType">

<option
  value="0"
>
Next Day
</option>
</select>
```
<!-- prettier-ignore-end -->

- 正确示例：

```html
<select v-model="dayType">
  <option value="0">Next Day</option>
</select>
```

## 分类

- [过时/低质量文章归档](/posts/junk/) · [docs/posts/junk/](https://github.com/HowieHz/howiehz-misc/tree/main/docs/posts/junk)

## 文章 Frontmatter 模板

```yaml
---
outline: deep
published: 2025-12-07T21:45:30Z
author:
  - name: 投稿者 A
    link: https://github.com/contributor-a
    email: contributor-a@example.com
  - name: 投稿者 B
    link: https://github.com/contributor-b
    email: contributor-b@example.com
references:
  - name: 参考资料名称
    link: https://example.com
    archive:
      ia: https://web.archive.org/web/20231207120000*/https://example.com
---
```

字段说明：

- `published`（必填）：发布时间。
- `author`（必填）：至少填写一位作者的 `name`；`link` 和 `email` 均可选。
  - `link`：网页联系方式（可填写个人网站、GitHub 主页等）。
  - `email`：电子邮箱联系方式。
  - 渲染规则：若 `link` 存在则链接至该地址，否则链接至 `email`（格式为 `mailto:`），两项都为空则不生成链接。
- `references`（可选）：引用资料列表；每项需要 `name`、`link` 与 `archive`，若没有参考资料可省略整个字段。
  - `archive`：备份信息。可以包含多个备份类型，如 `ia`（Internet Archive）、`wayback` 等，每个类型对应一个备份 URL。
    - 示例：`ia: https://web.archive.org/web/...` 或 `wayback: https://...`

> Frontmatter 必须位于 Markdown 文件最开头，并用一对 `---` 包裹，中间填写上述字段；正文须以 `# 文章标题` 的一级标题开头。

## 工具 Frontmatter 模板

```yaml
---
publish: false
published: 2025-12-07T21:45:30Z
---
```

字段说明：

- `publish: false`（必填）：避免发布到 RSS 源内。
- `published`（必填）：发布时间。

> Frontmatter 必须位于 Markdown 文件最开头，并用一对 `---` 包裹，中间填写上述字段；正文须以 `# 工具名` 的一级标题开头。
