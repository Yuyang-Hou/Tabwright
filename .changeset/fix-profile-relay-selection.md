---
'playwriter': patch
---

Fix relay routing when Playwriter is installed in multiple Chrome profiles signed into the same Google account.

The relay now identifies extension connections by the per-profile install id before falling back to account identity. This prevents one profile from replacing another profile's relay connection and keeps `context.newPage()` / `Target.createTarget` commands routed to the intended browser profile.

Fixes #80
