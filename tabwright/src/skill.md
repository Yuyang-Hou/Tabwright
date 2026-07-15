## CLI Usage

This file is the extended reference. The installed Tabwright skill contains the required compact browser protocol; agents should not load this entire reference before every task. Query only the relevant topic when needed, for example `tabwright skill | rg -n -C 20 'working with pages|snapshot|iframe'` on macOS/Linux or `tabwright skill | Select-String -Pattern 'working with pages|snapshot|iframe' -Context 20,20` in Windows PowerShell.

If `tabwright` command is not found, install globally or use npx/bunx:

```bash
npm install -g tabwright@latest
# or use without installing:
npx tabwright@latest session new
bunx tabwright@latest session new
```

If using npx or bunx always use @latest for the first session command. so we are sure of using the latest version of the package

Install the agent skill bundled with the same CLI build. Do not fetch it from a separate repository, because fork-specific behavior may differ:

```bash
tabwright skill status --target codex
tabwright skill install --target codex
# after a CLI upgrade, use --force only when status reports an outdated installed copy
tabwright skill install --target codex --force
```

The install command writes to `$CODEX_HOME/skills/tabwright/SKILL.md`, or `~/.codex/skills/tabwright/SKILL.md` when `CODEX_HOME` is unset. Open a new agent thread after installation. `tabwright doctor` reports a missing or outdated Tabwright skill and prints the exact repair command.

### Capability routing shortcuts

For concrete user tasks, first check saved capability contracts. When a capability or one of its operations has `routingHint: "exact-match-direct-run"`, its `match` patterns exactly fit the task, and that operation's `autonomousInvocation.allowed` is true (`trusted`, `sideEffect: "read"`, `requiresConfirmation: false`), run it directly with the extracted input. Routed operation inputs include `action`. Do not search, describe, or open a page first.

If the exact-match capability index is not already visible in the current skill or tool context, use `tabwright capability route "<task-or-url>" --json` as the metadata check. Do not use `capability search` or `capability describe` for an exact-match direct-run candidate.

When using route output, run the returned `shellCommand` exactly. Do not infer a shell command from the capability id; capability ids are not shell commands.

In Codex sandboxed environments, `tabwright capability run ...` writes the capability run log and may write artifacts under `~/.tabwright/capabilities/...`. Run trusted capability commands with escalated/unsandboxed permissions immediately instead of trying once in the sandbox and then retrying. `tabwright capability route ... --json` is metadata-only and can run sandboxed.

Do not treat every URL as a direct-run signal. This shortcut only applies to exact capability matches, and it also applies to non-URL tasks when a capability's `match` patterns are specific enough. Capability-specific usage and display rules belong in that capability's own agent skill, not in this general Tabwright skill. If there is no exact match, use `capability search` and `capability describe` before running or creating new automation.

### Sandboxed agent environments

Tabwright controls the real user browser through a local relay on `127.0.0.1:19988`. If you are running inside an agent sandbox that restricts localhost access, use that environment's elevated/unsandboxed command mode for Tabwright commands that create sessions, list browsers, run `-s ... -e ...`, run browser-backed capabilities, or read relay logs. Do this immediately for Tabwright browser/relay commands instead of first trying a sandboxed command and diagnosing the relay as broken.

### Session management

If setup state is unclear, run `tabwright doctor` first. It checks the relay, Chrome extension, enabled tabs, active sessions, and visible capabilities, then prints one next action. Agents may use `tabwright doctor --json` to consume the same result without parsing terminal formatting. Existing sessions may belong to another task: create a new session unless the user explicitly handed you one.

Each session runs in an **isolated sandbox** with its own `state` object. Use sessions to:

- Keep state separate between different tasks or agents
- Persist data (pages, variables) across multiple execute calls
- Avoid interference when multiple agents use tabwright simultaneously

Get a new session ID to use in commands:

```bash
tabwright session new
# outputs: 1
```

`session new` automatically uses the only connected extension. When multiple extension profiles reconnect, it waits briefly for the set to settle and auto-selects only if exactly one profile has enabled tabs. Otherwise, use a key printed in the error or by `tabwright browser list`, then retry with `tabwright session new --browser <key>`. After replacing an older relay, Tabwright waits until the relay reports the current or a newer compatible package version before creating the session.

**Always use your own session** - pass `-s <id>` to all commands. Using the same session preserves your `state` between calls. Using a different session gives you a fresh `state`.

List all active sessions with their state keys:

```bash
tabwright session list
# ID  State Keys
# --------------
# 1   myPage, userData
# 2   -
```

Reset a session if the browser connection is stale or broken:

```bash
tabwright session reset <sessionId>
```

### Remote access (control browser from another machine)

