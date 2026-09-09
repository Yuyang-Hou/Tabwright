---
"tabwright": minor
---

Discover and call native page WebMCP tools through the existing Tabwright extension with dedicated MCP tools and CLI commands. Tool IDs are session-bound and expire when pages or tools change; uncertain results are never automatically retried.

CLI execution errors now also produce a nonzero exit status so callers can distinguish a failed command from a successful result.

Include the complete WebMCP discovery, authoring, userscript persistence and maintenance workflow in the bundled Tabwright Skill, without requiring a separate Web Code Skill installation.
