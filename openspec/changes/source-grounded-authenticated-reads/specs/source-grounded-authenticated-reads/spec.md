## ADDED Requirements

### Requirement: One-off authenticated reads use exact deployed source

When no saved capability exactly matches, the agent SHALL derive a transient read request only from the exact revision serving the target environment.

#### Scenario: Ready instances agree on a revision

- **WHEN** deployment evidence identifies the same revision on all relevant ready instances
- **THEN** the agent inspects that revision for the route and request contract
- **AND** it records the revision and source evidence in the transient request plan

#### Scenario: Serving revision is uncertain

- **WHEN** ready instances disagree, deployment evidence is missing, or only a branch head or build result is known
- **THEN** the agent stops without guessing or executing an endpoint

### Requirement: Browser authentication remains opaque

The agent SHALL execute the verified read in page context on the target origin without extracting browser credentials.

#### Scenario: Verified read request succeeds

- **WHEN** the plan uses a source-confirmed read-only `GET` or `HEAD` route
- **THEN** the page-context request uses browser credentials
- **AND** the agent verifies the HTTP and application-level result
- **AND** only the requested result is returned

### Requirement: Transient source-grounded requests cannot mutate state

The agent SHALL NOT use the transient path for a request whose method or source semantics can mutate state.

#### Scenario: Source describes a mutation

- **WHEN** the request is not `GET` or `HEAD`, or a nominal read method has mutation semantics
- **THEN** the agent does not execute it through the transient path
- **AND** it requires a saved capability with machine-enforced confirmation or a reviewed product workflow

### Requirement: Durable automation is created only when justified

The agent SHALL keep a one-off read transient and MAY create a saved capability when repetition, stable schemas, or durable safety controls justify it.

#### Scenario: A verified request is used once

- **WHEN** the user asks for a one-off authenticated read
- **THEN** the agent does not create an endpoint-specific Skill or saved capability solely for that request
