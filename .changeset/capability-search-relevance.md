---
'playwriter': patch
---

Ignore common English stop words when matching capability search intent so unrelated capabilities, including side-effecting ones, are not returned merely because their metadata contains words such as `a`, `the`, or `to`.