Tabwright can control a Chrome browser running on a different machine over the internet. The host machine runs `tabwright serve` with a [traforo](https://traforo.dev) tunnel, and the remote machine connects through the tunnel URL.

```bash
# Host machine (has Chrome + extension)
npx -y traforo -p 19988 -- npx -y tabwright serve --token MY_SECRET_TOKEN

# Remote machine
export TABWRIGHT_HOST=https://<tunnel-id>-tunnel.traforo.dev
export TABWRIGHT_TOKEN=MY_SECRET_TOKEN
tabwright session new
tabwright -s 1 -e "await page.goto('https://example.com')"
```

For the full guide (Docker, LAN, MCP config, security), see: https://playwriter.dev/docs/remote-access

### Direct CDP connection (no extension needed)

Tabwright can connect directly to a Chrome instance via the Chrome DevTools Protocol, bypassing the browser extension entirely. This is useful for:

- Chrome running with remote debugging enabled (CI, Docker, headless environments)
- Cloud browser providers that expose a CDP endpoint (e.g. `wss://xxx.cdp.browser-use.com`)
- Any service or machine that gives you a `ws://` or `wss://` URL to a Chrome DevTools session

**Prerequisites:** you need a CDP-enabled Chrome. Either:

- Open `chrome://inspect/#remote-debugging` in Chrome
- Launch Chrome with `--remote-debugging-port=9222`
- Use `tabwright browser start` (enables debugging automatically)
- Use a cloud browser provider URL (no local Chrome needed)

**CLI usage:**

```bash
# Auto-discover local Chrome instances with debugging enabled
tabwright session new --direct

# Connect to a specific CDP endpoint (local or cloud browser provider)
tabwright session new --direct ws://localhost:9222/devtools/browser/...
tabwright session new --direct wss://xxx.cdp.browser-use.com

# Connect to a remote Chrome instance (host:port auto-resolves to ws://)
tabwright session new --direct 192.168.1.50:9222

# Then use the session normally
tabwright -s 1 -e "await page.goto('https://example.com')"
```

**MCP configuration** (for AI assistants): set the `TABWRIGHT_DIRECT` env var in your MCP client config. If the user provides a CDP URL (like `wss://xxx.cdp.browser-use.com`), use it as the value:

```json
{
  "mcpServers": {
    "tabwright": {
      "command": "npx",
      "args": ["-y", "tabwright@latest"],
      "env": {
        "TABWRIGHT_DIRECT": "wss://xxx.cdp.browser-use.com"
      }
    }
  }
}
```

`TABWRIGHT_DIRECT` accepts:

- `1` — auto-discover Chrome on port 9222
- `ws://` or `wss://` URL — explicit WebSocket endpoint (local or cloud browser provider)
- `host:port` — resolves via HTTP probe to a ws:// URL

**Limitations:** DOM replay recording (`replay.start`/`replay.stop`) requires the Tabwright extension. Direct CDP mode can still execute browser automation, but it cannot collect extension-side rrweb replay files.

### Headless browser (no extension, no user browser)

Launch a headless Chrome automatically. No extension setup, no user browser involvement. Useful when the user doesn't want their personal browser used, in CI/server environments, or for fully autonomous automation.

```bash
# Install Chrome for Testing (first time only, if no Chrome is available)
tabwright browser install

# Launch headless Chrome and create a session
tabwright session new --browser headless

# Use the session normally
tabwright -s 1 -e "await page.goto('https://example.com')"
tabwright -s 1 -e "console.log(await snapshot({ page }))"
```

Multiple sessions reuse the same headless Chrome process. Extension-side replay recording is not available in headless mode.

If no Chrome binary is found, `tabwright session new --browser headless` will tell you to run `tabwright browser install` first to download Chrome for Testing.

### Cloud browsers (stealth, proxies, CAPTCHA solving)

Cloud browsers are full Chromium instances running in the cloud. They work exactly like a local Chrome session but with stealth and anti-detection built in. No local Chrome or extension needed.

**When to use cloud browsers:**

- **CAPTCHA bypass.** Cloudflare Turnstile, reCAPTCHA v2/v3, and hCaptcha are solved automatically via token injection. No API keys, no manual solving, no extra code.
- **Anti-detection.** Stealth Chromium patches remove `navigator.webdriver`, CDP leak fingerprints, and other automation signals. Sites that block Playwright, Puppeteer, or Selenium work normally.
- **Residential proxies.** Route traffic through residential IPs in 195+ countries with `--proxy <region>`. Proxy is disabled by default to save cost; enable it only when you need anti-detection or geo-targeting.
- **VPS and headless environments.** Run browser automation from any server without installing Chrome. The cloud browser runs remotely and you connect via CDP.
- **Parallel execution.** Spin up multiple cloud browsers to run tasks in parallel with subagents. Each browser is an isolated instance with its own IP, fingerprint, and cookie jar.
- **Multiple identities.** Control separate logged-in accounts on the same site simultaneously. Each cloud browser has independent cookies and storage, so sessions don't interfere with each other.

**Authentication:** two options depending on your environment.

```bash
# Option 1: Interactive login (opens browser for OAuth)
tabwright cloud login

# Option 2: API key (for CI, VPS, headless — no browser needed)
# Create one at https://playwriter.dev/dashboard, then:
export TABWRIGHT_API_KEY=pw_xxxxx
```

```bash
# Check active cloud sessions
tabwright cloud status

# Start a cloud browser session (no proxy, cheapest)
tabwright session new --browser cloud

# Start with US residential proxy (for anti-detection / geo-targeting)
tabwright session new --browser cloud --proxy us

# Use a different region
tabwright session new --browser cloud --proxy de

# Use a custom proxy
tabwright session new --browser cloud --custom-proxy user:pass@host:8080
```

Cloud sessions auto-stop after 10 minutes of inactivity. When proxy is enabled, raster images are blocked by default to reduce bandwidth costs. Pass `--disable-proxy-bandwidth-acceleration` if you need images to load.

### Execute code

```bash
tabwright -s <sessionId> -e "<code>"
```

The `-s` flag specifies a session ID (required). Get one with `tabwright session new`. Use the same session to persist state across commands.

**Examples:**

```bash
# Navigate to a page
tabwright -s 1 -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'

# Click a button
tabwright -s 1 -e 'await state.page.click("button")'

# Get page title
tabwright -s 1 -e 'await state.page.title()'

# Take a screenshot
tabwright -s 1 -e 'await state.page.screenshot({ path: "/absolute/path/to/screenshot.png", scale: "css" })'

# Get accessibility snapshot
tabwright -s 1 -e 'await snapshot({ page: state.page })'

# Get accessibility snapshot for a specific iframe
tabwright -s 1 -e 'const frame = await state.page.locator("iframe").contentFrame(); await snapshot({ frame })'
```

**Why single quotes?** Always wrap `-e` code in single quotes (`'...'`) to prevent bash from interpreting `$`, backticks, and other special characters inside your JS code. Use double quotes or backtick template literals for strings inside the JS code.

**Multiline code:**

```bash
# Preferred: use heredoc with quoted delimiter (disables all bash expansion)
tabwright -s 1 -e "$(cat <<'EOF'
const links = await state.page.$$eval('a', els => els.map(e => e.href));
console.log('Found', links.length, 'links');
const price = text.match(/\$[\d.]+/);
EOF
)"

# Alternative: $'...' syntax (but beware: \n and \t become special, and
# single quotes inside must be escaped as \')
tabwright -s 1 -e $'
const title = await state.page.title();
const url = state.page.url();
console.log({ title, url });
'
```

**Quoting rules summary:**
- **Single quotes** (`'...'`): best for one-liners. No bash expansion at all. But you cannot include a literal single quote inside — use double quotes for JS strings instead.
- **Heredoc** (`<<'EOF'`): best for multiline code. The quoted `'EOF'` delimiter disables all bash expansion. Any character works inside, including `$`, backticks, and single quotes.
- **`$'...'`**: allows `\'` escaping but `\n`, `\t`, `\\` become special — conflicts with JS regex patterns.

### Execute from file

For longer scripts, use `-f` instead of `-e` to execute JavaScript from a file:

```bash
tabwright -s 1 -f script.js
```

The file is read from disk and executed in the same sandbox as `-e`. All context variables (`state`, `page`, `context`, etc.) are available. `-e` and `-f` cannot be used together.

### Saved capabilities

Saved capabilities are reusable Tabwright scripts with metadata, AI-readable intent, input schema, output schema, auth policy, trust status, and run logs. Use them to preserve repeated workflows such as querying a user in an admin console or calling a page-backed API without reopening Chrome.

Before writing new browser automation, search whether a saved capability already exists:

```bash
tabwright capability list
tabwright capability route "current bilibili account"
tabwright capability search "current bilibili account"
tabwright capability describe bilibili-current-user --json
tabwright capability show query-user
```

Create and edit capabilities. Use `--runtime node` for API/HTTP capabilities that can run without a browser. Use `--contract-file` to update the AI-readable contract (`whenToUse`, `whenNotToUse`, `sideEffect`, `auth`, schemas, examples, tags).

```bash
tabwright capability create query-user --project --title "Query user"
tabwright capability create bilibili-current-user --runtime node --title "Bilibili Current User"
tabwright capability update query-user --from-file script.js
tabwright capability update bilibili-current-user --contract-file contract.json
tabwright capability trust query-user
```

Share a user-authored capability as a sanitized `.tgz`, or install it directly from a directory or HTTPS `.tgz` URL:

```bash
tabwright capability pack query-user
tabwright capability install ./query-user.tgz
tabwright capability install ../shared-capabilities/query-user --project
tabwright capability install https://example.com/query-user.tgz
```

Capability packages contain only `capability.json`, the configured entry script, optional `README.md`, and optional `agent-skills/`. The pack command excludes `secrets.json`, `runs.jsonl`, and `artifacts/`. A shared capability always installs as `draft`, even if its author trusted it locally. Inspect its contract and script, refresh auth with the recipient's own browser session when needed, validate it with `capability run --force`, and only then trust it. Packaged agent skills are not installed by default because they influence agent behavior; review one and run `capability skill install <id>`, or explicitly pass `--with-agent-skill`. Bundled suites such as `conan-config` remain installable by name and may be trusted by the publisher; use `--skip-agent-skills` for built-in suites.

When an AI is turning a user workflow into a durable capability, keep these responsibilities separate:

- Put machine-readable behavior in the capability contract: `match`, `routingHint`, schemas, `sideEffect`, `requiresConfirmation`, `auth`, and examples. For a capability with multiple safety boundaries, define `operations` keyed by `input.action`; each operation owns its match/routing metadata, schemas, permissions, side effect, and confirmation requirement.
- Put executable behavior in `script.js`.
- Put capability-specific agent instructions in an agent skill only when the capability is high-frequency, easy to misuse, has exact-match routing, needs auth/sandbox guidance, or needs nontrivial output/display rules.
- Do not rely on the CLI to write final skill prose. The CLI only scaffolds and installs; the AI that learned the workflow must edit the skill content.

Create an editable agent skill scaffold only when the capability needs one:

```bash
tabwright capability skill init query-user
# edit .tabwright/capabilities/query-user/agent-skills/codex/SKILL.md
tabwright capability skill show query-user
tabwright capability skill install query-user
```

`capability skill install` refuses to install the untouched scaffold marker. Before installing, the AI should write: when to use the capability, when not to use it, the first command or route workflow, auth/sandbox notes, and the default output/display discipline. Simple capabilities usually do not need an agent skill; a strong contract is enough.

Run a capability with structured JSON input. `node` runtime capabilities run locally without opening Chrome. `browser` runtime capabilities create a headless session by default when `-s` is omitted; use `--browser user` when the capability needs the user's logged-in Chrome session.

If the selected operation has `requiresConfirmation: true`, stop and obtain explicit user approval for the concrete input and side effect. Only then rerun with its exact `confirmationToken`, typically `--confirm <capability-id>:<operation>`. Capabilities without operations continue to use `--confirm <capability-id>`. `--force` never bypasses this gate.

```bash
tabwright capability run query-user --input-json '{"email":"a@example.com"}' --json
tabwright capability run query-user -s 1 --input-json '{"email":"a@example.com"}'
tabwright capability run query-user --browser user --input-json '{"email":"a@example.com"}'
tabwright capability run update-user --browser user --input-json '{"email":"a@example.com"}' --confirm update-user
tabwright capability run bilibili-current-user --json
```

When multiple Chrome extension connections exist, pass a browser key from `tabwright browser list` instead of `user`.

When turning a user demonstration into a repeatable workflow, do not analyze during recording. Keep the recording/replay id as evidence, then generate a draft browser capability only after the user gives the id plus a concrete goal. Generated workflow scripts should run directly and return `needs_ai` with page context when the live page diverges.

Refresh cookie auth only after explicit user confirmation. This updates the local `secrets.json` and does not print cookie values:

```bash
tabwright capability refresh-auth bilibili-current-user --browser user --json
tabwright capability refresh-auth bilibili-current-user --browser install:Chrome:qculboi03pt0 --json
```

The extension Options page shows the same local authentication state for cookie-authenticated capabilities. A user can review the declared cookie domains and explicitly authenticate or refresh with the current Chrome profile there. Treat that button click as the required user confirmation; never trigger the refresh endpoint automatically. Expiry is definitive when declared auth cookies have an expiry timestamp or a later run matches an auth failure signal. Session cookies without a validation failure remain authenticated with server-managed expiry.

Browser capability scripts run in the normal Tabwright sandbox and receive `input` and `capability` globals in addition to `page`, `context`, `state`, `snapshot`, and other helpers:

```js
await page.goto("https://admin.example.com/users")
await page.getByPlaceholder("Search").fill(input.email)
await page.keyboard.press("Enter")

return {
  email: input.email,
  url: page.url(),
}
```

Node capability scripts receive `input`, `capability`, `secrets`, `artifacts`, `fetch`, URL helpers, timers, `Buffer`, text encoders, and `crypto` globals. Use `artifacts.writeJson({ filename, value })` and `artifacts.writeText({ filename, text })` to persist query results under the capability's scoped `artifacts` directory:

```js
const response = await fetch("https://api.example.com/me", {
  headers: { cookie: secrets.cookieHeader },
})

const data = await response.json()
const filePath = artifacts.writeJson({ filename: "latest.json", value: data })

return { data, artifacts: { filePath } }
```

Agents should use capability search and describe before creating new automation. A capability operation can be called autonomously only when the capability is `trusted`, that operation has `sideEffect: "read"`, and it has `requiresConfirmation: false`. Draft capabilities require `--force` before they can run. Confirmation-required operations additionally require their exact `confirmationToken` after explicit user approval; `--force` cannot substitute for approval. Editing a trusted capability's script automatically downgrades it to draft. Updating the AI contract through `--contract-file` also downgrades trusted capabilities to draft unless the patch explicitly sets a status. Use `tabwright studio` to start the standalone local management page for capabilities.

### Debugging tabwright issues

If some internal critical error happens you can read the relay server logs to understand the issue. The log file is located in the user home directory:

```bash
tabwright logfile  # prints the log file path
# typically: ~/.tabwright/relay-server.log
```

The relay log contains logs from the extension, MCP and WS server. A separate CDP JSONL log is created alongside it (see `tabwright logfile`) with all CDP commands/responses and events, with long strings truncated. Both files are recreated every time the server starts. For debugging internal tabwright errors, read these files with grep/rg to find relevant lines.

Example: summarize CDP traffic counts by direction + method:

```bash
jq -r '.direction + "\t" + (.message.method // "response")' ~/.tabwright/cdp.jsonl | uniq -c
```

If you find a bug, you can create a gh issue using `gh issue create -R remorses/tabwright --title title --body body`. Ask for user confirmation before doing this.

---

# tabwright best practices

Control user's Chrome browser via playwright code snippets. Prefer single-line code with semicolons between statements. Use tabwright immediately without waiting for user actions; only if you get "extension is not connected" or "no browser tabs have Tabwright enabled" should you ask the user to click the tabwright extension icon on the target tab.

**When to use tabwright instead of webfetch/curl:** If a website is JS-heavy (SPAs like Instagram, Twitter, Facebook, etc.), has cookie consent modals, login walls, lazy-loaded content, carousels, or infinite scroll — **always use tabwright**. Simple fetch/webfetch will return an empty HTML shell with no content. Do NOT waste time trying curl, webfetch, or parsing raw HTML from JS-rendered sites. Go straight to tabwright: navigate with a real browser, dismiss modals, then extract what you need via `page.evaluate()` or network interception.

**If Chrome is not running**, the extension can't connect. Start Chrome from the command line before retrying:

```bash
# macOS
open -a "Google Chrome" --args --profile-directory=Default

# Linux
google-chrome --profile-directory=Default &

# Windows (cmd)
start chrome.exe --profile-directory=Default

# Windows (PowerShell)
Start-Process chrome.exe -ArgumentList '--profile-directory=Default'
```

You can collaborate with the user - they can help with captchas, difficult elements, or reproducing bugs.

**Direct CDP mode (no extension needed):** Tabwright can connect directly to Chrome's DevTools Protocol, bypassing the extension. This is useful in CI, Docker, headless environments, when Chrome has `--remote-debugging-port=9222`, or with cloud browser providers (e.g. `wss://xxx.cdp.browser-use.com`). If the user provides a CDP URL, set `TABWRIGHT_DIRECT` in the MCP client config:

```json
{
  "mcpServers": {
    "tabwright": {
      "command": "npx",
      "args": ["-y", "tabwright@latest"],
      "env": {
        "TABWRIGHT_DIRECT": "wss://xxx.cdp.browser-use.com"
      }
    }
  }
}
```

`TABWRIGHT_DIRECT` accepts `1` (auto-discover Chrome on port 9222), a `ws://` or `wss://` endpoint (including cloud browser providers), or `host:port`. Extension-side replay recording is not available in direct CDP mode.

## context variables

- `state` - object persisted between calls **within your session**. Each session has its own isolated state. Use to store pages, data, listeners (e.g., `state.page = await context.newPage()`)
- `page` - a default page (may be shared with other agents). Prefer creating your own page and storing it in `state` (see "working with pages")
- `context` - browser context, access all pages via `context.pages()`
- `require` - load Node.js modules (e.g., `const fs = require('node:fs')`). ESM `import` is not available in the sandbox
- Node.js globals: `setTimeout`, `setInterval`, `fetch`, `URL`, `Buffer`, `crypto`, `process`, etc.

**Not available in the sandbox:** `__dirname`, `__filename`, `import`.

**Important:** `state` is **session-isolated** but pages are **shared** across all sessions. See "working with pages" for how to avoid interference.

**Sandboxed `fs` write restrictions:** `require('node:fs')` is scoped. Writes (writeFileSync, mkdirSync, etc.) only succeed in:
- The **directory where `tabwright` CLI was invoked** (the session's cwd)
- `/tmp`
- The OS temp directory (`os.tmpdir()`, e.g. `/var/folders/.../T/` on macOS)

Writing to any other path (e.g. `~/Downloads`, `~/Desktop`) throws `EPERM: operation not permitted, access outside allowed directories`. To save files elsewhere, write to a temp path first, then move the file using a shell command outside the sandbox.

## rules

- **Initialize state.page first**: see "working with pages" — at the start of a task, assign `state.page` (reuse `about:blank` or create one) and use `state.page` for all automation steps.
- **Multiple calls**: use multiple execute calls for complex logic - helps understand intermediate state and isolate which action failed
- **Never close**: never call `browser.close()` or `context.close()`. Only close pages you created or if user asks
- **No bringToFront**: never call unless user asks - it's disruptive and unnecessary, you can interact with background pages
- **Check state after actions**: always verify page state after clicking/submitting (see next section)
- **Clean up listeners**: call `state.page.removeAllListeners()` at end of message to prevent leaks
- **Always print page logs after every action**: call `getLatestLogs({ page: state.page, sinceLastCall: true })` after every goto, click, or submit to catch console errors and warnings. Do not manually collect `page.on('console')` events; manual listeners miss logs emitted before the listener is attached. The first `sinceLastCall` call returns all buffered logs including startup and hydration errors.
- **CDP sessions**: use `getCDPSession({ page: state.page })` not `state.page.context().newCDPSession()` - NEVER use `newCDPSession()` method, it doesn't work through tabwright relay
- **Wait for load**: use `state.page.waitForLoadState('domcontentloaded')` not `state.page.waitForEvent('load')` - waitForEvent times out if already loaded
- **Minimize timeouts**: prefer proper waits (`waitForSelector`, `waitForPageLoad`) over `state.page.waitForTimeout()`. Short timeouts (1-2s) are acceptable for non-deterministic events like animations, tab opens, or async UI updates where no specific selector is available
- **Snapshot before screenshot**: always use `snapshot()` first to understand page state (text-based, fast, cheap). Only use `screenshot` when you specifically need visual/spatial information. Never take a screenshot just to check if a page loaded or to read text content — snapshot gives you that instantly without burning image tokens
- **Always use absolute file paths for Playwright artifact APIs**: for `page.screenshot({ path })`, `locator.screenshot({ path })`, `elementHandle.screenshot({ path })`, `page.pdf({ path })`, `download.saveAs(path)`, and `video.saveAs(path)`, always pass an absolute path. Relative paths are resolved by Playwright client internals, not the sandboxed `fs`, so they may use the relay server cwd instead of your session cwd.
- **Snapshot replaces page.evaluate() for inspection**: do NOT write `page.evaluate()` calls to manually query class names, bounding boxes, child counts, or visibility flags. `snapshot()` already shows every interactive element with its text, role, and a ready-to-use locator. If you catch yourself writing `document.querySelector` or `getBoundingClientRect` inside evaluate — stop and use `snapshot()` instead. Reserve `page.evaluate()` for actions that modify page state (e.g., `localStorage.clear()`, scroll manipulation) or extract non-DOM data (e.g., `window.__CONFIG__`)

## interaction feedback loop

Every browser interaction must follow **observe → act → observe**. Never chain multiple actions blindly.

1. **Open page** — get or create your page, navigate to URL
2. **Observe** — print `state.page.url()` + `snapshot()` + `getLatestLogs({ sinceLastCall: true })`. Always print URL — pages can redirect unexpectedly.
3. **Check** — if page isn't ready (loading, wrong URL, content missing), wait and observe again
4. **Act** — perform one action (click, type, submit)
5. **Observe again** — print URL + snapshot + page logs to verify the action's effect
6. **Repeat** from step 3 until task is complete

**Always print page logs after every action** using `getLatestLogs({ sinceLastCall: true })`. This returns only new console messages and errors since the last call, so you catch hydration errors, failed network requests, and runtime exceptions without duplicates. The first call returns all buffered logs from the page, including logs emitted before your script started.

```js
// Each step should be a separate execute call:
// Step 1: navigate + observe
state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
await state.page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
console.log('URL:', state.page.url())
console.log('Page logs:', await getLatestLogs({ page: state.page, sinceLastCall: true }))
await snapshot({ page: state.page }).then(console.log)
```

```js
// Step 2: act + observe
await state.page.locator('button:has-text("Submit")').click()
console.log('URL:', state.page.url())
console.log('Page logs:', await getLatestLogs({ page: state.page, sinceLastCall: true }))
await snapshot({ page: state.page }).then(console.log)
```

If nothing changed after an action, try `waitForPageLoad({ page: state.page, timeout: 3000 })` or you may have clicked the wrong element.

**Deeper observation** — when snapshots aren't enough to understand what happened, combine snapshot with filtered logs:

```js
// Search for specific errors in all logs (not just since last call)
const errors = await getLatestLogs({ page: state.page, search: /error|fail/i, count: 20 })

// Combine snapshot + filtered logs for full picture
const snap = await snapshot({ page: state.page, search: /dialog|error|message/ })
const logs = await getLatestLogs({ page: state.page, search: /error/i, count: 10 })
console.log('UI:', snap)
console.log('Logs:', logs)
```

Use `getLatestLogs({ sinceLastCall: true })` after every action, `getLatestLogs({ search })` for targeted debugging, `state.page.url()` for navigation, screenshots only for visual layout issues.

## common mistakes to avoid

**1. Not verifying actions succeeded**
Always check page state after important actions (form submissions, uploads, typing). Your mental model can diverge from actual browser state:

```js
await state.page.keyboard.type('my text')
await snapshot({ page: state.page, search: /my text/ })
// If verifying visual layout specifically, use screenshotWithAccessibilityLabels instead
```

**2. Assuming paste/upload worked**
Clipboard paste (`Meta+v`) can silently fail. For file uploads, prefer file input:

```js
// Reliable: use file input
const fileInput = state.page.locator('input[type="file"]').first()
await fileInput.setInputFiles('/path/to/image.png')

// Unreliable: clipboard paste may silently fail, need to focus textarea first for example
await state.page.keyboard.press('Meta+v') // always verify with screenshot!
```

**3. Using stale locators from old snapshots**
Locators (especially ones with `>> nth=`) can change when the page updates. Always get a fresh snapshot before clicking, then immediately use locators from that output:

```js
await snapshot({ page: state.page, showDiffSinceLastCall: true })
// Now use the NEW locators from this output
```

**4. Wrong assumptions about current page/element**
Before destructive actions (delete, submit), verify you're targeting the right thing:

```js
// Before deleting, verify it's the right item
await screenshotWithAccessibilityLabels({ page: state.page })
// READ the screenshot to confirm, THEN proceed with delete
```

**5. Text concatenation without line breaks**
`keyboard.type()` doesn't insert newlines from `\n` in strings. Use `keyboard.press('Enter')` between lines:

```js
await state.page.keyboard.type('Line 1')
await state.page.keyboard.press('Enter')
await state.page.keyboard.type('Line 2')
```

**6. Quote escaping in bash**
Bash parses `$`, backticks, and `\` inside double-quoted strings. This silently corrupts JS code. Always use single quotes or heredoc:

```bash
# single quotes — bash passes everything through literally
tabwright -s 1 -e 'await state.page.locator(`[id="_r_a_"]`).click()'

# heredoc for complex code with mixed quotes
tabwright -s 1 -e "$(cat <<'EOF'
await state.page.locator('[id="_r_a_"]').click()
const match = html.match(/\$[\d.]+/g)
EOF
)"
```

**7. Using screenshots when snapshots suffice**
Screenshots + image analysis is expensive and slow. Only use screenshots for visual/CSS issues. Use snapshot for text checks:

```js
await snapshot({ page: state.page, search: /expected text/i })
```

**8. Assuming page content loaded**
Even after `goto()`, dynamic content may not be ready:

```js
await state.page.goto('https://example.com')
// Content may still be loading via JavaScript!
await state.page.waitForSelector('article', { timeout: 10000 })
// Or use waitForPageLoad utility
await waitForPageLoad({ page: state.page, timeout: 5000 })
```

**9. Not using tabwright for JS-rendered sites**
Do NOT waste context trying webfetch, curl, or Playwright CLI screenshots on SPAs (Instagram, Twitter, etc.). These return empty HTML shells. Use tabwright directly:

```js
state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
await state.page.goto('https://www.instagram.com/p/ABC123/', { waitUntil: 'domcontentloaded' })
await waitForPageLoad({ page: state.page, timeout: 8000 })
await snapshot({ page: state.page, search: /cookie|consent|accept/i }).then(console.log)
```

**10. Login buttons that open popups**
Popup windows (`window.open` with features, OAuth buttons) are auto-relocated to tabs in the main window by the Tabwright extension. The new tab appears in `context.pages()` and is fully controllable. You will receive a `[WARNING] New page opened from current page (index N, initial url: ...)` message pointing to the new tab — the `initial url` may be `about:blank` for blank-then-scripted popups, so check `context.pages()[N].url()` for the final URL:

```js
await state.page.locator('button:has-text("Login with Google")').click()
await state.page.waitForTimeout(1000)

// New tab is the last page in the context
const pages = context.pages()
const loginPage = pages[pages.length - 1]

// Complete login flow in loginPage, cookies are shared with original page
await loginPage.locator('[data-email]').first().click()
await loginPage.waitForURL('**/callback**')
// Original page should now be authenticated
```

**11. Click times out or does nothing — snapshot to find the blocker**
When a click times out, a **modal or overlay** is likely intercepting pointer events. Do not retry with different selectors or `{ force: true }` — snapshot to find the blocker:

```js
// click timed out → don't retry blindly, find what's blocking
await snapshot({ page: state.page, search: /dialog|modal/i })
// Found modal → interact with it properly (don't just close via X, it may reappear)
await state.page.getByRole('radio', { name: 'Nope, Vanilla' }).click()
```

**12. Never use `dispatchEvent` or `{ force: true }` to bypass blockers**
`dispatchEvent(new MouseEvent(...))`, `{ force: true }`, and `element.click()` inside `page.evaluate()` bypass Playwright checks but **do not trigger React/Vue/Svelte handlers** — state won't update. Use snapshot to find the real interactive element:

```js
await state.page.getByRole('radio', { name: 'Node.js' }).click()
```

**13. Over-investigating instead of just interacting**
When something doesn't respond to a click, do NOT start inspecting CDP event listeners, React fibers, canvas pixel data, or writing `page.evaluate()` to read class names and bounding boxes. This wastes massive context. Instead:

1. Take a `snapshot()` — it shows every interactive element and what to click
2. Try a different interaction pattern if `click()` didn't work:
   - **Drawing/annotation tools, canvas paint** → `mouse.down`, move with steps, `mouse.up` (see drag section)
   - **Keyboard-activated modes** → press the shortcut key (snapshot shows tooltip text like "Draw mode D")
   - **Sliders, timeline scrubbers** → drag pattern
   - **Collapsed/toggled toolbars** → click the toggle first, wait, then interact
3. Take another `snapshot()` to see what changed
4. Only investigate DOM internals if correct interaction patterns produce zero response after 2–3 attempts

## accessibility snapshots

```js
await snapshot({ page: state.page, search?, showDiffSinceLastCall? })
```

- `search` - string/regex to filter results (returns first 10 matching lines)
- `showDiffSinceLastCall` - returns diff since last snapshot (default: `true`, but `false` when `search` is provided). Pass `false` to get full snapshot.

Snapshots return full content on first call, then diffs on subsequent calls. Diff is only returned when shorter than full content. If nothing changed, returns "No changes since last snapshot" message. Use `showDiffSinceLastCall: false` to always get full content. When `search` is provided, diffing is disabled by default so the search filters the full content — pass `showDiffSinceLastCall: true` explicitly to combine both. This diffing behavior also applies to `getCleanHTML` and `getPageMarkdown`.

Example output:

```md
- banner:
  - link "Home" [id="nav-home"]
  - navigation:
    - link "Docs" [data-testid="docs-link"]
    - link "Blog" role=link[name="Blog"]
```

Each interactive line ends with a Playwright locator you can pass to `state.page.locator()`.
If multiple elements share the same locator, a `>> nth=N` suffix is added (0-based)
to make it unique.

**Use snapshot locators directly — never invent selectors.** The snapshot output IS the selector. Do not guess CSS selectors or `getByText` when the snapshot already gives you the exact match:

```js
// Snapshot shows: role=radio[name="Nope, Vanilla"]  →  use it directly
await state.page.getByRole('radio', { name: 'Nope, Vanilla' }).click()
// Snapshot shows: role=link[name="SIGN IN"]  →  or pass raw string to locator()
await state.page.locator('role=link[name="SIGN IN"]').click()
```

**Beware CSS text-transform**: snapshots show visual text (`heading "NODE.JS"`) but DOM may be `"Node.js"`. Use case-insensitive regex: `getByRole('heading', { name: /node\.js/i })`.

If a screenshot shows ref labels like `e3`, resolve them using the last snapshot:

```js
const snap = await snapshot({ page: state.page })
const locator = refToLocator({ ref: 'e3' })
await state.page.locator(locator!).click()
```

Search for specific elements:

```js
const snap = await snapshot({ page: state.page, search: /button|submit/i })
```

**Scoping snapshots to a specific element** — pass a `locator` instead of `page` to snapshot only a subtree. This dramatically reduces output size when you only care about one section of the page (e.g., the main content area, ignoring the sidebar/header/footer):

```js
// Full page snapshot: ~150 lines (sidebar, nav, header, footer, everything)
await snapshot({ page: state.page })

// Scoped to main: ~20 lines (just the content you care about)
await snapshot({ locator: state.page.locator('main') })

// Scope to a specific form, dialog, or section
await snapshot({ locator: state.page.locator('[role="dialog"]') })
await snapshot({ locator: state.page.locator('form#checkout') })
```

Use this whenever the full page snapshot is dominated by navigation or layout elements you don't need. It saves significant tokens and makes the output much easier to parse.

**Filtering large snapshots in JS** — when `search` isn't enough, filter the string directly: `snap.split('\n').filter(l => l.includes('dialog') || l.includes('error')).join('\n')`

## choosing between snapshot methods

Use `snapshot` for text-heavy pages (forms, articles) — fast, cheap, searchable. Use `screenshotWithAccessibilityLabels` for complex visual layouts (grids, galleries, dashboards) where spatial position matters. Both share the same ref system and can be combined.

## selector best practices

**For unknown websites**: use `snapshot()` - it shows what's actually interactive with stable locators.

**For development** (when you have source code access), prefer stable selectors in this order:

1. **Best**: `[data-testid="submit"]` - explicit test attributes, never change accidentally
2. **Good**: `getByRole('button', { name: 'Save' })` - accessible, semantic
3. **Good**: `getByText('Sign in')`, `getByLabel('Email')` - readable, user-facing
4. **OK**: `input[name="email"]`, `button[type="submit"]` - semantic HTML
5. **Avoid**: `.btn-primary`, `#submit` - classes/IDs change frequently
6. **Last resort**: `div.container > form > button` - fragile, breaks easily

Combine locators for precision:

```js
state.page.locator('tr').filter({ hasText: 'John' }).locator('button').click()
state.page.locator('button').nth(2).click()
```

If a locator matches multiple elements, Playwright throws "strict mode violation". Use `.first()`, `.last()`, or `.nth(n)`:

```js
await state.page.locator('button').first().click() // first match
await state.page.locator('.item').last().click() // last match
await state.page.locator('li').nth(3).click() // 4th item (0-indexed)
```

## working with pages

**Pages are shared, state is not.** `context.pages()` returns all browser tabs with tabwright enabled — shared across all sessions. Multiple agents see the same tabs. If another agent navigates or closes a page you're using, you'll be affected. To avoid interference, **get your own page**.

**Get or create your page (first call):**

On your very first execute call, reuse an existing empty tab or create a new one, and navigate it **in the same execute call**. Store it in `state` and use `state.page` for all subsequent operations instead of the default `page` variable:

```js
// Reuse an empty about:blank tab if available, otherwise create a new one.
// IMPORTANT: always navigate immediately in the same call to avoid another
// agent grabbing the same about:blank tab between execute calls.
state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
await state.page.goto('https://example.com')
// Use state.page for ALL subsequent operations
```

**Handle page closures gracefully:**

The user may close your page by accident (e.g., closing a tab in Chrome). Always check before using it and recreate if needed:

```js
if (!state.page || state.page.isClosed()) {
  state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
}
await state.page.goto('https://example.com')
```

**Use an existing page only when the user asks:**

Only use a page from `context.pages()` if the user explicitly asks you to control a specific tab they already opened (e.g., they're logged into an app). Find it by URL pattern and store it in state:

```js
const pages = context.pages().filter((x) => x.url().includes('myapp.com'))
if (pages.length === 0) throw new Error('No myapp.com page found. Ask user to enable tabwright on it.')
if (pages.length > 1) throw new Error(`Found ${pages.length} matching pages, expected 1`)
state.targetPage = pages[0]
```

**List all available pages:**

```js
context.pages().map((p) => p.url())
```

**Popup windows become tabs automatically:**

The extension intercepts Chrome popup windows (`window.open(url, '', 'width=...')`, OAuth login flows) and relocates them into the main window as regular tabs. You don't need cmd+click or `{ modifiers: ['Meta'] }` to avoid popups. When a page opens another, you receive a `[WARNING] New page opened from current page (index N, initial url: ...)` and can access it via `context.pages()[N]`.

## navigation

**Use `domcontentloaded`** for `page.goto()`:

```js
await state.page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
await waitForPageLoad({ page: state.page, timeout: 5000 })
```

## common patterns

**Authenticated fetches** - fetch from within page context to include session cookies automatically:

```js
const data = await state.page.evaluate(async (url) => {
  const resp = await fetch(url)
  return await resp.text()
}, 'https://example.com/protected/resource')
```

**Read page cookies via CDP** - use `Network.getCookies` on the page CDP session:

```js
const cdp = await getCDPSession({ page: state.page })
const { cookies } = await cdp.send('Network.getCookies', { urls: [state.page.url()] })
console.log(cookies)
```

MUST use this for page-scoped cookies in extension mode. `Storage.getCookies` is a root-session command and will fail in tabwright.

**NEVER use `Network.clearBrowserCookies` or `Network.clearBrowserCache`** — these CDP commands are **profile-wide destructive operations** that wipe ALL cookies/cache across every domain in the user's Chrome profile. They will log the user out of Gmail, GitHub, and every authenticated session.

**Clear cookies for a specific domain** — use `Network.getCookies` to fetch cookies scoped to URLs, then delete them individually with `Network.deleteCookies`:

```js
const cdp = await getCDPSession({ page: state.page })
const { cookies } = await cdp.send('Network.getCookies', {
  urls: ['https://example.com', 'https://www.example.com'],
})
for (const cookie of cookies) {
  await cdp.send('Network.deleteCookies', { name: cookie.name, domain: cookie.domain })
}
```

**Downloading large data** - console output truncates large strings. Trigger a browser download instead:

```js
// Fetch protected data and trigger download to user's Downloads folder
await state.page.evaluate(async (url) => {
  const resp = await fetch(url)
  const data = await resp.text()
  const blob = new Blob([data], { type: 'application/octet-stream' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'data.json'
  a.click()
}, 'https://example.com/protected/large-file')
// File saves to ~/Downloads - read it from there
```

**Avoid permission-gated browser APIs** - some APIs require user permission prompts or special browser flags. These often fail silently or hang. Examples to avoid:

- `navigator.clipboard.writeText()` - requires permission
- Multiple concurrent downloads - browser may block
- `window.showSaveFilePicker()` - requires user gesture
- Geolocation, camera, microphone APIs

Instead, use simpler alternatives (single download via `a.click()`, store data in `state`, etc).

**Downloads** - capture and save:

```js
const [download] = await Promise.all([state.page.waitForEvent('download'), state.page.click('button.download')])
await download.saveAs(`/absolute/path/${download.suggestedFilename()}`)
```

**iFrames** - two approaches depending on what you need:

```js
// frameLocator: for chaining locator operations (click, fill, etc.)
const frame = state.page.frameLocator('#my-iframe')
await frame.locator('button').click()

// contentFrame: returns a Frame object, needed for snapshot({ frame })
const frame2 = await state.page.locator('iframe').contentFrame()
await snapshot({ frame: frame2 })
```

**Dialogs** - handle alerts/confirms/prompts:

```js
state.page.on('dialog', async (dialog) => {
  console.log(dialog.message())
  await dialog.accept()
})
await state.page.click('button.trigger-alert')
```

**Handling page obstacles (cookie modals, login walls, age gates)** - most major websites show blocking overlays. Always check for these with `snapshot()` right after navigation and dismiss them before doing anything else:

```js
// After navigating, check for common obstacles
await waitForPageLoad({ page: state.page, timeout: 5000 })
const snap = await snapshot({
  page: state.page,
  search: /cookie|consent|accept|reject|decline|allow|age|verify|login|sign.in/i,
})
console.log(snap)
// Look for dismiss/accept/decline buttons in the snapshot, then click them:
// await state.page.locator('button:has-text("Accept")').click();
// await state.page.locator('button:has-text("Decline optional")').click();
// Then re-snapshot to confirm the modal is gone before proceeding
```

If the page requires login and the user is already logged into Chrome, their session cookies are available — just navigate and the page should load authenticated. If not, ask the user for help or use their existing logged-in tab via `context.pages()`.

**Extracting and downloading media (images, videos)** - use `page.evaluate()` to extract URLs from the rendered DOM, then download via Node.js in the sandbox. This is far more reliable than parsing raw HTML:

```js
// Extract all image URLs from rendered DOM
const images = await state.page.evaluate(() =>
  Array.from(document.querySelectorAll('img[src]')).map((img) => ({
    src: img.src,
    alt: img.alt,
    width: img.naturalWidth,
  })),
)
console.log(JSON.stringify(images, null, 2))

// Download a specific image to disk
const fs = require('node:fs')
const resp = await fetch(images[0].src)
const buf = Buffer.from(await resp.arrayBuffer())
fs.writeFileSync('./downloaded-image.jpg', buf)
console.log('Saved', buf.length, 'bytes')
```

For carousels or lazy-loaded galleries, you may need to click navigation arrows or scroll first, then re-extract. Use network interception (see "network interception" section) to capture high-resolution CDN URLs that may differ from the `img.src` thumbnails.

## utility functions

**getLatestLogs** - retrieve captured browser console logs and page errors (up to 5000 per page):

Always use this helper when inspecting browser logs. Do not attach new `page.on('console')` listeners for debugging because they only see future events and can miss logs emitted during page startup or hydration.

Use `sinceLastCall: true` after every action to get only new logs since the previous call. The first call returns all buffered logs including pre-existing ones. Logs persist across navigations so you never miss errors from page transitions.

```js
await getLatestLogs({ page?, count?, search?, sinceLastCall? })
// After every action: get only new logs
const newLogs = await getLatestLogs({ page: state.page, sinceLastCall: true })
// Search all logs (ignores cursor):
const errors = await getLatestLogs({ search: /error/i, count: 50 })
const pageLogs = await getLatestLogs({ page: state.page, count: 100 })
const hydrationErrors = await getLatestLogs({ page: state.page, search: /hydration|pageerror|React/i })
```

**getCleanHTML** - get cleaned HTML from a locator or page, with search and diffing:

```js
await getCleanHTML({ locator, search?, showDiffSinceLastCall?, includeStyles? })
// Examples:
const html = await getCleanHTML({ locator: state.page.locator('body') })
const html = await getCleanHTML({ locator: state.page, search: /button/i })
const fullHtml = await getCleanHTML({ locator: state.page, showDiffSinceLastCall: false })  // disable diff
```

**Parameters:**

- `locator` - Playwright Locator or Page to get HTML from
- `search` - string/regex to filter results (returns first 10 matching lines with 5 lines context)
- `showDiffSinceLastCall` - returns diff since last call (default: `true`, but `false` when `search` is provided). Pass `false` to get full HTML.
- `includeStyles` - keep style and class attributes (default: false)

Cleans HTML automatically: removes script/style/svg/head tags, unwraps empty wrappers, removes empty elements, truncates long values. Keeps semantic attributes (`href`, `name`, `type`, `aria-*`, `data-*`).

**getPageMarkdown** - extract main page content as plain text using Mozilla Readability (same algorithm as Firefox Reader View). Strips navigation, ads, sidebars, and other clutter. Returns formatted text with title, author, and content:

```js
await getPageMarkdown({ page: state.page, search?, showDiffSinceLastCall? })
// Examples:
const content = await getPageMarkdown({ page: state.page, showDiffSinceLastCall: false })  // full article
const matches = await getPageMarkdown({ page: state.page, search: /API/i })  // search within content
```

**Output format:**

```
# Article Title

Author: John Doe | Site: example.com | Published: 2024-01-15

> Article excerpt or description

The main article content as plain text, with paragraphs preserved...
```

**Parameters:**

- `page` - Playwright Page to extract content from
- `search` - string/regex to filter content (returns first 10 matching lines with 5 lines context)
- `showDiffSinceLastCall` - returns diff since last call (default: `true`, but `false` when `search` is provided). Pass `false` to get full content.

**waitForPageLoad** - smart load detection that ignores analytics/ads:

```js
await waitForPageLoad({ page: state.page, timeout?, pollInterval?, minWait? })
// Returns: { success, readyState, pendingRequests, waitTimeMs, timedOut }
```

**getCDPSession** - send raw CDP commands:

```js
const cdp = await getCDPSession({ page: state.page })
const metrics = await cdp.send('Page.getLayoutMetrics')
```

**getLocatorStringForElement** - get stable Playwright selector from an element:

```js
const selector = await getLocatorStringForElement(state.page.locator('[id="submit-btn"]'))
// => "getByRole('button', { name: 'Save' })"
```

**getReactSource** - get React component source location (dev mode only):

```js
const source = await getReactSource({ locator: state.page.locator('[data-testid="submit-btn"]') })
// => { fileName, lineNumber, columnNumber, componentName }
```

**getReactComponentInfo** - get best-effort React component info for an element. Returns `null` for non-React elements and never throws just because an element was not rendered by React. Source locations are usually only available in React dev builds. Props are sanitized and truncated so functions, DOM nodes, circular refs, and huge objects do not flood the output.

```js
const info = await getReactComponentInfo({ locator: state.page.locator('[data-testid="submit-btn"]') })
// => { componentName, source, hierarchy, props } | null
```

**inspectPinnedElement** - inspect a Tabwright pinned element and print the element `outerHTML` plus React component info when available. Used by the in-page toolbar and right-click copy flow.

```js
await inspectPinnedElement('https://example.com', 'globalThis.tabwrightPinnedElem1')
```

**getStylesForLocator** - inspect CSS styles applied to an element, like browser DevTools "Styles" panel. Useful for debugging styling issues, finding where a CSS property is defined (file:line), and checking inherited styles. Returns selector, source location, and declarations for each matching rule. ALWAYS fetch `https://playwriter.dev/resources/styles-api.md` first with curl or webfetch tool.

```js
const styles = await getStylesForLocator({
  locator: state.page.locator('.btn'),
  cdp: await getCDPSession({ page: state.page }),
})
console.log(formatStylesAsText(styles))
```

**createDebugger** - set breakpoints, step through code, inspect variables at runtime. Useful for debugging issues that only reproduce in browser, understanding code flow, and inspecting state at specific points. Can pause on exceptions, evaluate expressions in scope, and blackbox framework code. ALWAYS fetch `https://playwriter.dev/resources/debugger-api.md` first.

```js
const cdp = await getCDPSession({ page: state.page })
const dbg = createDebugger({ cdp })
await dbg.enable()
const scripts = await dbg.listScripts({ search: 'app' })
await dbg.setBreakpoint({ file: scripts[0].url, line: 42 })
// when paused: dbg.inspectLocalVariables(), dbg.stepOver(), dbg.resume()
```

**createEditor** - view and live-edit page scripts and CSS at runtime. Edits are in-memory (persist until reload). Useful for testing quick fixes, searching page scripts with grep, and toggling debug flags. ALWAYS read `https://playwriter.dev/resources/editor-api.md` first.

```js
const cdp = await getCDPSession({ page: state.page })
const editor = createEditor({ cdp })
await editor.enable()
const matches = await editor.grep({ regex: /console\.log/ })
await editor.edit({ url: matches[0].url, oldString: 'DEBUG = false', newString: 'DEBUG = true' })
```

**screenshotWithAccessibilityLabels** - take a screenshot with Vimium-style visual labels overlaid on interactive elements. Shows labels, captures screenshot, then removes labels. The image and accessibility snapshot are automatically included in the response. Can be called multiple times to capture multiple screenshots. Use a timeout of **20 seconds** for complex pages.

This is only for **finding interactive elements** on the page. To share a screenshot with the user or save an image, use `page.screenshot()` + `resizeImageForAgent()` instead (see "taking screenshots" section below).

Prefer this for pages with grids, image galleries, maps, or complex visual layouts where spatial position matters. For simple text-heavy pages, `snapshot` with search is faster and uses fewer tokens.

```js
await screenshotWithAccessibilityLabels({ page: state.page })
// Image and accessibility snapshot are automatically included in response
// Use refs from snapshot to interact with elements
await state.page.locator('[id="submit-btn"]').click()

// Can take multiple screenshots in one execution
await screenshotWithAccessibilityLabels({ page: state.page })
await state.page.click('button')
await screenshotWithAccessibilityLabels({ page: state.page })
// Both images are included in the response
```

Labels are color-coded: yellow=links, orange=buttons, coral=inputs, pink=checkboxes, peach=sliders, salmon=menus, amber=tabs.

**resizeImageForAgent** - shrink an image so it consumes fewer tokens when read back into context. The resized image is automatically included in the response (visible to the LLM). `await resizeImageForAgent({ input: '/absolute/path/to/screenshot.png' })`. Also accepts `width`, `height`, `maxDimension`, `quality`, `format` (default: `'png'`), `output`. Alias: `resizeImage`.

**replay.start / replay.stop** - record the page as an rrweb DOM replay. This captures DOM snapshots, mutations, inputs, mouse movement, scrolls, and user-added Tabwright annotations into `~/.tabwright/rrweb-recordings/<id>.json`, then plays back in the Tabwright extension options page. DOM replays are for review and workflow understanding only: clicking inside the replay does **not** execute the original page's React/Vue/business logic.

Use replay recordings when you need a compact, inspectable artifact for AI understanding, workflow compilation, and user review. The in-page toolbar records rrweb replay only; video capture is intentionally not part of the product.

While recording, the toolbar's element selection button becomes an annotation tool. If the user selects an element and writes a note, the note is saved as a `tabwright.annotation` rrweb custom event and appears in `replay index` output as `annotations`. Treat these annotations as stronger intent signals than inferred labels/selectors.

```js
await replay.start({
  page: state.page,
  checkoutEveryNms: 0,
  maskAllInputs: false,
  recordCanvas: false,
  inlineImages: false,
})

await state.page.getByLabel('Title').fill('Summer banner')
await state.page.getByRole('button', { name: 'Preview' }).click()

state.replayResult = await replay.stop({ page: state.page })
console.log(state.replayResult)

// Other: replay.isRecording({ page }), replay.cancel({ page }), replay.list({ limit: 10 }),
// replay.events({ id: state.replayResult.id })
```

**workflow.saveFromRecording / workflow.saveCapability** - after the user gives a demonstration replay id and a concrete goal, save the derived reusable flow as a project capability. Prefer `workflow.saveFromRecording()` when the flow can be represented as structured steps; use `workflow.saveCapability()` when you need to write a custom script. Saved workflows start as `draft`, have `sideEffect: "write"` and `requiresConfirmation: true` by default, and can later be inspected or run with `tabwright capability ...`. The generated script runs the live frontend flow, observes the expected final request when `finalRequest` is provided, and returns `needs_ai` with a snapshot when the page no longer matches the replay. Omit `finalRequest` for flows that do not have a real submit/request boundary.

**replay list** - use `tabwright replay list --limit 10 --json` to discover saved demonstrations without connecting to the relay. Results are newest-first and include the exact inspect and make commands for each replay.

**replay make / replay compile** - when the user gives an rrweb replay id and asks to run similar work, first compile the replay into a project capability instead of manually replaying every step. Prefer `tabwright replay make <replayId> <capabilityId> --force --goal "..." --json` because it builds the AI index and compiles in one step. A successful result has `status: "compiled"` and writes the draft capability. If the deterministic compiler cannot recognize the workflow, the result has `status: "needs_ai"`, writes no placeholder capability, and returns exact `next.inspectCommand` and `next.createCommand` commands for an AI authoring handoff. Generated workflows are draft browser writes: inspect the contract and script, stop for explicit user confirmation, then run with `tabwright capability run <capabilityId> --browser user --input-json ... --force --confirm <capabilityId> --json`. Use `replay compile` only when the index has already been inspected or generated separately. The generated script should execute the live frontend path, continue from an already-editing page when possible, and return `needs_ai` with page context when validation, DOM drift, or a missing selector blocks the flow.

**replay index** - before compiling a replay, use `tabwright replay index <replayId> --json` to inspect the compact AI-readable view of the rrweb events. It preserves actions, fields, user annotations, warnings, and selector hints, but replaces bulky page text and interactive-element arrays with counts. Add `--full` only when the AI needs the complete evidence. The raw rrweb recording remains the source evidence; use `--write` only when you want to persist the generated index under `~/.tabwright/replay-ai-indexes`.

**replay eval** - run the replay productization self-test platform. It creates local example pages, writes synthetic rrweb recordings, builds the AI index, compiles draft capabilities, runs the generated scripts in a real browser, and verifies the page/request result. Use it before changing recording/index/compiler/capability code:

```bash
tabwright replay eval
tabwright replay eval --json
tabwright replay eval --case zh-list-append --headed
tabwright replay eval --report tmp/replay-eval-report.html --keep-artifacts
```

The default suite covers Chinese/English list append flows, already-editing pages, draft restart/continue dialogs, duplicate-value short-circuiting, deleted annotations, page drift returning `needs_ai`, and unsupported replays failing explicitly instead of generating fake automation.

```js
const latestReplay = (await replay.list({ limit: 1 }))[0]

const saved = workflow.saveFromRecording({
  id: 'create-material-from-demo',
  title: 'Create material from demo',
  description: 'Fill the material form from structured input and stop with needs_ai if the page drifts.',
  recordingId: latestReplay.id,
  match: ['https://admin.example.com/*'],
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            image: { type: 'string' },
          },
          required: ['title', 'image'],
        },
      },
    },
    required: ['items'],
  },
  steps: [
    { action: 'goto', url: { value: 'https://admin.example.com/materials/new' } },
    { action: 'fill', locator: '[name="title"]', value: { inputPath: 'title' } },
    { action: 'setInputFiles', locator: '[name="image"]', path: { inputPath: 'image' } },
  ],
  finalRequest: {
    url: '**/api/materials/**',
    method: 'POST',
    title: 'Create material',
    trigger: { action: 'click', locator: 'button[type="submit"]' },
  },
})

console.log(saved.capability)
```

**ghostCursor.show / ghostCursor.hide** - the ghost cursor overlay is always on: the extension injects it on every Tabwright-attached tab and it stays visible at the last spot Playwright clicked or moved. These methods only matter if you want to change the cursor style or temporarily hide it:

```js
await ghostCursor.show({ page: state.page, style: 'screenstudio' }) // 'minimal' (default), 'dot', 'screenstudio'
await ghostCursor.hide({ page: state.page }) // hide until next show() or hard navigation
```

## pinned elements

Users can right-click → "Copy Tabwright Element Reference" to store elements in `globalThis.tabwrightPinnedElem1` (increments for each pin). The reference is copied to clipboard:

```js
const el = await state.page.evaluateHandle(() => globalThis.tabwrightPinnedElem1)
await el.click()
```

## taking screenshots

Always use `scale: 'css'` to avoid 2-4x larger images on high-DPI displays:

```js
await state.page.screenshot({ path: '/absolute/path/to/shot.png', scale: 'css' })
```

If you want to read back the image file into context, resize it first so it consumes fewer tokens:

```js
await resizeImageForAgent({ input: './shot.png' })
```

## page.evaluate

Code inside `page.evaluate()` runs in the browser - use plain JavaScript only, no TypeScript syntax. Return values and log outside (console.log inside evaluate runs in browser, not visible):

```js
const title = await state.page.evaluate(() => document.title)
console.log('Title:', title)

const info = await state.page.evaluate(() => ({
  url: location.href,
  buttons: document.querySelectorAll('button').length,
}))
console.log(info)
```

## loading files

Fill inputs with file content:

```js
const fs = require('node:fs')
const content = fs.readFileSync('./data.txt', 'utf-8')
await state.page.locator('textarea').fill(content)
```

## network interception

For scraping or reverse-engineering APIs, intercept network requests instead of scrolling DOM. Store in `state` to analyze across calls:

```js
state.requests = []
state.responses = []
state.page.on('request', (req) => {
  if (req.url().includes('/api/')) state.requests.push({ url: req.url(), method: req.method(), headers: req.headers() })
})
state.page.on('response', async (res) => {
  if (res.url().includes('/api/')) {
    try {
      state.responses.push({ url: res.url(), status: res.status(), body: await res.json() })
    } catch {}
  }
})
```

Then trigger actions (scroll, click, navigate) and analyze captured data:

```js
console.log('Captured', state.responses.length, 'API calls')
state.responses.forEach((r) => console.log(r.status, r.url.slice(0, 80)))
```

Inspect a specific response to understand schema:

```js
const resp = state.responses.find((r) => r.url.includes('users'))
console.log(JSON.stringify(resp.body, null, 2).slice(0, 2000))
```

Replay API directly (useful for pagination):

```js
const { url, headers } = state.requests.find((r) => r.url.includes('feed'))
const data = await state.page.evaluate(
  async ({ url, headers }) => {
    const res = await fetch(url, { headers })
    return res.json()
  },
  { url, headers },
)
console.log(data)
```

Clean up listeners when done: `state.page.removeAllListeners('request'); state.page.removeAllListeners('response');`

## computer use (low-level mouse/keyboard)

### clicking

```js
// Preferred: by locator (stable, auto-waits, no coordinates needed)
await state.page.locator('button[name="Submit"]').click()
await state.page.locator('text=Login').click({ button: 'right' })
await state.page.locator('text=Login').dblclick()
await state.page
  .locator('a')
  .first()
  .click({ modifiers: ['Meta'] }) // cmd+click opens link in new background tab

// By coordinates (when locators aren't available, e.g. canvas, maps, custom widgets)
await state.page.mouse.click(450, 320) // left click
await state.page.mouse.click(450, 320, { button: 'right' }) // right click
await state.page.mouse.dblclick(450, 320) // double click
await state.page.mouse.click(450, 320, { clickCount: 3 }) // triple click
await state.page.mouse.click(450, 320, { modifiers: ['Shift'] }) // shift+click
```

### hover

```js
await state.page.locator('.tooltip-trigger').hover() // by locator (preferred)
await state.page.mouse.move(450, 320) // by coordinates
```

### scroll

```js
// By locator (preferred)
await state.page.locator('#footer').scrollIntoViewIfNeeded()

// By pixel (for canvas, maps, infinite scroll)
await state.page.mouse.wheel(0, 300) // scroll down 300px
await state.page.mouse.wheel(0, -300) // scroll up
await state.page.mouse.wheel(300, 0) // scroll right
await state.page.mouse.wheel(-300, 0) // scroll left

// Scroll at a specific position
await state.page.mouse.move(450, 320)
await state.page.mouse.wheel(0, 500)

// Scroll inside a container
await state.page.locator('.scrollable-list').evaluate((el) => {
  el.scrollTop += 500
})
```

### drag

```js
// By locator (preferred)
await state.page.locator('#item').dragTo(state.page.locator('#target'))

// By coordinates (for canvas, sliders, custom drag targets)
await state.page.mouse.move(100, 200)
await state.page.mouse.down()
await state.page.mouse.move(400, 500, { steps: 10 }) // steps for smooth drag
await state.page.mouse.up()
```

**Freehand drawing, annotation widgets, and canvas tools** use this same `mouse.down → move → up` pattern. If a widget expects a drawn stroke (paint tools, annotation overlays, range sliders, timeline scrubbers), always use held-mouse motion — not `mouse.click()`:

```js
// Draw a stroke across a canvas or annotation layer
await state.page.mouse.move(startX, startY)
await state.page.mouse.down()
await state.page.mouse.move(endX, endY, { steps: 15 }) // steps = smoother stroke
await state.page.mouse.up()
await state.page.waitForTimeout(500) // let the widget process the stroke
```

### key hold / release / repeat

```js
// Hold modifier while pressing another key
await state.page.keyboard.down('Shift')
await state.page.keyboard.press('ArrowDown')
await state.page.keyboard.up('Shift')

// Repeat a key
for (let i = 0; i < 5; i++) await state.page.keyboard.press('ArrowDown')
```

### resize viewport

```js
await state.page.setViewportSize({ width: 1280, height: 720 })
```

### region screenshot (zoom equivalent)

```js
await state.page.screenshot({ path: '/absolute/path/to/region.png', scale: 'css', clip: { x: 100, y: 200, width: 400, height: 300 } })
```

Prefer locator-based actions over coordinates — locators are stable across scroll/resize, auto-wait for elements, and don't require screenshot round-trips that burn ~800 image tokens per cycle.

## Ghost Browser integration

When running in [Ghost Browser](https://ghostbrowser.com/), the `chrome` object exposes APIs for multi-identity automation (identities, proxies, sessions). See `extension/src/ghost-browser-api.d.ts` for full API reference. Only works in Ghost Browser — calls fail in regular Chrome.
