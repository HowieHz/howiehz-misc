---
aside: false
publish: false
published: 2026-06-23T12:00:00+08:00
---

# Graphwar Killer

In Solver mode, calibrate a [Graphwar](https://graphwar.com/graphwar_1/index.html) screenshot and pick a path to generate a function expression. In Simulator mode, enter a function expression to simulate the result. All calculations happen locally.

<!-- autocorrect-disable -->
<script setup lang="ts">
import GraphwarKillerPage from "../../../tools/graphwar-killer/GraphwarKillerPage.vue";
import { graphwarKillerLocale } from "./locale";
</script>

<GraphwarKillerPage :locale="graphwarKillerLocale" />
<!-- autocorrect-enable -->

## Expression Syntax {#graphwar-killer-expression-syntax}

| Category      | Supported syntax                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variables     | Use `x`, `y`, and `y'`.                                                                                                                                                       |
| Operators     | Use `+`, `-`, `/`, `*`, and `^`. Parentheses and implicit multiplication such as `2x` or `2sin(x)` are also supported.                                                        |
| Functions     | Use `sqrt()`, `log()`, `ln()`, `abs()`, `sin()` (alias `sen()`), `cos()`, `tan()` (alias `tg()`), and `exp()`. `log` is the base-10 logarithm; `ln` is the natural logarithm. |
| Constants     | Use `e` and `pi`.                                                                                                                                                             |
| Compatibility | By default, Graphwar compatibility treats `y'` as `y` and ignores unknown characters. Both options can be turned off in Advanced.                                             |

## How to Use {#graphwar-killer-instructions}

### Basic Workflow {#graphwar-killer-basic-workflow}

- Input sources:
  - Screenshot detection: upload, drag, or paste a Graphwar screenshot and enter the coordinate range and game mode. You can also run Detect Bounds, then Detect Soldiers/Obstacles.
  - Agent reading: when accurate game state is required, turn on Use Agent, confirm the Agent URL, and select Read State.
- Modes:
  - Solver mode: select your soldier first, add targets or intermediate path points, then copy the generated function into Graphwar.
  - Simulator mode: select the initial firing soldier and enter a function. `y''` mode also needs a launch angle.
- Solver keeps three independent formula profiles. Their defaults are Double Absolute Value for `y`, Step with Glitch Mode for `y'`, and ordinary Step for `y''`. Switching game modes does not overwrite the other profiles; `y''` only disables the unsupported Double Absolute Value option.

### Key Features {#graphwar-killer-features}

#### Canvas Interaction {#graphwar-killer-canvas-interaction}

- Snap Soldiers only controls whether pointer selections snap to detected soldiers. When enabled, selections use the soldiers' actual hit circles.
- Collision Check only controls obstacle and boundary collisions for manual Solver work and Simulator playback. Path Planning, One-Click Clear, and Managed Mode always enforce collision checks.
- Path Planning controls whether selecting one target automatically finds a route around obstacles. It can be enabled before data is ready; the UI shows the first missing prerequisite directly.

#### Path Planning {#graphwar-killer-smart-pathfinding}

After you select a target, Path Planning finds a route from the current path end around detected obstacles, then generates a function and validates its trajectory with the simulator.

##### One-Click Clear {#graphwar-killer-one-click-clear}

Starting from the current path end, One-Click Clear filters usable targets whose soldier centers are in the `x+` direction and plans a route that kills as many soldiers as possible.

##### Managed Mode {#graphwar-killer-managed-mode}

Turn on Use Agent and confirm the Agent URL to enable Managed Mode. Solver keeps separate formula profiles for `y`, `y'`, and `y''`.

On first enable, Managed Mode lists profiles that do not support One-Click Clear and, after confirmation, repairs only those profiles. It locks calculation and firing inputs, reads game state once per second, selects the profile for the Agent's current game mode, and calculates One-Click Clear only during the current local human turn.

- When a search finishes, its calculation time is shown briefly and the shot is submitted immediately without waiting for the screenshot or trajectory to render on the page.
- If the search fails, or if 3 seconds remain without a usable plan, Managed Mode fires `999999999999999x` to skip the turn quickly. It does not deliberately hit an obstacle as a fallback because the explosion would change the map and could open a route for an opponent to attack your team.
- When 3 seconds remain, it stops calculating. If a validated plan exists, it briefly shows the elapsed calculation time and fires the best one.
- It does not retry during the same turn if calculation fails or the shot result cannot be confirmed.
- It recalculates every turn and does not reuse the previous turn's result.
- Keep the managed page in the foreground. The tool tries to keep the screen awake. Going into the background may cause delays; the tool will show a warning.

#### Glitch Mode {#graphwar-killer-step-glitch-mode}

Applies only to step functions in `y'` mode. When an obstacle lies inside the approximate normal-step path region, Glitch Mode attempts to generate a jump term that crosses the obstacle vertically. This mode needs obstacle data and accurate soldier positions, so reading game state through Agent is recommended.

### How to use Graphwar Agent {#graphwar-killer-agent-help}

Put [`graphwar-agent.jar`](/graphwar-agent.jar) in the game directory, then run this command from that directory:

```bash
java -javaagent:graphwar-agent.jar -jar graphwar.jar
```

This starts Graphwar Agent and the game together. Return to the tool and turn on Use Agent to read state manually or enable Managed Mode. For more information, see [Graphwar Agent](https://github.com/HowieHz/howiehz-misc/tree/main/packages/graphwar-agent).

### Pathfinding Details {#graphwar-killer-pathfinding-details}

#### Support Matrix {#graphwar-killer-pathfinding-support}

<!-- markdownlint-disable MD013 -->

| Function algorithm    | Glitch[^pathfinding-glitch]                                       | Game mode        | Path Planning[^pathfinding-solver-only]                      | One-Click Clear[^pathfinding-solver-only]                    | Target candidates                                                                                                                        | Key characteristics                    | Time complexity[^pathfinding-complexity]                                                                 |
| --------------------- | ----------------------------------------------------------------- | ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Double absolute value | <span title="Not applicable" aria-label="Not applicable">—</span> | `y`, `y'`        | <span title="Supported" aria-label="Supported">✅</span>     | <span title="Supported" aria-label="Supported">✅</span>     | Path Planning: Single-target mode[^pathfinding-single-target]<br>One-Click Clear: soldier centers                                        | Direct point-to-point lines            | Path Planning O(R)<br>One-Click Clear O(N²R)                                                             |
| Double absolute value | <span title="Not applicable" aria-label="Not applicable">—</span> | `y''`            | <span title="Unsupported" aria-label="Unsupported">❌</span> | <span title="Unsupported" aria-label="Unsupported">❌</span> | —                                                                                                                                        | Direct point-to-point lines            | —                                                                                                        |
| Step                  | <span title="Off" aria-label="Off">❌</span>                      | `y`, `y'`, `y''` | <span title="Supported" aria-label="Supported">✅</span>     | <span title="Supported" aria-label="Supported">✅</span>     | Path Planning: Center-first mode[^pathfinding-center-first]<br>One-Click Clear: soldier centers                                          | Right-angle paths                      | Path Planning O(R), with at most 2 runs<br>One-Click Clear O(N·D·R), where D is O(2^N) in the worst case |
| Step                  | <span title="On" aria-label="On">✅</span>                        | `y'`             | <span title="Supported" aria-label="Supported">✅</span>     | <span title="Supported" aria-label="Supported">✅</span>     | Path Planning: Center-first mode[^pathfinding-center-first]<br>One-Click Clear: allocated hit-circle points[^pathfinding-glitch-targets] | Horizontal scan and vertical tunneling | Path Planning O(P + S·F)<br>One-Click Clear O(P + N·S·F)                                                 |
| PCHIP                 | <span title="Not applicable" aria-label="Not applicable">—</span> | `y`, `y'`, `y''` | <span title="Supported" aria-label="Supported">✅</span>     | <span title="Unsupported" aria-label="Unsupported">❌</span> | Path Planning: Single-target mode[^pathfinding-single-target]                                                                            | Curve fitting                          | Path Planning O(R)                                                                                       |
| Akima                 | <span title="Not applicable" aria-label="Not applicable">—</span> | `y`, `y'`, `y''` | <span title="Supported" aria-label="Supported">✅</span>     | <span title="Unsupported" aria-label="Unsupported">❌</span> | Path Planning: Single-target mode[^pathfinding-single-target]                                                                            | Curve fitting                          | Path Planning O(R)                                                                                       |

<!-- markdownlint-enable MD013 -->

[^pathfinding-glitch]: The Glitch Mode toggle affects only Step `y'`.

[^pathfinding-solver-only]: Simulator mode retains the Path Planning preference, but it remains inactive and One-Click Clear cannot run.

[^pathfinding-single-target]: Single-target mode tries one target point only. For a soldier, it uses the center when available; otherwise it uses a valid point inside the hit circle. Once chosen, the target is not changed if routing or full trajectory validation fails. An ordinary click outside the `x+` direction is moved to the nearest usable `x+` position at the same `y`.

[^pathfinding-center-first]: Center-first mode tries at most two target points in order: the soldier center, then the hit circle's inner edge on the `x+` side. If the center is available, it is tried first; if routing to the center or full trajectory validation for the center target fails, the entire process is rerun once with the inner edge. If the center is unavailable from the start, the inner edge is used directly.

[^pathfinding-glitch-targets]: Glitch One-Click Clear processes targets by increasing soldier-center x. A singleton x column stays at its center. For multiple soldiers at the same x, the interval endpoints are the outermost integer screenshot pixels strictly inside the shared hit circles, and strictly increasing control points are distributed within that interval. Previously or subsequently occupied points inside the interval are fixed anchors. Within a group, increasing `|ΔY|` from the firing soldier's initial y maps to control points from left to right. Graph x is rechecked for strict increase after conversion.

[^pathfinding-complexity]: For ordinary modes, this column counts route finding only and excludes formula generation, trajectory simulation, hit checks, point removal, and reselection after a failure. Glitch scanning must replay the final formula to decide every candidate, so its complexity includes replay. See [Calculation Workflows](#graphwar-killer-pathfinding-workflows) for the complete process. `N` is the number of soldiers included in One-Click Clear after excluding the firing soldier and applying the Allow friendly fire and `x+` filters. `D` is the total number of ordinary Step cases kept separately because they reach different actual endpoints. `R` is the cost of one ordinary route search in [Routing Algorithms](#graphwar-killer-pathfinding-engines). `P` is the 770×450 grid-cell count; `S` is the number of glitch candidates fully replayed for one target before it is hit or every y/window branch is exhausted, with no fixed candidate limit; `F` is the sampling cost of one final-formula replay.

#### Calculation Workflows {#graphwar-killer-pathfinding-workflows}

<!-- markdownlint-disable MD013 -->

<table tabindex="0">
  <thead>
    <tr>
      <th scope="col">Configuration</th>
      <th scope="col">Workflow</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>Path Planning</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Double absolute value · <code>y</code>, <code>y'</code></td>
            </tr>
            <tr>
              <td>PCHIP, Akima · <code>y</code>, <code>y'</code>, <code>y''</code></td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>Check the current path and target → move the target to a usable position when needed → find a route around obstacles with the selected Routing Algorithm → generate the function and simulate its trajectory → check the <code>x+</code> direction, target hit, obstacles, and bounds → when Delete Optimization is enabled, try removing unnecessary new path points → perform the final full replay and update the path. A failure does not try another target point.</td>
    </tr>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>Path Planning</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Step · <code>y</code>, <code>y'</code>, <code>y''</code></td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Glitch Mode off</td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>Check the actual landing point of the current Step path → prefer the soldier center and use the hit circle's inner edge on the <code>x+</code> side when needed → find a Step route whose every step clears the obstacles → generate the complete function and simulate it from the start → check the target hit, obstacles, and bounds → retry with the inner-edge target if the center fails → when Delete Optimization is enabled, try removing unnecessary new path points → perform the final full replay and update the path.</td>
    </tr>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>Path Planning</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Step · <code>y'</code></td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Glitch Mode on</td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>Append the target directly; solve glitch segments from left to right with unsolved suffix terms temporarily disabled, and solve only the appended segments when an exact prefix matches; then still replay the final full formula from the launch point and update the path immediately on success → after direct failure, reuse the actual recovery point when the current path exactly matches the latest successful formula, otherwise replay the old full formula once while checking committed soldiers and the current tail → scan the current height to its first blocked column → generate right-gate control points from every free y beyond that column, preferring the candidate whose next horizontal run reaches farthest; every intermediate gate lies strictly between the current edge start and target x → tunnel vertically near the left gate and replay every new candidate's final formula from the launch point; do not replay the identical failed direct path → continue from the first real accepted point with <code>x≥R</code> → once the target is horizontally reachable, append the assigned target as the final control point; succeed only when the full replay hits the current target and every committed soldier and reaches that control-point x; committed soldiers need not retain their old hit order, otherwise keep exhausting branches → when Delete Optimization is enabled, try point deletion and fully replay each deletion candidate → perform the final full replay, update the path, and retain its actual recovery point and formula-solving prefix.</td>
    </tr>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>One-Click Clear</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Double absolute value · <code>y</code>, <code>y'</code></td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>Check the current path → collect soldier centers in the <code>x+</code> direction → try routes from the start to each target and between targets → choose the order expected to hit the most soldiers → generate and simulate each segment → exclude failed connections and choose again → when Delete Optimization is enabled, remove unnecessary path points → use one final full replay to validate the target order and collect every actual hit → update the path.</td>
    </tr>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>One-Click Clear</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Step · <code>y</code>, <code>y'</code>, <code>y''</code></td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Glitch Mode off</td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>Check the actual landing point of the current Step path → when earlier routes reach the same soldier at different actual landing points, continue trying each case separately → check whether each segment clears obstacles and connects to the previous segment → choose the order expected to hit the most soldiers → generate the complete function and simulate it from the launch point → exclude failed connections and choose again → when Delete Optimization is enabled, remove unnecessary path points → use one final full replay to validate the target order and collect every actual hit → update the path.</td>
    </tr>
    <tr>
      <td>
        <table class="graphwar-workflow-settings" role="presentation">
          <tbody>
            <tr>
              <td>One-Click Clear</td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Step · <code>y'</code></td>
            </tr>
            <tr class="graphwar-workflow-settings__group-start">
              <td>Glitch Mode on</td>
            </tr>
          </tbody>
        </table>
      </td>
      <td>Start at the current path tail, group soldiers by center x, and allocate strictly increasing hit-circle control points to equal-x soldiers → process new targets by increasing allocated x, using the same single-target glitch scan for every edge → after a hit, commit the whole edge ending exactly at the assigned target and promote that successful replay's actual recovery point and formula solution to the next fixed prefix; later formulas solve only appended segments but still replay the final full expression from the launch point → after exhausting every y/window branch without a path, permanently skip that target and try the next target from the unchanged prefix; failed targets leave the latest successful prefix evidence intact → when Delete Optimization is enabled, try deleting intermediate points while preserving committed target anchors; every accepted deletion replaces the evidence with the exact shorter path → use one final formula replay to confirm every selected new target, every old target, the last anchor x, and every actual hit at once → atomically write the path and actually hit soldier sequence; explicit targets keep control-point anchors that remain in the final path, while incidental hits are stored without anchors so later appends keep those soldiers hit without freezing their old hit order.</td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-enable MD013 -->

#### Routing Algorithms {#graphwar-killer-pathfinding-engines}

<!-- markdownlint-disable MD013 -->

| Routing algorithm      | Used by                         | Key characteristics                                                                                                                                                                               | Current worst-case time complexity[^routing-complexity]                                                                                            |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lazy Visibility Graph  | Path Planning + One-Click Clear | Chooses a small set of path points from obstacle contours. It is usually faster and produces straighter routes, but may miss a route that Theta* finds through complex obstacles[^routing-cache]. | First run O(P² + C + T² + T·V·(L + log V)); a cache hit omits P² but still scans O(C) contour vertices. For non-Step modes, T=V in the worst case. |
| Custom directed Theta* | Path Planning + One-Click Clear | Searches the 770×450 grid step by step in the `x+` direction. It is usually slower but handles complex obstacles more reliably[^routing-cache].                                                   | O(P + T[H² + H(L + log T)] + Q²L); a cache hit omits P.                                                                                            |
| X+ Scan                | Step `y'` Glitch Mode           | Always uses horizontal scanning and vertical tunneling, ignores the ordinary Routing Algorithm setting, and retains and exhausts branches with an explicit stack.                                 | O(P + S·F); One-Click Clear reuses the same O(P) index.                                                                                            |

<!-- markdownlint-enable MD013 -->

[^routing-complexity]: `P` is the number of cells in the 770×450 grid; `C` is the number of points on the simplified obstacle contours; `V` is the number of possible path points used by this Lazy Visibility Graph; `T` is the total number of times those points are checked, and the same point may be checked again when reached in a different way or after a better route is found; `H` is the grid height of 450; `L` is the number of cells checked for one straight or Step segment; `Q` is the final path-point count.

[^routing-cache]: When the obstacles, `x+` direction, and related tolerances stay unchanged, prepared obstacle data is reused instead of rebuilt. The cache affects speed only, not route selection. One-Click Clear reuses geometry data only within the current run, with each parallel task keeping its own copy. When ordinary One-Click Clear disables a failed edge and selects another route, it also reuses the validated edge prefix that is exactly shared with the previous attempt; edges after the divergence are still simulated normally. Glitch Mode retains one exact proof for the latest successful final formula, including its actual recovery point and left-to-right formula-solving prefix. Any change to the path, target sequence, coordinate bounds, formula settings, simulation tolerance, or obstacle snapshot forces a cold solve and replay. Single-target search and One-Click Clear may share an exact match. Within One-Click Clear, each successful edge promotes a request-local prefix, and only final whole-route success publishes it to later requests. The proof can remove preparation and historical glitch solving for the same old formula; it never replaces the full launch-point replay of a final formula with a new suffix.

Delete Optimization is independent of the routing algorithm and is off by default. When enabled, it tries to remove intermediate control points from a successful path. Disabling it skips only that work; the final full replay, collision checks, rule validation, and actual hit collection always remain.

When deletion is disabled, its hit-check radius is hidden in Advanced settings and does not participate in validation or cache identity.
