---
title: Agent debugging core design
description: Reuse the browser engine and make evidence cheap and composable.
prompt: |
  Implement the approved scope in @proposal.md using existing
  @tabwright/src/cdp-session.ts, @tabwright/src/editor.ts,
  @tabwright/src/debugger.ts, @tabwright/src/executor.ts,
  @tabwright/scripts/build-resources.ts, and @skills/tabwright/SKILL.md.
  Keep agents free to choose their method and preserve protocol compatibility.
---

> Historical first-stage plan: recording/replay retention and its acceptance record
> are superseded by @../browser-core-convergence/proposal.md and
> @../../../docs/browser-core-acceptance.md. Core debugging requirements remain.

## Decisions

1. Keep Playwriter/Playwright/CDP as the engine. Add a small Network inspector
   beside Editor and Debugger, not a planner, endpoint registry, or new protocol.
2. Capture only after explicit enable. Keep a bounded in-memory history, return
   summaries first, and retrieve response bodies only when requested. Preserve
   redirect identity and distinguish failed, pending, evicted, and unavailable
   responses. Header redaction reduces accidental exposure; arbitrary response
   bodies and page content remain potentially sensitive, untrusted evidence.
3. Supply references from the installed package by topic. Keep the bootstrap
   Skill short, explain real API limits, and avoid mandatory observation orders.
4. An executor remains busy until its actual awaited work settles, even if the
   caller's deadline expires. Timeouts report unknown outcome, not cancellation.
   Detached user-created promises are outside this guarantee. Do not promise
   rollback or exactly-once remote effects.
5. Logs redact known credential fields before writing. This is diagnostic
   hygiene, not a complete data-loss-prevention or untrusted-code sandbox.
6. Recent background DOM activity becomes an explicit opt-in. Existing manual
   replay and wire messages remain available for reproducing a problem. No
   replay viewer, workflow compiler, or Skill-management product is rebuilt.
7. Remove cloud acquisition and obsolete recording claims from the main journey,
   keeping compatibility routes and runtime commands intact. No billing or
   production resources are changed.
8. Keep script/style metadata on the shared CDP adapter. Creating another helper
   must not disable a domain, clear breakpoints, or resume paused code. Invalidate
   metadata on context and stylesheet lifecycle events. Cache metadata, not a
   second copy of response bodies or the whole protocol stream.

## Compatibility and local delivery

All new helper APIs compose with the existing typed CDP adapter. No messages are
removed from the extension/relay protocol. Paths use Node path APIs; examples
have a cross-platform CLI entrypoint. Generated references are rebuilt from
source. Installation continues to preserve modified Skills unless replacement
is explicitly authorized. Local acceptance uses a separate browser profile and
local fixture, never live account mutations or the user's unrelated tabs.

## Validation

Run focused regression tests without snapshot updates, package and website
typechecks, extension build, generated-resource checks, OpenSpec strict
validation, and a real extension-backed local browser scenario. The scenario
must connect a visible outcome to its request, inspect the initiating source,
retrieve a response excerpt, and verify a deliberately delayed execution cannot
be blindly repeated. Provide a runnable acceptance entrypoint and local artifact.
