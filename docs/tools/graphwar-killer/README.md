# Graphwar 杀手

[English](../../en/tools/graphwar-killer/) | **简体中文**

Graphwar 杀手在解算器模式下标定 [Graphwar](https://graphwar.com/graphwar_1/index.html) 截图坐标并生成函数表达式，在模拟器模式下输入函数表达式并模拟结果。

## 在线体验

[开始使用 Graphwar 杀手](https://howiehz.top/misc/tools/graphwar-killer/)

## 源码结构

- [index.md](./index.md) 是中文工具页面入口。
- [GraphwarKillerPage.vue](./GraphwarKillerPage.vue) 是中英文共享工具页面实现。
- [composables/](./composables/) 放页面侧工作流状态 Module，例如截图输入和路径编辑。
- [locale.ts](./locale.ts) 提供中文页面文案；英文文案在 [英文页面目录](../../en/tools/graphwar-killer/locale.ts) 的 `locale.ts`。
