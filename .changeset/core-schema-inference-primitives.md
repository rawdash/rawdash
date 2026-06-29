---
'@rawdash/core': patch
---

Add a `schema-inference` module to `@rawdash/core` with pure, data-agnostic schema primitives so any integrator gets schema-drift detection out of the box. Exports `infer` (derive a structural schema from a JSON value), `merge` (combine samples into one schema, with the `ENUM_CANDIDATE_CAP` enum-vs-freeform heuristic), `canonicalize` / `fingerprint` / `stableStringify` (a stable identity for a shape), `diff` (typed structural delta between a baseline and observed schema), and `validateObserved` (breaking-vs-noise classification over two schemas), along with the `Schema`, `DiffEntry`, `DiffKind`, and validation result types. These complement the existing declared-shape types (`Shape`, `shapeSchema`, `ResourceDefinition`, `schemasFromResources`) with an observed-shape capability. No new runtime dependencies.
