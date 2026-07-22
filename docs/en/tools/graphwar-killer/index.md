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
import graphwarAgentInfo from "../../../public/graphwar-agent.json";
import { graphwarKillerLocale } from "./locale";

const graphwarAgentSourceUrl = `https://github.com/HowieHz/howiehz-misc/commit/${graphwarAgentInfo.sourceCommit}`;
</script>

<GraphwarKillerPage :locale="graphwarKillerLocale" />
<!-- autocorrect-enable -->

## Expression Syntax {#graphwar-killer-expression-syntax}

| Category                     | Supported syntax                                                                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variables                    | `x`, `y`, and `y'`                                                                                                                                                                                                                                         |
| Operators                    | `+`, `-`, `/`, `*`, `^`, parentheses, and implicit multiplication such as `2x` or `2sin(x)`                                                                                                                                                                |
| Precedence and associativity | From lowest to highest: `+ = - (binary) < - (unary) < * < / < ^`. Binary `-` means adding a unary negative, so `1-2` and `1+-2` both evaluate as `1+(-2)`. Repeated binary operators are right-associative: `1+2+3` is `1+(2+3)`, and `1/2/3` is `1/(2/3)` |
| Functions                    | `sqrt()`, `log()`, `ln()`, `abs()`, `sin()` (alias `sen()`), `cos()`, `tan()` (alias `tg()`), and `exp()`; `log` is base 10, while `ln` is base `e`                                                                                                        |
| Constants                    | `e` and `pi`                                                                                                                                                                                                                                               |
| Compatibility                | By default, Graphwar compatibility treats `y'` as `y` and skips unknown characters; both options can be turned off under Advanced settings                                                                                                                 |

## How to Use {#graphwar-killer-instructions}

### Basic Workflow {#graphwar-killer-basic-workflow}

1. Upload, drag in, paste, or capture a Graphwar screenshot. For exact game data, turn on Use Agent and read the current state.
2. Confirm the coordinate bounds, soldiers, and obstacles. Correct the bounds or obstacle mask when automatic detection is inaccurate.
3. In Generate Function mode, select your soldier first, then add targets or intermediate path points. Paste the generated function into Graphwar.
4. In Simulate Trajectory mode, select the firing soldier and enter a function. The `y''` mode also requires a launch angle.

The tool saves separate algorithm settings for `y`, `y'`, and `y''`. The defaults are Double Absolute Value for `y`, Step with Glitch Mode for `y'`, and Step with Glitch Mode for `y''`.

### Canvas Tools {#graphwar-killer-canvas-interaction}

- Snap Soldiers snaps selections to detected soldiers and uses their actual hit circles.
- Collision Check applies to manual solving and trajectory simulation. Path Planning, One-Click Clear, and Managed Mode always check collisions.
- Path Planning finds a route around obstacles after you select a target. If data is missing, the interface shows what is required.

### Path Planning {#graphwar-killer-smart-pathfinding}

Path Planning searches from the current path end, generates a function, and validates the full trajectory before updating the path.

Single-target Step Path Planning targets the hit-circle center first, then tries the inner `x+` edge if the center route fails.

One-Click Clear starts at the current path end, finds usable soldiers in the `x+` direction, and plans a route that hits as many targets as possible.

#### Support Matrix {#graphwar-killer-pathfinding-support}

| Function algorithm    | Game mode        | Path Planning | One-Click Clear | Route style                        |
| --------------------- | ---------------- | ------------- | --------------- | ---------------------------------- |
| Double Absolute Value | `y`, `y'`, `y''` | Supported     | Supported       | Direct lines with smooth turns     |
| Step                  | `y`, `y'`, `y''` | Supported     | Supported       | Right-angle paths                  |
| Step (Glitch Mode)    | `y'`, `y''`      | Supported     | Supported       | Horizontal scan and vertical jumps |
| PCHIP                 | `y`, `y'`, `y''` | Supported     | —               | Smooth curves                      |
| Akima                 | `y`, `y'`, `y''` | Supported     | —               | Smooth curves                      |

#### One-Click Clear Aiming Rules {#graphwar-killer-pathfinding-targets}

