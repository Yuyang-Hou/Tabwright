---
title: Browser core convergence
description: Remove product surfaces outside browser understanding and execution.
prompt: |
  Implement the user-approved product direction from @README.md and
  @openspec/changes/agent-debugging-core/design.md: remove recording, Skill
  management, extension options, and cloud SaaS; migrate business Skills to
  independently owned scripts; redesign the website as product and docs.
---

## Why

Tabwright supplies Playwright/CDP and browser debugging tools. The agent owns
business workflows and Skills. Recording, managed Skill contracts, automatic
credential storage, and cloud billing obscure this boundary.

## What Changes

- Remove recording/capture/replay/activity code, UI, commands and dependencies.
- Remove extension options and Skill discovery/management/runtime services.
- Migrate repository business Skills to independent scripts with explicit input,
  browser-context authentication and preserved business validation/confirmation.
- Remove cloud provisioning, accounts, billing, device login and database code;
  retain local browser, direct CDP and explicitly configured remote relay access.
- Redesign the website around browser understanding, installation and local docs.
- Keep the existing WS version and CDP behavior; reject retired recording
  requests explicitly without collecting or storing data.

## Impact

Public recording/runtime/cloud entrypoints retire. Migration documentation and
release notes must name removals. Installed user Skills and historical credentials,
reports and recordings are preserved, not silently overwritten or deleted.
This work does not authorize commit, deployment, release, production resource
deletion, or replacement of the running browser extension/global CLI.
