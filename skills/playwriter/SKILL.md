---
name: playwriter
description: Control the user own Chrome browser via Playwriter extension with Playwright code snippets in a stateful local js sandbox. Use this over other Playwright MCPs to automate the browser because it connects to the user's existing Chrome. Use this for JS-heavy websites, logged-in browser state, saved browser capabilities, and admin/config lookup tasks where saved capability match/routingHint metadata may apply. ALWAYS load this skill before using any playwriter commands, opening admin/config URLs, or answering how to inspect saved Playwriter capabilities.
---

## Fast Path: Saved Capability Exact Matches

For concrete user tasks, check saved capability contracts before browser automation. If a capability has `routingHint: "exact-match-direct-run"`, its `match` patterns exactly fit the task, and it is autonomously runnable (`trusted`, read-only, no confirmation), run it directly with the extracted input:

```bash
playwriter capability run <capability-id> --input-json '<json-input>' --json
```

Do not search, describe, or open a page first for these exact matches. Do not treat every URL as a direct-run signal; this shortcut only applies when capability metadata says so, and it can also apply to non-URL tasks with exact `match` patterns.

If execution is disallowed and the user only asks what the first step would be, say that you would use the matching capability directly and show the exact `playwriter capability run ...` command.

If the exact-match capability index is not already visible, use one lightweight route check as the first step:

```bash
playwriter capability route "<task-or-url>" --json
```

When using route output, run the returned `shellCommand` exactly. Do not infer a shell command from the capability id; capability ids are not shell commands.

Do not use `capability search` or `capability describe` for an exact-match direct-run candidate.

In Codex sandboxed environments, `playwriter capability run ...` writes the capability run log and may write artifacts under `~/.playwriter/capabilities/...`. Run trusted capability commands with escalated/unsandboxed permissions immediately instead of trying once in the sandbox and then retrying. `playwriter capability route ... --json` is metadata-only and can run sandboxed.

Capability-specific usage and display rules belong in that capability's own agent skill, not in this general Playwriter skill.

If a described capability has `requiresConfirmation: true`, stop and obtain explicit user approval for the concrete input and side effect. Only after approval may you run it with `--confirm <capability-id>`. The value must exactly match the capability id, and `--force` never bypasses this gate.

## Creating Saved Capabilities

When an AI is creating or refining a saved capability, put machine-readable behavior in the capability contract and executable behavior in `script.js`. Create a capability-specific agent skill only for high-frequency, exact-match, easy-to-misuse, auth-sensitive, or display-sensitive capabilities.

Use the CLI to scaffold and install, but do not treat generated scaffold text as final prose:

```bash
playwriter capability skill init <capability-id>
# edit the generated SKILL.md with the real workflow and display rules
playwriter capability skill install <capability-id>
```

`capability skill install` refuses untouched scaffold templates. Simple capabilities usually need only a good contract, not a separate agent skill.

## Sharing Saved Capabilities

When the user asks to package, share, export, or install a saved capability, use the capability package commands directly:

```bash
playwriter capability pack <capability-id>
playwriter capability install ./<capability-id>.tgz
playwriter capability install https://example.com/<capability-id>.tgz
```

`capability pack` includes only the manifest, entry script, optional README, and optional agent skills. It excludes `secrets.json`, `runs.jsonl`, and `artifacts/`. Shared capabilities always install as `draft`. Do not trust one until its contract and script have been inspected and it has passed a `capability run --force` validation. Authentication must be refreshed from the recipient's own browser. Packaged agent skills are not installed unless the user explicitly passes `--with-agent-skill` or later runs `capability skill install <capability-id>`.

## Replay-to-Capability Handoff

Turn a saved user demonstration into a capability through the CLI contract:

```bash
playwriter replay list --limit 10 --json
playwriter replay index <replay-id> --json
playwriter replay make <replay-id> <capability-id> --force --goal '<goal>' --json
```

`replay index --json` is compact by default; add `--full` only when complete page text and interactive-element evidence is needed. `replay make` returns `status: "compiled"` after writing a draft. An unsupported workflow returns `status: "needs_ai"`, writes no fake capability, and supplies exact `next.inspectCommand` and `next.createCommand` commands. Follow that handoff instead of inventing a workflow.

Generated workflows are draft browser writes. Inspect them and obtain explicit user approval before running the exact returned command, which must include `--browser user --force --confirm <capability-id> --json`:

```bash
playwriter capability run <capability-id> --browser user --force --confirm <capability-id> --input-json '<json-input>' --json
```

## Browser Core Protocol

This skill contains the required core protocol. Do not load the 17k-token extended reference before every browser task. Query it only when the task needs a specialized API:

```bash
# macOS/Linux
playwriter skill | rg -n -C 20 'working with pages|snapshot|iframe'
playwriter skill | rg -n -C 20 'network requests|debugger|live edit'
# Windows PowerShell
playwriter skill | Select-String -Pattern 'working with pages|snapshot|iframe' -Context 20,20
```

Follow this order for browser work:

1. Run `playwriter doctor --json` when connection state is unclear, and follow its exact `next` action.
2. Create a new session for this task. Never reuse an existing session unless the user explicitly handed it to you.
3. Create and retain your own page in `state`. Pages are shared across sessions, but `state` is not.
4. Navigate, inspect logs, then snapshot. Use snapshot search when full output would be large.
5. Copy a role/text/test-id locator from current evidence. Never guess a fixed `aria-ref` from examples or an older snapshot.
6. Perform the smallest action, then verify the resulting URL, visible state, response, or logs.
7. Never call `browser.close()` or `context.close()`. Close only pages you created, and delete your task session when finished.

In sandboxed agent environments, browser/relay commands need immediate elevated or unsandboxed execution because they connect to localhost and may update session state. Metadata-only `capability route/search/describe` commands can remain sandboxed.

Use single quotes around `-e` code so the shell does not expand `$`, backticks, or backslashes. Use double quotes for JavaScript strings inside.

## Minimal Browser Example

```bash
playwriter session new
SESSION_ID=2 # replace 2 with the new ID printed above
playwriter -s "$SESSION_ID" -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'
playwriter -s "$SESSION_ID" -e 'console.log(await getLatestLogs({ page: state.page }))'
playwriter -s "$SESSION_ID" -e 'console.log(await snapshot({ page: state.page, search: /learn|more/i }))'
playwriter -s "$SESSION_ID" -e 'console.log(await state.page.getByRole("link", { name: "Learn more" }).getAttribute("href"))'
```

If `playwriter` is not found, use `npx playwriter@latest` or `bunx playwriter@latest`.

If the relay, extension, enabled tab, or session state is unclear, run `playwriter doctor --json` and follow its returned `next` step instead of guessing recovery commands.

`playwriter session new` automatically selects a single connected extension. With multiple profiles, it waits briefly for reconnects to settle and auto-selects only when exactly one has enabled tabs; otherwise choose one of the reported browser keys with `--browser <key>`. A restarted relay is ready after it reports the current or a newer compatible Playwriter package version.
