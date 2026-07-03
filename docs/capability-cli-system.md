# Playwriter Capability CLI System

This document records the product and technical design for turning browser work into reusable CLI capabilities that agents can discover, understand, and call.

## Goal

Playwriter capabilities are local tools generated from real browser context. A capability should not stop at a saved script. It needs three durable parts:

- Executable logic: `script.js`, runnable by the CLI or MCP.
- Semantic contract: AI-readable intent, schemas, safety level, auth plan, and examples.
- Operational memory: local secrets and recent run history.

The target flow is:

```text
Browser context
  -> AI observes page, network, cookies, and user intent
  -> AI extracts the smallest repeatable operation
  -> Playwriter saves a capability contract and script
  -> User trusts the capability
  -> Agent searches/describes/runs it when the matching intent appears
```

## Runtime Types

Capabilities currently support:

- `node`: runs without opening Chrome. Use this for HTTP/API abilities such as querying the current Bilibili account from saved cookies.
- `browser`: runs in a Playwriter browser session. Use this for workflows that require DOM interaction, page JavaScript, or user-visible browser state.

Auth refresh is modeled separately from the main runtime. A `node` capability can declare cookie auth that is refreshed from the current browser only when the user explicitly allows it.

## Capability Files

Capabilities live under either:

```text
.playwriter/capabilities/<id>/
~/.playwriter/capabilities/<id>/
```

Each capability directory contains:

```text
capability.json   # manifest and AI contract
script.js         # executable logic
secrets.json      # local credentials, never printed by default
runs.jsonl        # operational memory
README.md         # human-facing notes
```

## Manifest Contract

`capability.json` includes execution metadata and AI-facing intent:

```json
{
  "schemaVersion": 1,
  "id": "bilibili-current-user",
  "title": "Bilibili Current User",
  "description": "Fetch current Bilibili account information",
  "runtime": "node",
  "status": "trusted",
  "sideEffect": "read",
  "requiresConfirmation": false,
  "whenToUse": [
    "用户询问当前 Bilibili 登录账号是谁",
    "用户需要 Bilibili mid、昵称、等级、会员状态"
  ],
  "whenNotToUse": [
    "查询其他人的公开主页",
    "执行点赞、投币、发弹幕等写操作"
  ],
  "tags": ["bilibili", "account"],
  "inputSchema": {
    "type": "object",
    "properties": {}
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "isLogin": { "type": "boolean" },
      "mid": { "type": "number" },
      "uname": { "type": "string" }
    }
  },
  "auth": {
    "type": "cookie",
    "refresh": "from-browser",
    "secretKey": "cookieHeader",
    "browserUrls": [
      "https://www.bilibili.com/",
      "https://api.bilibili.com/"
    ],
    "requiredCookieNames": ["SESSDATA"],
    "failureSignals": ["isLogin=false", "code=-101"]
  }
}
```

The contract lets an agent decide:

- whether this ability matches the user intent;
- what input shape to provide;
- what output shape to expect;
- whether it is safe to run without confirmation;
- how auth can be refreshed when credentials expire.

## AI Invocation Policy

Agents should follow this sequence:

```text
User request
  -> capability.search(query)
  -> capability.describe(id)
  -> check status, sideEffect, requiresConfirmation, schemas, auth
  -> capability.run(id, input)
  -> use structured output in the answer
```

Autonomous invocation is allowed only when:

- `status` is `trusted`;
- `sideEffect` is `read`;
- `requiresConfirmation` is `false`.

Agents must ask for user confirmation before:

- `write` or `dangerous` capabilities;
- payment, deletion, publishing, exporting private data, or account mutation;
- `refresh_auth`, because it updates local credentials;
- draft capabilities unless the user explicitly allows `--force`.

## CLI Surface

Human and agent-facing commands:

```bash
playwriter capability list
playwriter capability search "当前 Bilibili 登录账号"
playwriter capability describe bilibili-current-user --json
playwriter capability show bilibili-current-user --script
playwriter capability run bilibili-current-user --json
playwriter capability refresh-auth bilibili-current-user --browser user --json
playwriter capability refresh-auth bilibili-current-user --browser install:Chrome:qculboi03pt0 --json
```

Use `playwriter browser list` to pick a concrete browser key when more than one Chrome extension connection is available.

Editing commands:

```bash
playwriter capability create bilibili-current-user --runtime node
playwriter capability update bilibili-current-user --from-file script.js
playwriter capability update bilibili-current-user --contract-file contract.json
playwriter capability trust bilibili-current-user
playwriter capability draft bilibili-current-user
playwriter capability disable bilibili-current-user
```

## MCP Tool Gateway

The MCP exposes one stable gateway tool named `capability` instead of registering every saved CLI as a separate top-level tool. This avoids tool explosion and lets the agent retrieve only the relevant contract when needed.

Supported actions:

- `list`
- `search`
- `describe`
- `show`
- `run`
- `refresh_auth`

`playwriter://capabilities` exposes the AI-readable contracts as a JSON resource.

## Bilibili Example

The Bilibili current-user capability demonstrates the intended architecture:

1. Use the logged-in browser once to save cookies into `secrets.json`.
2. Run a `node` capability that calls `https://api.bilibili.com/x/web-interface/nav`.
3. Return structured account data without opening Chrome.
4. If the cookie expires, run `capability refresh-auth` after explicit user confirmation.

The important product property is that the later CLI call does not depend on an open Chrome tab.

## Safety Notes

- `secrets.json` is local-only and should not be printed into chat.
- Run logs should avoid storing raw credentials.
- Updating scripts or AI contracts should move the capability back to `draft` unless the user explicitly trusts it again.
- Agents should prefer `search` and `describe` before writing new automation.
