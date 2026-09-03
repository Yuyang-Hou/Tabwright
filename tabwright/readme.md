# Tabwright

Turn work in your signed-in Chrome into portable, verified Agent Skills. Tabwright records a successful
workflow, describes how it must run, and gives future agent sessions a durable tool instead of making them
rediscover the website.

Skills can use direct requests, requests inside the browser, real UI interaction, or hybrid execution that
lets the website create a protected request and then reads the structured network result. When the website
requires a CAPTCHA, SMS code, or other human verification, the Skill returns an explicit checkpoint.

## Install

1. Install the [Tabwright Chrome extension](https://chromewebstore.google.com/detail/tabwright/dkfhphbajbkplddmchbdgdddioonngep).
2. Open the tab you want to control and click the extension icon until it turns green.
3. Install the CLI:

```bash
npm install -g tabwright@latest
tabwright doctor
```

The CLI automatically installs its matching Tabwright skill into `~/.agents/skills/tabwright`. If npm lifecycle scripts were disabled, run `tabwright skill install`; agent-specific directories are available through `--target codex` and `--target claude`. Tabwright updates only its managed copy and preserves user-modified skill files.

## First workflow

```bash
tabwright session new
# Replace 1 with the session ID printed above.
tabwright -s 1 -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'
tabwright -s 1 -e 'console.log(await snapshot({ page: state.page }))'
tabwright session delete 1
```

Use the published package without installing it globally:

```bash
npx tabwright@latest session new
```

Run `tabwright skill` for the complete CLI and browser automation reference. See the [GitHub repository](https://github.com/Yuyang-Hou/tabwright) for architecture, development, remote access, and release documentation.

Record and inspect a repeatable workflow before creating an Agent Skill:

```bash
tabwright replay list --limit 10 --json
tabwright replay index <replay-id> --json
tabwright skill runtime validate "/absolute/path/to/skill" --json
```
