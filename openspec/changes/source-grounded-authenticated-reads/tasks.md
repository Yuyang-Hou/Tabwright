## 1. Agent behavior

- [x] 1.1 Document exact serving-revision and source-evidence requirements
- [x] 1.2 Document authenticated page-context execution and stop conditions
- [x] 1.3 Define confirmed one-off mutation safeguards and when to persist a Skill runtime
- [x] 1.4 Add an exact-deployment fallback for pages whose source is unavailable
- [x] 1.5 Preserve evidence-confirmed non-credential request headers

## 2. Verification

- [x] 2.1 Build the generated Skill resources
- [x] 2.2 Run Tabwright typecheck and OpenSpec strict validation
- [x] 2.3 Add a public-package changeset and review the complete diff
- [x] 2.4 Regenerate Skill resources and validate the expanded artifact-grounded contract
- [x] 2.5 Verify the workflow against a real authenticated no-source page

## 3. Optional packed-code tooling

- [x] 3.1 Expose exact raw runtime script source with URL and content fingerprint
- [x] 3.2 Add a pinned, isolated Wakaru helper to the executor without automatic invocation
- [x] 3.3 Describe page, Network, source, runtime debugging, and Wakaru as capabilities the agent may combine using its own judgment
- [x] 3.4 Add focused tests for raw source provenance and local Wakaru output
- [x] 3.5 Rebuild generated resources and rerun typecheck, OpenSpec, Skill, and diff validation
- [x] 3.6 Store explicitly selected scripts by content hash and reuse matching Wakaru output

## 4. Skill-owned runtime

- [x] 4.1 Add non-executing validation and normal execution commands that accept an independent Skill directory
- [x] 4.2 Update generated capability-backed Skills to use the Skill-owned runtime command
- [x] 4.3 Remove legacy Capability authoring and routing from the primary Tabwright Skill workflow
- [x] 4.4 Update README, generated resources, focused tests, and validation evidence
- [x] 4.5 Delete the Capability registry, Studio, MCP tool, replay compiler/evaluator, draft-writing sandbox helpers, and migrate bundled Skills
- [x] 4.6 Reject removed Capability commands with actionable outdated-Skill guidance and no compatibility execution
