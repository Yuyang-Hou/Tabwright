---
'tabwright': patch
---

Prevent overlapping executions while timed-out awaited code is still running and
report that its outcome is unknown rather than claiming cancellation. Redact known
credential fields before writing CDP diagnostic logs.
