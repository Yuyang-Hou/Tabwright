## Context

Tabwright already supplies authenticated page-context requests plus Network and Debugger access. The missing behavior is a safe fallback for one-off requests, including pages whose original source repository is unavailable.

## Goals / Non-Goals

**Goals:**

- Ground request construction in the exact serving revision or deployed-client fingerprint.
- Recover only goal-relevant, client-observable request behavior from browser artifacts when source is unavailable.
- Give agents an optional local Wakaru tool for packed code that blocks understanding.
- Reuse browser login without reading or copying credentials.
- Keep one-off requests transient, with explicit confirmation and one-shot execution for mutations.
- Make an independent Agent Skill the only recommended durable unit, with Tabwright limited to validating and running its bundled runtime contract.

**Non-Goals:**

- Add endpoint registries, automatic whole-site decompilation, a generic decompiler abstraction, webcrack, Humanify, deployment integrations, or automatic mutation execution without a concrete preview and explicit confirmation.
- Claim complete source recovery, hidden server behavior, or permissions beyond the current account.
- Recreate a Tabwright-owned registry, Studio, replay compiler, or MCP routing layer.

## Decisions

### 1. Give the agent independent evidence tools

Page inspection, observed responses, source, Source Maps, bundles, runtime debugging, and Wakaru remain independent tools. The Skill describes their capabilities and lets the agent decide which combination best supports the user's request.

### 2. Bind every contract to the exact deployed client

When source exists, agents use available deployment tooling to identify the revision on ready instances and inspect that revision in isolation. When it does not, they fingerprint the loaded document and assets. Branch heads and successful builds are only candidates, and any changed fingerprint invalidates prior artifact inference.

### 3. Use observable behavior as the no-source boundary

Observed Network traffic proves actual requests. Public Source Maps, bundles, lazy chunks, Debugger call stacks, and runtime values may explain request fields, enums, validation, dependencies, transformations, and dynamic signing. Analysis stays scoped to the requested behavior; browser artifacts cannot establish hidden server logic.

### 4. Allow confirmed one-off mutations

Classify requests by observed semantics rather than HTTP method. A one-off mutation may use the transient path after the agent establishes the exact request and current state when observable, presents the target environment, method, path, input, and expected effect, and receives explicit confirmation. It executes once, is never automatically retried after an ambiguous result, and is verified through both the response and a state readback when observable. Repeated or durable mutations remain in independent Skill runtimes with machine-enforced confirmation.

### 5. Keep browser authentication opaque

Requests execute in the target page context through the site's request client when it supplies authentication, CSRF, or signatures, and otherwise through `fetch` with observed non-credential headers and browser credentials. Authentication material stays inside the page and cannot exceed the current account's permissions.

### 6. Expose Wakaru as an optional local primitive

The executor exposes exact runtime script source separately from a pinned Wakaru decompiler. Agents compose them when useful. An explicitly selected script can be saved locally by content hash so the agent searches bounded file excerpts instead of injecting the bundle into model context. Wakaru runs locally against the same content-addressed input, never executes recovered code, and reuses scoped derived output only when the content hash, Wakaru version, level, and unpack mode match.

### 7. Make Skills own durable automation

One-off work remains transient. When durable automation is justified, the agent creates or updates a standard Agent Skill directly. Agent-facing discovery and workflow live in `SKILL.md`; the machine contract and executable entry live under `runtime/`. Tabwright validates and runs that runtime in place and stores only device-local state.

The old project/user Capability registry, Capability Studio, MCP Capability tool, replay compiler, and draft-writing sandbox helpers are removed. Replay remains evidence only, while Agent Skill tooling owns durable authoring and distribution.

## Upgrade Behavior

The existing managed Skill installer distributes the updated compact Skill while preserving user-modified copies. The Tabwright package supplies the pinned Wakaru runtime on supported platforms and exposes Skill-owned runtime validation and execution commands. The extension guidance follows the Skill-owned path; the relay protocol remains compatible.
