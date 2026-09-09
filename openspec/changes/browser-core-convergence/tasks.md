---
title: Browser core convergence tasks
description: Implementation and acceptance for the approved product boundary.
prompt: |
  Track @proposal.md against the implementation and local acceptance evidence.
---

## Implementation

- [x] Remove recording end to end; preserve pin inspection and WS compatibility.
- [x] Remove options and repair connection health indicators.
- [x] Migrate business Skills without runtime-owned credentials or registration.
- [x] Remove Skill discovery, runtime execution, management and automatic auth.
- [x] Remove cloud SaaS, account/billing/device flows and unused dependencies.
- [x] Redesign product website and update CLI/MCP/Skill documentation.
- [x] Update migration notes, Changesets, extension version and project guidance.

## Verification

- [x] Typecheck and build all retained packages.
- [x] Run focused compatibility/authentication/script migration checks.
- [x] Run the complete retained browser/core suite without blanket snapshots.
- [x] Inspect the website in a browser and verify no retired product routes.
- [x] Verify package contents, generated docs and final diff; deliver acceptance.

## Acceptance and remaining release check

2026-09-07: implementation, builds, typechecks, package smoke, website inspection,
Skill checks and strict OpenSpec validation are complete. The full LTS run finished
with 326 passed, one live Hacker News label timeout and two existing skips.
The timed-out case passed its unchanged isolated recheck and the entire screenshot
file then passed 10/10; the full result remains
non-green, not silently converted into a pass. See @../../../docs/browser-core-acceptance.md.

- [x] Complete a fixed-version full release regression: 2026-09-09, 39 files passed,
  337 tests passed and two existing skips on Node 22.22.0. The unchanged screenshot
  file passed 10/10; the earlier live-page timeout did not reproduce. This is a new
  green run, not a reclassification of the earlier failure or proof of its cause.

## Paused checkpoint

2026-09-07: the user requested a local checkpoint after reconsidering product value
against official browser CDP access. Product development, homepage positioning and
release are paused. Preserve the current implementation and pending Changesets;
do not treat this checkpoint as release approval or an all-green regression.
No side-by-side comparison with the official extension has been completed.

## Release resumed — 2026-09-09

The user accepted the refactor and authorized releasing it together with WebMCP
and the consolidated Tabwright Skill. Target versions are CLI 4.0.0 (removed
public APIs require a major release) and extension 0.0.165. The historical paused
checkpoint above is superseded; release verification is recorded separately.

Release acceptance: @../../../docs/release-4-0-acceptance.md.
