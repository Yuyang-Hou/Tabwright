---
title: Tabwright
description: Browser debugging and automation tools for AI agents.
prompt: |
  基于 Playwriter，Agent 像前端工程师调试理解网页，不只是 AX 点击；
  工具提供强原语和低成本证据，由 AI 自由选择方法，不增加强制流程。
  Use @README.md and @tabwright/src/skill.md for this npm package introduction.
---

# Tabwright

Give your agent the browser's debugging tools. Built on Playwriter, Tabwright
connects GPT and other agents to your Chrome through a stateful Playwright
environment, with page inspection, Network, console logs, source search,
breakpoints, screenshots, and in-memory script/CSS editing.

The agent chooses the evidence and interaction method appropriate to the task.
Searchable output and local source artifacts keep large pages and bundles out of
the conversation unless needed.

## Install

Install the [Chrome extension](https://chromewebstore.google.com/detail/tabwright/dkfhphbajbkplddmchbdgdddioonngep)
and the CLI, then click the extension icon on the page you want to use:

```bash
npm install -g tabwright@latest
tabwright doctor
tabwright session new
```

The CLI installs its matching agent skill into `~/.agents/skills/tabwright`.
Open a new agent task to discover it. If lifecycle scripts were disabled, run
`tabwright skill install`; use `tabwright skill status` to check the installed
copy. Agent-specific directories are available through `--target codex` and
`--target claude`. Updates preserve user-modified copies.

## Use the browser

Replace `2` with the new session ID. List available tabs and select the one that
matches the user's request, or create a task-owned tab as shown here:

```bash
tabwright -s 2 -e 'console.log(context.pages().map((page) => { return page.url() }))'
tabwright -s 2 -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'
tabwright -s 2 -e 'console.log(await snapshot({ page: state.page }))'
tabwright -s 2 -e 'console.log(await getLatestLogs({ page: state.page, search: /error|fail/i }))'
```

For a site already open in Chrome, retain the matching enabled page in
`state.page` instead of navigating a new one. Session variables are separate;
browser tabs and the profile's login state are shared.

Use `getCDPSession`, `createEditor`, and `createDebugger` to investigate running
code, or `createNetwork` to inspect a failing request. Look up the relevant API
locally with `tabwright docs network`, `tabwright docs editor`, or
`tabwright docs debugger`; use `--limit 80` for a bounded excerpt.

When finished, close only pages created for this task and delete its session:

```bash
tabwright -s 2 -e 'await state.page.close()' # only for the task-owned page above
tabwright session delete 2
```

The default relay runs on your machine. Returned page content goes to the calling
agent and may be processed by its model provider. Raw browser execution follows
the account's permissions; the agent is responsible for the user's authorized
scope and required approvals.

See the [repository](https://github.com/Yuyang-Hou/Tabwright) for examples,
architecture, independent scripts, and MCP / direct CDP / remote connections.

Business Skills belong to the user and agent. Run ordinary browser scripts with
`tabwright -s <id> -f <file>`; no registry or manifest is required. Recording,
managed Skill runtimes, automatic Cookie storage and cloud provisioning are removed.
Keep business validation, approval and result verification with the Skill.
