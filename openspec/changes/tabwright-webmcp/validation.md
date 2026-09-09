# Local acceptance — 2026-09-09

Branch: `codex-browser-cli-pilot`. No commit, push, release, installed Skill update,
user browser extension reload, or running relay replacement was performed.

## Verified behavior

Native WebMCP, not a polyfill, on isolated HeadlessChrome 152 with
`--enable-features=WebMCPTesting`. Business tools use a synthetic localhost fixture.
Browser calls go through the real Tabwright extension and test relay on port 19979.

- Native tool metadata is discovered without business invocation; non-JSON string results are preserved.
- Re-discovery, same-URL reload, SPA URL round-trip, native unregister/re-register and MCP reset reject old IDs.
- Missing API is distinguished from an empty list.
- Array input and missing required fields are rejected before native invocation. Chrome itself did not reject missing required fields, so the implementation uses the existing MCP SDK JSON Schema validator.
- Rejected and navigating invocations are not retried; navigation returns an unknown result or a context-loss error.
- MCP timeout retains the executor's busy guard until the original call settles; the fixture observes no duplicate execution.
- CLI list/call share a relay session; an invalid ID produces a nonzero exit code. Session deletion releases WebMCP snapshot listeners without closing the user's extension-controlled page.

## Checks

- `pnpm exec vitest run src/webmcp.test.ts --no-file-parallelism`: 10/10 passed after final lifecycle changes.
- Earlier combined run: WebMCP 9/9, CLI help 16/16, executor unit 25/25 passed. The final WebMCP file adds navigation acceptance, giving 51 distinct passing checks across these files.
- `pnpm typecheck` in tabwright and website: passed.
- `pnpm --filter tabwright build`: passed, including extension bundle and generated Skill/docs.
- Both local Skills pass skill-creator validation using the cached PyYAML environment.
- `openspec validate tabwright-webmcp --strict` and `git diff --check`: passed.
- No full browser suite or new-machine install was claimed.

## Scope and compatibility

The first release lists only tools hosted by the selected top-level document;
iframe aggregation and script persistence management remain outside this patch.
CLI/MCP use the existing Runtime/CDP transport. No extension source, permission,
manifest or WS protocol change is needed, and older extensions were not separately
reinstalled for this test. Browsers without the native discovery API report unsupported.

API contract reference: [Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).
Native API support and schema enforcement were checked empirically rather than assumed from registration success.

## Bundled Skill consolidation

The Tabwright Skill now contains discovery/invocation, evidence-grounded userscript
authoring, manager-based persistence, health checks and repair. The local browser
reference contains the native registration/lifecycle details. Web Code source is
retained as an optional compatibility entry, not an installation dependency.

Generated resources were rebuilt. An isolated installation under the repository's
`tmp/` directory contains only the Tabwright Skill, matches the source byte-for-byte
and reports `current`; the bundled browser reference is readable without Web Code.
Skill/docs/installer regression: 24/24 passed. Both Skills pass format validation;
OpenSpec strict validation and diff checks pass. No TypeScript/runtime change, full
browser rerun or replacement of installed personal Skills was needed for this step.
