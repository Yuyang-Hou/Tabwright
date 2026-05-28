---
'playwriter': patch
---

Document that agents should use `getLatestLogs()` instead of manually attaching console listeners when inspecting page logs.

Manual listeners only receive future console events, so they can miss errors emitted during page startup or hydration. The Playwriter skill now points agents to `getLatestLogs({ page })` for captured browser logs and `pageerror` entries.
