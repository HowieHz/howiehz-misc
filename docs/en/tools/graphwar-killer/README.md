# Graphwar Killer

**English** | [简体中文](../../../tools/graphwar-killer/)

Graphwar Killer calibrates a [Graphwar](https://graphwar.com/graphwar_1/index.html) screenshot and generates function expressions in Solver mode, then lets you enter a function expression and simulate the result in Simulator mode.

## Try it online

[Start using Graphwar Killer](https://howiehz.top/misc/en/tools/graphwar-killer/)

## Source layout

- [index.md](./index.md) is the English tool page entry.
- [GraphwarKillerPage.vue](../../../tools/graphwar-killer/GraphwarKillerPage.vue) is the shared Chinese/English tool page implementation.
- [core/](../../../tools/graphwar-killer/core/) contains Graphwar constants, coordinates/numbers, shared types, and forward rules.
- [formula/](../../../tools/graphwar-killer/formula/) contains expression parsing, formula generation, trajectory sampling, and simulator logic.
- [detection/](../../../tools/graphwar-killer/detection/) contains screenshot detection, obstacle masks, soldier template matching, and detection worker protocols.
- [pathfinding/](../../../tools/graphwar-killer/pathfinding/) contains smart pathfinding, one-click clear, pathfinding caches, runners, and worker protocols.
- [controllers/](../../../tools/graphwar-killer/controllers/) contains page controllers for screenshot input, path editing, detection workflows, stage interactions, and pathfinding sessions.
- [presentation/](../../../tools/graphwar-killer/presentation/) contains presentation-layer modules, including page panels, the screenshot stage SVG overlay, status aggregation, and duration formatting.
- [workers/](../../../tools/graphwar-killer/workers/) contains Web Worker entry files.
- [locale.ts](./locale.ts) provides the English page text; the Chinese page text lives in the Chinese page directory's [locale.ts](../../../tools/graphwar-killer/locale.ts).
