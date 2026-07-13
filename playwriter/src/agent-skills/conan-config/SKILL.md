---
name: conan-config
description: Search, read, inspect history and schemas, validate edits, manage drafts, publish, create, copy, and roll back domestic Conan/Buff Space_Enhanced_Config configs through the unified Playwriter conan-config capability. Use immediately for exact config URLs, config keywords, draft or history questions, and explicit config changes in cn-prod or cn-test. Run read operations autonomously; require a prepared immutable report, a structured semantic diff or definition preview, and explicit user confirmation for every write operation.
---

# Conan Config

Use `playwriter capability run conan-config`; never execute `conan-config` as a shell command.

## Select the environment

Infer the environment from an exact URL:

- `cn-prod`: `conan.zhenguanyu.com`, `buff.zhenguanyu.com`
- `cn-test`: `ytkconan.zhenguanyu.com`, `buff-test.zhenguanyu.com`

Pass `environment` explicitly when no URL is available. For a write, stop and resolve an ambiguous environment before preparing the change. Do not use this capability for overseas hosts.

Capability runs write local run logs and artifacts under `~/.playwriter/capabilities/conan-config/`; use escalated execution in a Codex sandbox. If cookie auth is missing or expired, report the blocker and obtain approval before running:

```bash
playwriter capability refresh-auth conan-config --browser user --json
```

## Run read operations directly

Run these operations without confirmation:

```bash
playwriter capability run conan-config --input-json '{"action":"list-spaces","environment":"cn-prod"}' --json
playwriter capability run conan-config --input-json '{"action":"search","environment":"cn-test","query":"会员订单"}' --json
playwriter capability run conan-config --input-json '{"action":"history","url":"<config-url>"}' --json
playwriter capability run conan-config --input-json '{"action":"get-schema","url":"<config-url>"}' --json
```

For an exact `Space_Enhanced_Config` URL, route or get it immediately:

```bash
playwriter capability route "<config-url>" --json
playwriter capability run conan-config --input-json '{"action":"get","url":"<config-url>"}' --json
```

Use `historyIds` with `history` only when full historical values are needed. Keep large values out of chat and point to saved artifacts. Production artifacts retain the legacy path `artifacts/conan-config/<namespace>/<key>/`; test artifacts use `artifacts/conan-config/cn-test/<namespace>/<key>/`.

## Validate values

Validate the complete target value, not only changed fields. Check:

- Formily field types, required fields, enums, defaults, `x-validator`, and `x-reactions`
- component semantics and nested array/object shapes
- unchanged legacy fields that the schema may not expose
- every path in the structured semantic Diff
- suspicious test markers such as `ytk`, `.biz`, or `test` when targeting `cn-prod`

Return a report with `passed`, `errors`, `warnings`, `warningsAccepted`, `environment`, the hashes and version fields returned by the prepare operation, and `summary`. Never mark warnings accepted unless the user explicitly accepts them.

## Change content

Prepare the complete target value:

```bash
playwriter capability run conan-config --input-json '{"action":"prepare-change","url":"<config-url>","value":<complete-target-json>,"changeSummary":"<summary>"}' --json
```

Show `environment`, field paths, before/after values, warnings, and whether a draft exists. Then choose exactly one confirmed write:

- Save without publishing: `save-draft` with `--confirm conan-config:save-draft`
- Update and publish atomically: `apply-change` with `--confirm conan-config:apply-change`

Pass the unchanged complete target value, summary, and validation report. Both operations recheck `environment`, `schemaId`, `updatedTime`, `sourceSha256`, and `targetSha256`. Do not overwrite an existing draft.

## Publish or discard a draft

Prepare an existing draft:

```bash
playwriter capability run conan-config --input-json '{"action":"prepare-publish-draft","url":"<config-url>"}' --json
```

Validate `draftValue`, show the Diff against `currentValue`, the draft operator, environment, and warnings, then:

- Publish with the unchanged validation report and `--confirm conan-config:publish-draft`.
- Discard only after showing `configDraftId`, operator, environment, and Diff; pass the prepared `configDraftId` and `draftSha256` with `--confirm conan-config:discard-draft`.

Treat discarding as destructive. Never retry a failed or partially completed draft write automatically.

## Create a config

Resolve the target `groupingId` with `list-spaces` or `search`, then prepare:

```bash
playwriter capability run conan-config --input-json '{"action":"prepare-create","environment":"cn-test","groupingId":123,"key":"CONFIG_KEY","name":"配置名称","desc":"配置描述","schemaId":456}' --json
```

Show the complete definition, target root grouping, environment, Schema summary, and warnings. After confirmation, pass `environment`, `targetSha256`, and `groupingUpdatedTime` unchanged in `preparationReport`, then run `create` with `--confirm conan-config:create`.

Creating a config does not create or edit a Schema. A `schemaId` of `0` means no Formily Schema and must be shown as a warning.

## Copy a config definition

Prepare the source and target:

```bash
playwriter capability run conan-config --input-json '{"action":"prepare-copy","sourceUrl":"<source-config-url>","groupingId":123,"targetKey":"CONFIG_KEY_COPY"}' --json
```

Show the source, target, environment, target grouping, and `contentCopied: false`. The B-side copy flow copies metadata and reuses the source `schemaId`; it does not copy the source value. After confirmation, pass the unchanged preparation fields and run `copy` with `--confirm conan-config:copy`.

If the user also wants content copied, create the target definition first, then run the normal `prepare-change` and `save-draft` or `apply-change` workflow on the new target.

## Roll back

List history, choose one `historyId`, then prepare:

```bash
playwriter capability run conan-config --input-json '{"action":"prepare-rollback","url":"<config-url>","historyId":123}' --json
```

Validate the full historical value against its historical Schema. Show the environment, history record, Schema change, and semantic Diff. Stop if a draft exists. After confirmation, pass the unchanged report fields and run `rollback` with `--confirm conan-config:rollback`.

Rollback creates and publishes a draft with operation type `backtrace`, then reads the live config back. Never retry it automatically.

## Confirmation discipline

Never call a write operation directly from a raw user request. Always run its read-only prepare operation first, display the concrete target and side effect, and obtain confirmation for that exact prepared state.

Use only these write confirmations:

- `conan-config:save-draft`
- `conan-config:apply-change`
- `conan-config:publish-draft`
- `conan-config:discard-draft`
- `conan-config:create`
- `conan-config:copy`
- `conan-config:rollback`

Do not use this capability to delete configs, manage groupings, create or edit Schemas, change favourites, or operate overseas environments.

## Report results

Keep answers compact. Always report `environment`, `namespace`, `key`, `configId`, operation status, and verification result. For writes, also report `configDraftId` when present and state whether the change was published. Do not create extra export files unless requested.
