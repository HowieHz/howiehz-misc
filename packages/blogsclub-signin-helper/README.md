# BlogsClub Check-in Helper

**English** | [简体中文](./README.zh-Hans.md) | [繁體中文](./README.zh-Hant.md)

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

For full documentation, visit the [BlogsClub Check-in Helper documentation](https://howiehz.top/misc/en/blogsclub-signin-helper/).

## Quick Start

1. Install a supported script engine.
2. [Install the userscript directly from GitHub](https://github.com/HowieHz/howiehz-misc/raw/refs/heads/dist-userscript/blogsclub-signin-helper/blogsclub-signin-helper.user.js) or [install it from Greasy Fork](https://greasyfork.org/scripts/590073-blogsclub-check-in-helper).
3. Open `https://www.blogsclub.org/` or another BlogsClub page.
4. Choose `BlogsClub account: Not configured` from the userscript manager menu and enter your email and password.
5. Choose `Check now / check in` to check immediately. The script opens Geetest when today's check-in is still missing.

By default, automatic status checks run only on BlogsClub pages; manual checks are available on any matched page. The password is stored in the userscript manager's local storage and is sent only to the BlogsClub login endpoint.

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

## License

This project is licensed under the [MIT License](../../LICENSE).
