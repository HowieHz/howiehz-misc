---
aside: false
publish: false
published: 2026-06-23T12:00:00+08:00
---

# Graphwar Killer

Generate functions from a [Graphwar](https://graphwar.com/graphwar_1/index.html) screenshot or Agent state, or preview the trajectory of an existing function. All calculations run locally.

<!-- autocorrect-disable -->
<script setup lang="ts">
import GraphwarKillerPage from "../../../tools/graphwar-killer/GraphwarKillerPage.vue";
import { graphwarKillerLocale } from "./locale";
</script>

<GraphwarKillerPage :locale="graphwarKillerLocale" />
<!-- autocorrect-enable -->

## Expression Syntax {#graphwar-killer-expression-syntax}

| Category      | Supported syntax                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variables     | `x`, `y`, and `y'`                                                                                                                                  |
| Operators     | `+`, `-`, `/`, `*`, `^`, parentheses, and implicit multiplication such as `2x` or `2sin(x)`                                                         |
| Functions     | `sqrt()`, `log()`, `ln()`, `abs()`, `sin()` (alias `sen()`), `cos()`, `tan()` (alias `tg()`), and `exp()`; `log` is base 10, while `ln` is base `e` |
| Constants     | `e` and `pi`                                                                                                                                        |
| Compatibility | By default, Graphwar compatibility treats `y'` as `y` and skips unknown characters; both options can be turned off under Advanced settings          |

## How to Use {#graphwar-killer-instructions}

### Basic Workflow {#graphwar-killer-basic-workflow}

1. Upload, drag in, paste, or capture a Graphwar screenshot. For exact game data, turn on Use Agent and read the current state.
2. Confirm the coordinate bounds, soldiers, and obstacles. Correct the bounds or obstacle mask when automatic detection is inaccurate.
3. In Generate Function mode, select your soldier first, then add targets or intermediate path points. Paste the generated function into Graphwar.
4. In Simulate Trajectory mode, select the firing soldier and enter a function. The `y''` mode also requires a launch angle.

The tool saves separate algorithm settings for `y`, `y'`, and `y''`. The defaults are Double Absolute Value for `y`, Step with Glitch Mode for `y'`, and Step for `y''`.

Steepness applies to every Step formula and to the smooth turn pulses used by Double Absolute Value `y''`. Double Absolute Value `y''` always uses the stable pulse formula and does not use Step's overflow-protection switch.

### Canvas Tools {#graphwar-killer-canvas-interaction}

- Snap Soldiers snaps selections to detected soldiers and uses their actual hit circles.
- Collision Check applies to manual solving and trajectory simulation. Path Planning, One-Click Clear, and Managed Mode always check collisions.
- Path Planning finds a route around obstacles after you select a target. If data is missing, the interface shows what is required.

### Path Planning {#graphwar-killer-smart-pathfinding}

Path Planning searches from the current path end, generates a function, and validates the full trajectory before updating the path.

One-Click Clear starts at the current path end, finds usable soldiers in the `x+` direction, and plans a route that hits as many targets as possible.

Search Animation shows single-target search progress and the best validated formula and actual trajectory found by One-Click Clear or Managed Mode. Intermediate results hide their control points. The control points become part of the formal path when the search finishes.

To stop a manual One-Click Clear run and keep its current result without firing, right-click the screenshot. Turn off Managed Mode to stop a managed search.

#### Support Matrix {#graphwar-killer-pathfinding-support}

| Function algorithm    | Game mode        | Path Planning | One-Click Clear | Route style                        |
| --------------------- | ---------------- | ------------- | --------------- | ---------------------------------- |
| Double Absolute Value | `y`, `y'`, `y''` | Supported     | Supported       | Direct lines with smooth turns     |
| Step                  | `y`, `y'`, `y''` | Supported     | Supported       | Right-angle paths                  |
| Step (Glitch Mode)    | `y'`, `y''`      | Supported     | Supported       | Horizontal scan and vertical jumps |
| PCHIP                 | `y`, `y'`, `y''` | Supported     | —               | Smooth curves                      |
| Akima                 | `y`, `y'`, `y''` | Supported     | —               | Smooth curves                      |

#### Target Selection {#graphwar-killer-pathfinding-targets}

- Every result is validated with the full trajectory before the path is updated.
- Step Path Planning targets the center of a hit circle first, then tries the inner edge on the `x+` side.
- When multiple soldiers share the same x, Glitch One-Click Clear assigns different points in their hit circles so the path can keep moving right.
- Glitch One-Click Clear processes targets from left to right. If a target is unreachable, it skips that target and continues to the right.
- Point removal is off by default. When enabled, it tries to remove unnecessary control points without skipping final trajectory validation.

#### Routing Algorithms {#graphwar-killer-pathfinding-engines}

| Algorithm             | Behavior                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Lazy Visibility Graph | Default; usually faster with straighter routes, but it may miss a route around complex obstacles    |
| Theta*                | Usually slower, but more reliable around complex obstacles                                          |
| X+ Scan               | Used automatically by Step ODE Glitch Mode; scans to the right and tries vertical jumps when needed |

### Glitch Mode {#graphwar-killer-step-glitch-mode}

Glitch Mode applies to Step `y'` and `y''`. When a normal Step route encounters an obstacle, it tries to add a vertical jump; `y''` uses a short braking pulse after the jump to restore the previous `y'`. Accurate obstacle and soldier positions are required, so reading game state through Agent is recommended.

### Managed Mode {#graphwar-killer-managed-mode}

Turn on Use Agent and enter a valid URL to use Managed Mode. It marks local players in the room as ready, then reads state, runs One-Click Clear, and fires during local turns.

If a game mode uses an algorithm that does not support One-Click Clear, Managed Mode lists the required changes before updating those settings. After a search, it briefly shows the elapsed time and submits the shot without waiting for the page to render.

Managed Mode always keeps the best formula found so far in the background. Search Animation affects only the on-page preview, not the search or deadline firing.

With 3 seconds left, Managed Mode fires the best validated plan. If no plan is available, it submits a skip-turn function. It does not deliberately hit an obstacle as a fallback because doing so could change the map and open a route for an opponent.

Keep this page in the foreground while Managed Mode is active. Browser background limits may delay a shot.

### How to Use Graphwar Agent {#graphwar-killer-agent-help}

Place [`graphwar-agent.jar`](/graphwar-agent.jar) in the game directory, then run:

```bash
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

This starts Graphwar Agent and the game. Return to the tool and turn on Use Agent to read state or enable Managed Mode. For more information, see [Graphwar Agent](https://github.com/HowieHz/howiehz-misc/tree/main/packages/graphwar-agent).
