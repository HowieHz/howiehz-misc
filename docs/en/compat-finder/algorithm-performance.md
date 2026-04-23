# Algorithm Performance

`compat-finder` currently ships with two built-in algorithms: `binary-split` and `leave-one-out`.

Here, "performance" mainly means how many test rounds the troubleshooting flow needs.

## **TL;DR**

- In almost all cases, `leave-one-out` uses exactly `n` questions; it becomes `n + 1` only when the final result covers all targets.
- `binary-split` varies with the size and distribution of the final result set and usually falls between about `max(1, ceil(log2(n)))` and `2n - 1` questions.

| Observation | Condition | Better Choice |
| --- | --- | --- |
| Average question count | Final incompatible set is about `22.84%` to `100%` of the total target set | `leave-one-out` |
| Average question count | Final incompatible set is below `22.83%` | `binary-split` |

The crossover point is around `13.77%`; below that, in most cases, the worst case for `binary-split` is also better than `leave-one-out`.

**Conclusion:** `binary-split` remains the default because, in real troubleshooting, the failing share is more often small.

## Overall Trend

The chart below summarizes the overall behavior across all non-empty result sets.

![Overall round-count comparison across all non-empty result sets](/compat-finder/overall-non-empty-subsets.svg)

## When the Final Result Has Only 1 Target

Single-target cases are one of the clearest situations where `binary-split` wins.

![Round-count comparison when the final result contains only 1 target](/compat-finder/pick-1.svg)

## When the Final Result Set Is Small

At `12.5%` of the total target set, `binary-split` has a clear advantage.

![Round-count comparison when the final result set is 12.5% of the total target set](/compat-finder/pick-eighth.svg)

## Near the Worst-Case Crossover

Around `13.77%`, the worst-case behavior of the two algorithms starts to get close.

![Round-count comparison when the final result set is about 13.77% of the total target set](/compat-finder/pick-13-77-percent.svg)

## Near the Average-Case Crossover

Around `22.83%`, the average-case advantage starts to flip.

![Round-count comparison when the final result set is about 22.83% of the total target set](/compat-finder/pick-22-83-percent.svg)

## When the Incompatible Set Is Large

When the final result is close to "almost everything is incompatible," `leave-one-out` becomes more predictable and often uses fewer rounds.

![Round-count comparison when the final result set covers all targets](/compat-finder/pick-all.svg)

## How to Choose

- You expect to end up with only a few incompatible targets: prefer `binary-split`
- You expect to end up with many incompatible targets: consider `leave-one-out`
- You are unsure: start with the default `binary-split`
- You want to see how to switch algorithms in practice: continue with [CLI](./cli#algorithms) and [API Reference](./api#algorithm-selection)
