# Tabwright Capability CLI System

This document records the product and technical design for turning browser work into reusable CLI capabilities that agents can discover, understand, and call.

## Goal

Tabwright capabilities are local tools generated from real browser context. A capability should not stop at a saved script. It needs three durable parts:

- Executable logic: `script.js`, runnable by the CLI or MCP.
- Semantic contract: AI-readable intent, schemas, safety level, auth plan, and examples.
- Operational memory: local secrets and recent run history.

The target flow is:

```text
User demonstration or successful browser task
  -> replay evidence and annotations
  -> deterministic compiler when the workflow type is supported
  -> AI handoff with compact evidence when it is not supported
  -> draft contract and script
  -> validation in the original user-browser context
  -> explicit confirmation for concrete side effects
  -> user trust
  -> route and run from a fresh AI session
```

The product is successful only when the final fresh-session route works. Saving a script is an intermediate state, not the completion condition.

## Product Lifecycle

Every generated capability moves through explicit states:

```text
recorded -> indexed -> drafted -> validated -> trusted
                         |            |
                         +-> needs_ai +-> confirmation-required run
```

- `recorded`: the replay is evidence, not executable truth.
- `indexed`: actions, fields, annotations, requests, and selector evidence are available in an AI-sized view.
- `drafted`: contract and script exist, but require review and `--force` for testing.
- `validated`: input/output schemas, runtime, page match, and observable result have passed a real test.
- `trusted`: the user has accepted the durable behavior. Trust does not remove per-run confirmation when `requiresConfirmation` is true.
- `needs_ai`: the compiler or live script cannot safely infer the next action; it returns evidence instead of pretending success.

The lifecycle must preserve these invariants:

- Browser workflows derived from a logged-in replay run with `--browser user` or an explicit browser key, never silently in headless Chrome.
- `--force` permits draft testing or URL-match bypass only. It never acknowledges a side effect.
- A confirmation-required run must stop before script execution unless `--confirm` repeats the exact capability id after explicit user approval.
- Search and route outputs are compact by default; full contracts and scripts are fetched only for the selected candidate.
- A task owns its session and page. Existing sessions are health evidence, not safe defaults for another agent.
- Unsupported replay types produce a structured AI handoff and never a fake runnable capability.

## Runtime Types

Capabilities currently support:

- `node`: runs without opening Chrome. Use this for HTTP/API abilities such as querying the current Bilibili account from saved cookies.
- `browser`: runs in a Tabwright browser session. Use this for workflows that require DOM interaction, page JavaScript, or user-visible browser state.

Auth refresh is modeled separately from the main runtime. A `node` capability can declare cookie auth that is refreshed from the current browser only when the user explicitly allows it.

## Capability Files

Capabilities live under either:

```text
.tabwright/capabilities/<id>/
~/.tabwright/capabilities/<id>/
```

Each capability directory contains:

```text
capability.json   # manifest and AI contract
script.js         # executable logic
secrets.json      # local credentials, never printed by default
runs.jsonl        # operational memory
README.md         # human-facing notes
```

## Portable Agent Skill Distribution

Agent-native discovery and distribution use the open Agent Skills structure instead of a Tabwright-specific installer. Export one capability or migrate all saved capabilities with:

```bash
tabwright capability skill export query-user --output ./skills/query-user
tabwright capability skill export-all --output ./skills
```

The result is both portable to an Agent Skills-compatible manager and explicit about its Tabwright runtime dependency:

```text
query-user/
  SKILL.md
  agents/openai.yaml
  runtime/
    capability.json
    script.js
```

`SKILL.md` is the only distributed semantic source for agent discovery, workflow, and display rules. The exported `runtime/capability.json` strips duplicated discovery fields and keeps the machine-enforced execution contract. Generated instructions tell a fresh agent how to detect or run the CLI, resolve runtime paths relative to `SKILL.md`, install the runtime as draft, validate it, and refresh auth when required. Export never includes local secrets, runs, or artifacts.

