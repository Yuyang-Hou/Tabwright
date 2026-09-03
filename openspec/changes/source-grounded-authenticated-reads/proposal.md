## Why

Endpoint-specific Skills drift when application routes and request types change. For one-off requests, an agent can instead combine the user's existing browser login with the strongest evidence for the exact client deployment, including deployed source when available and observable browser artifacts when it is not.

## What Changes

- Add a generic Tabwright workflow for evidence-grounded authenticated requests.
- Prefer the exact revision actually serving ready instances when deployed source is available.
- Without source, fingerprint the deployed document and assets, then combine Network, public Source Maps, bundles, lazy chunks, and runtime debugging evidence.
- Expose page state, Network, deployed code, runtime debugging, exact script source, and a separately invocable pinned Wakaru helper as capabilities the agent can combine using its own judgment.
- Cache explicitly selected runtime scripts locally by content hash and reuse matching Wakaru output without automatically collecting or decompiling a whole site.
- Stop on uncertain versions, routes, authentication boundaries, side effects, or instance inconsistency.
- Allow explicitly confirmed one-off mutations without forcing the agent to create a durable Skill.
- Keep repeated or durable mutation workflows in independent Skills with machine-enforced runtime contracts.
- Let agents create independent Skills directly for durable workflows; keep the Tabwright runtime contract inside each Skill.
- Add Skill-owned runtime validation and execution entry points and remove the obsolete Capability registry product path.
- Invalidate inferred contracts when the deployed asset fingerprint changes.
- Non-goals: automatically decompile an entire site, add a multi-decompiler abstraction, integrate webcrack or Humanify, infer hidden server behavior, bypass account permissions, expose browser credentials, or automatically execute mutations without a concrete preview and explicit confirmation.

## Capabilities

### New Capabilities

- `source-grounded-authenticated-reads`: One-off authenticated requests derived from exact deployed source or browser-observable deployment artifacts instead of a durable endpoint catalog.

### Modified Capabilities

None.

## Impact

- Updates the Tabwright executor/editor API, Skill-owned runtime CLI, extension guidance, compact installed Skill, full reference source, generated resources, and package dependencies.
- Does not change the WebSocket protocol.
