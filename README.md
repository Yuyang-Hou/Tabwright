---
title: Tabwright
description: Browser debugging and automation tools for AI agents.
prompt: |
  基于 Playwriter，Agent 像前端工程师调试理解网页，不只是 AX 点击；
  工具提供强原语和低成本证据，由 AI 自由选择方法，不增加强制流程。
  Reconcile @tabwright/src/skill.md, @skills/tabwright/SKILL.md, @MCP.md,
  @tabwright/src/editor-examples.ts and @tabwright/src/debugger-examples.ts.
  Keep setup, browser ownership, data boundaries and compatibility accurate.
---

<div align="center">
  <img src="website/public/logo-square.svg" alt="Tabwright" width="112" height="112" />
  <h1>Tabwright</h1>
  <p>Give your agent the browser's debugging tools.</p>
</div>

Tabwright builds on Playwriter's extension and stateful Playwright environment.
It lets GPT and other agents work in your Chrome: inspect the page, follow network
requests, read running code, set breakpoints, test a change, and interact with the
site using your existing login.

The agent chooses the useful tools for the question. A screenshot can explain a
layout problem; a response body or call stack can explain an empty dashboard.
Tabwright supplies those tools through a CLI or MCP, with filtered text, source
excerpts, and local artifacts to keep evidence manageable.

## Get started

The bundled Tabwright Skill also guides discovery, use, creation and maintenance
of page WebMCP tools. No separate Web Code Skill is required. For userscript
persistence and setup, see the [WebMCP guide](./docs/web-code-preview.md).

