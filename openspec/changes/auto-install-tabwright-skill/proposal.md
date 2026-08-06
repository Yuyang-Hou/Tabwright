## Why

Installing the Tabwright CLI currently leaves the matching Agent Skill undiscoverable until the user separately imports it through an agent-specific manager. Users reasonably expect a globally installed browser CLI to teach compatible agents how to use it without a second undocumented installation workflow.

## What Changes

- Install the bundled Tabwright Skill automatically from the npm `postinstall` lifecycle into the shared user-level Agent Skills directory.
- Add explicit `tabwright skill install` and `tabwright skill status` commands for disabled lifecycle scripts, agent-specific directories, diagnostics, and recovery.
- Safely update copies previously managed by Tabwright while preserving user-modified or unrecognized files unless `--force` is explicit.
- Keep package installation successful when automatic Skill installation cannot write to the target directory, and print a recovery command.
- Update CLI, repository, package, and website documentation to describe the automatic flow and exceptions.
- Non-goals: install capability-specific Skills, silently overwrite user-authored instructions, or change browser/relay behavior.

## Capabilities

### New Capabilities

- `cli-skill-installation`: Automatic and explicit installation, update, status, and recovery behavior for the base Tabwright Agent Skill.

### Modified Capabilities

None; this repository did not previously contain archived OpenSpec capabilities.

## Impact

- Adds one npm lifecycle script and a bundled postinstall entrypoint to the public `tabwright` package.
- Writes the base Skill under the account running npm, defaulting to `~/.agents/skills/tabwright`.
- Adds small installation metadata next to the managed Skill so upgrades can distinguish safe updates from user edits.
- Updates installation and Agent Reference pages without changing generated `website/public` files directly.
