# Design

Reuse Runtime evaluation through the existing extension and relay; no wire messages,
extension permissions or protocol versions change. MCP tools and CLI commands both
call executor helpers, so pending work retains the same timeout and no-overlap guard.

Each executor owns a WebMCP instance. One snapshot per selected page retains native
tool objects in a JSHandle, emits opaque session-local IDs, and listens to native
toolchange plus Playwright main-frame navigation. Calls use the original object,
never a name lookup on a new document. Re-listing disposes only our snapshot listeners.
Reset/disconnect clears IDs. No page globals, cookie storage or script files are added.
The first version deliberately excludes iframe aggregation. It preserves native results without inferring application success. Native Chrome
did not enforce required schema fields in acceptance, so input validation uses the
already installed MCP SDK JSON Schema provider before invocation.

The CLI adds no filesystem paths or shell commands and serializes request values as
JSON data. No dependencies are added. The public package gets a minor Changeset;
the repository has issues disabled, so no matching issue can be referenced. Existing
extensions work without an update; native API availability is checked on each discovery.
No installed user Skill, extension, runtime or login session is migrated by this patch.
