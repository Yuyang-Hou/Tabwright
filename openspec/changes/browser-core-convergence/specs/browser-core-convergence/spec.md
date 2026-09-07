---
title: Browser core convergence requirements
description: A browser debugging tool without recording or managed business Skills.
prompt: |
  Define verifiable outcomes for @../../proposal.md and @../../tasks.md.
---

## ADDED Requirements

### Requirement: Browser-only product boundary
Tabwright SHALL provide browser execution and debugging without recording,
business Skill registration, credential refresh services or cloud provisioning.

#### Scenario: User executes an independently owned script
- **WHEN** an agent executes a JavaScript file in a connected session
- **THEN** browser execution works without a Skill manifest or discovery scan
- **AND** browser requests can reuse the selected profile's login without saving
  credentials in Tabwright-managed Skill storage.

### Requirement: Compatible removal of recording
New builds SHALL retain the WS version and core CDP compatibility while ceasing
all recording capture, storage and feature advertisement.

#### Scenario: A legacy peer requests recording
- **WHEN** a legacy peer sends a recording command
- **THEN** the peer receives an explicit unsupported response or false status
- **AND** the browser connection remains usable and no recording is created.

### Requirement: Preserve user-owned data
Migration SHALL preserve existing installed Skills and historical local data.

#### Scenario: Core package is upgraded
- **WHEN** a user upgrades Tabwright
- **THEN** old Skill/runtime invocations explain migration instead of executing
  with missing safeguards or silently retrying mutations
- **AND** historical credentials, reports and recordings are not deleted.

### Requirement: Product and documentation website
The website SHALL explain browser debugging, installation, authentication and
independent scripts without account, billing, cloud or recording product flows.

#### Scenario: User visits the website
- **WHEN** a user opens the product page or documentation
- **THEN** browser connection and useful debugging capabilities are discoverable
- **AND** no login, subscription or hosted browser is required.
