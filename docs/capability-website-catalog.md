# Website Capability Catalog

This document tracks additional website capabilities designed and smoke-tested for the local Playwriter capability runtime.

## Capability Selection

The first expanded batch intentionally avoids new account credentials. These capabilities run with `runtime: "node"`, have `sideEffect: "read"`, and can be invoked autonomously after trust.

| Capability | Website/API | Intent | Auth | Runtime |
| --- | --- | --- | --- | --- |
| `github-repo-summary` | GitHub REST API | Summarize a public repository and latest release | none | node |
| `npm-package-info` | npm Registry | Inspect package metadata and latest version | none | node |
| `hacker-news-top` | Hacker News Algolia API | Fetch current front page stories | none | node |
| `bilibili-popular-videos` | Bilibili public API | Fetch public popular videos | none | node |

## AI Invocation Policy

All capabilities in this batch are read-only and do not require confirmation after being trusted. Agents should still call `capability search` and `capability describe` before `capability run`.

## Smoke Test Matrix

| Capability | Test Input | Result |
| --- | --- | --- |
| `github-repo-summary` | `{"owner":"microsoft","repo":"playwright"}` | passed; returned `microsoft/playwright`, stars, forks, open issues, and latest release |
| `npm-package-info` | `{"packageName":"playwriter"}` | passed; returned `playwriter` latest version `0.4.0` |
| `hacker-news-top` | `{"limit":3}` | passed; returned three current front page stories |
| `bilibili-popular-videos` | `{"limit":3}` | passed; returned three public Bilibili popular videos |

Smoke test command shape:

```bash
playwriter capability search "GitHub 仓库 stars latest release" --json
playwriter capability run github-repo-summary --input-json '{"owner":"microsoft","repo":"playwright"}' --json

playwriter capability search "npm 包 最新版本" --json
playwriter capability run npm-package-info --input-json '{"packageName":"playwriter"}' --json

playwriter capability search "Hacker News 热门文章" --json
playwriter capability run hacker-news-top --input-json '{"limit":3}' --json

playwriter capability search "Bilibili 热门视频" --json
playwriter capability run bilibili-popular-videos --input-json '{"limit":3}' --json
```

## Installed User Capabilities

These capabilities were installed under:

```text
~/.playwriter/capabilities/
```

They are user-local examples, not committed project fixtures. The project record of the design and tests is this document.

## Future Candidates

Authenticated candidates need explicit user approval before saving cookies or tokens:

- GitHub authenticated notifications and assigned review requests.
- Gmail unread summary.
- Google Calendar today/tomorrow agenda.
- Notion recent pages or database query.
- Twitter/X current profile and bookmarks.
- Bilibili watch later, favorites, and creator center metrics.
