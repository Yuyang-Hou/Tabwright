# Independent scripts and Skills

Tabwright provides browser access. The user and agent own the business knowledge,
scripts, installation and updates. There is no required Skill manifest or runtime.

## From a task to a Skill

1. Understand the user's goal, account, environment and intended effects.
2. Inspect the current application using whichever page, Network, deployed source
   or debugging evidence helps. A recording or prescribed sequence is unnecessary.
3. Verify one concrete result. Distinguish an HTTP response from business success.
4. If reuse is useful, save instructions and optionally a script in the user's
   normal Skill directory. Include only stable business semantics and known limits.
5. Test parameters, errors, login expiry and result verification. Ask for concrete
   approval before consequential writes; an unknown result is not a retry signal.

These are authoring considerations, not a workflow Tabwright enforces.

## A plain browser script

Select the intended enabled page from observed URLs and retain it in `state.page`.
For a separate task page, create it explicitly; the same profile shares cookies,
but not another page's sessionStorage or in-memory state.

This example assumes the current app's code or observed traffic established a
read-only `GET /api/items?q=...` endpoint. It is illustrative, not a live endpoint.

```js
// query-items.js — executed with tabwright -s <id> -f <absolute-file>
const query = state.query
if (typeof query !== 'string' || !query.trim()) {
  throw new Error('Provide a nonempty state.query')
}
if (!state.page) throw new Error('Select the intended signed-in page first')
const result = await state.page.evaluate(
  async ({ query }) => {
    const url = new URL('/api/items', location.origin)
    url.searchParams.set('q', query)
    const response = await fetch(url, { credentials: 'include', redirect: 'error' })
    if (response.status === 401 || response.status === 403) {
      throw new Error('Restore the intended account login; do not retry automatically')
    }
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Expected JSON; the login session or endpoint may have changed')
    }
    return response.json()
  },
  { query },
)
console.log(result)
```

`state.query` is this author's input convention, not a Tabwright API requirement.
A script can instead parse its own file, use a function, or return structured data.
It needs no `runtime/capability.json`, permissions declaration or registration.
Scripts execute in the same trusted-agent environment as `-e`; top-level ESM
imports are not supported there. Ordinary standalone Node/Python scripts have
their own module and dependency setup.

## Authentication

- Prefer the existing page's request client when it supplies CSRF tokens, request
  signatures or account context. Page `fetch` can reuse applicable browser cookies,
  including HttpOnly cookies, without exposing their values to the agent.
- `credentials: 'include'` does not bypass CORS, SameSite, CSRF, cookie partitioning,
  authorization, or device-bound authentication. Do not silently fall back to
  exporting credentials when a page request fails.
- A new tab shares the profile's cookie store, not every page's application state.
  A headless or separate browser does not inherit the user's signed-in profile.
- Node's global `fetch` does not inherit Chrome login. Prefer an official API token
  managed outside the Skill when standalone execution is appropriate.
- Cookie export is an explicit exception: approve the account, origins, destination
  and purpose first. Scope a browser Cookie read to the exact relevant URLs, keep
  values out of model output/source/history, pass them through a protected local
  channel, and do not write a permanent credential cache. Cookies may not be enough.
  Never clear or export an entire profile as a workaround.

Tabwright does not host a credential broker or auto-refresh service. Login expiry
belongs to the application's recovery path and may require the user to sign in.

## What to keep stable

Tabwright owns session execution, Playwright/CDP access, debugging helper APIs,
bounded evidence and honest error/timeout feedback. The Skill owns business input
validation, target/environment selection, approvals and success checks. The agent
chooses how much procedure a particular task needs.

No dependency is needed for instruction-only Skills. A browser script depends only
on the browser executor and the helpers it actually uses. A Node/Python API script
can have zero Tabwright dependency. Do not store cookies, temporary tab IDs, old
breakpoints or captured personal data as reusable Skill knowledge.
