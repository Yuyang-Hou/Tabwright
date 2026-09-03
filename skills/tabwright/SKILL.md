---
name: tabwright
description: Control the user's Chrome browser through Tabwright's extension and stateful Playwright sandbox. Use for JS-heavy or logged-in pages, source- or deployment-artifact-grounded authenticated reads, and Tabwright runtimes bundled in independently managed Agent Skills. Load before using Tabwright commands or explaining its browser and Skill runtime behavior.
---

## Installation

Installing the global Tabwright CLI also installs this skill into `~/.agents/skills/tabwright`. If npm lifecycle scripts were disabled, run `tabwright skill install`; use `tabwright skill status` to verify the copy or `--target codex` / `--target claude` for an agent-specific directory. Tabwright preserves user-modified skill files unless `--force` is explicit.

## Skill-Owned Runtimes

When an independently installed domain Skill matches the request, follow that Skill. Its `SKILL.md` owns discovery, workflow, and display semantics; its `runtime/` directory owns machine-enforced schemas, permissions, side effects, authentication, confirmation, and executable behavior.

```bash
tabwright skill runtime validate "<absolute-skill-directory>" --json
tabwright skill runtime run "<absolute-skill-directory>" --input-json '<json-input>' --json
```

Validation does not execute the runtime. Running applies the existing Tabwright safety contract and stores authentication, run evidence, quarantine state, and artifacts under `~/.tabwright/skill-runtime-state/`, outside the Skill. If the selected operation requires confirmation, stop for explicit approval of its concrete input and effect before using the operation's exact confirmation token. `--force` never bypasses confirmation.


## Evidence-Grounded Authenticated Reads

When no specialized Skill exactly matches a one-off authenticated read, Tabwright can combine visible or programmatic page state, observed Network requests and responses, deployed source, public Source Maps, bundles and lazy chunks, Debugger call stacks and runtime values, and optional Wakaru decompilation. The agent decides which of these capabilities are useful for the user's request.

For an authenticated request, identify the target environment and bind inferred behavior to the serving revision or deployed-client fingerprint rather than a branch head or build record. Record the origin, `GET` or `HEAD` method, path, input, required non-credential headers, read-only semantics, opaque browser authentication, and supporting evidence. A changed deployment fingerprint invalidates prior inference; do not guess when the version, route, authentication boundary, or side effect is uncertain.

Navigate a task-owned page to the target origin. Use the site's own in-page request client when it supplies authentication, CSRF, or signatures; otherwise issue `fetch` with observed non-credential headers and `credentials: "include"`. Keep all credentials inside the page, return only the requested data, and verify both the HTTP and application-level result.

Wakaru is available when it helps interpret packed or minified code. Read the Editor API, keep the exact script content inside code, and pass it to the optional local helper. Do not print the raw bundle or execute recovered output:

```js
const cdp = await getCDPSession({ page: state.page })
const editor = createEditor({ cdp })
const script = await editor.readRaw({ url: targetScriptUrl })
const recovered = await decompileJavaScript({ source: script.content, sourceUrl: script.url, level: 'minimal' })
console.log({ sha256: recovered.sha256, outputPath: recovered.outputPath, files: recovered.files })
```

The helper writes under the current project's `.tabwright/artifacts/wakaru/` directory and returns provenance plus paths. It supports `minimal`, `standard`, and `aggressive`; choose the level that fits the task. If a larger script needs a longer helper timeout, set the enclosing execute timeout higher than it.

Only current-account-authorized, client-observable behavior qualifies; artifacts cannot prove hidden server logic or bypass permissions. This transient path is read-only. Never use it for mutations, including endpoints that encode writes behind `GET`; use an independently managed Skill with a machine-enforced runtime contract instead.

## Creating Durable Skills

Keep one-off work transient. When the user asks for reuse, or stable schemas and safety controls justify persistence, create or update a standard Agent Skill directly with the agent's official Skill tooling:

- Put discovery, workflow, and result-display guidance in `SKILL.md`.
- Put schemas, permissions, side effects, confirmation, and authentication in `runtime/capability.json`.
- Put executable behavior in `runtime/script.js`.
- Validate and test the Skill in place; do not copy its runtime into Tabwright storage.

Recent activity and replay indexes may provide authoring evidence, but they are not durable automation by themselves.

## Browser Core Protocol

This skill contains the required core protocol. Do not load the 17k-token extended reference before every browser task. Query it only when the task needs a specialized API:

```bash
# macOS/Linux
tabwright skill | rg -n -C 20 'working with pages|snapshot|iframe'
tabwright skill | rg -n -C 20 'network requests|debugger|live edit'
# Windows PowerShell
tabwright skill | Select-String -Pattern 'working with pages|snapshot|iframe' -Context 20,20
```

Follow this order for browser work:

1. Run `tabwright doctor --json` when connection state is unclear, and follow its exact `next` action.
2. Create a new session for this task. Never reuse an existing session unless the user explicitly handed it to you.
3. Create and retain your own page in `state`. Pages are shared across sessions, but `state` is not.
4. Navigate, inspect logs, then snapshot. Use snapshot search when full output would be large.
5. Copy a role/text/test-id locator from current evidence. Never guess a fixed `aria-ref` from examples or an older snapshot.
6. Perform the smallest action, then verify the resulting URL, visible state, response, or logs.
7. Never call `browser.close()` or `context.close()`. Close only pages you created, and delete your task session when finished.

In sandboxed agent environments, browser/relay commands and `skill runtime run` need immediate elevated or unsandboxed execution because they connect to localhost or write device-local state. `skill runtime validate` is metadata-only and can remain sandboxed.

Use single quotes around `-e` code so the shell does not expand `$`, backticks, or backslashes. Use double quotes for JavaScript strings inside.

## Minimal Browser Example

```bash
tabwright session new
SESSION_ID=2 # replace 2 with the new ID printed above
tabwright -s "$SESSION_ID" -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'
tabwright -s "$SESSION_ID" -e 'console.log(await getLatestLogs({ page: state.page }))'
tabwright -s "$SESSION_ID" -e 'console.log(await snapshot({ page: state.page, search: /learn|more/i }))'
tabwright -s "$SESSION_ID" -e 'console.log(await state.page.getByRole("link", { name: "Learn more" }).getAttribute("href"))'
```

If `tabwright` is not found, use `npx tabwright@latest` or `bunx tabwright@latest`.

If the relay, extension, enabled tab, or session state is unclear, run `tabwright doctor --json` and follow its returned `next` step instead of guessing recovery commands.

`tabwright session new` automatically selects a single connected extension. With multiple profiles, it waits briefly for reconnects to settle and auto-selects only when exactly one has enabled tabs; otherwise choose one of the reported browser keys with `--browser <key>`. A restarted relay is ready after it reports the current or a newer compatible Tabwright package version.
