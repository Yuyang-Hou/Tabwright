---
title: MCP Setup
description: Connect an MCP agent to Tabwright's browser debugging tools.
prompt: |
  基于 Playwriter，Agent 像前端工程师调试理解网页，不只是 AX 点击。
  Use @README.md, @tabwright/src/mcp.ts and @tabwright/src/skill.md.
  Keep direct CDP and remote connections compatible without cloud promotion.
---

# MCP Setup

MCP and the CLI access the same browser tools. Use MCP when your agent supports
tool servers, or the CLI when it can run shell commands.

Add this configuration to your MCP client:

```json
{
  "mcpServers": {
    "tabwright": {
      "command": "npx",
      "args": ["-y", "tabwright@latest"]
    }
  }
}
```

Install the Chrome extension and enable the page you want to use. The MCP starts
the local relay and connects to the browser. It exposes:

- `execute`: stateful Playwright JavaScript with page, Network, source, Debugger,
  screenshot, and CDP helpers.
- `reset`: reconnect after a browser or relay connection failure.

In `execute`, list available pages and retain the intended one in `state.page`.
Use an existing page when its live state matters, or create a task-owned page
with `await context.newPage()`. Variables persist within the MCP session;
browser tabs and the profile's login state are shared.

The agent chooses tools appropriate to the question. Use `tabwright docs` to
list local references, then read a topic such as `tabwright docs network` or
`tabwright docs debugger` for API details. No fixed inspection sequence is required.

## Automatic task tab

`TABWRIGHT_AUTO_ENABLE` is enabled by default. A connection can create a new
`about:blank` tab if needed; this does not identify the existing page the user
intended. Set it to `false` to require a manually enabled tab:

```json
{
  "mcpServers": {
    "tabwright": {
      "command": "npx",
      "args": ["-y", "tabwright@latest"],
      "env": {
        "TABWRIGHT_AUTO_ENABLE": "false"
      }
    }
  }
}
```

## Direct CDP

For an existing Chrome DevTools endpoint, set `TABWRIGHT_DIRECT`:

```json
{
  "mcpServers": {
    "tabwright": {
      "command": "npx",
      "args": ["-y", "tabwright@latest"],
      "env": {
        "TABWRIGHT_DIRECT": "ws://127.0.0.1:9222/devtools/browser/abc"
      }
    }
  }
}
```

Replace the example URL with the endpoint supplied by your browser.
`TABWRIGHT_DIRECT=1` instead tries local discovery on port 9222. The browser must
have debugging enabled and may require user approval.

## Remote agents

For a devcontainer, VM, or SSH agent using a relay you explicitly configured,
set its reachable host and token:

```json
{
  "mcpServers": {
    "tabwright": {
      "command": "npx",
      "args": ["-y", "tabwright@latest"],
      "env": {
        "TABWRIGHT_HOST": "host.docker.internal",
        "TABWRIGHT_TOKEN": "<secret>"
      }
    }
  }
}
```

Use your host's reachable address outside Docker. See the
[remote access guide](./docs/remote-access.md) for relay binding and tunnels.

## Data and scope

The default relay is local; content returned through MCP goes to the calling
agent and may be processed by its model provider. A remote relay changes where
browser commands and results travel. The agent remains responsible for the
user's authorized scope, required approvals, and result verification. Raw
browser execution is not a separate account or application-permission boundary.
