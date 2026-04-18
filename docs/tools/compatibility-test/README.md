# 兼容性问题排查器

本工具用于排查多个目标之间的兼容性问题，由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。

在线体验 -> [开始排查兼容性问题](https://howiehz.top/misc/tools/compatibility-test/)

## 文件结构

- [legacy.py](./legacy.py) 是原始 Python 实现版本。
- [compatibility-test.ts](./compatibility-test.ts) 是兼容性排查引擎的 TypeScript 实现。
- [compatibility-test.test.ts](./compatibility-test.test.ts) 是排查引擎的测试文件。
- [index.md](./index.md) 是工具页面与交互面板。
