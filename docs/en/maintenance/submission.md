---
publish: false
outline: deep
---

# Contribution Guide

This guide covers public site content submissions and edits. If you are working on repository maintenance, CI, release flow, or the npm package, see the [Maintenance Guide](/en/maintenance/contributing).

Feel free to submit or revise content through pull requests.

## Quick Start

1. Install dependencies: `pnpm install`
2. Start the docs development server with hot reload: `pnpm docs:watch`
3. Build the docs site: `pnpm docs:build`
4. Build the docs site and start the preview server: `pnpm docs:preview`
5. Before submitting, run `pnpm fmt`, `pnpm lint`, and `pnpm test`

## Using Vue in Markdown

In VitePress, each Markdown file is compiled to HTML and treated as a Vue single-file component. That means you can use Vue dynamic templates, components, and `<script>` logic directly in Markdown. Before editing these pages, read the [official VitePress guide](https://vitepress.dev/guide/using-vue) first.

Keep raw HTML template blocks contiguous and well-formed. Do not insert arbitrary blank lines inside containers such as `<select>...</select>`, or VitePress may surface Vue template parse errors during development or build, such as `Element is missing end tag`.

- Bad:

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

- Good:

```html
<select v-model="dayType">
  <option value="0">Next Day</option>
</select>
```

## Categories

- [Junk](/en/posts/junk/) · [docs/posts/junk/](https://github.com/HowieHz/howiehz-misc/tree/main/docs/posts/junk)

## Article Frontmatter Template

```yaml
---
outline: deep
published: 2025-12-07T21:45:30Z
author:
  - name: Contributor A
    link: https://github.com/contributor-a
    email: contributor-a@example.com
  - name: Contributor B
    link: https://github.com/contributor-b
    email: contributor-b@example.com
references:
  - name: Reference name
    link: https://example.com
    archive:
      ia: https://web.archive.org/web/20231207120000*/https://example.com
---
```

Field descriptions:

- `published` (required): publication date and time
- `author` (required): at least one author with `name`; both `link` and `email` are optional
  - `link`: a web contact such as a personal site or GitHub profile
  - `email`: an email contact
  - Rendering rule: if `link` exists, it is used as the author link; otherwise `email` is used as a `mailto:` link; if both are empty, no link is rendered
- `references` (optional): a list of source materials; each item should include `name`, `link`, and `archive`; omit the field entirely if there are no references
  - `archive`: archive information. Multiple archive types are allowed, such as `ia` (Internet Archive) or `wayback`, each with its own archive URL
    - Example: `ia: https://web.archive.org/web/...` or `wayback: https://...`

> Frontmatter must appear at the beginning of the Markdown file and be wrapped in `---`. The article body must begin with a level-one heading in the form `# Article Title`.

## Tool Frontmatter Template

```yaml
---
publish: false
published: 2025-12-07T21:45:30Z
---
```

Field descriptions:

- `publish: false` (required): prevents the page from being included in the RSS feed
- `published` (required): publication date and time

> Frontmatter must appear at the beginning of the Markdown file and be wrapped in `---`. The content must begin with a level-one heading in the form `# Tool Name`.
