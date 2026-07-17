---
name: conan-config
description: Search, read, inspect, validate, and safely manage domestic Conan/Buff Space_Enhanced_Config configs through the Tabwright conan-config capability. Use immediately for config keywords, exact admin URLs, namespace/key lookups, schema or history questions, and explicit cn-prod/cn-test config changes. Run reads autonomously; require a prepared immutable report, structured semantic diff, and explicit confirmation for writes.
---

## Tabwright Runtime

Resolve `<runtime-dir>` to the absolute `runtime/` directory next to this `SKILL.md` and run it directly. Use `tabwright` when available; if it is missing or too old for Skill runtime paths, replace it with `npm exec --yes --package=tabwright@latest -- tabwright`. Ask the user only if Node.js or npm is unavailable.

Tabwright validates the runtime and refreshes declared browser authentication automatically. Do not run `describe`, `trust`, `--force`, or `refresh-auth` as setup. Pause only if Tabwright reports that the required Chrome login is unavailable.


# Conan Config

Use `tabwright capability run "<runtime-dir>"`; never execute the capability id as a shell command.

## Fast read path

Treat a simple keyword or exact-URL lookup as self-contained. Do not inspect memory, workspace files, capability metadata, or the admin page first.

- Default an environment-less keyword search to `cn-prod` and state that assumption.
- Infer `cn-test` from `ytkconan.zhenguanyu.com` or `buff-test.zhenguanyu.com` URLs.
- Run exactly one capability command, then answer from its compact output.
- Do not automatically fetch every ambiguous search result; show the matches and let the user choose.

```bash
tabwright capability run "<runtime-dir>" --input-json '{"action":"search","environment":"cn-prod","query":"<keyword>"}' --json
tabwright capability run "<runtime-dir>" --input-json '{"action":"get","url":"<config-url>"}' --json
```

Use `"detailLevel":"full"` only when the user needs complete per-mode search records. For exact `namespace` plus `key`, call `get` directly.

## Writes

For changes, drafts, publishing, creation, copying, or rollback, read [references/write-operations.md](references/write-operations.md). For value validation, also read [references/validation.md](references/validation.md). Never run a write directly from a raw request.

## Report

Keep read results compact: report `environment`, name, `namespace`, `key`, and `configId`. For writes, also report the prepared diff, confirmation state, `configDraftId` when present, publication status, and read-back verification.
