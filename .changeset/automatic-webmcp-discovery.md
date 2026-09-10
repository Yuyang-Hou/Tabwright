---
"tabwright": minor
---

Automatically surface changed WebMCP tool summaries after ordinary browser operations. The bundled Skill now prefers tools that match the user's task, without requiring a separate Web Code Skill or explicit discovery prompt. Metadata checks are bounded and preserve existing tool IDs and operation results.

Add `page inspect` to select a page and refresh its WebMCP tools and schemas before the agent chooses an action. Reinspection replaces older IDs and explicitly distinguishes unavailable or failed discovery from an empty directory.
