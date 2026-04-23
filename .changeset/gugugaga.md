---
"compat-finder": minor
---

Add algorithm selection for compatibility tests, including a new `leave-one-out` strategy.
Benchmark results show that `leave-one-out` lowers the average question count when the failing set accounts for roughly 22.84% to 100% of the total target set, but performs worse than `binary-split` on average when the failing set accounts for less than 22.83%.
Worst-case results become mixed around the 13.77% mark, then swing back toward `binary-split`; by 12.5% or single-target cases it wins for nearly all target counts, so it remains the default because real-world troubleshooting usually involves a relatively small failing share of the total target set.
Thanks @surooooo for proposing the `leave-one-out` algorithm.
