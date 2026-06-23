---
'playwriter': patch
---

Fix `playwriter cloud login` to use Better Auth's current device authorization endpoints.

The CLI now requests `/api/auth/device/code`, polls `/api/auth/device/token`, and stores the returned bearer token so cloud browsers appear after approving the login in the browser.
