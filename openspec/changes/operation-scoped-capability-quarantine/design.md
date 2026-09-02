# Design

Contract health is derived from the latest conclusive run for the current fingerprint and selected operation. The runner resolves the operation before checking quarantine, so a failed operation cannot block a healthy sibling operation.

Skill runtime state records whether a draft or disabled status was explicitly selected. Legacy automatic draft state remains recognizable from its matching historical downgrade evidence, including after a repaired operation passes.

Origins in `auth.browserUrls` join operation and capability network permissions for conformance checks. This allows login redirects without granting undeclared hosts.
