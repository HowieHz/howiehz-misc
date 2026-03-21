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

## 分类

- [过时/低质量文章归档](/posts/junk/) · [docs/posts/junk/](https://github.com/HowieHz/howiehz-misc/tree/main/docs/posts/junk)

## Frontmatter 模板

```yaml
---
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
