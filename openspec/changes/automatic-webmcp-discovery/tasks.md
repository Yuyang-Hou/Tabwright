## Implementation
- [x] Add bounded metadata summaries to shared execution and CLI/MCP output.
- [x] Update bundled Skill preference and source documentation.
- [x] Add a minor changeset (repository issues are disabled).

## Verification
- [x] Verify native Chrome discovery, lifecycle, CLI/MCP delivery and failure isolation.
- [x] Run package typecheck/build, website typecheck and Skill checks.
- [x] Validate OpenSpec and review final diff, preserving unrelated WIP.

Validation: Chrome 152 native WebMCP over the real extension/relay; 38 focused tests passed. Package and website typechecks, package build, Skill validation, OpenSpec strict validation and diff whitespace checks passed. Changesets reports a Tabwright minor release. No fresh-agent blind evaluation or installed-package upgrade was performed.

## Inspect-before-action follow-up
- [x] Add page inspection CLI/helper and require a separate decision round trip in the Skill.
- [x] Return fresh schemas/IDs or explicit unavailable/unknown status on every inspection.
- [x] Verify reinspection, failure invalidation, CLI invocation, build and typechecks.

Follow-up validation: 30 tests passed (13 native WebMCP, 16 CLI, 1 bundled Skill). Package build, package/website typechecks, Skill validation, OpenSpec strict validation and diff checks passed. Not committed, released or installed.
