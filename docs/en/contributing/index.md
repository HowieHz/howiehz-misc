---
publish: false
---

# Contribution Guide

Feel free to submit or revise content via PR.

## Quick Start

1. Install dependencies: `pnpm install`
2. Start the docs development server with hot reload: `pnpm docs:watch`
3. Build the docs site: `pnpm docs:build`
4. Build the docs site and start the preview server: `pnpm docs:preview`
5. Before submitting, run: `pnpm fmt` and `pnpm lint`

## Using Vue in Markdown

In VitePress, every Markdown file is compiled into HTML and treated as a Vue Single-File Component. That means you can use Vue dynamic templates, components, and `<script>` logic directly in Markdown. Before editing related pages, read the [official VitePress docs](https://vitepress.dev/guide/using-vue) first.

On top of that, keep raw HTML template blocks contiguous and structurally stable. Do not insert arbitrary blank lines inside containers like `<select>...</select>`, or VitePress may report a Vue template parse error during dev/build through `vite:vue` / the Vue SFC compiler, such as `Element is missing end tag`.

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

Field explanation:

- `published` (required): Publication time.
- `author` (required): at least one author with `name`; both `link` and `email` are optional.
  - `link`: Web contact information (can be a personal website, GitHub profile, etc.).
  - `email`: Email contact information.
  - Rendering rules: if `link` exists, link to that address; otherwise link to `email` (formatted as `mailto:`); skip linking if both are empty.
- `references` (optional): reference materials list; each item needs `name`, `link`, and `archive`. Can omit the entire field if no references.
  - `archive`: backup information. Can include multiple backup types, such as `ia` (Internet Archive), `wayback`, etc., each type corresponding to a backup URL.
    - Example: `ia: https://web.archive.org/web/...` or `wayback: https://...`

> Frontmatter must be placed at the very beginning of the Markdown file, wrapped by a pair of `---`, with fields in between. The article content must begin with `# Article Title` as a level-one heading.

## Tool Frontmatter Template

```yaml
---
publish: false
published: 2025-12-07T21:45:30Z
---
```

Field explanation:

- `publish: false` (required): prevents publishing to RSS feeds.
- `published` (required): publication time.

> Frontmatter must be placed at the very beginning of the Markdown file, wrapped by a pair of `---`, with fields in between. The content must begin with `# Tool Name` as a level-one heading.
