# Tabwright

Tabwright gives AI agents a CLI and reusable Skill runtime for controlling user-authorized Chrome tabs and compiling authenticated web workflows into portable Agent Skills.

Project requirements:

- Keep the extension, relay, CLI, and Agent Skill compatible across macOS, Linux, and Windows.
- Never introduce a breaking WebSocket protocol change while older extensions may still be installed.
- Preserve user-owned files and require explicit intent before replacing unrecognized local changes.
- Keep `tabwright/src/skill.md` as the full agent-reference source and `skills/tabwright/SKILL.md` as the compact installed Skill source.
- Add a Changeset for every public `tabwright` fix or feature.
