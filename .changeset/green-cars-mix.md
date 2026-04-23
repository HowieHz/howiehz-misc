---
"compat-finder": major
---

Make the public `CompatibilityTestState` type a discriminated union keyed by `algorithm`.
Narrow on `state.algorithm === "binary-split"` before accessing `insideArrow` or `outsideArrows`.
