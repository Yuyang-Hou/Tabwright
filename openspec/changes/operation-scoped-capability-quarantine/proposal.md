# Why

A contract failure in one Skill operation currently downgrades the whole runtime, blocking unrelated operations and requiring reinstall or manual recovery.

# What Changes

- Quarantine only the operation whose current contract fingerprint failed conformance.
- Let an explicit `--force` validation replace that operation's failed evidence after repair.
- Treat declared browser-authentication origins as valid authentication traffic.
- Preserve explicit manual draft and disabled states while migrating legacy automatic global quarantine.
- Keep confirmation requirements and the prohibition on automatic write retries unchanged.

# Impact

- Updates the capability registry, runner, tests, public guidance, and `tabwright` changeset.
- Does not change the extension or WebSocket protocol.