1. Install the [Chrome extension](https://chromewebstore.google.com/detail/tabwright/dkfhphbajbkplddmchbdgdddioonngep).
2. Install the CLI, open the page you want the agent to use, and click the extension icon.
3. Check the connection and create a session:

```bash
npm install -g tabwright@latest
tabwright doctor
tabwright session new
```

The global CLI installs its matching agent skill into
`~/.agents/skills/tabwright`. Open a new agent task after installation so it can
discover the instructions. If lifecycle scripts were disabled, run
`tabwright skill install`; `tabwright skill status` reports the installed copy.
Use `--target codex` or `--target claude` for an agent-specific directory.
Updates preserve user-modified skill files.

Tell your agent the goal and the page, for example:

> Use Tabwright on my open dashboard. Find out why the chart is empty by
> inspecting whichever page state, requests, or running code helps explain it.

For manual CLI use, set the ID printed by `session new` below. The examples use
Bash/Zsh; in other shells, pass that ID directly to `-s`.

```bash
SESSION_ID=2 # replace 2 with the new session ID
tabwright -s "$SESSION_ID" -e 'console.log(context.pages().map((page) => { return page.url() }))'
```

Choose the page matching the user's request. This example requires one exact
match from the URLs above:

```bash
tabwright -s "$SESSION_ID" -e '
const matches = context.pages().filter((page) => { return page.url() === "https://example.com/dashboard" })
if (matches.length !== 1) throw new Error("Select one enabled tab by its exact URL")
state.page = matches[0]
console.log(await snapshot({ page: state.page }))
'
```

For work that should have its own tab, create one instead. It shares the browser
profile's login state, but not the existing page's unsaved or in-memory state:

```bash
tabwright -s "$SESSION_ID" -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'
```

Each session retains its own `state`, while connected tabs are shared. Other
agents or the user can change those tabs. Keep a reference to the intended page;
close only tabs you created or were asked to close. Use
`tabwright session delete "$SESSION_ID"` when your session is no longer needed.

## Tools the agent can combine

| What helps answer the question         | Available tools                                                            |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Page content and structure             | `snapshot`, scoped DOM queries, `getCleanHTML`, `getPageMarkdown`          |
| Layout and interaction                 | Screenshots, accessibility labels, Playwright locators, mouse and keyboard |
| Failed requests and application errors | `createNetwork`, Playwright request/response events, `getLatestLogs`       |
| Running application code               | `createEditor`, source search, public Source Maps, `createDebugger`        |
| Testing a hypothesis                   | In-memory script/CSS edits, page evaluation, browser interaction           |
| Larger evidence                        | Exact script files cached by content hash, optional local Wakaru analysis  |

These are independent tools, not a prescribed sequence. Filter or scope evidence
when the full page or bundle would add noise. Verify the relevant result after
an action; a click completing does not establish that the business operation
succeeded.

### Page and request evidence

```bash
tabwright -s "$SESSION_ID" -e 'console.log(await snapshot({ page: state.page, search: /chart|error|loading/i }))'
tabwright -s "$SESSION_ID" -e 'console.log(await getLatestLogs({ page: state.page, search: /error|fail/i, count: 20 }))'
```

For request evidence, enable a Network inspector before reproducing the issue,
then filter its summaries:

```bash
tabwright -s "$SESSION_ID" -e 'state.cdp = await getCDPSession({ page: state.page }); state.network = createNetwork({ cdp: state.cdp }); await state.network.enable()'
tabwright -s "$SESSION_ID" -e 'console.log(state.network.list({ search: "/api/chart", limit: 10 }))'
```

Use a `requestId` from the list to inspect its initiator or a bounded response
excerpt. Bodies can contain sensitive application data; request only useful
content:

```js
console.log(state.network.inspect({ requestId: observedRequestId }))
console.log(await state.network.responseBody({ requestId: observedRequestId, limit: 2000 }))
```

Dispose the inspector when finished; it removes its own listeners:

```bash
tabwright -s "$SESSION_ID" -e 'state.network.dispose()'
```

### Running code and breakpoints

```bash
tabwright -s "$SESSION_ID" -e 'state.cdp = await getCDPSession({ page: state.page }); state.editor = createEditor({ cdp: state.cdp }); await state.editor.enable(); console.log(await state.editor.grep({ regex: /chart|loadData/, pattern: /app/ }))'
```

Using a script URL found in that output, read a bounded excerpt or save its exact
content for local search:

```js
console.log(await state.editor.read({ url: scriptUrl, offset: 100, limit: 40 }))
console.log(await state.editor.saveRaw({ url: scriptUrl }))
state.debugger = createDebugger({ cdp: state.cdp })
await state.debugger.enable()
await state.debugger.setBreakpoint({ file: scriptUrl, line: observedLine })
```

The debugger can inspect paused variables and step through calls. The editor can
also make in-memory script or CSS changes; those changes normally disappear on
reload. Look up a relevant API locally without connecting to a browser:

```bash
tabwright docs
tabwright docs network --limit 80
tabwright docs editor --limit 80
tabwright docs debugger --limit 80
```

References also cover `browser`, `styles`, and `performance`. Use `--offset` and
`--limit` for a bounded section, or `--json` for structured output.

## Browser requests and permissions

For authenticated work, use the intended account and environment. Observed
Network traffic, deployed code, and runtime values can establish how a request
works. Use the site's request client or page-context `fetch` when its login,
CSRF, or signatures are needed; keep credentials out of agent output.

Raw Playwright and CDP are powerful execution tools. The calling agent remains
responsible for staying within the user's request and obtaining required
approval for consequential actions. They do not provide account isolation or
enforce application-level read/write permissions. After a possibly submitted
write, check the result before deciding what to do next; do not blindly retry an
unknown outcome.

## How it connects

```text
Agent CLI / MCP → local relay (:19988) → Chrome extension → chrome.debugger
                                                     → connected tabs
```

The default relay runs locally. The agent can use tabs attached through the
extension and create additional tabs in that browser profile. Chrome displays
debugging indicators on controlled tabs. Extension, relay, and CLI negotiate
supported features so older installed extensions can keep using core control.

Websites still receive the requests made in their pages. Content returned by
Tabwright is passed to the calling agent and may be processed by its model
provider. Logs and saved source can
contain page data; handle those artifacts according to the task's needs.

## Other entry points

- [MCP configuration](./MCP.md) for clients that use tools instead of the CLI.
- `tabwright browser start` for a separate Chrome for Testing / Chromium instance.
- `tabwright session new --direct <cdp-url>` for an existing CDP endpoint.
- [Remote access](./docs/remote-access.md) for an explicitly configured remote relay.

## Independent Skills

The user and agent own their business Skills. An instruction file may be enough;
repeatable work can use ordinary JavaScript via `tabwright -s <id> -f <file>`,
or use Node/Python and an official API without Tabwright.

Tabwright supplies browser/debugging primitives, not a Skill registry, business
runtime, credential vault, or recording system. Keep validation and concrete
approval with the business script. See the [independent script guide](./docs/independent-scripts.md)
and [migration notes](./docs/browser-core-migration.md).

## Troubleshooting

`tabwright doctor --json` reports relay, browser, and session
status with a suggested next action. `tabwright logfile` prints the relay log
location. For connection errors, `tabwright session reset <id>` reconnects that
session; check the intended page again afterward.

Known browser limitations include pages appearing as `about:blank` after some
Chrome debugger failures and browser color-scheme changes on connection. Report
reproducible issues in the [repository](https://github.com/Yuyang-Hou/Tabwright/issues).
