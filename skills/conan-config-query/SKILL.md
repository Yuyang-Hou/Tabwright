---
name: conan-config-query
description: Query Conan/Buff copywriting config admin URLs with Tabwright saved capabilities. Use immediately, before memory/history lookup or browser/page inspection, when the user asks to view, inspect, read, check, or analyze a buff.zhenguanyu.com or conan.zhenguanyu.com Space_Enhanced_Config URL containing key plus rootGroupingKey/namespace, especially links like buff-army/#/buff-oversea-designer/Space_Enhanced_Config?key=...&rootGroupingKey=.... The first action must be either `tabwright capability route ... --json` or `tabwright capability run conan-config-query --input-json ... --json`; `conan-config-query` is only a capability id, never a shell command. Do not first explain, mention loading/reading this skill, search memory, open the page, or run tabwright skill.
---

## Exact Config URL Workflow

For a matching `Space_Enhanced_Config` URL, do not open the page, do not mention browser state, do not mention loading/reading this skill, do not search memory/history, do not run `tabwright skill`, and do not explain the plan before acting. Do not send a progress update before the first command.

First action:

```bash
tabwright capability route "<config-admin-url>" --json
```

If it returns `conan-config-query`, immediately run the returned `shellCommand` exactly. `conan-config-query` is a capability id, not an executable shell command; never run `conan-config-query "<url>"`.

Direct run is also valid when the URL clearly matches:

```bash
tabwright capability run conan-config-query --input-json '{"url":"<config-admin-url>"}' --json
```

In Codex sandboxed environments, run that `tabwright capability run ...` command with escalated/unsandboxed permissions on the first try because it writes `runs.jsonl` and artifacts under `~/.tabwright/capabilities/...`.

After success, answer from the capability output and artifact paths only. Mention `namespace`, `key`, `configId`, top-level array counts, `latest.full.json`, `latest.value.json`, and `latest.summary.md`. Do not perform extra business analysis such as filtering currently effective items unless the user asks for it.

## Default Display Discipline

The capability already saves complete artifacts. Do not create extra CSV/JSON/Markdown files in the thread output directory unless the user explicitly asks for an export file.

If the user asks for a large filtered subset, keep the chat answer compact:

- Report the matching count and filter rule.
- Show at most 10 representative rows with only the fields needed for the question.
- Point to `latest.value.json` or `latest.full.json` for complete details.

For "开启的落地页发券配置", filter `value.landingPageCouponConfigList` by `switchOn === true`. Do not include `newArrivalCouponConfigList` unless the user asks for 新品券. Do not generate a CSV by default.

If route returns no match, fall back to `tabwright capability search "<user task>" --json`.
