## Why

Endpoint-specific Skills drift when application routes and request types change. For one-off reads, an agent can instead combine the user's existing browser login with the strongest evidence for the exact client deployment, including deployed source when available and observable browser artifacts when it is not.

## What Changes

- Add a generic Tabwright workflow for evidence-grounded authenticated `GET` and `HEAD` requests.
- Prefer the exact revision actually serving ready instances when deployed source is available.
- Without source, fingerprint the deployed document and assets, then combine Network, public Source Maps, bundles, lazy chunks, and runtime debugging evidence.
- Expose page state, Network, deployed code, runtime debugging, exact script source, and a separately invocable pinned Wakaru helper as capabilities the agent can combine using its own judgment.
- Stop on uncertain versions, routes, authentication boundaries, side effects, or instance inconsistency.
- Keep transient requests read-only and use independent Skills for repeated or mutation workflows.
- Let agents create independent Skills directly for durable workflows; keep the Tabwright runtime contract inside each Skill.
- Add Skill-owned runtime validation and execution entry points and remove the obsolete Capability registry product path.
- Invalidate inferred contracts when the deployed asset fingerprint changes.
- Non-goals: automatically decompile an entire site, add a multi-decompiler abstraction, integrate webcrack or Humanify, infer hidden server behavior, bypass account permissions, expose browser credentials, or add a generic write path.

## Capabilities

### New Capabilities

- `source-grounded-authenticated-reads`: One-off authenticated reads derived from exact deployed source or browser-observable deployment artifacts instead of a durable endpoint catalog.

### Modified Capabilities

None.

## Impact

- Updates the Tabwright executor/editor API, Skill-owned runtime CLI, extension guidance, compact installed Skill, full reference source, generated resources, and package dependencies.
- Does not change the WebSocket protocol.
