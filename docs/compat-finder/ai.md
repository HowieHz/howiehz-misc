# 与 AI 协作

如果你想让 AI 帮你推进 `compat-finder` 的排查或集成流程，可以为你的 AI 智能体安装 `compat-finder` [智能体技能（Agent Skill）](https://agentskills.io/)。

安装后，AI 会更清楚 `compat-finder` 的 CLI 用法、库 API 和常见排查流程。

## AI 能帮你做什么

- 根据你的目标列表和测试结果，持续推进兼容性排查
- 帮你判断更适合先用 CLI，还是把 `compat-finder` 集成进自己的项目
- 帮你写或调整 `compat-finder` 的 CLI 命令
- 帮你把 `compat-finder` 接进自己的应用、脚本或自定义 UI
- 帮你设计会话保存、恢复和持久化方案

## 安装

为你的 AI 智能体安装 `compat-finder` 智能体技能：

```bash
npx skills add HowieHz/howiehz-misc --skill compat-finder
```

智能体技能源码位于 [skills/compat-finder](https://github.com/HowieHz/howiehz-misc/tree/main/packages/compat-finder/skills/compat-finder)。

## 怎么提问更有效

如果你希望 AI 更快给出可执行的建议，尽量在提示里说明：

- 你的目标列表，例如插件、mods、版本、功能开关或配置项
- 你怎么判断一次测试是“有兼容性问题”还是“没有兼容性问题”
- 你已经做过哪些测试，以及每一步的结果
- 你是想直接用 CLI，还是接入自己的应用或脚本

## 示例提示词

安装后，你可以让 AI 帮你处理这类任务：

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
