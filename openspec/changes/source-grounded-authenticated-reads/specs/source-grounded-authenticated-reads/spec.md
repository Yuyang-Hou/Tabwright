## ADDED Requirements

### Requirement: Agents choose useful evidence capabilities

Tabwright SHALL expose page state, observed Network traffic, deployed source, Source Maps, bundles, runtime debugging, and Wakaru as independently usable capabilities. The agent MAY combine the capabilities it judges useful for the user's request.

#### Scenario: Agent investigates client-observable behavior

- **WHEN** the task can benefit from browser or deployed-code evidence
- **THEN** the agent chooses one or more available capabilities based on the task and current evidence
- **AND** each selected capability remains independently invocable

#### Scenario: Agent uses Wakaru

- **WHEN** Wakaru would help the agent interpret packed or minified JavaScript
- **THEN** the agent MAY invoke the local helper with selected script source and a suitable decompilation level
- **AND** recovered output is not executed

### Requirement: Wakaru is an independent local tool

Tabwright SHALL expose copied runtime script source and pinned Wakaru decompilation as separately invocable primitives.

#### Scenario: Agent decompiles a relevant runtime script

- **WHEN** the agent explicitly passes copied script source to Wakaru
- **THEN** Tabwright records the source URL when supplied and a content hash
- **AND** Wakaru writes only to a scoped artifact directory
- **AND** Tabwright returns artifact paths and provenance without executing recovered code

#### Scenario: Wakaru is unavailable on the host

- **WHEN** the pinned Wakaru package does not support the current platform or its binary is unavailable
- **THEN** the tool reports that limitation without changing browser state
- **AND** the agent continues with other available evidence or reports the evidence gap

### Requirement: One-off authenticated reads use exact deployed source

When deployed source is available, the agent SHALL derive a transient read request only from the exact revision serving the target environment.

#### Scenario: Ready instances agree on a revision

- **WHEN** deployment evidence identifies the same revision on all relevant ready instances
- **THEN** the agent inspects that revision for the route and request contract
- **AND** it records the revision and source evidence in the transient request plan

#### Scenario: Serving revision is uncertain

- **WHEN** ready instances disagree, deployment evidence is missing, or only a branch head or build result is known
- **THEN** the agent stops without guessing or executing an endpoint

### Requirement: No-source reads use exact deployed artifacts

When deployed source is unavailable, the agent SHALL bind any inferred request contract to the exact client deployment and SHALL analyze only browser-observable evidence relevant to the requested behavior.

#### Scenario: Deployed artifacts identify a request

- **WHEN** the agent fingerprints the loaded document and assets
- **AND** observed Network behavior plus Source Maps, bundles, lazy chunks, or runtime debugging establish a read request
- **THEN** the transient plan records the deployment fingerprint and evidence references
- **AND** it distinguishes observed behavior from inference

#### Scenario: Deployed artifacts change

- **WHEN** the document, build metadata, manifest, asset URLs, or asset content hashes no longer match the recorded fingerprint
- **THEN** the agent invalidates the inferred contract
- **AND** it re-establishes evidence before execution

#### Scenario: Evidence is incomplete

- **WHEN** the route, inputs, authentication boundary, side effect, or deployment fingerprint cannot be established
- **THEN** the agent stops without guessing or executing the request

### Requirement: Artifact interpretation stays within the client boundary

The agent SHALL treat browser artifacts as evidence only for client-observable behavior available to the current account.

#### Scenario: Behavior is server-only or unauthorized

- **WHEN** a requested behavior depends on hidden server logic or permissions the current account does not have
- **THEN** the agent does not claim that the bundle proves or grants that behavior

### Requirement: Browser authentication remains opaque

The agent SHALL execute the verified read in page context on the target origin without extracting browser credentials.

#### Scenario: Verified read request succeeds

- **WHEN** the plan uses an evidence-confirmed read-only `GET` or `HEAD` route
- **THEN** the page-context request uses opaque browser credentials
- **AND** it preserves required non-credential headers observed on the real request
- **AND** the site's in-page request client produces any required authentication, CSRF token, or signature without exposing it to the agent
- **AND** the agent verifies the HTTP and application-level result
- **AND** only the requested result is returned

### Requirement: Transient source-grounded requests cannot mutate state

The agent SHALL NOT use the transient path for a request whose method or source semantics can mutate state.

#### Scenario: Source describes a mutation

- **WHEN** the request is not `GET` or `HEAD`, or a nominal read method has mutation semantics
- **THEN** the agent does not execute it through the transient path
- **AND** it requires an independent Skill runtime with machine-enforced confirmation or a reviewed product workflow

### Requirement: Durable automation is created only when justified

The agent SHALL keep a one-off read transient and MAY create an independent Agent Skill when repetition, stable schemas, or durable safety controls justify it.

#### Scenario: A verified request is used once

- **WHEN** the user asks for a one-off authenticated read
- **THEN** the agent does not create an endpoint-specific Skill or runtime contract solely for that request

#### Scenario: Durable automation is justified

- **WHEN** the user requests a reusable workflow or durable safety and schemas are necessary
- **THEN** the agent creates or updates a standard Agent Skill directly
- **AND** agent-facing semantics remain in `SKILL.md`
- **AND** machine-enforced behavior remains under the Skill's `runtime/` directory
- **AND** no intermediate capability registry entry is required

### Requirement: Tabwright runs Skill-owned runtimes in place

Tabwright SHALL validate and execute a Skill's bundled runtime without copying it into Tabwright-owned storage.

#### Scenario: Agent validates an independently authored Skill

- **WHEN** the agent passes the Skill directory to the runtime validation command
- **THEN** Tabwright validates the bundled contract and executable entry without executing it
- **AND** it reports the resolved Skill and runtime directories

#### Scenario: Agent executes an independently authored Skill

- **WHEN** the agent passes the Skill directory and structured input to the runtime execution command
- **THEN** Tabwright applies the existing schema, permission, authentication, confirmation, isolation, and run-evidence controls
- **AND** device-local state remains outside the Skill directory

### Requirement: Legacy commands identify outdated Skills

Tabwright SHALL reject removed Capability commands with guidance that lets an agent identify an outdated domain Skill.

#### Scenario: Outdated Skill invokes a removed command

- **WHEN** an Agent Skill invokes `tabwright capability ...`
- **THEN** the CLI exits without executing or translating the command
- **AND** it tells the agent to update or reinstall the selected Skill
- **AND** it names the current Skill-owned runtime command

### Requirement: Replay remains authoring evidence

Tabwright SHALL expose recorded activity for inspection without compiling it into a Tabwright-owned draft runtime.

#### Scenario: Agent authors from a replay

- **WHEN** the user asks to reuse a recorded workflow
- **THEN** the agent inspects the replay index as evidence
- **AND** it creates or updates an independent Agent Skill directly
- **AND** Tabwright does not create a registry entry or draft Capability
