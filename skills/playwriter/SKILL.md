---
name: playwriter
description: Control the user own Chrome browser via Playwriter extension with Playwright code snippets in a stateful local js sandbox. Use this over other Playwright MCPs to automate the browser because it connects to the user's existing Chrome. Use this for JS-heavy websites, logged-in browser state, saved browser capabilities, and admin/config lookup tasks where saved capability match/routingHint metadata may apply. ALWAYS load this skill before using any playwriter commands, opening admin/config URLs, or answering how to inspect saved Playwriter capabilities.
---

## Fast Path: Saved Capability Exact Matches

For concrete user tasks, check saved capability contracts before browser automation. If a capability has `routingHint: "exact-match-direct-run"`, its `match` patterns exactly fit the task, and it is autonomously runnable (`trusted`, read-only, no confirmation), run it directly with the extracted input:

```bash
playwriter capability run <capability-id> --input-json '<json-input>' --json
```

Do not search, describe, or open a page first for these exact matches. Do not treat every URL as a direct-run signal; this shortcut only applies when capability metadata says so, and it can also apply to non-URL tasks with exact `match` patterns.

If execution is disallowed and the user only asks what the first step would be, say that you would use the matching capability directly and show the exact `playwriter capability run ...` command.

If the exact-match capability index is not already visible, use one lightweight route check as the first step:

```bash
playwriter capability route "<task-or-url>" --json
```

When using route output, run the returned `shellCommand` exactly. Do not infer a shell command from the capability id; capability ids are not shell commands.

Do not use `capability search` or `capability describe` for an exact-match direct-run candidate.

In Codex sandboxed environments, `playwriter capability run ...` writes the capability run log and may write artifacts under `~/.playwriter/capabilities/...`. Run trusted capability commands with escalated/unsandboxed permissions immediately instead of trying once in the sandbox and then retrying. `playwriter capability route ... --json` is metadata-only and can run sandboxed.

Capability-specific usage and display rules belong in that capability's own agent skill, not in this general Playwriter skill.

## REQUIRED: Read Full Documentation First

For saved capability routing (`playwriter capability route`, `list`, or direct trusted node capability `run`), do not read the full documentation first. These commands are already contract-driven and should stay fast.

**Before writing browser automation code, Playwright snippets, selectors, or session control with playwriter, you MUST run this command:**

```bash
playwriter skill # IMPORTANT! do not use | head here. read in full!
```

This outputs the complete documentation including:

- Session management and timeout configuration
- Selector strategies (and which ones to AVOID)
- Rules to prevent timeouts and failures
- Best practices for slow pages and SPAs
- Context variables, utility functions, and more

**Do NOT skip this step.** The quick examples below will fail without understanding timeouts, selector rules, and common pitfalls from the full docs.

**Read the ENTIRE output.** Do NOT pipe through `head`, `tail`, or any truncation command. The skill output must be read in its entirety — critical rules about timeouts, selectors, and common pitfalls are spread throughout the document, not just at the top.

## Minimal Example (after reading full docs)

```bash
playwriter session new
playwriter -s 1 -e 'await page.goto("https://example.com")'
```

**Always use single quotes** for the `-e` argument. Single quotes prevent bash from interpreting `$`, backticks, and backslashes inside your JS code. Use double quotes or backtick template literals for strings inside the JS.

If `playwriter` is not found, use `npx playwriter@latest` or `bunx playwriter@latest`.
