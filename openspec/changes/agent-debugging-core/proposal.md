---
title: Agent debugging core
description: Deliver a focused local browser understanding and debugging tool.
prompt: |
  User: 利用我们的工具，ai可以在调试的视角得到用户想要的结果，
  像一个前端工程师一样，而不用仅仅像普通人一样理解网页。
  User: 我们的产品一定要做的够核心，能真正的帮助ai而不是制定很多
  “规范”限制ai，导致ai效率更低。
  User: 好的请开始吧，直接给我验收最终成果。
  Use @README.md, @tabwright/src/skill.md, @openspec/project.md,
  @tabwright/src/executor.ts, and @tabwright/src/cdp-session.ts.
---

> Historical first-stage plan: recording/replay retention and its acceptance record
> are superseded by @../browser-core-convergence/proposal.md and
> @../../../docs/browser-core-acceptance.md. Core debugging requirements remain.

## Why

The browser engine is capable, but product entry points still lead with
workflow recording, generated Skills, and cloud rental. Network investigation
requires repeated handwritten listeners, while execution timeouts can be
mistaken for stopped actions. The product should help a capable agent obtain
reliable evidence cheaply, not add another planner or mandatory procedure.

## What Changes

- Add an explicitly enabled, bounded network inspector with request summaries,
  initiator locations, failures, redirects, and on-demand response excerpts.
- Expose local API references for network, source, and runtime debugging without
  requiring a remote documentation fetch or a full reference in model context.
- Rewrite the compact Skill and public entry points around independent debugging
  capabilities, preserving actual authorization and browser-lifecycle limits.
- Prevent overlapping executions after timeouts and report unknown outcomes.
- Redact credential fields in diagnostic CDP logs.
- Make background DOM activity recording opt-in; retain explicit replay as
  diagnostic evidence without a workflow-generation promise.
- Add repeatable local browser acceptance and non-updating regression checks.

## Capabilities

### New Capabilities

- `agent-debugging-core`: composable browser evidence, focused entry points,
  execution feedback, and local acceptance.

### Modified Capabilities

- None. Existing wire protocol and Skill runtime commands remain compatible.

## Impact

Public `tabwright` package, extension onboarding, documentation website, generated
API resources, and CI. A Changeset covers public behavior and the extension
manifest is bumped independently. No cloud deployment, account operation,
database change, public publish, or Playwright fork change is required.
