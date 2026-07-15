# MCP Setup

> **Note:** CLI is the recommended way to use Tabwright. See [README.md](./README.md) for CLI usage.

Add to your MCP client settings:

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

## Using the MCP

1. Enable the extension on at least one tab (click icon → turns green)
2. MCP automatically starts relay server and connects to enabled tabs
3. Use the `execute` tool to run Playwright code

The MCP exposes:

- `execute` tool - run Playwright code snippets
- `reset` tool - reconnect if connection issues occur

## Environment Variables

### `TABWRIGHT_AUTO_ENABLE`

Auto-creates a tab when Playwright connects (no manual extension click needed). **Enabled by default** in both CLI and MCP. The auto-created tab starts at `about:blank`; navigate it to any URL.

Set `TABWRIGHT_AUTO_ENABLE=false` to disable and require manually enabling the extension on a tab before connecting:

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

## Direct CDP (no extension needed)

Connect directly to Chrome's DevTools Protocol without the extension. Set `TABWRIGHT_DIRECT` in your MCP config:

```json
{
  "mcpServers": {
    "tabwright": {
      "command": "npx",
      "args": ["-y", "tabwright@latest"],
      "env": {
        "TABWRIGHT_DIRECT": "1"
      }
    }
  }
}
```

Enable debugging in Chrome first: open `chrome://inspect/#remote-debugging` or launch with `--remote-debugging-port=9222`.

Chrome 136+ may show an approval dialog the first time a connection is made.

You can also pass an explicit WebSocket endpoint: `TABWRIGHT_DIRECT=ws://127.0.0.1:9222/devtools/browser/abc`.

**Limitation:** screen recording is unavailable in direct mode.

## Remote Agents (Devcontainers, VMs, SSH)

Run agents in isolated environments while controlling Chrome on your host.

**On host (where Chrome runs):**

```bash
npx -y tabwright serve --token <secret>
```

**In container/VM (where agent runs):**

```json
{
  "mcpServers": {
    "tabwright": {
      "command": "npx",
      "args": ["-y", "tabwright@latest", "--host", "host.docker.internal", "--token", "<secret>"]
    }
  }
}
```

Or with environment variables:

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

Use `host.docker.internal` for devcontainers, or your host's IP for VMs/SSH.
