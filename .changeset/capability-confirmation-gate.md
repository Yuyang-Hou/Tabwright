---
'playwriter': patch
---

Enforce `requiresConfirmation` for node, browser, CLI, and MCP capability runs with an exact-id confirmation flag that `--force` cannot bypass, generate replay/browser run commands with the correct user-browser and confirmation arguments, clear completed node-capability timeout timers so successful CLI runs exit immediately, and replace the mandatory 17k-token reference read with a compact browser core protocol plus topic queries.
