# Write operations

Every write requires a read-only preparation, a structured preview, and explicit confirmation for that exact prepared state. Never retry a failed or partially completed write automatically.

## Change content

Prepare the complete target value:

```bash
tabwright capability run "<runtime-dir>" --input-json '{"action":"prepare-change","url":"<config-url>","value":<complete-target-json>,"changeSummary":"<summary>"}' --json
```

Show the environment, changed paths, before/after values, warnings, and existing-draft state. After confirmation, use exactly one operation:

- `save-draft` with `--confirm conan-config:save-draft`
- `apply-change` with `--confirm conan-config:apply-change`

Pass the unchanged target value, summary, and validation report. Do not overwrite an existing draft.

## Publish or discard a draft

Run `prepare-publish-draft`, validate `draftValue`, and show the diff, operator, environment, warnings, `configDraftId`, and `draftSha256`.

- Publish with `--confirm conan-config:publish-draft`.
- Discard with `--confirm conan-config:discard-draft` only after explicitly explaining the destructive effect.

## Create or copy

- Resolve `groupingId`, then run `prepare-create`; confirm with `conan-config:create`.
- Run `prepare-copy`; confirm with `conan-config:copy`.
- Copying reuses metadata and Schema but does not copy the source value. Copy content later through the normal change workflow.

## Roll back

List history, select one `historyId`, then run `prepare-rollback`. Validate the historical value and Schema, show the semantic diff, and stop if a draft exists. Confirm with `conan-config:rollback`.

## Allowed confirmation tokens

- `conan-config:save-draft`
- `conan-config:apply-change`
- `conan-config:publish-draft`
- `conan-config:discard-draft`
- `conan-config:create`
- `conan-config:copy`
- `conan-config:rollback`
