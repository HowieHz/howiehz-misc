# BlogsClub Check-in Helper

**English** | [简体中文](./README.zh.md) | [繁體中文](./README.zh-Hant.md)

BlogsClub Check-in Helper is a userscript for checking your BlogsClub daily check-in status, reminding you when action is needed, and submitting the check-in after you complete the Geetest challenge.

The script does not solve, bypass, or automate the CAPTCHA. You must complete the challenge yourself.

## Features

- Check the daily check-in status in the background.
- Run an immediate check and open the Geetest challenge when needed.
- Submit the check-in after manual verification and show today's ranking.
- Optionally prepare the challenge before midnight and submit after the server's midnight.
- Estimate the BlogsClub server clock from the HTTP `Date` response header.
- Reduce unnecessary requests by reusing valid sessions and in-flight requests.
- Localize menus and notifications in English, Simplified Chinese, or Traditional Chinese; the first load follows the browser language preference.

## Supported Script Engines

The userscript supports [Tampermonkey](https://www.tampermonkey.net), [Violentmonkey](https://violentmonkey.github.io), [Greasemonkey](https://www.greasespot.net), [ScriptCat](https://docs.scriptcat.org), and other compatible userscript engines.

## Documentation

For full behavior, settings, network activity, privacy notes, troubleshooting, and limitations, visit [howiehz.top/misc/en/blogsclub-signin-helper](https://howiehz.top/misc/en/blogsclub-signin-helper/).

## Quick Start

1. Install a compatible userscript manager.
2. Build this package and install `dist/blogsclub-signin-helper.user.js` in the manager.
3. Open `https://www.blogsclub.org/` or another BlogsClub page.
4. Choose `BlogsClub 账号：未设置` from the userscript manager menu and enter your email and password.
5. Choose `立即检查/签到` to check immediately. The script opens Geetest when today's check-in is still missing.

By default, checks run only on BlogsClub pages. The password is stored in the userscript manager's local storage and is sent only to the BlogsClub login endpoint.

## Development

Install workspace dependencies from the repository root, then run:

```bash
pnpm --filter blogsclub-signin-helper build
```

Builds the userscript bundle in `dist/`.

```bash
pnpm --filter blogsclub-signin-helper watch
```

Rebuilds the userscript whenever source files change.

```bash
pnpm --filter blogsclub-signin-helper dev
```

Starts the Vite development server with HMR.

```bash
pnpm --filter blogsclub-signin-helper preview
```

Builds the userscript and serves the generated `dist/` bundle locally.
