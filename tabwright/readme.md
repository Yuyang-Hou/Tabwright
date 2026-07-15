# Tabwright

Let AI agents control your existing Chrome through a local CLI and MCP server. Your logins, extensions, and cookies stay available because Tabwright connects to the browser you already use.

## Install

1. Install the [Tabwright Chrome extension](https://chromewebstore.google.com/detail/tabwright/dkfhphbajbkplddmchbdgdddioonngep).
2. Open the tab you want to control and click the extension icon until it turns green.
3. Install the CLI and its matching Codex skill:

```bash
npm install -g tabwright@latest
tabwright skill install --target codex
tabwright doctor
```

Open a new Codex task after installing or updating the skill.

## First browser task

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
