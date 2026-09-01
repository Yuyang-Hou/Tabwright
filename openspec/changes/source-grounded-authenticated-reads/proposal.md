## Why

Endpoint-specific Skills drift when application routes and request types change. For one-off reads, an agent can instead combine the user's existing browser login with the exact source revision serving the requested environment.

## What Changes

- Add a generic Tabwright workflow for source-grounded authenticated `GET` and `HEAD` requests.
- Require evidence of the revision actually serving ready instances before source inspection.
- Stop on uncertain versions, routes, authentication boundaries, or instance inconsistency.
- Keep transient requests read-only and retain saved capabilities for repeated or mutation workflows.
- Non-goals: discover endpoints by guessing, expose browser credentials, or add a generic write path.

## Capabilities

### New Capabilities

- `source-grounded-authenticated-reads`: One-off authenticated reads derived from exact deployed source instead of a durable endpoint catalog.

### Modified Capabilities

None.

## Impact

- Updates only the compact installed Tabwright Skill, its full reference source, and generated Skill discovery metadata.
- Does not change the relay, extension, browser protocol, or capability runtime.
