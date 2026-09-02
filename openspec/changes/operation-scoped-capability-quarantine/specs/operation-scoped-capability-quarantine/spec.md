## ADDED Requirements

### Requirement: Contract quarantine is scoped to an operation

The runtime SHALL derive quarantine from the latest conclusive evidence for the selected operation and current contract fingerprint.

#### Scenario: One operation fails conformance

- **WHEN** a trusted Skill operation produces output or network activity outside its contract
- **THEN** that operation is quarantined
- **AND** unrelated operations remain runnable under their own evidence and safety rules

#### Scenario: A repaired operation is validated

- **WHEN** the user repairs the operation and explicitly reruns it with `--force`
- **THEN** a passing result replaces the failed evidence for that operation
- **AND** later runs no longer require reinstalling the Skill

### Requirement: Manual runtime status is preserved

The runtime SHALL distinguish explicit draft or disabled state from legacy automatic global quarantine.

#### Scenario: Legacy automatic quarantine is loaded

- **WHEN** an older runtime state contains a matching automatic draft downgrade
- **THEN** operation evidence controls quarantine
- **AND** a later passing validation does not restore the obsolete global draft state

#### Scenario: A user explicitly drafts or disables a Skill

- **WHEN** runtime state records manual intent
- **THEN** operation evidence does not override that status

### Requirement: Authentication origins are valid network traffic

The runtime SHALL accept HTTP and HTTPS origins declared in `auth.browserUrls` during contract network validation.

#### Scenario: Authentication redirects to a declared origin

- **WHEN** execution reaches a URL under a declared authentication origin
- **THEN** that URL is not reported as undeclared network access
- **AND** other undeclared origins still fail conformance

### Requirement: Write safety remains unchanged

The runtime SHALL NOT automatically retry write or dangerous operations after execution may have started.

#### Scenario: A write operation fails conformance

- **WHEN** the operation is quarantined
- **THEN** repair validation still requires fresh confirmation
- **AND** `--force` does not bypass confirmation
