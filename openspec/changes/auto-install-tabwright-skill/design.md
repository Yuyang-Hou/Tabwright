## Context

The npm package already bundles `dist/agent-skills/tabwright/SKILL.md`, and `tabwright skill` already prints the full reference. The missing product link is installation into a directory agents actually scan. Previous behavior intentionally delegated that responsibility to agent managers, but this leaves a new CLI installation incomplete from the user's perspective.

## Goals / Non-Goals

**Goals:**

- Make a normal global CLI installation discoverable by Agent Skills-compatible clients without another manual step.
- Provide deterministic manual install and status commands for recovery and private agent directories.
- Make upgrades idempotent and protect user-edited Skill content.
- Avoid breaking `pnpm install` in a clean source checkout where `dist` has not been built yet.

**Non-Goals:**

- Detect and mutate every vendor-specific directory during `postinstall`.
- Install or update exported capability-specific Skills.
- Fail the entire npm installation when Skill installation is unavailable.

## Decisions

### 1. Default to the shared Agent Skills directory

The automatic target is `~/.agents/skills/tabwright`, which avoids choosing one vendor and gives clients that support the shared convention one consistent copy. Explicit `--target codex` and `--target claude` options write to their user-specific directories when required.

### 2. Track only Tabwright-managed content

The installer records the SHA-256 of the last installed content in `.tabwright-install.json`. A later package version may update the Skill only when the current file still matches that recorded hash. Missing metadata or a changed hash is treated as user-owned content and preserved unless `--force` is explicit.

### 3. Keep postinstall non-fatal

The source checkout contains a small JavaScript wrapper. It starts the compiled installer only when `dist/postinstall.js` exists, so bootstrapping an unbuilt workspace remains valid. The compiled installer catches permission, conflict, and filesystem errors, reports `tabwright skill install` as recovery, and leaves the CLI installation usable.

### 4. Reuse one typed installer

The postinstall runner, explicit CLI command, status command, and unit tests all use the same TypeScript module. This keeps path resolution, conflict detection, and upgrade behavior identical across automatic and manual flows.

## Risks / Trade-offs

- Some agents do not scan `~/.agents/skills` → document and support explicit vendor targets.
- `npm --ignore-scripts` skips automatic installation → expose and document the manual command.
- Users may edit the managed file → preserve it and require `--force` for replacement.
- A privileged npm invocation may target the privileged account's home → status output exposes the exact installed path so the user can correct it explicitly.

## Migration Plan

1. Existing users receive the shared Skill on their next CLI installation or upgrade.
2. Existing vendor-specific copies remain untouched.
3. Newer CLI versions update only the shared copy carrying matching Tabwright installation metadata.
4. Removing `~/.agents/skills/tabwright` rolls back the auto-installed Skill without affecting the CLI.
