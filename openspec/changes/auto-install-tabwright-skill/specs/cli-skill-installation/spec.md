## ADDED Requirements

### Requirement: CLI installation makes the base Skill discoverable

A normal Tabwright npm installation SHALL install the bundled base Tabwright Skill into the current user's shared Agent Skills directory.

#### Scenario: First global installation

- **WHEN** npm runs the package lifecycle scripts for a user without an installed base Tabwright Skill
- **THEN** `~/.agents/skills/tabwright/SKILL.md` contains the Skill bundled with that CLI version
- **AND** installation metadata records the installed content fingerprint

#### Scenario: Lifecycle scripts are disabled

- **WHEN** the user installs the package with lifecycle scripts disabled
- **THEN** the CLI remains usable
- **AND** `tabwright skill install` installs the same bundled Skill explicitly

### Requirement: Managed upgrades are automatic and idempotent

The installer SHALL update a previously managed copy when its recorded content is unchanged and SHALL make repeated installation a no-op when the bundled and installed content already match.

#### Scenario: CLI upgrade changes the bundled Skill

- **WHEN** the installed file still matches the fingerprint recorded by the previous Tabwright installer
- **AND** the new CLI bundles different Skill content
- **THEN** postinstall replaces the managed file and records the new fingerprint

#### Scenario: Reinstalling the same CLI content

- **WHEN** the installed and bundled Skill content match
- **THEN** installation reports `unchanged`
- **AND** the file content remains unchanged

### Requirement: User-modified Skill content is protected

Automatic installation SHALL NOT overwrite Skill content that differs from both the current bundle and the fingerprint recorded by Tabwright.

#### Scenario: User edited the managed Skill

- **WHEN** postinstall finds user-modified Skill content
- **THEN** it preserves the file
- **AND** package installation remains successful
- **AND** it prints the explicit manual recovery command

#### Scenario: User explicitly replaces the modified copy

- **WHEN** the user runs `tabwright skill install --force`
- **THEN** the bundled Skill replaces the modified copy
- **AND** installation metadata records the new fingerprint

### Requirement: Agent-specific recovery targets are available

The explicit installer SHALL support the shared Agent Skills directory and vendor-specific Codex and Claude user directories.

#### Scenario: Agent scans only its private directory

- **WHEN** the user runs `tabwright skill install --target codex` or `--target claude`
- **THEN** the Skill is installed under that agent's user-level skills directory
- **AND** status output reports the exact installed path
