# compat-finder Package Map

## Files

- `src/compatibility-test.ts`: core search state machine, range utilities, exported types
- `src/cli-main.ts`: CLI parsing, help text, locale resolution, interactive loop, JSON result generation
- `src/cli.ts`: Node CLI entrypoint
- `src/index.ts`: library public entrypoint
- `src/locales/en.ts`: English CLI messages
- `src/locales/zh-Hans.ts`: Simplified Chinese CLI messages for the `zh-Hans` locale
- `__tests__/compatibility-test.test.ts`: state-machine and range utility tests
- `__tests__/cli.test.ts`: CLI parser, locale, help text, and JSON output tests
- `README.md`: English package docs
- `README.zh.md`: Chinese package docs

## Workspace Commands

Run from the repository root:

```bash
pnpm compat-finder:test
pnpm compat-finder:build
pnpm cli:compat-finder -- --help
pnpm cli:compat-finder -- next -c 3 -a "y,n"
```

## Change Guidance

For algorithm changes:

- inspect `src/compatibility-test.ts`
- add or update tests in `__tests__/compatibility-test.test.ts`
- verify any changed session semantics in the README examples

For CLI changes:

- inspect `src/cli-main.ts` and the locale files together
- keep aliases, help text, and parser errors synchronized across locales
- add or update tests in `__tests__/cli.test.ts`

For documentation changes:

- keep `README.md` and `README.zh.md` aligned
- prefer concrete command examples and expected JSON output
