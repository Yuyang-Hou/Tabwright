# Validation

## 2026-09-01 implementation verification

- Manual end-to-end proof: deployment evidence identified exact revisions in two environments, both revisions exposed the same source-confirmed read route, and page-context authenticated requests returned successful HTTP and application results.
- `pnpm typecheck` in `tabwright/`: passed.
- `pnpm build` in `tabwright/`: passed outside the filesystem sandbox after the sandboxed run was blocked from creating the `tsx` IPC pipe; generated both the full and compact Skill resources with the new guidance.
- Skill Creator `quick_validate.py` against `skills/tabwright`: passed using an isolated temporary PyYAML dependency.
- `openspec validate source-grounded-authenticated-reads --strict`: passed.
- `git diff --check`: passed.

## 2026-09-02 authenticated no-source browser proof

- Target: the authenticated GitHub Notifications page, treated only as its deployed document, browser traffic, and loaded assets; no source repository was used.
- Deployment evidence: page release `f2aafd6dcda5889831f8b321ca63683528f64dec`; runtime chunk `f7p-68bd67a1d0bcb2ef.js` had SHA-256 `0c6211728a19b7be7df541cb7fb0628afb7602ea892c3637586af4ac4cf8c729`.
- Runtime script search recovered the default `GET /notifications/indicator` route, enable flag, retry defaults, and response modes `none`, `global`, `disabled`, and `unavailable`.
- Observed Network traffic showed the page sent `Accept: application/json` and `X-Requested-With: XMLHttpRequest`. A page-context replay that omitted those non-credential headers returned HTTP `400`; replaying the observed contract returned HTTP `200` with a JSON `mode` matching the recovered enum.
- No Cookie, token, CSRF value, response value, notification content, or mutation was returned to the agent.

## 2026-09-02 artifact-grounded expansion verification

- `pnpm build` in `tabwright/`: passed outside the filesystem sandbox after the sandboxed run was blocked from creating the `tsx` IPC pipe; regenerated the bundled, MCP, and website Skill resources.
- `pnpm typecheck` in `tabwright/`: passed.
- Skill Creator `quick_validate.py` against `skills/tabwright`: passed.
- Generated compact, full, and well-known Skill files exactly match their sources.
- `openspec validate source-grounded-authenticated-reads --strict`: passed.
- `pnpm changeset status`: passed with a patch bump for `tabwright`.
- `git diff --check`: passed.

## 2026-09-02 optional Wakaru tooling verification

- Pinned `@wakaru/cli@1.10.0`; the public package supplies platform binaries through optional dependencies and reports unsupported hosts without changing browser state.
- Focused Vitest run: 26 tests passed across raw Editor source, Wakaru artifact generation, executor utilities, and compact Skill packaging.
- The Wakaru fixture recovered `/notifications/indicator`, `X-Requested-With`, and the expected response enum from a packed webpack-style script without executing it.
- `pnpm typecheck`: passed.
- Generated `editor-api.md`, compact Skill, full Skill, and discovery resources were rebuilt successfully.
- Skill Creator `quick_validate.py`: passed with an isolated PyYAML runtime.
- `openspec validate source-grounded-authenticated-reads --strict`: passed.
- `pnpm exec changeset status`: passed with a minor bump for `tabwright`.
- `git diff --check`: passed.
- The full `pnpm build` passed after a transient `cdnjs.cloudflare.com` TLS reset recovered, including extension packaging and generated resources.
- The targeted real-Chrome Editor integration test passed; the deterministic CDP unit test also covers exact source, source-map URL, and SHA-256 behavior.

## 2026-09-03 Skill-owned runtime verification

- Added `tabwright skill runtime validate <skillDir>` as a non-executing structural runtime check and `tabwright skill runtime run <skillDir>` as the primary in-place execution path.
- A focused CLI test created an independent Skill, validated a script that would throw if executed, then replaced it with a read-only Node runtime and ran it successfully without creating a project or user Capability registry entry.
- Capability registry, Studio, replay compilation/evaluation, MCP registry surfaces, and draft-writing sandbox helpers were removed; replay discovery returns inspection evidence only.
- Bundled Skills invoke the Skill-owned runtime command and keep device-local state outside their Skill directories.
- Focused Vitest run: 55 tests passed and 1 existing test was skipped across Skill runtime CLI, generated Skill compatibility, replay evidence, raw Editor source, Wakaru, executor utilities, extension options, and compact Skill packaging.
- `pnpm typecheck`: passed.
- Full `pnpm build`: passed outside the filesystem sandbox after the sandboxed run was blocked from creating the `tsx` IPC pipe; extension packaging and all generated Skill/resources completed.
- Skill Creator `quick_validate.py`: passed for Tabwright and all five migrated bundled Skills.
- `tabwright skill runtime validate`: passed for all five bundled runtime contracts without executing them.
- A full serial Vitest attempt completed 32 files and 240 assertions without an assertion failure, then 8 extension suites failed during setup because `cdnjs.cloudflare.com` reset the TLS connection while downloading Prism assets; 63 dependent browser tests were skipped. The focused in-scope suites and the standalone extension build passed.
- Generated compact, full, and well-known Skill resources were rebuilt from their sources.
- `openspec validate source-grounded-authenticated-reads --strict`, `pnpm exec changeset status`, and `git diff --check`: passed.

## 2026-09-03 agent tool-choice guidance

- Compact and full Tabwright Skills now present page state, Network, deployed code, runtime debugging, and Wakaru as independently usable capabilities selected by agent judgment.
- Generated Skill resources were rebuilt, Skill Creator validation passed, and the updated Codex Skill was installed with matching bundled and installed hashes.
- Focused Skill and CLI tests: 12 passed.
- `openspec validate source-grounded-authenticated-reads --strict` and `git diff --check`: passed.

## 2026-09-03 local bundle cache verification

- `Editor.saveRaw` stores exact runtime JavaScript once under `.tabwright/artifacts/web/blobs/<sha256>.js` and returns only its path, hash, size, Source Map URL when available, and cache status.
- Wakaru input reuses the content-addressed source file, while derived output is keyed by source hash, pinned Wakaru version, level, and unpack mode.
- Focused Vitest run: 32 tests passed across Editor persistence, real Wakaru generation and cache reuse, executor utilities, and bundled Skill compatibility.
- `pnpm typecheck`, the full `pnpm build`, Skill Creator validation, strict OpenSpec validation, Changesets status, and `git diff --check`: passed.

## 2026-09-03 confirmed one-off mutation guidance

- The compact and full Tabwright Skills allow evidence-grounded one-off mutations after showing the concrete environment, method, path, input, and expected effect and receiving explicit confirmation.
- Mutation guidance classifies requests by observed semantics, executes a confirmed request once, prohibits automatic retry after an ambiguous result, and requires response and state verification when observable.
- `pnpm typecheck`, the full `pnpm build`, Skill Creator validation, strict OpenSpec validation, Changesets status, and generated-resource equality checks passed.
- Focused Skill installation and CLI tests: 17 passed.
- The locally installed Codex Skill was safely updated from the local build and its installed hash matches the bundled hash.
