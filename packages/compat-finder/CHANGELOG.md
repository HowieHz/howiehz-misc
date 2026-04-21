# compat-finder

## 1.3.0

### Minor Changes

- [#79](https://github.com/HowieHz/howiehz-misc/pull/79) [`3d01497`](https://github.com/HowieHz/howiehz-misc/commit/3d0149739035bd8e8424615b3be7f72e44dd925f) Thanks [@HowieHz](https://github.com/HowieHz)! - Add `getNextAnswerableCompatibilityTestStep(state)` as the primary low-level helper, align the CLI and docs around it, and make `compat-finder next` return `extraAnswerCount` instead of failing on extra `--answers` values.

### Patch Changes

- [#79](https://github.com/HowieHz/howiehz-misc/pull/79) [`3d01497`](https://github.com/HowieHz/howiehz-misc/commit/3d0149739035bd8e8424615b3be7f72e44dd925f) Thanks [@HowieHz](https://github.com/HowieHz)! - Tighten CLI answer validation, localize `next --help` output examples correctly, and move the legacy Python prototype into a dedicated `legacy/` folder.

## 1.2.0

### Minor Changes

- [#69](https://github.com/HowieHz/howiehz-misc/pull/69) [`625f51e`](https://github.com/HowieHz/howiehz-misc/commit/625f51e4ba829f8a8698662e6dc4e167164b0c74) Thanks [@HowieHz](https://github.com/HowieHz)! - Add a high-level `createCompatibilitySession` API with `current()`, `answer(hasIssue)`, and `undo()` for simpler library integrations.

## 1.1.1

### Patch Changes

- [#63](https://github.com/HowieHz/howiehz-misc/pull/63) [`640710d`](https://github.com/HowieHz/howiehz-misc/commit/640710dd5ed892abfbb798cb422a1ca4646979ed) Thanks [@HowieHz](https://github.com/HowieHz)! - Fix locale parsing for POSIX-style locale modifiers and reject unsupported explicit Chinese locale variants.

- [#59](https://github.com/HowieHz/howiehz-misc/pull/59) [`605294b`](https://github.com/HowieHz/howiehz-misc/commit/605294bf8db9f7b372616b92165f86e70ca491e8) Thanks [@HowieHz](https://github.com/HowieHz)! - Enable npm Trusted Publishing for package releases.

- [#63](https://github.com/HowieHz/howiehz-misc/pull/63) [`640710d`](https://github.com/HowieHz/howiehz-misc/commit/640710dd5ed892abfbb798cb422a1ca4646979ed) Thanks [@HowieHz](https://github.com/HowieHz)! - Rename the canonical Simplified Chinese locale to `zh-Hans` and keep `zh-CN` as a backward-compatible alias.

## 1.1.0

### Minor Changes

- [#57](https://github.com/HowieHz/howiehz-misc/pull/57) [`2806bef`](https://github.com/HowieHz/howiehz-misc/commit/2806bef2fc947ba6d3febb8e82de6a7e0f9288be) Thanks [@HowieHz](https://github.com/HowieHz)! - Add CLI locale support through the `--locale`/`-l` option and locale environment variables.

## 1.0.1

### Patch Changes

- [#52](https://github.com/HowieHz/howiehz-misc/pull/52) [`149d6d5`](https://github.com/HowieHz/howiehz-misc/commit/149d6d5fa3cfaf2aa398a20a25c75830125c1eee) Thanks [@HowieHz](https://github.com/HowieHz)! - Fix release workflow errors.

## 1.0.0

### Major Changes

- [#47](https://github.com/HowieHz/howiehz-misc/pull/47) [`067a2f8`](https://github.com/HowieHz/howiehz-misc/commit/067a2f852186c63e9a34811e973a263b60fe53ea) Thanks [@HowieHz](https://github.com/HowieHz)! - Add the initial public release of compat-finder.
