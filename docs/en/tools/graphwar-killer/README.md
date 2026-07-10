# Graphwar Killer

**English** | [简体中文](../../../tools/graphwar-killer/)

Graphwar Killer calibrates a [Graphwar](https://graphwar.com/graphwar_1/index.html) screenshot and generates function expressions in Solver mode, then lets you enter a function expression and simulate the result in Simulator mode.

## Try it online

[Start using Graphwar Killer](https://howiehz.top/misc/en/tools/graphwar-killer/)

## Source layout

- [index.md](./index.md) is the English tool page entry.
- [GraphwarKillerPage.vue](../../../tools/graphwar-killer/GraphwarKillerPage.vue) is the shared Chinese/English tool page implementation.
- [core/](../../../tools/graphwar-killer/core/) contains shared types, coordinate conversion, numeric helpers, and the shared timing helper; `game/` holds Graphwar game constants and forward rules, and `tool/` holds tool defaults.
- [formula/](../../../tools/graphwar-killer/formula/) contains formula modules: `generation/` for formula generation and step numeric strategy, `expression/` for the expression evaluator, `simulation/` for the Graphwar trajectory simulator, and `trajectory/` for path, target, and obstacle sampling wrappers.
- [detection/](../../../tools/graphwar-killer/detection/) contains screenshot detection modules: `objects.ts` for coordinate-system bounds, obstacle, and soldier detection, `profile/` for detection thresholds, `runtime/` for the runner and worker protocols, and `template/` for template-matching subtask protocols.
- [pathfinding/](../../../tools/graphwar-killer/pathfinding/) contains path planning modules: `routing/` for shared geometric routing, `smart/` for regular smart pathfinding, `one-click-clear/` for one-click clear, `runtime/` for caches, runners, and worker protocols, and `targeting.ts` for shared targeting rules.
- [controllers/](../../../tools/graphwar-killer/controllers/) contains page controllers: `debug/` for debug activation and timings, `screenshot/` for screenshot input, `settings/` for input validation, `detection/` for detection workflows, `path/` for path state and editing, `pathfinding/` for pathfinding sessions, `stage/` for stage interactions, and `result/` for result actions.
- [presentation/](../../../tools/graphwar-killer/presentation/) contains presentation-layer modules: page panels are grouped under `settings/`,
  `detection/`, `pathfinding/`, `action/`, `screenshot/`, and `result/`, with `MainPanel.vue`/`AdvancedPanel.vue` naming inside each area;
  shared panel models live next to their panels as `*-model.ts`; `dom/` contains DOM event adapters, `stage/` contains the screenshot-stage SVG overlay and polyline points formatting, and `status/` contains status aggregation and duration formatting.
- [workers/](../../../tools/graphwar-killer/workers/) contains Web Worker entry files: `trajectory/` holds the main trajectory worker, `live-click-preview/` holds the live-preview worker, `detection/` holds the screenshot-detection main worker and template-matching subworker, `pathfinding/` holds the pathfinding main worker, and `pathfinding/one-click-clear/` holds the one-click-clear edge worker.
- [locale.ts](./locale.ts) provides the English page text; the Chinese page text lives in the Chinese page directory's [locale.ts](../../../tools/graphwar-killer/locale.ts).
