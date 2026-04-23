# 兼容性问题排查器

compat-finder 是一个用于排查多个目标之间兼容性问题的 TypeScript 库和命令行工具。

它适合这几类场景：

- 在插件、模组、扩展或中间件集合里快速缩小出有问题的目标
- 在应用里嵌入一步步的兼容性排查流程
- 用 CLI 跑交互式排查，或者根据已有结果做单步推导
- 把这套流程交给 AI 或自动化工具协助完成

## 功能特点

- 为多数集成场景提供简单的会话 API：`createCompatibilitySession`
- 为高级场景提供底层状态 API，便于自定义 UI、持久化和恢复会话
- 内置 `binary-split` 和 `leave-one-out` 两种算法
- CLI 支持英文和简体中文
- 既能作为 ESM 库使用，也能作为 Node.js CLI 使用

## 阅读路线

- [安装](./install)：环境要求、包管理器安装方式、临时执行 CLI
- [快速开始](./quick-start)：最短路径跑通库和命令行
- [API 参考](./api)：会话 API、底层状态 API、范围工具和核心类型
- [命令行工具](./cli)：帮助、语言、算法和子命令
- [与 AI 协作](./ai)：Agent Skill、安装方式和提示词示例
- [在线版](./online-tool)：在线体验地址和源码位置

## 适用范围

- 作为库使用：仅提供 ESM，不依赖 Node.js 内置模块，也可用于浏览器和其他兼容 ESM 的运行时
- 作为命令行工具使用：需要 Node.js `^20 || ^22 || >=24`；支持英文和简体中文

## 相关项目

由 [HowieHz/plugin-compatibility-checking-tool](https://github.com/HowieHz/plugin-compatibility-checking-tool) 重构而来。
