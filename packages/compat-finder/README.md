# compat-finder

compat-finder 是一个用于排查多个目标之间兼容性问题的引擎与命令行工具。

由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。

对应的在线版页面见：[docs/tools/compatibility-test](../../docs/tools/compatibility-test/)。

## 文件结构

- [src/compatibility-test.ts](./src/compatibility-test.ts) 是兼容性排查引擎的 TypeScript 实现。
- [src/cli.ts](./src/cli.ts) 是命令行入口。
- [src/legacy.py](./src/legacy.py) 是原始 Python 实现版本。
- [\_\_tests\_\_](./__tests__/) 是排查引擎与命令行工具的测试文件。
