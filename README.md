<div align='center'>
    <br/>
    <img src="website/public/logo-square.svg" alt="Tabwright" width="112" height="112" />
    <h1>Tabwright</h1>
    <br/>
    <p>Give any web app a CLI.</p>
    <br/>
</div>

Many important workflows only exist in a website: no public API, protected by SSO, dynamic signatures, or risk controls. Attach Tabwright to a signed-in tab and work normally. An Agent can select the relevant part of your recent activity and turn it into a reusable CLI workflow and Agent Skill with structured inputs, safety rules, and explicit human checkpoints.

Each Skill records how it actually runs: direct request, request inside the browser, real UI interaction, or a hybrid flow that uses the UI to trigger a protected request and the network response as structured output. Users never need to identify the website's verification mechanism themselves.

## Installation

1. [**Install Extension**](https://chromewebstore.google.com/detail/tabwright/dkfhphbajbkplddmchbdgdddioonngep) from Chrome Web Store

2. Click extension icon on a tab → turns green when connected

3. Install the CLI and start automating the browser:

   ```bash
   npm i -g tabwright
   tabwright doctor
   tabwright session new  # copy the new session ID printed by this command
   SESSION_ID=2            # replace 2 with that ID
   tabwright -s "$SESSION_ID" -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'
   ```

Install the Tabwright skill with your agent's official Agent Skills-compatible manager. Skill discovery, updates, and distribution belong to that manager; the CLI provides only browser and capability runtime behavior.

## Quick Start

```bash
tabwright browser start  # starts Chrome for Testing/Chromium with bundled Tabwright extension
tabwright doctor  # checks relay, extension, enabled tabs, sessions, and capabilities
tabwright session new  # creates stateful sandbox, outputs session id (e.g. 1)
SESSION_ID=2  # replace 2 with the ID printed above; never reuse another task's session
tabwright -s "$SESSION_ID" -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'
tabwright -s "$SESSION_ID" -e 'console.log(await snapshot({ page: state.page }))'
# Copy a locator from the snapshot instead of guessing a fixed aria-ref.
tabwright -s "$SESSION_ID" -e 'await state.page.getByRole("link", { name: "Learn more" }).click()'
```

`session new` stays automatic with one connected extension. With multiple profiles, it waits briefly for reconnects to settle and auto-selects only when exactly one profile has enabled tabs; otherwise it prints the available browser keys so you can retry with `--browser <key>`. If the CLI restarts an older relay, it waits for the current or a newer compatible package version before continuing.

> **Tip:** Always use single quotes for `-e` to prevent bash from interpreting `$`, backticks, and `\` in your JS code. Use double quotes for strings inside the JS.

## Recent Activity to CLI Workflow

Attaching a tab keeps a rolling local activity stream. Nothing needs to be saved in advance. When the Agent needs to understand something you just did, it can inspect the recent timeline and copy only the relevant event range into a replay:

```bash
tabwright activity list --json
tabwright activity inspect --last 5m --json
tabwright activity save --from <timestamp> --to <timestamp> --json
```

Saving creates a replay copy; observation continues without interruption. With multiple attached tabs, pass the `sessionId` returned by `activity list` using `--session`.

Then inspect the saved evidence and turn it into a runnable draft capability:

```bash
tabwright replay list --limit 10 --json
tabwright replay index <replay-id> --json
tabwright replay make <replay-id> <capability-id> --force --goal "add the requested list item" --json
# Generated workflows are browser writes. Stop for explicit user approval first.
tabwright capability run <capability-id> --browser user --force --confirm <capability-id> --input-json '{"value":"test3"}' --json
```

`replay index --json` omits bulky page text and interactive-element arrays while preserving actions, fields, annotations, warnings, and selector hints. Add `--full` when an AI needs the complete evidence. `replay make` returns `status: "compiled"` when it writes a draft. If the deterministic compiler does not recognize the workflow, it returns `status: "needs_ai"`, writes no placeholder capability, and provides exact `next.inspectCommand` and `next.createCommand` handoff commands.

### Replay Workflow Self-Test

Tabwright can evaluate the recording-to-capability product loop locally:

```bash
tabwright replay eval
tabwright replay eval --json
tabwright replay eval --report tmp/replay-eval-report.html --keep-artifacts
```

The suite creates local example pages, writes rrweb recordings, builds AI indexes, compiles draft capabilities, runs the generated scripts in a real browser, and verifies the final page/request result. Use it before changing replay recording, replay indexing, workflow compilation, or generated capability scripts.

## Share Capabilities

For mainstream agents, export a portable Agent Skill and distribute it with the agent's official skill or plugin manager:

```bash
tabwright capability skill export my-capability --output ./skills/my-capability
# edit or refine the exported SKILL.md with the agent's official skill tooling
```

The exported directory contains a standard `SKILL.md`, optional `agents/openai.yaml`, and the machine-enforced Tabwright contract and entry script under `runtime/`. A fresh agent resolves that runtime relative to `SKILL.md` and executes it directly; it is never copied into a CLI capability directory. Agent-managed runtimes are ready on first run. Tabwright stores only device-local authentication, disable/quarantine state, run history, and artifacts under `~/.tabwright/capability-state/<id>/`.

Cookie-authenticated capabilities refresh their declared browser authentication automatically when a run needs it. Cookie values stay in the capability's local `secrets.json` and are never shown in the extension Options page. The read-only **Tabwright Skills** view discovers compatible skills installed by Codex, Claude, and other Agent Skills managers, uses each installed `SKILL.md` for its user-facing purpose, deduplicates the same capability across managers, and shows only safe local runtime summaries such as readiness, recent runs, and artifact counts. Set `TABWRIGHT_SKILL_DIRS` with platform-delimited extra skill roots when a manager uses a custom directory.

## CLI Usage

Each session has **isolated state**. Browser tabs are **shared** across sessions.

```bash
# Browser management
tabwright browser start             # auto-finds Chrome for Testing or Chromium
tabwright browser start /path/to/browser-binary

# Session management
tabwright session new              # creates stateful sandbox, outputs id (e.g. 1)
tabwright session list             # show sessions + state keys
tabwright session reset <id>       # fix connection issues

# Execute (always use -s)
tabwright -s 1 -e 'await page.goto("https://example.com")'
tabwright -s 1 -e 'await page.click("button")'
tabwright -s 1 -e 'console.log(await page.title())'
```

Create your own page to avoid interference from other agents:

```bash
tabwright -s 1 -e 'state.myPage = await context.newPage(); await state.myPage.goto("https://example.com")'
```

Multiline:

```bash
tabwright -s 1 -e $'
const title = await page.title();
console.log({ title, url: page.url() });
'
```

## Examples

Variables in scope: `page`, `context`, `state` (persists between calls), `require`, and Node.js globals.

**Persist data in state:**

```bash
tabwright -s 1 -e "state.users = await page.$$eval('.user', els => els.map(e => e.textContent))"
tabwright -s 1 -e "console.log(state.users)"
```

**Intercept network requests:**

```bash
tabwright -s 1 -e "state.requests = []; page.on('response', r => { if (r.url().includes('/api/')) state.requests.push(r.url()) })"
tabwright -s 1 -e "await Promise.all([page.waitForResponse(r => r.url().includes('/api/')), page.click('button')])"
tabwright -s 1 -e "console.log(state.requests)"
```

**Set breakpoints and debug:**

```bash
tabwright -s 1 -e "state.cdp = await getCDPSession({ page }); state.dbg = createDebugger({ cdp: state.cdp }); await state.dbg.enable()"
tabwright -s 1 -e "state.scripts = await state.dbg.listScripts({ search: 'app' }); console.log(state.scripts.map(s => s.url))"
tabwright -s 1 -e "await state.dbg.setBreakpoint({ file: state.scripts[0].url, line: 42 })"
```

**Live edit page code:**

```bash
tabwright -s 1 -e "state.cdp = await getCDPSession({ page }); state.editor = createEditor({ cdp: state.cdp }); await state.editor.enable()"
tabwright -s 1 -e "await state.editor.edit({ url: 'https://example.com/app.js', oldString: 'const DEBUG = false', newString: 'const DEBUG = true' })"
```

**Screenshot with labels:**

```bash
tabwright -s 1 -e "await screenshotWithAccessibilityLabels({ page })"
```

## MCP Setup

Using the CLI with the skill (step 4 above) is the recommended approach. For direct MCP server configuration, see [MCP.md](./MCP.md).

## Visual Labels

Vimium-style labels for AI agents to identify elements:

```javascript
await screenshotWithAccessibilityLabels({ page })
// Returns screenshot + accessibility snapshot with aria-ref selectors
await page.locator('aria-ref=e5').click()
```

Color-coded: yellow=links, orange=buttons, coral=inputs, pink=checkboxes, peach=sliders, salmon=menus, amber=tabs.

## Comparison

### vs Playwright MCP

|                         | Playwright MCP                         | Tabwright                                      |
| ----------------------- | -------------------------------------- | ---------------------------------------------- |
| Existing signed-in tabs | Supported with its browser extension   | Supported with per-tab extension control       |
| Product boundary        | Browser tools for the current task     | Browser runtime plus reusable Agent Skills      |
| Workflow contract       | Agent prompt or external code          | Inputs, outputs, safety, auth, execution method |
| Protected requests      | Operate the page                       | UI trigger + structured network result          |
| Human verification      | Calling agent handles it               | Explicit resumable `needs_human` checkpoint     |
| Distribution            | MCP configuration                      | Portable Agent Skill                            |

|                    | Playwright CLI                 | Tabwright                                  |
| ------------------ | ------------------------------ | ------------------------------------------ |
| Primary use         | Browser tests and one-off commands | Reusable tools for agent workflows     |
| Existing browser    | Depends on connection mode     | Per-tab signed-in Chrome control           |
| Durable contract    | Test or script                  | Skill intent, schemas, safety, auth, execution |
| Human checkpoints  | Implement in the caller         | Standard `needs_human` result              |
| Agent distribution | Share scripts/configuration     | Export a portable Agent Skill              |
| Raw CDP helpers     | Not the main CLI surface        | Built-in debugging and inspection helpers |

### vs BrowserMCP

|               | BrowserMCP          | Tabwright               |
| ------------- | ------------------- | ------------------------ |
| Tools         | 12+ dedicated tools | 1 `execute` tool         |
| API           | Limited actions     | Full Playwright          |
| Context usage | High (tool schemas) | Low                      |
| LLM knowledge | Must learn tools    | Already knows Playwright |

### vs Antigravity (Jetski)

|          | Jetski                       | Tabwright       |
| -------- | ---------------------------- | ---------------- |
| Tools    | 17+ tools                    | 1 tool           |
| Subagent | Spawns for each browser task | Direct execution |
| Latency  | High (agent overhead)        | Low              |

### vs Claude Browser Extension

|                      | Claude Extension     | Tabwright              |
| -------------------- | -------------------- | ----------------------- |
| Agent support        | Claude only          | Any MCP client          |
| Windows WSL          | No                   | Yes                     |
| Context method       | Screenshots (100KB+) | A11y snapshots (5-20KB) |
| Playwright API       | No                   | Full                    |
| Debugger/breakpoints | No                   | Yes                     |
| Live code editing    | No                   | Yes                     |
| Network interception | Limited              | Full                    |
| Raw CDP access       | No                   | Yes                     |

### vs Built-in Chrome CDP (`--remote-debugging-port`)

|                       | Built-in CDP                          | Tabwright                   |
| --------------------- | ------------------------------------- | ---------------------------- |
| Setup                 | Restart Chrome with special flags     | Click extension icon         |
| Confirmation dialog   | Shows automation infobar agents can't dismiss | No blocking dialog   |
| Autonomous agents     | Interrupted by debug banners          | Fully autonomous             |
| User disruption       | Banners appear mid-workflow           | Silent — no interruption     |
| Existing session      | Must relaunch Chrome (lose state)     | Uses your running browser    |

> Chrome's `--remote-debugging-port` flag shows a persistent "controlled by automated software" banner that agents cannot dismiss. It pops up in the middle of your workflow whenever you're using the browser. Tabwright runs silently — agents work autonomously without any confirmation dialogs, so you're never interrupted.

## Architecture

```
+---------------------+     +-------------------+     +-----------------+
|   BROWSER           |     |   LOCALHOST       |     |   MCP CLIENT    |
|                     |     |                   |     |                 |
|  +---------------+  |     | WebSocket Server  |     |  +-----------+  |
|  |   Extension   |<--------->  :19988         |     |  | AI Agent  |  |
|  +-------+-------+  | WS  |                   |     |  +-----------+  |
|          |          |     |  /extension       |     |        |        |
|    chrome.debugger  |     |       |           |     |        v        |
|          v          |     |       v           |     |  +-----------+  |
|  +---------------+  |     |  /cdp/:id <--------------> |  execute  |  |
|  | Tab 1 (green) |  |     +-------------------+  WS |  +-----------+  |
|  | Tab 2 (green) |  |                               |        |        |
|  | Tab 3 (gray)  |  |     Tab 3 not controlled      |  Playwright API |
+---------------------+     (no extension click)      +-----------------+
```

## Remote Access

Control Chrome on a remote machine over the internet using [traforo](https://traforo.dev) tunnels:

**On host:**

```bash
npx -y traforo -p 19988 -t my-machine -- npx -y tabwright serve --token <secret>
```

**From remote:**

```bash
export TABWRIGHT_HOST=https://my-machine-tunnel.traforo.dev
export TABWRIGHT_TOKEN=<secret>
tabwright -s 1 -e 'await page.goto("https://example.com")'
```

Also works on a LAN without traforo (`TABWRIGHT_HOST=192.168.1.10`). Full guide with use cases (remote Mac mini, user support, multi-machine control): [docs/remote-access.md](./docs/remote-access.md)

## Security

- **Local only**: WebSocket server on `localhost:19988`
- **Origin validation**: Only our extension IDs allowed (browsers can't spoof Origin)
- **Explicit consent**: Only tabs where you clicked the extension icon
- **Visible automation**: Chrome shows automation banner on controlled tabs
- **No remote access**: Malicious websites cannot connect

## Playwright API

Connect programmatically (without CLI):

```typescript
import { chromium } from 'playwright-core'
import { startTabwrightCDPRelayServer, getCdpUrl } from 'tabwright'

const server = await startTabwrightCDPRelayServer()
const browser = await chromium.connectOverCDP(getCdpUrl())
const page = browser.contexts()[0].pages()[0]

await page.goto('https://example.com')
await page.screenshot({ path: 'screenshot.png' })
// Don't call browser.close() - it closes the user's Chrome
server.close()
```

Or connect to a running server:

```bash
npx -y tabwright serve --host 127.0.0.1
```

```typescript
const browser = await chromium.connectOverCDP('http://127.0.0.1:19988')
```

## Troubleshooting

Start with the readiness check. It reports relay, extension, enabled-tab, session, and capability status, then prints the single best next step:

```bash
tabwright doctor
tabwright doctor --json  # machine-readable output for agents and support tools
```

View relay server logs to debug issues:

```bash
tabwright logfile  # prints the log file path
# typically: ~/.tabwright/relay-server.log
```

The relay log contains extension, MCP and WebSocket server logs. A separate CDP JSONL log is also created alongside it (see `tabwright logfile`). Both are recreated on each server start.

Example: summarize CDP traffic counts by direction + method:

```bash
jq -r '.direction + "\t" + (.message.method // "response")' ~/.tabwright/cdp.jsonl | uniq -c
```

## Support

If Tabwright is useful to you, consider [sponsoring the project](https://github.com/sponsors/remorses).

## Known Issues

- If all pages return `about:blank`, restart Chrome (Chrome bug in `chrome.debugger` API)
- Browser may switch to light mode on connect ([Playwright issue](https://github.com/microsoft/playwright/issues/37627))
