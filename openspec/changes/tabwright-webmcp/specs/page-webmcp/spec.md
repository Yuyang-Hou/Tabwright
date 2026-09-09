## ADDED Requirements

### Requirement: Discover native tools in the selected page
Tabwright SHALL return tool identity, description, schema, origin and annotations for the selected top-level document through MCP and CLI, without executing tools.

#### Scenario: Native WebMCP unavailable
- **WHEN** the selected document lacks the native discovery/execution API
- **THEN** discovery reports unsupported API rather than an empty tool list

#### Scenario: Available tools
- **WHEN** a connected page exposes tools
- **THEN** discovery returns session-bound opaque IDs and tool metadata without invoking business code

### Requirement: Bind calls to discovered tools
Tabwright SHALL invoke the exact discovered native tool object using JSON object input and the existing session execution guard.

#### Scenario: Stale discovery
- **WHEN** the page navigates, its tool list changes, discovery repeats, or the session resets
- **THEN** old IDs cannot invoke a replacement tool and the caller must rediscover

#### Scenario: Timeout or rejection
- **WHEN** execution times out, rejects, or returns null during navigation
- **THEN** Tabwright reports uncertainty, does not retry, and retains the executor's no-overlap rule for pending work

#### Scenario: Native result
- **WHEN** a native tool returns a string
- **THEN** Tabwright preserves the string without asserting business success or parsing it as JSON

### Requirement: Ship the complete workflow with Tabwright
The bundled Tabwright Skill SHALL guide discovery, invocation, evidence-grounded userscript creation, manager-based persistence and scoped repair without requiring a separate Web Code Skill.

#### Scenario: User installs only Tabwright
- **WHEN** a user installs the bundled Tabwright Skill and asks to reuse or create page WebMCP tools
- **THEN** the Skill and locally bundled browser reference provide the complete workflow with no reference to an external Web Code installation as a prerequisite

#### Scenario: Existing Web Code users
- **WHEN** a user already uses the separate Web Code Skill
- **THEN** that compatibility entry remains available and no installed user files are overwritten
