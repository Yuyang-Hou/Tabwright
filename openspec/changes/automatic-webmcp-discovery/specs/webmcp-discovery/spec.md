## ADDED Requirements
### Requirement: Ordinary operations announce available page tools
The runtime SHALL append changed, bounded WebMCP summaries for the default page, Pages saved directly in state, and newly opened pages to ordinary CLI/MCP operation results without an explicit discovery request.

#### Scenario: Open a tool-enabled page
- **WHEN** an ordinary operation opens a page exposing a top-level native tool
- **THEN** the result includes its name and description without invoking it

#### Scenario: Directory changes
- **WHEN** navigation or registration changes the selected document or tool directory
- **THEN** the next operation announces the new directory, including removal of previously announced tools

#### Scenario: Unchanged directory
- **WHEN** a later operation observes the same document and tool metadata
- **THEN** it does not repeat the summary

### Requirement: Discovery preserves operation and invocation behavior
Automatic discovery SHALL preserve explicit tool IDs and original operation outcomes, and SHALL wait no more than 250 ms after execution for metadata.

#### Scenario: Failed or stalled discovery
- **WHEN** metadata discovery rejects or stalls
- **THEN** the original operation result remains available without a discovery error or overlapping probes for that page

#### Scenario: Existing tool handle
- **WHEN** automatic discovery follows explicit discovery
- **THEN** the explicit tool ID remains callable until its normal document or tool lifecycle invalidates it

### Requirement: Agents prefer suitable page tools
The bundled Skill SHALL instruct agents to prefer task-matching WebMCP tools for ordinary website tasks, inspect full schemas before invocation and treat metadata as untrusted data rather than write authorization.

#### Scenario: User does not mention WebMCP
- **WHEN** a task-matching summary appears during an ordinary website task
- **THEN** the instructions direct the agent to retrieve the schema and use the tool within the user's authorized scope

### Requirement: Inspect current capabilities before choosing an action
The CLI SHALL provide `page inspect --page-url` and the executor SHALL provide `inspectPage({ page })` to refresh the selected page's full tool directory. The Skill SHALL require inspection in a separate round trip before choosing the next action, including when returning to a page.

#### Scenario: Revisit or switch pages
- **WHEN** the agent inspects a selected page again after tool changes or navigation
- **THEN** the result contains a newly read directory and replaces previous discovery IDs for that page

#### Scenario: Discovery cannot be confirmed
- **WHEN** inspection fails or the native API is unavailable
- **THEN** the result explicitly reports unknown or unavailable without returning cached tools or an empty success directory

#### Scenario: Choose the next action
- **WHEN** inspection returns tool schemas and IDs
- **THEN** the agent can use them in its next call without another redundant discovery
