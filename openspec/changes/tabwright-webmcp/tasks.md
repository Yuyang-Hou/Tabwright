## Implementation
- [x] Add session-bound native WebMCP discovery and invocation.
- [x] Expose the shared implementation through MCP, CLI and executor helpers.
- [x] Document supported scope, lifecycle, errors and compatibility; add Changeset.

## Verification
- [x] Exercise real extension/relay transport and lifecycle/error paths in focused tests.
- [x] Verify native WebMCP when available; label simulation separately.
- [x] Run package typecheck/build, website typecheck and OpenSpec strict validation.
- [x] Review final diff and preserve unrelated WIP during local implementation.

## Bundled Skill consolidation
- [x] Include the full WebMCP workflow in the bundled Tabwright Skill and local browser reference.
- [x] Make Web Code optional while preserving its source and existing user files.
- [x] Validate generated bundles, isolated installation and Skill/docs checks.

## Release — 2026-09-09

The user authorized publishing this feature together with the accepted browser
core refactor as CLI 4.0.0 and extension 0.0.165. The local-only limits in the
earlier validation record describe that earlier stage, not the release scope.
