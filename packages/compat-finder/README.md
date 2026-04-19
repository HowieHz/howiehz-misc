# compat-finder

- 本工具用于排查多个目标之间的兼容性问题。
- 这是兼容性问题排查引擎与命令行工具所在的工作区包。
- 由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。

在线版页面见：[docs/tools/compatibility-test](../../docs/tools/compatibility-test/)。

## 文件结构

- [src](./src/)
  - [compatibility-test.ts](./src/compatibility-test.ts) 是兼容性排查引擎的 TypeScript 实现。
  - [cli.ts](./src/cli.ts) 是命令行入口。
  - [legacy.py](./src/legacy.py) 是原始 Python 实现版本。
- [\_\_test\_\_](./__tests__/) 是排查引擎与命令行工具的测试文件。
