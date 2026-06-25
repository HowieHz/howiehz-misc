# Graphwar Killer

**English** | [简体中文](../../../tools/graphwar-killer/)

Graphwar Killer calibrates a [Graphwar](https://graphwar.com/graphwar_1/index.html) screenshot and generates function expressions in Solver mode, then lets you enter a function expression and simulate the result in Simulator mode.

## Try it online

[Start using Graphwar Killer](https://howiehz.top/misc/en/tools/graphwar-killer/)

## Source layout

- [index.md](./index.md) is the English tool page entry.
- [GraphwarKillerPage.vue](../../../tools/graphwar-killer/GraphwarKillerPage.vue) is the shared Chinese/English tool page implementation.
- [composables/](../../../tools/graphwar-killer/composables/) contains page workflow state modules, such as screenshot input and path editing.
- [locale.ts](./locale.ts) provides the English page text; the Chinese page text lives in the Chinese page directory's [locale.ts](../../../tools/graphwar-killer/locale.ts).
