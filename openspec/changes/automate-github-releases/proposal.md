## Why

Publishing Tabwright currently depends on local commands and manually assembled GitHub Releases. A release can therefore be built from the wrong branch, publish the extension before its matching CLI, or omit the extension ZIP.

## What Changes

- Add a manually triggered GitHub Actions release workflow with separate CLI and extension targets.
- Initialize only the public Playwright build submodule so unrelated private site sources cannot block CI or releases.
- Publish the CLI from `main` to npm through npm trusted publishing, then create the matching latest GitHub Release from its changelog entry.
- Build the production extension only after the matching CLI version is public, then attach its ZIP to a non-latest GitHub Release.
- Non-goals: automatically publish to Chrome Web Store, release from feature branches, or store a long-lived npm write token.

## Capabilities

### New Capabilities

- `github-release-automation`: Controlled npm and GitHub Release publication for Tabwright CLI and extension artifacts.

### Modified Capabilities

None.

## Impact

- Adds one manual workflow under `.github/workflows/`.
- Requires a one-time npm trusted-publisher association with `release.yml`.
- Uses the repository `GITHUB_TOKEN` only for tags and GitHub Releases.
