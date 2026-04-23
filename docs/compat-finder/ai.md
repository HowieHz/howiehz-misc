# 与 AI 协作

compat-finder 提供了 [智能体技能（Agent Skill）](https://agentskills.io/)，帮助 AI 理解本包的兼容性排查流程、CLI 用法和 TypeScript API。

如果你想把排查流程交给 AI 协助推进，先安装这个智能体技能会更直接。

## 安装

为你的 AI 智能体安装 compat-finder 智能体技能：

```bash
npx skills add HowieHz/howiehz-misc --skill compat-finder
```

智能体技能的源码位于 `packages/compat-finder/skills/compat-finder`。

## 示例提示词

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

```text
我的 compat-finder UI 需要把排查会话保存下来，并且在刷新页面后继续。应该用哪个 API，需要持久化哪些状态？
```

## 包含的内容

compat-finder 智能体技能涵盖以下内容：

- 如何选择一次性使用 CLI，还是把它作为库集成
- CLI 命令、参数、输出语言和可用的回答值
- 内置算法切换，包括 `binary-split` 和 `leave-one-out`
- 引导式与单步兼容性排查流程
- 如何把 mods 文件夹、插件目录之类的笼统请求整理成具体的 compat-finder 排查流程
- TypeScript 会话 API 与底层状态 API
- 在高级集成场景下，什么时候该用底层状态 API 来持久化或恢复会话
- 如何在引导式排查、自动排查和应用集成之间做选择
