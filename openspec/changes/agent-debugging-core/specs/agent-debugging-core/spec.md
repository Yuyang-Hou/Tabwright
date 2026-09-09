---
title: Agent debugging core requirements
description: Observable outcomes for the local debugging-focused product.
prompt: |
  Derive testable requirements from @../../proposal.md and @../../design.md.
---

## ADDED Requirements

### Requirement: Inspect network evidence on demand

The system SHALL expose a bounded network inspector using the existing CDP
connection without requiring the agent to follow a fixed investigation workflow.

#### Scenario: Connect a request to executing source

- **WHEN** an agent enables capture and a page sends a request
- **THEN** the agent can query method, URL, status, timing or failure, and the
  available initiating script location without retrieving every response body

#### Scenario: Inspect a response selectively

- **WHEN** the agent requests a response excerpt by the returned request identity
- **THEN** the output reports its range and truncation, or a concrete unavailable
  reason, and never silently substitutes a later redirected response

#### Scenario: Finish capture without disrupting another helper

- **WHEN** the agent disposes its inspector
- **THEN** its listeners and retained entries are released without disabling the
  shared Network domain or detaching the shared CDP session

### Requirement: Provide local capability references

The system SHALL provide a compact installed Skill and locally accessible
topic references for browser evidence and debugging.

#### Scenario: Discover a specialized API

- **WHEN** an agent asks the installed CLI for a debugging topic
- **THEN** the CLI returns that topic without a browser connection or remote fetch

### Requirement: Compose debugging helpers without resetting shared state

The system SHALL let Network, Editor, and Debugger share CDP resource metadata
without disabling another helper's domains or clearing its breakpoints.

#### Scenario: Inspect source after pausing execution

- **WHEN** the page is paused at an existing breakpoint and an agent opens Editor
- **THEN** existing source is readable, paused locals stay available, and the
  breakpoint still works after resuming

#### Scenario: Navigate after collecting source metadata

- **WHEN** execution contexts or stylesheets are replaced
- **THEN** subsequent source lookup does not return resources from the removed contexts

### Requirement: Report execution uncertainty accurately

The system SHALL distinguish a caller deadline from completion of awaited code
and SHALL prevent another execution from overlapping it in the same executor.

#### Scenario: Deadline expires while a browser action is pending

- **WHEN** the caller deadline expires before the awaited operation settles
- **THEN** the response states that the outcome is unknown and the operation may
  still run, and a subsequent execution is rejected as busy until it settles

### Requirement: Limit incidental diagnostic collection

The system SHALL redact known credential fields from CDP logs and SHALL NOT
start rolling DOM activity recording by default merely because a tab attaches.

#### Scenario: Attach a page for debugging

- **WHEN** a page attaches without explicit activity-recording opt-in
- **THEN** browser debugging remains available without starting rolling DOM capture

#### Scenario: Log a credential-bearing CDP message

- **WHEN** a message contains Cookie, Authorization, or cookie-value fields
- **THEN** diagnostic logging preserves useful structure while replacing those
  credential values before writing the message

### Requirement: Deliver the debugging-focused user journey

The system SHALL present local browser understanding as the primary product,
without promising cloud rental, automatic workflow compilation, unavailable
video recording, complete isolation, or a hardened untrusted-code sandbox.

#### Scenario: Start from public onboarding

- **WHEN** a user follows the installation and first-session instructions
- **THEN** the instructions establish a real session and expose debugging
  capabilities without requiring a recording or a generated business Skill
