# WebMCP through Tabwright

## Why
Users already have Tabwright. They need one supported entry point to discover and call page WebMCP tools through its existing extension, relay and MCP/CLI connection.

## What Changes
- Add session-bound discovery and invocation of native tools in an explicitly selected top-level page.
- Add MCP tools and CLI commands using the existing serialized executor and CDP transport.
- Invalidate discovered IDs on navigation, toolchange, repeat discovery, reset or disconnect.
- Preserve native results and distinguish unsupported API, empty list, stale identity, rejection and unknown outcome.

## Non-goals
No script manager, capability registry, credential export, polyfill, background polling, automatic retries, cross-origin/frame aggregation, extension UI or WS protocol change. Existing user scripts and installed extensions remain untouched.

## Impact
Public package: tabwright (minor). Existing extensions remain compatible because commands use their current Runtime transport. This work stays on codex-browser-cli-pilot without committing or releasing its paused parent refactor.
