## ADDED Requirements

### Requirement: CLI releases are published from main

The release workflow SHALL publish the version declared by the CLI package from the repository default branch and create a matching GitHub Release.

#### Scenario: Maintainer releases the CLI

- **WHEN** a maintainer manually selects the CLI release target on `main`
- **THEN** the workflow typechecks, tests, and builds the package
- **AND** npm trusted publishing publishes the declared public version
- **AND** a latest GitHub Release is created from that version's changelog entry

#### Scenario: Unrelated private submodule is unavailable

- **WHEN** the GitHub runner checks out release sources without credentials for an unrelated private site submodule
- **THEN** it initializes only the public Playwright build submodule
- **AND** validation and publication can continue

#### Scenario: Maintainer selects another branch

- **WHEN** the workflow is dispatched from a branch other than `main`
- **THEN** publication stops before npm or GitHub is changed

### Requirement: Extension releases wait for the matching CLI

The extension release workflow SHALL package a clean production build only after the CLI version in the same source revision is available from npm.

#### Scenario: Matching CLI is public

- **WHEN** a maintainer manually selects the extension target on `main`
- **AND** npm exposes the matching CLI version
- **THEN** the workflow creates a production ZIP
- **AND** attaches it to a non-latest GitHub Release for the manifest version

#### Scenario: Matching CLI is not public

- **WHEN** the local CLI version is not available from npm
- **THEN** the extension workflow stops before creating a tag or Release
