# Browser core migration

This source revision is a local preview, not a published CLI, installed extension
upgrade, or website deployment. Keep the existing installation until accepting the
preview and explicitly choosing to replace it.

## Product boundary

- Recording, rolling activity, replay, annotations and the Options page are removed.
  Pin inspection and normal Playwright/CDP/debugging remain.
- Managed business Skill commands, discovery, auto-auth, credential caches and run
  histories are removed. `skill install/status` manage only the bundled Tabwright
  tool guide, not user business Skills.
- Cloud provisioning, accounts, billing, device login, subscriptions and database
  bindings are removed. Own CDP endpoints, local/headless browsers and explicit
  remote relays remain. A separate browser does not inherit a personal login.
- The website is a product landing page and documentation site, without an AI chat,
  account service or product database. Its old upstream deployment routes are gone.

The WS version and core CDP forwarding stay compatible. Retired recording requests
receive explicit unsupported replies; legacy chunks are ignored. Retired HTTP
routes return 410, and old CLI commands fail before sending business requests.
Do not advertise this revision as supporting old business-runtime APIs.

## Independent business Skill copies

The five repository examples moved to `examples/independent-skills`. They are
consumer examples, not part of the CLI/extension distribution or auto-installer.
Installed Skills may differ from these source copies: compare before replacing.

| Example                       | Execution                 | Authentication                                |
| ----------------------------- | ------------------------- | --------------------------------------------- |
| conan-commerce                | Plain JavaScript via `-f` | Page-context browser login                    |
| zgy-conan-webapp-release-list | Plain JavaScript via `-f` | Page-context browser login                    |
| conan-config                  | Standalone Node script    | Explicit, exact-origin local credential input |
| conan-pedia-cms               | Standalone Node script    | Explicit, exact-origin local credential input |
| cozy-pedia-order-refund       | Standalone Node script    | Explicit, exact-origin local credential input |

Node examples retain their existing API requests, business validation and reports;
they do not silently convert authentication strategy or call Tabwright. They use
Node 20+ built-ins, with no npm dependencies. Their JSON files describe business
inputs, not a product registration protocol. The CLI input checks are structural;
the existing business preparation and semantic validation instructions still apply.
An offline preview sends no request. Writes require a confirmation hash bound to
the input and script after concrete user approval. Execution never refreshes auth
or retries a failed/unknown operation automatically.

Browser examples use `state.input`, a task-owned `state.page` and `state.result` as
author-selected conventions. They may navigate that page. Their requests inherit
the applicable browser credentials, not a copied Cookie string.

The Node path is a migration exception, not the recommended default for new
browser Skills. See [independent scripts](./independent-scripts.md). No real CMS
publish, configuration change or refund is needed to validate this product release;
those examples require separate authorized business acceptance before use.

## Existing data

No installed Skill, browser profile, login, credential file, recording or business
report is deleted or rewritten by this migration. The new product does not read
old runtime state or recordings. If those files need cleanup later, inventory the
exact directories and obtain separate approval. Source deletions are recoverable
from Git; deployment resources have not been touched.