- It aims at soldier centers first. If a center is not to the right of the current path end, it aims at the rightmost usable point inside that soldier's hit circle.
- When multiple soldiers share the same x coordinate, their aim points are offset within their hit circles so the path can keep moving right.
- The complete trajectory is validated before the path is updated. Soldiers hit along the way also count toward the result.
- Point Removal can shorten the path when doing so preserves the hits.

#### Routing Algorithms {#graphwar-killer-pathfinding-engines}

| Algorithm             | Behavior                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Lazy Visibility Graph | Default; usually faster with straighter routes, but it may miss a route around complex obstacles    |
| Theta*                | Usually slower, but more reliable around complex obstacles                                          |
| X+ Scan               | Used automatically by Step ODE Glitch Mode; scans to the right and tries vertical jumps when needed |

### Glitch Mode {#graphwar-killer-step-glitch-mode}

Glitch Mode is available for Step `y'` and `y''`. When a normal Step cannot get around an obstacle, it tries a vertical jump and still validates collisions when obstacle data is available. Use Agent when accurate obstacle crossing is important.

### Managed Mode {#graphwar-killer-managed-mode}

Turn on Use Agent and enter a valid URL to use Managed Mode. It marks local players in the room as ready, then reads state, runs One-Click Clear, and fires during local turns.

If a game mode uses an algorithm that does not support One-Click Clear, Managed Mode lists the required changes before updating those settings. After a search, it briefly shows the elapsed time and submits the shot without waiting for the page to render.

Managed Mode always keeps the best formula found so far in the background. Search Animation affects only the on-page preview, not the search or deadline firing.

With 3 seconds left, Managed Mode fires the best validated plan. If no plan is available, it submits a skip-turn function. It does not deliberately hit an obstacle as a fallback because doing so could change the map and open a route for an opponent.

Keep this page in the foreground while Managed Mode is active. Browser background limits may delay a shot.

### How to Use Graphwar Agent {#graphwar-killer-agent-help}

Place [`graphwar-agent.jar`](/graphwar-agent.jar) in the game directory.

::: details graphwar-agent.jar file information

- File size: `{{ graphwarAgentInfo.fileSize.toLocaleString("en-US") }}` bytes
- MD5: `{{ graphwarAgentInfo.md5 }}`
- SHA-256: `{{ graphwarAgentInfo.sha256 }}`
- Version: `{{ graphwarAgentInfo.version }}`
- Source commit time: `{{ graphwarAgentInfo.sourceCommitTime }}`
- Source commit: <a :href="graphwarAgentSourceUrl"><code>{{ graphwarAgentInfo.sourceCommitShort }}</code></a>

:::

Then run:

```bash
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

The Windows Steam version of Graphwar can use its bundled Java directly:

```shell
.\jre1.8\bin\java.exe -javaagent:graphwar-agent.jar -jar graphwar.jar
```

::: details Graphwar Agent startup options

Append `=...` to the Agent JAR path to set startup options. Separate multiple options with commas:

```shell
java -javaagent:graphwar-agent.jar=token=auto,maxRequestBodyBytes=1048576 -jar graphwar.jar
```

| Option                    | Purpose                                 | Default                                                    | Accepted values                                             |
| ------------------------- | --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `port`                    | Set the HTTP listening port             | `17900`; if busy, try the next 100 ports (`17901`–`18000`) | `1`–`65535`; an explicit value disables fallback            |
| `token`                   | Enable bearer-token authentication      | Authentication disabled                                    | `auto`, or 1–4096 visible ASCII characters excluding commas |
| `maxRequestBodyBytes`     | Limit JSON request-body size            | `65536`                                                    | `1024`–`16777216`                                           |
| `maxFunctionBytes`        | Limit the function's UTF-8 byte length  | `16384`                                                    | `1`–`1048576`, capped to the effective request-body limit   |
| `maxFunctionNestingDepth` | Limit function-expression nesting depth | `256`                                                      | `1`–`4096`                                                  |

:::

This starts Graphwar Agent and the game. Return to the tool and turn on Use Agent to read state or enable Managed Mode. For more information, see [Graphwar Agent](https://github.com/HowieHz/howiehz-misc/tree/main/packages/graphwar-agent).
