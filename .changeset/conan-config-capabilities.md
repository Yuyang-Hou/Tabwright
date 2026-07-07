---
"playwriter": minor
---

Add a built-in `conan-config` capability suite for installing read-only Conan/Buff copywriting config search and query capabilities that refresh cookie auth from the user's current Chrome session.

Add capability routing metadata so trusted read-only capabilities can declare exact-match direct-run behavior. The built-in `conan-config-query` capability uses this metadata for exact `Space_Enhanced_Config` admin URLs.

Add a lightweight `playwriter capability route` command and MCP route action so agents can resolve exact-match direct-run capabilities without first reading full Playwriter docs, searching, or describing contracts.

Persist successful `conan-config-query` results to scoped local artifacts by default so agents can reuse full JSON and summaries in later turns without deciding after the response is already large.

Include sandbox execution hints in exact-match route results so Codex agents know to run trusted capability commands with escalated permissions when they need to write run logs or artifacts under `~/.playwriter`.

Install bundled agent skills alongside built-in capability suites so capability-specific instructions live next to the capability instead of being hard-coded into the general Playwriter skill.
