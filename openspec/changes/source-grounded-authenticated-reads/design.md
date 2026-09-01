## Context

Tabwright already supplies authenticated page-context requests and saved capabilities. The missing behavior is a safe fallback for one-off reads when no exact capability exists and current source is available.

## Goals / Non-Goals

**Goals:**

- Ground request construction in the exact revision serving the target environment.
- Reuse browser login without reading or copying credentials.
- Keep the fallback transient and read-only.

**Non-Goals:**

- Add endpoint registries, source parsers, deployment integrations, or generic mutations.
- Replace saved capabilities for repeated, schema-heavy, or confirmation-required workflows.

## Decisions

### 1. Implement this as agent guidance

Existing Tabwright primitives already execute the request. Adding runtime code would duplicate browser and capability behavior without improving safety.

### 2. Treat serving revision as the source boundary

Agents must use available deployment tooling to identify the revision on ready instances and inspect that revision in isolation. Branch heads and successful builds are only candidates, not proof of what is running.

### 3. Limit transient execution to reads

Only `GET` and `HEAD` requests whose source semantics are read-only qualify. Mutations require a saved capability with machine-enforced confirmation or a reviewed product workflow.

## Upgrade Behavior

The existing managed Skill installer distributes the updated compact Skill while preserving user-modified copies. No filesystem paths, platform commands, or package lifecycle behavior change.