Existing `.tgz` packages remain a capability-runtime compatibility surface. Agent skill installation and updates belong exclusively to the agent's official manager.

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
  -> capability.route(task)
  -> exact trusted read match: run returned shellCommand
  -> otherwise capability.search(query)
  -> capability.describe(id)
  -> check status, sideEffect, requiresConfirmation, schemas, auth
  -> stop for approval when confirmation is required
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

After the user approves a concrete confirmation-required run, the CLI acknowledgement is explicit and capability-specific:

```bash
tabwright capability run update-user --input-json '{"email":"a@example.com"}' --browser user --confirm update-user --json
```

`--confirm update-user` is an acknowledgement, not an unforgeable identity proof. A future stronger approval boundary should bind a one-time token to the capability id, input hash, and script/manifest digest, or use a native client approval UI.

## CLI Surface

Human and agent-facing commands:

```bash
tabwright capability list
tabwright capability route "当前 Bilibili 登录账号" --json
tabwright capability search "当前 Bilibili 登录账号"
tabwright capability describe bilibili-current-user --json
tabwright capability show bilibili-current-user --script
tabwright capability run bilibili-current-user --json
tabwright capability refresh-auth bilibili-current-user --browser user --json
tabwright capability refresh-auth bilibili-current-user --browser install:Chrome:qculboi03pt0 --json
```

Use `tabwright browser list` to pick a concrete browser key when more than one Chrome extension connection is available.

Editing commands:

```bash
tabwright capability create bilibili-current-user --runtime node
tabwright capability update bilibili-current-user --from-file script.js
tabwright capability update bilibili-current-user --contract-file contract.json
tabwright capability trust bilibili-current-user
tabwright capability draft bilibili-current-user
tabwright capability disable bilibili-current-user
```

## MCP Tool Gateway

The MCP exposes one stable gateway tool named `capability` instead of registering every saved CLI as a separate top-level tool. This avoids tool explosion and lets the agent retrieve only the relevant contract when needed.

Supported actions:

- `list`
- `route`
- `search`
- `describe`
- `show`
- `run`
- `refresh_auth`

`tabwright://capabilities` exposes the AI-readable contracts as a JSON resource.

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

## Quality Gates For Generated Capabilities

A generated capability is ready for trust only after all applicable gates pass:

1. Contract: specific `whenToUse` and `whenNotToUse`, input/output schemas, runtime, side effect, confirmation, auth, and match metadata.
2. Script: no embedded secrets, no undeclared external hosts, and an explicit `needs_ai` result for page drift.
3. Test: run in a task-owned session against the original user-browser context; verify output schema and the observable page or response result.
4. Safety: demonstrate that draft, URL, and confirmation gates fail before execution when their acknowledgements are absent.
5. Fresh-session acceptance: a new AI can route, describe only when needed, execute the correct command, and explain the result without reading the implementation.
6. Packaging: exported bundles exclude `secrets.json`, `runs.jsonl`, and artifacts; imported capabilities start as draft.

## Product Metrics

Track the loop rather than raw recording counts:

- time from installation to first successful task-owned session;
- route precision and the number of contracts loaded before execution;
- context tokens consumed by discovery, evidence, and output;
- replay classification coverage and `needs_ai` recovery rate;
- generated-capability validation pass rate;
- fresh-session route-and-run success rate;
- node capability wall time versus script duration;
- confirmation blocks before script execution;
- drift rate after 7 and 30 days.

## Near-Term Technical Plan

1. Finish the shell loop: local `replay list`, compact indexes, structured unsupported-workflow handoff, validate/test, and safe pack/import.
2. Make discovery context-bounded: compact search results, minimum relevance, one selected contract, and no duplicate text in JSON output.
3. Build on the browser-graph foundation—settled profile selection, compatible relay restart recovery, and heartbeat expiry—with explicit protocol feature negotiation that does not break old extensions.
4. Turn the Options page into the lifecycle UI: record guidance, compiler support status, validation evidence, approval state, trust, and export.
5. Add contract conformance: compare observed outputs and network hosts with schemas/permissions, then downgrade drifted capabilities to draft.
