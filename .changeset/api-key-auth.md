---
'playwriter': minor
---

Add API key authentication for cloud browsers.

Instead of the interactive `playwriter cloud login` device flow, you can now create an API key at https://playwriter.dev/dashboard and set it as an environment variable:

```bash
export PLAYWRITER_API_KEY=pw_xxxxx
playwriter session new --browser cloud
```

This is ideal for CI, VPS, and headless environments where opening a browser for OAuth is not possible.

The dashboard now has an **API Keys** panel where you can create and revoke keys. API keys use the `x-api-key` header and resolve to a session transparently via better-auth's `@better-auth/api-key` plugin with `enableSessionForAPIKeys`.

Priority order for authentication:
1. `PLAYWRITER_API_KEY` env var (API key, sent via `x-api-key` header)
2. `PLAYWRITER_CLOUD_TOKEN` env var (session token from device flow, sent via `Authorization: Bearer`)
3. `~/.playwriter/auth.json` file (saved by `playwriter cloud login`)
