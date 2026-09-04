# MiniMax H3 primitive qualification

Prompt Director v2 keeps model-calibrated motion primitives separate from free-form directing language. The initial library is deliberately small: `static_hold`, `micro_turn`, `dolly_in`, and `orbit_left`. Each primitive permits one dominant motion and states what must remain still.

A primitive is not production-qualified merely because its prompt compiles. Qualification requires at least two materially different scenes and two fixed seeds. The same first frame, workflow, model parameters, legacy goal, and scoring rubric must be retained per paired case. A candidate may be promoted only when it beats or ties legacy in every scene/seed cell, introduces no critical identity or geometry artifact, and improves aggregate commercial quality.

`createH3PrimitiveQualificationPlan` expands the deterministic matrix and fails closed before submission when evidence breadth is insufficient, a primitive is unknown, a seed is invalid, or estimated spend exceeds the hard limit. Generation remains a separately authorized execution step; constructing a plan never calls a provider.
