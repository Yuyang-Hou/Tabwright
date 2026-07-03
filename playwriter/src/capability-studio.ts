import http from 'node:http'
import {
  createCapability,
  listCapabilities,
  readCapabilityScript,
  toCapabilitySummary,
  updateCapabilityManifest,
  updateCapabilityScript,
  type CapabilityManifestPatch,
  type CapabilityStatus,
} from './capability-registry.js'

export interface CapabilityStudioServer {
  host: string
  port: number
  close(): Promise<void>
}

export async function startCapabilityStudio(options: {
  host: string
  port: number
  cwd: string
}): Promise<CapabilityStudioServer> {
  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest({ request, response, cwd: options.cwd })
    } catch (error) {
      sendJson({
        response,
        status: 500,
        value: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  return {
    host: options.host,
    port,
    close: () => {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

async function handleRequest(options: {
  request: http.IncomingMessage
  response: http.ServerResponse
  cwd: string
}): Promise<void> {
  const url = new URL(options.request.url || '/', 'http://localhost')
  if (options.request.method === 'GET' && url.pathname === '/') {
    sendHtml({ response: options.response, html: renderStudioHtml() })
    return
  }

  if (options.request.method === 'GET' && url.pathname === '/api/capabilities') {
    sendJson({
      response: options.response,
      value: listCapabilities({ cwd: options.cwd }).map(toCapabilitySummary),
    })
    return
  }

  const capabilityMatch = /^\/api\/capabilities\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname)
  if (!capabilityMatch) {
    sendJson({ response: options.response, status: 404, value: { error: 'Not found' } })
    return
  }

  const id = decodeURIComponent(capabilityMatch[1] || '')
  const action = capabilityMatch[2]

  if (options.request.method === 'GET' && !action) {
    const capability = listCapabilities({ cwd: options.cwd }).find((candidate) => {
      return candidate.manifest.id === id
    })
    if (!capability) {
      sendJson({ response: options.response, status: 404, value: { error: `Capability not found: ${id}` } })
      return
    }
    sendJson({
      response: options.response,
      value: {
        ...toCapabilitySummary(capability),
        script: readCapabilityScript({ id, cwd: options.cwd }),
      },
    })
    return
  }

  if (options.request.method === 'POST' && !action) {
    const body = await readJsonBody(options.request)
    const capability = createCapability({
      id,
      title: typeof body.title === 'string' ? body.title : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      location: body.project === true ? 'project' : 'user',
      cwd: options.cwd,
      createdBy: 'user',
    })
    sendJson({ response: options.response, value: toCapabilitySummary(capability) })
    return
  }

  if (options.request.method === 'PUT' && action === 'script') {
    const body = await readJsonBody(options.request)
    if (typeof body.source !== 'string') {
      sendJson({ response: options.response, status: 400, value: { error: 'source must be string' } })
      return
    }
    const capability = updateCapabilityScript({ id, cwd: options.cwd, source: body.source })
    sendJson({ response: options.response, value: toCapabilitySummary(capability) })
    return
  }

  if (options.request.method === 'PATCH' && action === 'manifest') {
    const body = await readJsonBody(options.request)
    const patch = buildManifestPatch(body)
    const capability = updateCapabilityManifest({ id, cwd: options.cwd, patch })
    sendJson({ response: options.response, value: toCapabilitySummary(capability) })
    return
  }

  sendJson({ response: options.response, status: 404, value: { error: 'Not found' } })
}

function buildManifestPatch(body: Record<string, unknown>): CapabilityManifestPatch {
  const patch: CapabilityManifestPatch = {}
  if (typeof body.title === 'string') {
    patch.title = body.title
  }
  if (typeof body.description === 'string') {
    patch.description = body.description
  }
  if (isCapabilityStatus(body.status)) {
    patch.status = body.status
  }
  if (Array.isArray(body.match) && body.match.every((item) => typeof item === 'string')) {
    patch.match = body.match
  }
  if (Array.isArray(body.permissions) && body.permissions.every((item) => typeof item === 'string')) {
    patch.permissions = body.permissions
  }
  if (Array.isArray(body.whenToUse) && body.whenToUse.every((item) => typeof item === 'string')) {
    patch.whenToUse = body.whenToUse
  }
  if (Array.isArray(body.whenNotToUse) && body.whenNotToUse.every((item) => typeof item === 'string')) {
    patch.whenNotToUse = body.whenNotToUse
  }
  if (Array.isArray(body.tags) && body.tags.every((item) => typeof item === 'string')) {
    patch.tags = body.tags
  }
  if (body.sideEffect === 'read' || body.sideEffect === 'write' || body.sideEffect === 'dangerous') {
    patch.sideEffect = body.sideEffect
  }
  if (typeof body.requiresConfirmation === 'boolean') {
    patch.requiresConfirmation = body.requiresConfirmation
  }
  if (isRecord(body.auth)) {
    patch.auth = {
      type:
        body.auth.type === 'cookie' || body.auth.type === 'token' || body.auth.type === 'custom'
          ? body.auth.type
          : 'none',
      refresh:
        body.auth.refresh === 'manual' || body.auth.refresh === 'from-browser' ? body.auth.refresh : 'none',
      secretKey: typeof body.auth.secretKey === 'string' ? body.auth.secretKey : undefined,
      browserUrls: Array.isArray(body.auth.browserUrls)
        ? body.auth.browserUrls.filter((item): item is string => {
            return typeof item === 'string'
          })
        : [],
      requiredCookieNames: Array.isArray(body.auth.requiredCookieNames)
        ? body.auth.requiredCookieNames.filter((item): item is string => {
            return typeof item === 'string'
          })
        : [],
      failureSignals: Array.isArray(body.auth.failureSignals)
        ? body.auth.failureSignals.filter((item): item is string => {
            return typeof item === 'string'
          })
        : [],
    }
  }
  if (Array.isArray(body.examples)) {
    patch.examples = body.examples
      .filter((item) => {
        return isRecord(item)
      })
      .map((item) => {
        return {
          description: typeof item.description === 'string' ? item.description : undefined,
          input: item.input,
          output: item.output,
        }
      })
  }
  if (isRecord(body.inputSchema)) {
    patch.inputSchema = body.inputSchema
  }
  if (isRecord(body.outputSchema)) {
    patch.outputSchema = body.outputSchema
  }
  return patch
}

function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return value === 'draft' || value === 'trusted' || value === 'disabled'
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) {
    return {}
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  if (!isRecord(parsed)) {
    throw new Error('JSON body must be object')
  }
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(options: { response: http.ServerResponse; value: unknown; status?: number }): void {
  options.response.writeHead(options.status || 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  options.response.end(JSON.stringify(options.value, null, 2))
}

function sendHtml(options: { response: http.ServerResponse; html: string }): void {
  options.response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  options.response.end(options.html)
}

function renderStudioHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playwriter Studio</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #16181d;
      --muted: #687081;
      --line: #d9dee8;
      --blue: #246bfe;
      --green: #157f4f;
      --red: #c7362f;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      background: var(--bg);
      color: var(--text);
    }
    .shell {
      display: grid;
      grid-template-columns: 320px 1fr;
      min-height: 100vh;
    }
    aside {
      border-right: 1px solid var(--line);
      background: var(--panel);
      padding: 16px;
      overflow: auto;
    }
    main {
      padding: 20px;
      overflow: auto;
    }
    .topbar, .row, .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .topbar {
      justify-content: space-between;
      margin-bottom: 16px;
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 { font-size: 18px; }
    h2 { font-size: 20px; }
    button, input, textarea, select {
      font: inherit;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
    }
    button {
      min-height: 32px;
      padding: 0 10px;
      cursor: pointer;
    }
    button.primary {
      border-color: var(--blue);
      background: var(--blue);
      color: #fff;
    }
    button.danger {
      border-color: var(--red);
      color: var(--red);
    }
    input, select {
      height: 34px;
      padding: 0 10px;
    }
    textarea {
      width: 100%;
      min-height: 380px;
      padding: 12px;
      resize: vertical;
      font-family: var(--mono);
      font-size: 13px;
      line-height: 1.5;
    }
    .list {
      display: grid;
      gap: 8px;
    }
    .item {
      width: 100%;
      text-align: left;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .item.active {
      border-color: var(--blue);
      box-shadow: inset 3px 0 0 var(--blue);
    }
    .title {
      font-weight: 650;
      margin-bottom: 4px;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 260px;
      gap: 16px;
      align-items: start;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 10px;
    }
    .empty {
      color: var(--muted);
      padding: 40px 0;
      text-align: center;
    }
    .status-trusted { color: var(--green); }
    .status-draft { color: var(--muted); }
    .status-disabled { color: var(--red); }
    @media (max-width: 840px) {
      .shell { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--line); }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="topbar">
        <h1>Playwriter Studio</h1>
        <button id="refresh">Refresh</button>
      </div>
      <div class="row" style="margin-bottom: 12px;">
        <input id="newId" placeholder="new-capability" style="min-width: 0; flex: 1;" />
        <button id="create" class="primary">Create</button>
      </div>
      <div id="list" class="list"></div>
    </aside>
    <main>
      <div id="empty" class="empty">Select a capability.</div>
      <div id="detail" hidden>
        <div class="topbar">
          <div>
            <h2 id="detailTitle"></h2>
            <div id="detailMeta" class="meta"></div>
          </div>
          <div class="actions">
            <button id="saveManifest">Save manifest</button>
            <button id="saveScript" class="primary">Save script</button>
          </div>
        </div>
        <div class="grid">
          <section class="panel">
            <textarea id="script"></textarea>
          </section>
          <section class="panel">
            <label>Title<input id="title" /></label>
            <label>Description<input id="description" /></label>
            <label>Status
              <select id="status">
                <option value="draft">draft</option>
                <option value="trusted">trusted</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <label>Match patterns<textarea id="match" style="min-height: 90px;"></textarea></label>
            <label>Permissions<textarea id="permissions" style="min-height: 90px;"></textarea></label>
            <label>Input schema<textarea id="inputSchema" style="min-height: 140px;"></textarea></label>
            <label>Output schema<textarea id="outputSchema" style="min-height: 140px;"></textarea></label>
          </section>
        </div>
      </div>
    </main>
  </div>
  <script>
    const state = { capabilities: [], selectedId: null }
    const el = (id) => document.getElementById(id)

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {}),
        },
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || response.statusText)
      }
      return data
    }

    function renderList() {
      el('list').innerHTML = ''
      for (const capability of state.capabilities) {
        const button = document.createElement('button')
        button.className = 'item' + (capability.id === state.selectedId ? ' active' : '')
        button.innerHTML = '<div class="title">' + escapeHtml(capability.title) + '</div>' +
          '<div class="meta"><span class="status-' + capability.status + '">' + capability.status + '</span> · ' +
          escapeHtml(capability.location) + ' · ' + escapeHtml(capability.id) + '</div>'
        button.onclick = () => { selectCapability(capability.id) }
        el('list').appendChild(button)
      }
    }

    async function refresh() {
      state.capabilities = await api('/api/capabilities')
      renderList()
      if (state.selectedId) {
        await selectCapability(state.selectedId)
      }
    }

    async function selectCapability(id) {
      state.selectedId = id
      renderList()
      const capability = await api('/api/capabilities/' + encodeURIComponent(id))
      el('empty').hidden = true
      el('detail').hidden = false
      el('detailTitle').textContent = capability.title
      el('detailMeta').textContent = capability.id + ' · ' + capability.dir
      el('title').value = capability.title || ''
      el('description').value = capability.description || ''
      el('status').value = capability.status || 'draft'
      el('match').value = (capability.match || []).join('\\n')
      el('permissions').value = (capability.permissions || []).join('\\n')
      el('inputSchema').value = JSON.stringify(capability.inputSchema || {}, null, 2)
      el('outputSchema').value = JSON.stringify(capability.outputSchema || {}, null, 2)
      el('script').value = capability.script || ''
    }

    async function createCapability() {
      const id = el('newId').value.trim()
      if (!id) return
      await api('/api/capabilities/' + encodeURIComponent(id), {
        method: 'POST',
        body: JSON.stringify({ title: id }),
      })
      el('newId').value = ''
      await refresh()
      await selectCapability(id)
    }

    async function saveManifest() {
      if (!state.selectedId) return
      await api('/api/capabilities/' + encodeURIComponent(state.selectedId) + '/manifest', {
        method: 'PATCH',
        body: JSON.stringify({
          title: el('title').value,
          description: el('description').value,
          status: el('status').value,
          match: lines(el('match').value),
          permissions: lines(el('permissions').value),
          inputSchema: JSON.parse(el('inputSchema').value || '{}'),
          outputSchema: JSON.parse(el('outputSchema').value || '{}'),
        }),
      })
      await refresh()
    }

    async function saveScript() {
      if (!state.selectedId) return
      await api('/api/capabilities/' + encodeURIComponent(state.selectedId) + '/script', {
        method: 'PUT',
        body: JSON.stringify({ source: el('script').value }),
      })
      await refresh()
    }

    function lines(value) {
      return value.split('\\n').map((line) => line.trim()).filter(Boolean)
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char])
    }

    el('refresh').onclick = () => { refresh().catch(alertError) }
    el('create').onclick = () => { createCapability().catch(alertError) }
    el('saveManifest').onclick = () => { saveManifest().catch(alertError) }
    el('saveScript').onclick = () => { saveScript().catch(alertError) }
    function alertError(error) { alert(error.message || String(error)) }
    refresh().catch(alertError)
  </script>
</body>
</html>`
}
