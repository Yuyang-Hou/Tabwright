# Tabwright

Tabwright builds on Playwriter to let agents understand and debug a running web application like a frontend engineer. It exposes browser state, network evidence, source code, and runtime debugging through a composable local execution environment. Agents choose the approach; the product does not prescribe a workflow or require a reusable Skill.

Project requirements:

- Keep the extension, relay, CLI, and Agent Skill compatible across macOS, Linux, and Windows.
- Never introduce a breaking WebSocket protocol change while older extensions may still be installed.
- Preserve user-owned files and require explicit intent before replacing unrecognized local changes.
- Keep `tabwright/src/skill.md` as the full agent-reference source and `skills/tabwright/SKILL.md` as the compact installed Skill source.
- Add a Changeset for every public `tabwright` fix or feature.
- Prioritize local signed-in browser debugging. Cloud hosting, workflow compilation, and Skill management are not the product roadmap.
- Keep observations bounded and inspectable. Recording and replay are removed; do not add mandatory observation sequences.
- Report execution uncertainty accurately; a timeout is not proof that a browser action stopped.
