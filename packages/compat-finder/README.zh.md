# 兼容性问题排查器

[English](./README.md) | 简体中文

compat-finder 是一个用于排查多个目标之间兼容性问题的引擎与命令行工具。

[适用范围](#适用范围) | [安装](#安装) | [快速开始](#快速开始) | [API 参考](#api-参考) | [命令行工具](#命令行工具) | [与 AI 协作](#与-ai-协作) | [在线版](#在线版)

## 适用范围

- 作为库使用：仅提供 ESM，不依赖 Node.js 内置模块，也可用于浏览器和其他兼容 ESM 的运行时
- 作为命令行工具使用：需要 Node.js `^20 || ^22 || >=24`；支持英文和简体中文

## 安装

使用你偏好的包管理器安装：

```bash
npm install compat-finder

# 或

pnpm add compat-finder

# 或

yarn add compat-finder

# 或

bun add compat-finder
```

然后可以创建一个兼容性排查会话：

```ts
import { createCompatibilitySession } from "compat-finder";
```

也可以直接临时调用命令行工具：

```bash
npx compat-finder --help

# 或

pnpm dlx compat-finder --help

# 或

yarn dlx compat-finder --help

# 或

bunx compat-finder --help
```

## 快速开始

### 库使用示例

```ts
import { createCompatibilitySession } from "compat-finder";

const session = createCompatibilitySession(["A", "B", "C", "D"]);

let step = session.current();

while (step.status === "testing") {
  const result = askUser(step.targets);

  if (result === "undo") {
    step = session.undo();
    continue;
  }

  step = session.answer(result === "issue");
}

console.log("最终结果：", step.targets);

function askUser(targets: readonly string[]): "issue" | "pass" | "undo" {
  console.log("当前需要测试：", targets);
  // 浏览器里可以来自 prompt()、按钮或表单。
  // Node.js 里可以来自 readline、测试脚本或你自己的 CLI。
  return "issue"; // 复现返回 "issue"，未复现返回 "pass"，撤销返回 "undo"。
}
```

更多导出 API 见 [API 参考](#api-参考)。

### 命令行示例

执行完整的交互式排查流程：

```bash
compat-finder interactive --count 4
```

执行单步排查计算并输出结果：

```bash
compat-finder next -c 3 -a "y,n"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

查看完整的[命令行工具](#命令行工具)文档了解命令和参数。

## API 参考

多数集成场景优先使用 `createCompatibilitySession`。

简单会话 API：

- `createCompatibilitySession(targets)`：根据目标列表创建兼容性排查会话
- `session.current()`：读取当前步骤或最终结果
- `session.answer(hasIssue)`：提交一次测试结果，并进入下一步
- `session.undo()`：撤销最新一次测试结果，并回到上一步

会话步骤：

- `status`：`testing` 表示当前需要按 `targets` 进行测试；`complete` 表示已经得到最终结果
- `targets`：来自原始输入列表的目标值
- `targetNumbers`：从 1 开始的目标编号，适合展示或记录日志

`session.answer(true)` 表示当前这组目标会复现问题。
`session.answer(false)` 表示当前这组目标不会复现问题。
如果最新一次结果输入错误，可以调用 `session.undo()` 撤销。
`createCompatibilitySession(targets)` 至少需要一个目标。

### 高级 API

底层 API 暴露了基于范围的可变状态机，适用于自定义 UI 与诊断场景。

会话流程：

- `createCompatibilityTestState(targetCount)`：创建新的排查会话
- `getCurrentCompatibilityTestStep(state)`：读取当前步骤；排查结束时返回 `undefined`
- `applyCompatibilityTestAnswer(state, hasIssue)`：提交一个测试结果并推进会话
- `skipCachedCompatibilityTestSteps(state)`：跳过已经命中的缓存步骤

范围工具：

- `takeTargetsFromRanges(ranges, limit)`：把范围展开成目标编号列表
- `countTargetsInRanges(ranges)`：统计范围内包含的目标数量
- `intersectTargetRanges(leftRanges, rightRanges)`：求两个范围列表的交集
- `subtractTargetRanges(sourceRanges, excludedRanges)`：从一个范围列表中剔除另一个范围列表

核心类型：

- `CompatibilityTestState`：可变的排查会话状态
- `CompatibilityTestStep`：当前要展示给调用方的步骤
- `CompatibilityTestDebugStep`：以范围形式表示的内部搜索状态
- `TargetRange`：闭区间目标编号范围

参数细节和行为约束请直接参考 [src/compatibility-test.ts](./src/compatibility-test.ts) 中的内联 JSDoc 注释。

## 命令行工具

### 帮助

```bash
compat-finder --help
```

```bash
compat-finder --help interactive
```

```bash
compat-finder --help next
```

### 输出语言

CLI 文案可以通过命令行参数或环境变量设置输出语言。

优先级：

1. 命令行参数：`--locale` / `-l`
2. 环境变量：`COMPAT_FINDER_LOCALE`
3. 环境变量：`LC_ALL`
4. 环境变量：`LC_MESSAGES`
5. 环境变量：`LANG`
6. 默认值：`en`

支持的语言：

- `en`
- `zh-Hans`

兼容旧的简体中文 locale 标签，例如 `zh-CN` 与 `zh-SG` 会被归一化为 `zh-Hans`。
显式传入不支持的值时会报错，包括 `zh-TW`、`zh-Hant` 等其他中文变体，不会静默切换到英文。
环境变量中的不支持值会被忽略，并继续按优先级查找；若最终没有匹配到支持语言，则回退到 `en`。

示例：

```bash
compat-finder --locale zh-Hans --help
```

```bash
compat-finder -l zh-Hans next -c 3 -a "y,n"
```

```bash
COMPAT_FINDER_LOCALE=zh-Hans compat-finder next -c 3 -a "y,n"
```

### 子命令

#### `interactive`

启动交互式排查流程：

```bash
compat-finder interactive --count 4
```

```bash
compat-finder i -c 4 -n "A,B,C,D"
```

支持以下输入：

- `y` / `yes` / `issue` / `1`：表示“有兼容性问题”
- `n` / `no` / `pass` / `0`：表示“没有兼容性问题”
- `u` / `undo`：撤回上一步
- `q` / `quit`：退出

#### `next`

根据已有回答，计算当前下一步应测试的目标，或直接返回最终结果：

```bash
compat-finder next -c 3
```

```bash
compat-finder n -c 3 -a "y,n"
```

```bash
compat-finder next -c 4 -a "issue,pass,1,0" -n "A,B,C,D"
```

返回字段说明：

- `status`：`testing` 表示当前需要按 `targets` 列表进行测试；`complete` 表示已经得到最终结果
- `targetCount`：本轮排查的测试目标总数
- `targets`：`testing` 时表示当前需要测试的目标列表；`complete` 时表示最终结果列表

`answers` 支持以下取值：

- `y` / `yes` / `issue` / `1` / `true`：表示“有兼容性问题”
- `n` / `no` / `pass` / `0` / `false`：表示“没有兼容性问题”

示例 1：

```bash
compat-finder next -c 3 -a "y"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 1"]
}
```

示例 2：

```bash
compat-finder next -c 3 -a "y,n"
```

预期输出为以下 JSON：

```json
{
  "status": "testing",
  "targetCount": 3,
  "targets": ["目标 2"]
}
```

示例 3：

```bash
compat-finder next -c 3 -a "y,n,n"
```

预期输出为以下 JSON：

```json
{
  "status": "complete",
  "targetCount": 3,
  "targets": ["目标 1", "目标 2"]
}
```

## 与 AI 协作

compat-finder 提供了 AI 编程助手可用的 [skills](https://agentskills.io/)，帮助 AI 理解本包的兼容性排查流程、CLI 命令和 TypeScript API。

### 安装

将 compat-finder skills 安装到你的 AI 编程助手中：

```bash
npx skills add HowieHz/howiehz-misc --skill compat-finder
```

skills 的源码在 [skills/compat-finder](./skills/compat-finder)。

### 示例提示词

安装后，你可以让 AI 帮助完成各种 compat-finder 相关任务：

```text
我需要排查插件 1、插件 2、插件 3、插件 4 的兼容性问题。你告诉我下一步测什么，我把结果给你，你继续帮我缩小范围。
```

```text
用 compat-finder 扫一遍我游戏 mods 文件夹，直接找出哪些插件会导致游戏启动不了。
```

```text
帮我把 compat-finder 接进我的软件，做一个让用户自己排查插件冲突的功能。
```

### 包含的内容

compat-finder skill 涵盖以下知识：

- CLI 命令、参数、输出语言和回答格式
- 交互式与单步兼容性排查流程
- TypeScript 状态机 API 与目标范围工具
- 包源码结构、测试文件和工作区命令
- CLI 与 API 变更时的文档更新要求

## 在线版

在线体验：[兼容性问题排查器](https://howiehz.top/misc/tools/compatibility-test/)

在线版源码在 [compatibility-test](../../docs/tools/compatibility-test)。

## 相关项目

由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。
