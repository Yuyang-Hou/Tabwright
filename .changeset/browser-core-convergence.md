---
"tabwright": minor
---

Focus Tabwright on live browser understanding, debugging and ordinary scripts.
Remove recording/replay, managed business Skill runtimes and cloud provisioning.
Keep core CDP and extension negotiation compatible, and reject retired commands
before execution with migration guidance. User-owned Skills can use plain `-f`
scripts or standalone APIs; installed Skills and old data are not changed.

Migration is required for callers of removed recording exports and managed-runtime
commands. See the browser core migration guide before replacing an installation.
