## Why
Ordinary website tasks should expose available page WebMCP tools without users prompting the agent to discover them.

## What Changes
- Add a separate `page inspect` decision entry point that refreshes tools before choosing an action, including when revisiting a page.
- Announce changed top-level tool summaries after ordinary CLI/MCP execution for selected and newly opened pages.
- Prefer task-matching tools in the bundled Skill, retrieving schemas before invocation.
- Keep metadata discovery bounded and separate from invocation handles and business authorization.

## Capabilities
### New Capabilities
- `webmcp-discovery`: Automatic operation-result tool summaries.
### Modified Capabilities
None.

## Impact
Shared executor, CLI/MCP rendering and bundled documentation. No extension or WebSocket protocol changes, dependencies, site registry, or installed user-file changes.
