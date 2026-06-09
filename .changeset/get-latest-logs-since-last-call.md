---
'playwriter': patch
---

Add `sinceLastCall` option to `getLatestLogs()` and persist browser logs across navigations.

`getLatestLogs({ page, sinceLastCall: true })` tracks a per-page cursor so each call returns only new console logs and page errors since the previous call. The first call returns all buffered logs including pre-existing ones. This lets agents check for errors after every action without seeing duplicates.

Browser console logs no longer clear on main-frame navigation. Errors from page transitions (hydration failures, redirect issues) are preserved. The 5000-entry cap per page still prevents unbounded growth.
