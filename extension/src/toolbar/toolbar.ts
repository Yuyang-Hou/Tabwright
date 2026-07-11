// Toolbar injected into the page's MAIN world via chrome.scripting.executeScript({ func }).
//
// CRITICAL: entirely self-contained. The function is serialized via
// Function.prototype.toString(), so no external imports, no module-level refs,
// all helpers as inner functions, all constants defined inline. Type-only imports
// and TS annotations are stripped at compile time — safe to use.
//
// window.__playwriterPinCount is a shared MAIN-world counter so toolbar pins
// and right-click menu pins never collide on globalThis.playwriterPinnedElemN.

declare global {
  interface Window {
    __playwriterToolbarInstalled?: boolean
    __playwriterToolbarBridgeInstalled?: boolean
    __playwriterToolbarDestroy?: () => void
    __playwriterPinCount?: number
    // Template literal index for pinned element globals (playwriterPinnedElem1, etc.)
    [key: `playwriterPinnedElem${number}`]: Element | undefined
  }
}

export function initPlaywriterToolbarBridge(): void {
  if (window.__playwriterToolbarBridgeInstalled) return
  window.__playwriterToolbarBridgeInstalled = true

  type ToolbarRequest = {
    source: 'playwriter-toolbar'
    type: 'recording-status' | 'recording-toggle'
    requestId: string
  }

  type ToolbarRuntimeResponse = {
    requestId: string
    result: unknown
  }

  function isToolbarRequest(value: unknown): value is ToolbarRequest {
    if (!value || typeof value !== 'object') return false
    const candidate = value as {
      source?: unknown
      type?: unknown
      requestId?: unknown
    }
    return (
      candidate.source === 'playwriter-toolbar' &&
      (candidate.type === 'recording-status' || candidate.type === 'recording-toggle') &&
      typeof candidate.requestId === 'string'
    )
  }

  function isToolbarRuntimeResponse(value: unknown, requestId: string): value is ToolbarRuntimeResponse {
    if (!value || typeof value !== 'object') return false
    const candidate = value as {
      requestId?: unknown
      result?: unknown
    }
    return candidate.requestId === requestId
  }

  function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function isExtensionContextInvalidated(error: unknown): boolean {
    return getErrorMessage(error).includes('Extension context invalidated')
  }

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!isToolbarRequest(event.data)) return
    const data = event.data

    const action = data.type === 'recording-toggle' ? 'playwriterToolbarToggleRecording' : 'playwriterToolbarRecordingStatus'
    const requestId = data.requestId
    const responseType = `${data.type}-result`
    const connectedPort = (() => {
      try {
        return chrome.runtime.connect({ name: 'playwriter-toolbar-recording' })
      } catch (error: unknown) {
        if (isExtensionContextInvalidated(error)) return null
        const message = getErrorMessage(error)
        console.warn('[Playwriter toolbar bridge] port connect failed', data.type, requestId, message)
        window.postMessage(
          {
            source: 'playwriter-toolbar-bridge',
            type: responseType,
            requestId,
            result: { success: false, error: message },
          },
          '*',
        )
        return null
      }
    })()
    if (!connectedPort) return
    const port = connectedPort
    const timeoutId = window.setTimeout(() => {
      failWithMessage({
        message: `Playwriter toolbar background did not respond (${data.type}, ${requestId})`,
        disconnect: true,
      })
    }, 85000)
    let settled = false

    function cleanup(options: { disconnect: boolean }): void {
      window.clearTimeout(timeoutId)
      port.onMessage.removeListener(onPortMessage)
      port.onDisconnect.removeListener(onDisconnect)
      if (options.disconnect) {
        port.disconnect()
      }
    }

    function postResult(result: unknown): void {
      window.postMessage(
        {
          source: 'playwriter-toolbar-bridge',
          type: responseType,
          requestId,
          result,
        },
        '*',
      )
    }

    function abandonRequest(): void {
      if (settled) return
      settled = true
      cleanup({ disconnect: false })
    }

    function failWithMessage(options: { message: string; disconnect: boolean }): void {
      if (settled) return
      settled = true
      cleanup({ disconnect: options.disconnect })
      console.warn('[Playwriter toolbar bridge] port request failed', data.type, requestId, options.message)
      postResult({ success: false, error: options.message })
    }

    function onPortMessage(response: unknown): void {
      if (!isToolbarRuntimeResponse(response, requestId)) return
      if (settled) return
      settled = true
      cleanup({ disconnect: true })
      postResult(response.result)
    }

    function onDisconnect(): void {
      const message = (() => {
        try {
          return chrome.runtime.lastError?.message || 'Playwriter toolbar background port disconnected'
        } catch (error: unknown) {
          return getErrorMessage(error)
        }
      })()
      if (message.includes('Extension context invalidated')) {
        abandonRequest()
        return
      }
      failWithMessage({
        message,
        disconnect: false,
      })
    }

    port.onMessage.addListener(onPortMessage)
    port.onDisconnect.addListener(onDisconnect)

    try {
      port.postMessage({ action, requestId })
    } catch (error: unknown) {
      if (isExtensionContextInvalidated(error)) {
        abandonRequest()
        return
      }
      const message = getErrorMessage(error)
      failWithMessage({ message, disconnect: true })
    }
  })
}

export function initPlaywriterToolbar(): void {
  if (window.__playwriterToolbarInstalled) return
  window.__playwriterToolbarInstalled = true

  // Top-level frame only — skip iframes (cross-origin access throws).
  try {
    if (window !== window.top) return
  } catch {
    return
  }

  let pinModeActive = false
  let pinCount = 0
  let recordingActive = false
  let recordingBusy = false
  let nextBridgeRequestId = 1
  let toastTimer: number | null = null
  let overlayEl: HTMLDivElement | null = null
  let annotationLayerEl: HTMLDivElement | null = null
  let annotationEditorEl: HTMLDivElement | null = null
  let annotationPreview: { target: Element; region: HTMLDivElement } | null = null
  let annotationCount = 0
  let annotationLayoutListening = false
  type AnnotationPlacement = 'right' | 'left' | 'bottom' | 'top'
  const annotationMarkers: Array<{
    id: string
    target: Element
    region: HTMLDivElement
    label: HTMLDivElement
  }> = []
  // Declared here so the hoisted setPinMode can reference it before assignment.
  let pinBtn!: HTMLButtonElement
  let recordBtn!: HTMLButtonElement

  type ToolbarBridgeResult = {
    success?: boolean
    isRecording?: boolean
    startedAt?: number
    tabId?: number
    id?: string
    path?: string
    duration?: number
    size?: number
    replayId?: string
    replayPath?: string
    replayDuration?: number
    replaySize?: number
    replayEventCount?: number
    warning?: string
    error?: string
  }

  // ── Create shadow-DOM host ─────────────────────────────────────────────────

  const host = document.createElement('div')
  host.setAttribute('data-playwriter-toolbar', '1')
  // pointer-events:none on the host so the shadow-DOM children (pointer-events:all)
  // control interactivity without the host element itself blocking page events
  host.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;font-size:0;line-height:0;'

  // Closed shadow root: page scripts cannot access our toolbar DOM
  const shadow = host.attachShadow({ mode: 'closed' })

  const styleEl = document.createElement('style')
  // Toolbar styles mirror mesurer's toolbar.tsx:
  //   - white bg, rounded-[12px], p-1
  //   - shadow: 0px 0px .5px rgba(0,0,0,.18), 0px 3px 8px rgba(0,0,0,.1), 0px 1px 3px rgba(0,0,0,.1)
  //   - active button: #0d99ff background, white text
  //   - inactive hover: bg-black/4 (rgba(0,0,0,0.04))
  styleEl.textContent = `
    *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      background: #fff;
      border-radius: 10px;
      pointer-events: all;
      user-select: none;
      box-shadow: 0px 0px 0.5px rgba(0,0,0,0.18), 0px 3px 8px rgba(0,0,0,0.1), 0px 1px 3px rgba(0,0,0,0.1);
    }
    .divider {
      width: 1px;
      height: 12px;
      background: rgba(0, 0, 0, 0.08);
      margin: 0 1px;
      flex-shrink: 0;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: #000;
      cursor: pointer;
      transition: background 0.1s;
      padding: 0;
      flex-shrink: 0;
      outline: none;
    }
    .btn:hover {
      background: rgba(0, 0, 0, 0.04);
    }
    .btn.active {
      background: #0d99ff;
      color: #fff;
    }
    .btn.active:hover {
      background: #0d99ff;
      filter: brightness(1.05);
    }
    .btn.recording {
      color: #ef4444;
    }
    .btn.recording.active {
      background: #ef4444;
      color: #fff;
    }
    .btn.recording.active:hover {
      background: #ef4444;
      filter: brightness(1.05);
    }
    .btn.busy {
      opacity: 0.55;
      cursor: wait;
    }
    /* When active, the logo inner cursor path needs to match the blue bg
       so it appears as a "cutout" through the white outer shape */
    .btn.active .logo-inner { fill: #0d99ff; }
    .toast {
      position: fixed;
      background: #0f172a;
      border-radius: 8px;
      padding: 9px 18px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 11px;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      pointer-events: none;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      white-space: nowrap;
      z-index: 1;
      --toast-transform: translateX(-50%);
      animation: toast-in 0.15s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: var(--toast-transform) translateY(4px); }
      to   { opacity: 1; transform: var(--toast-transform); }
    }
    .annotation-popover {
      position: fixed;
      width: min(360px, calc(100vw - 24px));
      padding: 12px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.98);
      color: #0f172a;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18), 0 3px 12px rgba(15, 23, 42, 0.1);
      z-index: 2;
      pointer-events: all;
      animation: annotation-in 0.14s ease;
      backdrop-filter: blur(10px);
    }
    @keyframes annotation-in {
      from { opacity: 0; transform: translateY(4px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .annotation-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0;
    }
    .annotation-target {
      max-width: 210px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #64748b;
      font-size: 11px;
      font-weight: 500;
    }
    .annotation-input {
      display: block;
      width: 100%;
      min-height: 76px;
      max-height: 150px;
      resize: vertical;
      border: 1px solid #d8dee8;
      border-radius: 9px;
      padding: 9px 10px;
      color: #0f172a;
      background: #fff;
      font: 12px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      outline: none;
    }
    .annotation-input:focus {
      border-color: #0d99ff;
      box-shadow: 0 0 0 3px rgba(13, 153, 255, 0.14);
    }
    .annotation-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 10px;
    }
    .annotation-action {
      height: 28px;
      padding: 0 11px;
      border-radius: 8px;
      border: 1px solid transparent;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      background: transparent;
      color: #334155;
    }
    .annotation-action:hover {
      background: #f1f5f9;
    }
    .annotation-action.primary {
      color: #fff;
      background: #0d99ff;
      border-color: #0d99ff;
    }
    .annotation-action.primary:hover {
      background: #087ad1;
      border-color: #087ad1;
    }
  `

  const toolbarEl = document.createElement('div')
  toolbarEl.className = 'toolbar'
  toolbarEl.setAttribute('role', 'toolbar')
  toolbarEl.setAttribute('aria-label', 'Playwriter tools')

  shadow.appendChild(styleEl)
  shadow.appendChild(toolbarEl)

  // ── Helper: toast notification ─────────────────────────────────────────────

  function showToast(msg: string, anchorRect?: DOMRect): void {
    shadow.querySelectorAll('.toast').forEach((el) => {
      el.remove()
    })
    if (toastTimer !== null) clearTimeout(toastTimer)
    const toastEl = document.createElement('div')
    toastEl.className = 'toast'
    toastEl.textContent = msg

    if (anchorRect) {
      // Position like a tooltip just below the element, centered horizontally
      const GAP = 8
      const centerX = anchorRect.left + anchorRect.width / 2
      const belowY = anchorRect.bottom + GAP

      // Flip above if too close to viewport bottom (toast is ~30px tall)
      const fitsBelow = belowY + 36 < window.innerHeight
      const top = fitsBelow ? belowY : anchorRect.top - GAP
      const transformOrigin = fitsBelow ? 'top center' : 'bottom center'

      toastEl.style.left = Math.max(8, Math.min(centerX, window.innerWidth - 8)) + 'px'
      toastEl.style.top = top + 'px'
      // Set base transform via CSS variable so the @keyframes animation includes it.
      // Without this, the keyframe overrides the inline transform during animation
      // and the toast jumps when positioned above the anchor (translateY(-100%)).
      const baseTransform = fitsBelow ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)'
      toastEl.style.setProperty('--toast-transform', baseTransform)
      toastEl.style.transform = baseTransform
      toastEl.style.transformOrigin = transformOrigin
    } else {
      // Fallback: bottom-center of viewport
      toastEl.style.bottom = '20px'
      toastEl.style.left = '50%'
      toastEl.style.transform = 'translateX(-50%)'
    }

    shadow.appendChild(toastEl)
    toastTimer = window.setTimeout(() => {
      toastEl.remove()
    }, 1900)
  }

  function isToolbarBridgeResult(value: unknown): value is ToolbarBridgeResult {
    if (!value || typeof value !== 'object') return false
    const candidate = value as {
      success?: unknown
      isRecording?: unknown
      startedAt?: unknown
      tabId?: unknown
      id?: unknown
      path?: unknown
      duration?: unknown
      size?: unknown
      replayId?: unknown
      replayPath?: unknown
      replayDuration?: unknown
      replaySize?: unknown
      replayEventCount?: unknown
      warning?: unknown
      error?: unknown
    }
    return (
      (candidate.success === undefined || typeof candidate.success === 'boolean') &&
      (candidate.isRecording === undefined || typeof candidate.isRecording === 'boolean') &&
      (candidate.startedAt === undefined || typeof candidate.startedAt === 'number') &&
      (candidate.tabId === undefined || typeof candidate.tabId === 'number') &&
      (candidate.id === undefined || typeof candidate.id === 'string') &&
      (candidate.path === undefined || typeof candidate.path === 'string') &&
      (candidate.duration === undefined || typeof candidate.duration === 'number') &&
      (candidate.size === undefined || typeof candidate.size === 'number') &&
      (candidate.replayId === undefined || typeof candidate.replayId === 'string') &&
      (candidate.replayPath === undefined || typeof candidate.replayPath === 'string') &&
      (candidate.replayDuration === undefined || typeof candidate.replayDuration === 'number') &&
      (candidate.replaySize === undefined || typeof candidate.replaySize === 'number') &&
      (candidate.replayEventCount === undefined || typeof candidate.replayEventCount === 'number') &&
      (candidate.warning === undefined || typeof candidate.warning === 'string') &&
      (candidate.error === undefined || typeof candidate.error === 'string')
    )
  }

  function sendToolbarBridgeRequest(type: 'recording-status' | 'recording-toggle'): Promise<ToolbarBridgeResult> {
    const requestId = `playwriter-${Date.now()}-${nextBridgeRequestId++}`
    return new Promise<ToolbarBridgeResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onResponse)
        console.warn('[Playwriter toolbar] bridge timeout', type, requestId)
        reject(new Error(`Playwriter toolbar bridge did not respond (${type}, ${requestId})`))
      }, 90000)

      function onResponse(event: MessageEvent<unknown>): void {
        const data = event.data
        if (!data || typeof data !== 'object') return
        const candidate = data as {
          source?: unknown
          type?: unknown
          requestId?: unknown
          result?: unknown
        }
        if (
          candidate.source !== 'playwriter-toolbar-bridge' ||
          candidate.type !== `${type}-result` ||
          candidate.requestId !== requestId
        ) {
          return
        }

        window.clearTimeout(timeout)
        window.removeEventListener('message', onResponse)
        if (!isToolbarBridgeResult(candidate.result)) {
          reject(new Error('Invalid Playwriter toolbar bridge response'))
          return
        }
        resolve(candidate.result)
      }

      window.addEventListener('message', onResponse)
      window.postMessage(
        {
          source: 'playwriter-toolbar',
          type,
          requestId,
        },
        '*',
      )
    })
  }

  function updateRecordButton(): void {
    recordBtn.classList.toggle('active', recordingActive)
    recordBtn.classList.toggle('busy', recordingBusy)
    recordBtn.setAttribute('aria-pressed', String(recordingActive))
    recordBtn.setAttribute('aria-busy', String(recordingBusy))
    recordBtn.setAttribute('title', recordingActive ? 'Stop demonstration recording' : 'Start demonstration recording')
    recordBtn.setAttribute(
      'aria-label',
      recordingActive ? 'Stop Playwriter demonstration recording' : 'Start Playwriter demonstration recording',
    )
    recordBtn.innerHTML = recordingActive ? STOP_RECORDING_SVG : RECORD_SVG
    updatePinButton()
  }

  function updatePinButton(): void {
    if (!pinBtn) return
    pinBtn.setAttribute(
      'aria-label',
      recordingActive
        ? 'Annotate an element in this recording'
        : 'Pin element — click any element to copy inspection code for a playwriter -e call',
    )
    pinBtn.setAttribute(
      'title',
      recordingActive ? 'Annotate element in recording' : 'Pin element (click to copy inspection code)',
    )
  }

  function applyRecordingResult(result: ToolbarBridgeResult): void {
    if (result.success === false) {
      throw new Error(result.error || 'Recording request failed')
    }
    if (typeof result.isRecording === 'boolean') {
      const wasRecording = recordingActive
      recordingActive = result.isRecording
      if (recordingActive && !wasRecording) {
        clearAnnotationBadges()
      }
      if (!recordingActive && wasRecording) {
        closeAnnotationEditor()
        clearAnnotationBadges()
        setPinMode(false)
      }
    }
  }

  // ── Helper: hover overlay (shown under cursor in pin mode) ─────────────────
  //
  // Matches mesurer's rendering exactly: four 1px-thin edge divs as the border,
  // plus a very subtle fill background. Colors from mesurer's measurement-box.tsx:
  //   outlineColor = color-mix(in oklch, oklch(0.62 0.18 255) 80%, transparent)
  //   fillColor    = color-mix(in oklch, oklch(0.62 0.18 255) 8%,  transparent)
  // This is thinner and cleaner than a CSS outline/border.

  function getOverlay(): HTMLDivElement {
    if (!overlayEl) {
      const EDGE = 'color-mix(in oklch, oklch(0.62 0.18 255) 80%, transparent)'
      const FILL = 'color-mix(in oklch, oklch(0.62 0.18 255) 8%, transparent)'

      const container = document.createElement('div')
      container.setAttribute('data-playwriter-overlay', '1')
      container.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:2147483646',
        `background:${FILL}`,
        'display:none',
      ].join(';')

      // Four 1px edge divs — same technique as mesurer measurement-box
      const edgeTop = document.createElement('div')
      edgeTop.style.cssText = `position:absolute;top:0;left:0;width:100%;height:1px;background:${EDGE};`

      const edgeRight = document.createElement('div')
      edgeRight.style.cssText = `position:absolute;top:0;right:0;width:1px;height:100%;background:${EDGE};`

      const edgeBottom = document.createElement('div')
      edgeBottom.style.cssText = `position:absolute;bottom:0;left:0;width:100%;height:1px;background:${EDGE};`

      const edgeLeft = document.createElement('div')
      edgeLeft.style.cssText = `position:absolute;top:0;left:0;width:1px;height:100%;background:${EDGE};`

      container.appendChild(edgeTop)
      container.appendChild(edgeRight)
      container.appendChild(edgeBottom)
      container.appendChild(edgeLeft)

      document.documentElement.appendChild(container)
      overlayEl = container
    }
    return overlayEl
  }

  function positionOverlay(target: Element): void {
    const rect = target.getBoundingClientRect()
    if (!rect.width && !rect.height) return
    const overlay = getOverlay()
    overlay.style.display = 'block'
    overlay.style.top = rect.top + 'px'
    overlay.style.left = rect.left + 'px'
    overlay.style.width = rect.width + 'px'
    overlay.style.height = rect.height + 'px'
  }

  function hideOverlay(): void {
    if (overlayEl) overlayEl.style.display = 'none'
  }

  function removeOverlay(): void {
    if (overlayEl) {
      overlayEl.remove()
      overlayEl = null
    }
  }

  // ── Helper: find element at point, skipping our own injected DOM ───────────

  function getTargetAt(x: number, y: number): Element | null {
    // pointer-events:none elements are excluded from elementsFromPoint per spec,
    // so the overlay is already filtered. We still skip our toolbar host explicitly.
    const els = document.elementsFromPoint(x, y)
    return (
      els.find(
        (el) =>
          !el.hasAttribute('data-playwriter-overlay') &&
          !el.hasAttribute('data-playwriter-toolbar') &&
          el !== document.documentElement &&
          el !== document.body,
      ) ?? null
    )
  }

  // composedPath with a closed shadow root still includes the host element,
  // so this correctly detects clicks/moves that land on our toolbar
  function isOverToolbar(e: MouseEvent): boolean {
    return e.composedPath().some((node) => node === host)
  }

  // ── Helper: flash green outline on a pinned element ────────────────────────

  function flashElement(el: Element): void {
    const s = (el as HTMLElement).style
    if (!s) return
    const prevOutline = s.outline
    const prevOffset = s.outlineOffset
    s.outline = '1px solid #22c55e'
    s.outlineOffset = '2px'
    window.setTimeout(() => {
      s.outline = prevOutline
      s.outlineOffset = prevOffset
    }, 350)
  }

  // ── Helper: copy text to clipboard with execCommand fallback ───────────────

  function copyText(text: string): void {
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback for pages where the Clipboard API is blocked by Permissions-Policy
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        ta.remove()
      } catch {}
    })
  }

  function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`
  }

  function replayCapabilityId(replayId: string): string {
    const suffix =
      replayId
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(-28) || 'workflow'
    return `replay-${suffix}`
  }

  function replayMakeCommand(replayId: string): string {
    const capabilityId = replayCapabilityId(replayId)
    return [
      'playwriter replay make',
      shellQuote(replayId),
      shellQuote(capabilityId),
      '--force',
      '--goal',
      shellQuote('<describe the batch task goal>'),
    ].join(' ')
  }

  function replayRunCommand(replayId: string): string {
    const capabilityId = replayCapabilityId(replayId)
    return [
      'playwriter capability run',
      shellQuote(capabilityId),
      '--browser user',
      '--force',
      '--confirm',
      shellQuote(capabilityId),
      '--input-json',
      shellQuote('{"value":"..."}'),
      '--json',
    ].join(' ')
  }

  function replayAiHandoffText(result: ToolbarBridgeResult): string | null {
    const replayId = result.replayId || result.id
    if (!replayId) return null
    const path = result.replayPath || result.path
    return [
      `这是 Playwriter replay id：${replayId}`,
      `Recorded URL: ${window.location.href}`,
      path ? `Recording path: ${path}` : '',
      result.replayEventCount !== undefined ? `Events: ${result.replayEventCount}` : '',
      '',
      '我的目标是：<描述要 AI 基于这次录制重复/批量完成什么>',
      '',
      '请先编译成 capability：',
      replayMakeCommand(replayId),
      '',
      '这是写操作。先暂停并取得用户明确确认，确认后才可执行：',
      replayRunCommand(replayId),
      '',
      '如果返回 needs_ai，请根据上下文修改脚本后继续跑。',
    ]
      .filter((line) => {
        return line.length > 0
      })
      .join('\n')
  }

  function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
  }

  function uniqueStrings(values: string[]): string[] {
    return Array.from(
      new Set(
        values.filter((value) => {
          return value.length > 0
        }),
      ),
    )
  }

  function attrSelector(name: string, value: string): string {
    return `[${name}=${JSON.stringify(value)}]`
  }

  function isSimpleCssIdentifier(value: string): boolean {
    return /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(value)
  }

  function elementText(target: Element): string | undefined {
    const text =
      target instanceof HTMLElement
        ? normalizeText(target.innerText || target.textContent || '')
        : normalizeText(target.textContent || '')
    if (!text || text.length > 180) {
      return undefined
    }
    return text
  }

  function labelForTarget(target: Element): string | undefined {
    const direct =
      target.getAttribute('aria-label') ||
      target.getAttribute('title') ||
      target.getAttribute('placeholder') ||
      target.getAttribute('name') ||
      ''
    if (direct.trim()) {
      return normalizeText(direct)
    }
    const id = target.getAttribute('id')
    if (id) {
      const label = document.querySelector(`label[for=${JSON.stringify(id)}]`)
      const labelText = normalizeText(label?.textContent || '')
      if (labelText) {
        return labelText
      }
    }
    const closestLabel = target.closest('label')
    const closestLabelText = normalizeText(closestLabel?.textContent || '')
    if (closestLabelText) {
      return closestLabelText
    }
    return elementText(target)
  }

  function selectorHintsForTarget(target: Element): string[] {
    const tagName = target.tagName.toLowerCase()
    const classHints = Array.from(target.classList)
      .filter((className) => {
        return isSimpleCssIdentifier(className) && className.length <= 80
      })
      .slice(0, 3)
      .map((className) => {
        return `${tagName}.${className}`
      })
    const id = target.getAttribute('id') || ''
    return uniqueStrings([
      id ? (isSimpleCssIdentifier(id) ? `#${id}` : attrSelector('id', id)) : '',
      target.getAttribute('data-testid') ? attrSelector('data-testid', target.getAttribute('data-testid') || '') : '',
      target.getAttribute('data-test') ? attrSelector('data-test', target.getAttribute('data-test') || '') : '',
      target.getAttribute('name') ? `${tagName}${attrSelector('name', target.getAttribute('name') || '')}` : '',
      target.getAttribute('placeholder')
        ? `${tagName}${attrSelector('placeholder', target.getAttribute('placeholder') || '')}`
        : '',
      target.getAttribute('aria-label')
        ? `${tagName}${attrSelector('aria-label', target.getAttribute('aria-label') || '')}`
        : '',
      ...classHints,
    ])
  }

  function targetLabelPreview(target: Element): string {
    const label = labelForTarget(target)
    if (label) {
      return label.length > 44 ? `${label.slice(0, 43)}…` : label
    }
    const selector = selectorHintsForTarget(target)[0]
    if (selector) {
      return selector
    }
    return target.tagName.toLowerCase()
  }

  function summarizeTarget(target: Element): Record<string, unknown> {
    const rect = target.getBoundingClientRect()
    return {
      tagName: target.tagName.toLowerCase(),
      label: labelForTarget(target),
      text: elementText(target),
      role: target.getAttribute('role') || undefined,
      name: target.getAttribute('name') || undefined,
      placeholder: target.getAttribute('placeholder') || undefined,
      selectorHints: selectorHintsForTarget(target),
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    }
  }

  function getAnnotationLayer(): HTMLDivElement {
    if (!annotationLayerEl) {
      const layer = document.createElement('div')
      layer.setAttribute('data-playwriter-annotation-layer', '1')
      layer.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483645',
        'pointer-events:none',
        'font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      ].join(';')
      document.documentElement.appendChild(layer)
      annotationLayerEl = layer
    }
    return annotationLayerEl
  }

  function createAnnotationRegion(options: { index?: number; preview: boolean }): HTMLDivElement {
    const region = document.createElement('div')
    if (options.preview) {
      region.setAttribute('data-playwriter-annotation-preview', '1')
    } else if (typeof options.index === 'number') {
      region.setAttribute('data-playwriter-annotation-region', String(options.index))
    }
    region.style.cssText = [
      'position:fixed',
      `border:1px solid ${options.preview ? 'rgba(99,102,241,0.46)' : 'rgba(99,102,241,0.32)'}`,
      `background:${options.preview ? 'rgba(99,102,241,0.075)' : 'rgba(99,102,241,0.045)'}`,
      `box-shadow:inset 0 0 0 1px rgba(255,255,255,0.45),0 0 0 2px ${options.preview ? 'rgba(99,102,241,0.095)' : 'rgba(99,102,241,0.055)'}`,
      'border-radius:6px',
      'pointer-events:none',
    ].join(';')
    return region
  }

  function positionAnnotationRegion(options: { target: Element; region: HTMLDivElement }): boolean {
    const rect = options.target.getBoundingClientRect()
    const visible = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0
    options.region.style.display = visible ? 'block' : 'none'
    if (!visible) {
      return false
    }

    const regionLeft = Math.max(0, rect.left)
    const regionTop = Math.max(0, rect.top)
    options.region.style.left = `${regionLeft}px`
    options.region.style.top = `${regionTop}px`
    options.region.style.width = `${Math.max(1, Math.min(rect.width, window.innerWidth - regionLeft))}px`
    options.region.style.height = `${Math.max(1, Math.min(rect.height, window.innerHeight - regionTop))}px`
    return true
  }

  function updateAnnotationPreview(): void {
    if (!annotationPreview) return
    positionAnnotationRegion(annotationPreview)
  }

  function removeAnnotationPreview(): void {
    if (!annotationPreview) return
    annotationPreview.region.remove()
    annotationPreview = null
    if (annotationMarkers.length === 0) {
      removeAnnotationBadgeLayoutListeners()
    }
  }

  function showAnnotationPreview(target: Element): void {
    removeAnnotationPreview()
    const region = createAnnotationRegion({ preview: true })
    const layer = getAnnotationLayer()
    layer.appendChild(region)
    annotationPreview = { target, region }
    ensureAnnotationBadgeLayoutListeners()
    updateAnnotationPreview()
  }

  function clampAnnotationPosition(options: { value: number; min: number; max: number }): number {
    return Math.max(options.min, Math.min(options.value, options.max))
  }

  function chooseAnnotationPlacement(options: {
    rect: DOMRect
    bubbleWidth: number
    bubbleHeight: number
    gap: number
  }): AnnotationPlacement {
    const placements: Array<{ placement: AnnotationPlacement; fits: boolean; score: number }> = [
      {
        placement: 'right',
        fits: window.innerWidth - options.rect.right - options.gap >= options.bubbleWidth,
        score: window.innerWidth - options.rect.right,
      },
      {
        placement: 'left',
        fits: options.rect.left - options.gap >= options.bubbleWidth,
        score: options.rect.left,
      },
      {
        placement: 'bottom',
        fits: window.innerHeight - options.rect.bottom - options.gap >= options.bubbleHeight,
        score: window.innerHeight - options.rect.bottom,
      },
      {
        placement: 'top',
        fits: options.rect.top - options.gap >= options.bubbleHeight,
        score: options.rect.top,
      },
    ]
    const firstFit = placements.find((placement) => {
      return placement.fits
    })
    if (firstFit) {
      return firstFit.placement
    }
    return placements.reduce((best, placement) => {
      return placement.score > best.score ? placement : best
    }).placement
  }

  function updateAnnotationBadges(): void {
    updateAnnotationPreview()
    annotationMarkers.forEach(({ target, region, label }) => {
      const rect = target.getBoundingClientRect()
      const visible = positionAnnotationRegion({ target, region })
      label.style.display = visible ? 'flex' : 'none'
      if (!visible) {
        return
      }

      const padding = 8
      const gap = 12
      const bubbleWidth = label.offsetWidth || 240
      const bubbleHeight = label.offsetHeight || 34
      const placement = chooseAnnotationPlacement({ rect, bubbleWidth, bubbleHeight, gap })
      const targetCenterX = rect.left + rect.width / 2
      const targetCenterY = rect.top + rect.height / 2
      const maxLeft = Math.max(padding, window.innerWidth - bubbleWidth - padding)
      const maxTop = Math.max(padding, window.innerHeight - bubbleHeight - padding)

      const position = (() => {
        if (placement === 'right') {
          const left = clampAnnotationPosition({ value: rect.right + gap, min: padding, max: maxLeft })
          const top = clampAnnotationPosition({ value: targetCenterY - bubbleHeight / 2, min: padding, max: maxTop })
          return {
            left,
            top,
          }
        }
        if (placement === 'left') {
          const left = clampAnnotationPosition({ value: rect.left - gap - bubbleWidth, min: padding, max: maxLeft })
          const top = clampAnnotationPosition({ value: targetCenterY - bubbleHeight / 2, min: padding, max: maxTop })
          return {
            left,
            top,
          }
        }
        if (placement === 'bottom') {
          const left = clampAnnotationPosition({ value: targetCenterX - bubbleWidth / 2, min: padding, max: maxLeft })
          const top = clampAnnotationPosition({ value: rect.bottom + gap, min: padding, max: maxTop })
          return {
            left,
            top,
          }
        }
        const left = clampAnnotationPosition({ value: targetCenterX - bubbleWidth / 2, min: padding, max: maxLeft })
        const top = clampAnnotationPosition({ value: rect.top - gap - bubbleHeight, min: padding, max: maxTop })
        return {
          left,
          top,
        }
      })()

      label.style.left = `${position.left}px`
      label.style.top = `${position.top}px`
    })
  }

  function ensureAnnotationBadgeLayoutListeners(): void {
    if (annotationLayoutListening) return
    annotationLayoutListening = true
    window.addEventListener('resize', updateAnnotationBadges, true)
    document.addEventListener('scroll', updateAnnotationBadges, true)
  }

  function removeAnnotationBadgeLayoutListeners(): void {
    if (!annotationLayoutListening) return
    annotationLayoutListening = false
    window.removeEventListener('resize', updateAnnotationBadges, true)
    document.removeEventListener('scroll', updateAnnotationBadges, true)
  }

  function removeAnnotationMarker(options: { id: string; emitDelete: boolean }): void {
    const markerIndex = annotationMarkers.findIndex((marker) => {
      return marker.id === options.id
    })
    if (markerIndex < 0) return
    const marker = annotationMarkers[markerIndex]
    if (!marker) return
    annotationMarkers.splice(markerIndex, 1)
    marker.region.remove()
    marker.label.remove()
    if (options.emitDelete) {
      postAnnotationDeleteEvent({ id: options.id })
    }
    if (annotationMarkers.length === 0 && !annotationPreview) {
      removeAnnotationBadgeLayoutListeners()
      annotationLayerEl?.remove()
      annotationLayerEl = null
    }
  }

  function createAnnotationBadge(options: { id: string; target: Element; text: string; index: number }): void {
    const region = createAnnotationRegion({ index: options.index, preview: false })

    const label = document.createElement('div')
    label.setAttribute('data-playwriter-annotation-badge', String(options.index))
    label.setAttribute('data-playwriter-annotation-id', options.id)
    label.setAttribute('data-playwriter-annotation-text', options.text)
    label.title = options.text
    label.style.cssText = [
      'position:fixed',
      'align-items:center',
      'gap:6px',
      'max-width:min(300px,calc(100vw - 16px))',
      'min-height:28px',
      'padding:5px 10px 5px 6px',
      'border:1px solid rgba(99,102,241,0.2)',
      'border-radius:10px',
      'background:rgba(255,255,255,0.9)',
      'color:#312e81',
      'font-size:12px',
      'font-weight:560',
      'line-height:1.25',
      'box-shadow:0 10px 28px rgba(15,23,42,0.13),0 1px 3px rgba(49,46,129,0.1)',
      'backdrop-filter:blur(10px)',
      'opacity:0.92',
      'pointer-events:auto',
      'cursor:default',
    ].join(';')

    const number = document.createElement('span')
    number.textContent = String(options.index)
    number.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'width:17px',
      'height:17px',
      'border-radius:5px',
      'background:rgba(79,70,229,0.9)',
      'color:#fff',
      'font-size:10px',
      'font-weight:750',
      'line-height:1',
      'flex:0 0 auto',
    ].join(';')

    const text = document.createElement('span')
    text.textContent = options.text
    text.style.cssText = [
      'display:block',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'white-space:nowrap',
      'letter-spacing:0',
    ].join(';')

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.textContent = '×'
    deleteButton.setAttribute('aria-label', `Delete annotation ${options.index}`)
    deleteButton.title = 'Delete annotation'
    deleteButton.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'width:18px',
      'height:18px',
      'margin-left:2px',
      'border:0',
      'border-radius:6px',
      'background:rgba(49,46,129,0.08)',
      'color:#4338ca',
      'font-size:14px',
      'font-weight:700',
      'line-height:1',
      'opacity:0',
      'cursor:pointer',
      'transition:opacity 0.12s ease,background 0.12s ease,color 0.12s ease',
      'pointer-events:auto',
      'flex:0 0 auto',
    ].join(';')

    label.addEventListener('mouseenter', () => {
      deleteButton.style.opacity = '1'
    })
    label.addEventListener('mouseleave', () => {
      deleteButton.style.opacity = '0'
    })
    label.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    label.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    deleteButton.addEventListener('mouseenter', () => {
      deleteButton.style.background = 'rgba(239,68,68,0.12)'
      deleteButton.style.color = '#dc2626'
    })
    deleteButton.addEventListener('mouseleave', () => {
      deleteButton.style.background = 'rgba(49,46,129,0.08)'
      deleteButton.style.color = '#4338ca'
    })
    deleteButton.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    deleteButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      removeAnnotationMarker({ id: options.id, emitDelete: true })
      showToast('Annotation deleted', label.getBoundingClientRect())
    })

    label.appendChild(number)
    label.appendChild(text)
    label.appendChild(deleteButton)
    const layer = getAnnotationLayer()
    layer.appendChild(region)
    layer.appendChild(label)
    annotationMarkers.push({ id: options.id, target: options.target, region, label })
    ensureAnnotationBadgeLayoutListeners()
    updateAnnotationBadges()
  }

  function clearAnnotationBadges(): void {
    removeAnnotationPreview()
    annotationMarkers.splice(0).forEach(({ region, label }) => {
      region.remove()
      label.remove()
    })
    removeAnnotationBadgeLayoutListeners()
    annotationLayerEl?.remove()
    annotationLayerEl = null
    annotationCount = 0
  }

  function closeAnnotationEditor(): void {
    if (annotationEditorEl) {
      annotationEditorEl.remove()
      annotationEditorEl = null
    }
    removeAnnotationPreview()
  }

  function postAnnotationEvent(options: { id: string; target: Element; text: string; index: number }): void {
    const annotation = {
      schemaVersion: 1,
      id: options.id,
      text: options.text,
      url: location.href,
      timestamp: Date.now(),
      target: summarizeTarget(options.target),
    }
    window.postMessage(
      {
        source: 'playwriter-toolbar',
        type: 'recording-annotation',
        annotation,
      },
      '*',
    )
  }

  function postAnnotationDeleteEvent(options: { id: string }): void {
    window.postMessage(
      {
        source: 'playwriter-toolbar',
        type: 'recording-annotation-delete',
        annotation: {
          schemaVersion: 1,
          id: options.id,
          url: location.href,
          timestamp: Date.now(),
        },
      },
      '*',
    )
  }

  function showAnnotationEditor(target: Element, anchorRect: DOMRect): void {
    closeAnnotationEditor()
    showAnnotationPreview(target)
    const popover = document.createElement('div')
    popover.className = 'annotation-popover'
    popover.addEventListener('click', (event) => {
      event.stopPropagation()
    })
    popover.addEventListener('mousedown', (event) => {
      event.stopPropagation()
    })

    const titleRow = document.createElement('div')
    titleRow.className = 'annotation-title'

    const title = document.createElement('span')
    title.textContent = 'Add annotation'

    const targetText = document.createElement('span')
    targetText.className = 'annotation-target'
    targetText.textContent = targetLabelPreview(target)

    const input = document.createElement('textarea')
    input.className = 'annotation-input'
    input.placeholder = 'What should AI remember here?'

    const actions = document.createElement('div')
    actions.className = 'annotation-actions'

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'annotation-action'
    cancel.textContent = 'Cancel'

    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'annotation-action primary'
    save.textContent = 'Save'

    function saveAnnotation(): void {
      const text = normalizeText(input.value)
      if (!text) {
        input.focus()
        return
      }
      annotationCount += 1
      const id = `ann-${Date.now()}-${annotationCount}`
      createAnnotationBadge({ id, target, text, index: annotationCount })
      postAnnotationEvent({ id, target, text, index: annotationCount })
      closeAnnotationEditor()
      showToast('Annotation saved', anchorRect)
    }

    cancel.addEventListener('click', () => {
      closeAnnotationEditor()
    })
    save.addEventListener('click', () => {
      saveAnnotation()
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAnnotationEditor()
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        saveAnnotation()
      }
    })

    titleRow.appendChild(title)
    titleRow.appendChild(targetText)
    actions.appendChild(cancel)
    actions.appendChild(save)
    popover.appendChild(titleRow)
    popover.appendChild(input)
    popover.appendChild(actions)

    const GAP = 10
    const preferredLeft = anchorRect.left
    const preferredTop = anchorRect.bottom + GAP
    const width = Math.min(360, window.innerWidth - 24)
    const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12))
    const top = preferredTop + 160 < window.innerHeight ? preferredTop : Math.max(12, anchorRect.top - 170)
    popover.style.left = `${left}px`
    popover.style.top = `${top}px`
    shadow.appendChild(popover)
    annotationEditorEl = popover
    window.setTimeout(() => {
      input.focus()
    }, 0)
  }

  // ── Pin mode: allocate the next reference name ─────────────────────────────

  function allocatePinName(): `playwriterPinnedElem${number}` {
    // Sync with the shared MAIN-world counter so right-click and toolbar
    // pins never produce conflicting globalThis.playwriterPinnedElemN names
    const shared = window.__playwriterPinCount
    if (typeof shared === 'number' && shared > pinCount) pinCount = shared
    pinCount++
    window.__playwriterPinCount = pinCount
    return `playwriterPinnedElem${pinCount}`
  }

  // ── Pin mode event handlers ────────────────────────────────────────────────

  function onMouseMove(e: MouseEvent): void {
    if (isOverToolbar(e)) {
      hideOverlay()
      return
    }
    const target = getTargetAt(e.clientX, e.clientY)
    if (target) positionOverlay(target)
    else hideOverlay()
  }

  // Build a tiny eval that delegates all logging and React inspection to Playwriter.
  // JSON.stringify does NOT escape literal ' characters, so "Don't save"
  // stays "Don't save" in the output. That would break the outer bash '…'
  // wrapper. Replace ' with \u0027 — valid JSON, parses back to ' in the
  // JS engine — so the whole code is single-quote-free and slots safely
  // into the bash 'playwriter -e …' wrapper regardless of element text.
  function buildInspectionCode(n: number, url: string): string {
    const URL_LIT = JSON.stringify(url).replace(/'/g, '\\u0027')
    return `inspectPinnedElement(${URL_LIT},"globalThis.playwriterPinnedElem${n}")`
  }

  function onClick(e: MouseEvent): void {
    if (isOverToolbar(e)) return
    e.preventDefault()
    e.stopImmediatePropagation()

    const target = getTargetAt(e.clientX, e.clientY)
    if (!target) return

    if (recordingActive) {
      const rect = target.getBoundingClientRect()
      setPinMode(false)
      showAnnotationEditor(target, rect)
      return
    }

    const name = allocatePinName()
    const n = pinCount
    window[name] = target

    flashElement(target)

    // Copy only the command so pasting it into a shell or agent prompt stays compact.
    const url = location.href
    const code = buildInspectionCode(n, url)
    const clipboardText = "playwriter -e '" + code + "'"
    copyText(clipboardText)
    showToast('Copied playwriter element reference, use it in your agent prompt', target.getBoundingClientRect())
    setPinMode(false)
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') setPinMode(false)
  }

  // ── Pin mode toggle ────────────────────────────────────────────────────────

  function setPinMode(on: boolean): void {
    pinModeActive = on
    // pinBtn is declared above and assigned below; safe to reference here
    // because setPinMode is only called from event listeners that fire after
    // all setup code has run
    pinBtn.classList.toggle('active', on)

    if (on) {
      document.documentElement.style.cursor = 'crosshair'
      getOverlay() // ensure overlay element exists in DOM
      document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true })
      document.addEventListener('click', onClick, true)
      document.addEventListener('keydown', onKeyDown, true)
    } else {
      document.documentElement.style.cursor = ''
      hideOverlay()
      document.removeEventListener('mousemove', onMouseMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }

  // ── SVG icon strings (defined inside function — required for func injection) ─

  // Playwriter logo-square icon (inlined from website/public/logo-square.svg)
  const CLIPBOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 424 424" aria-hidden="true"><path d="M 0 212 C 0 112.063 0 62.095 31.037 31.037 C 62.116 0 112.063 0 212 0 C 311.937 0 361.905 0 392.942 31.037 C 424 62.116 424 112.063 424 212 C 424 311.937 424 361.905 392.942 392.942 C 361.926 424 311.937 424 212 424 C 112.063 424 62.095 424 31.037 392.942 C 0 361.926 0 311.937 0 212" fill="currentColor"/><path class="logo-inner" d="M 225.732 260.521 L 277.905 312.673 C 283.311 318.1 286.003 320.793 289.014 322.043 C 293.042 323.718 297.557 323.718 301.585 322.043 C 304.596 320.793 307.309 318.1 312.694 312.694 C 318.1 307.288 320.793 304.596 322.043 301.585 C 323.722 297.563 323.722 293.036 322.043 289.014 C 320.793 286.003 318.1 283.29 312.694 277.905 L 260.521 225.732 L 276.442 209.789 C 292.766 193.465 300.907 185.325 298.999 176.548 C 297.07 167.792 286.237 163.785 264.591 155.814 L 192.384 129.208 C 149.2 113.308 127.618 105.358 116.488 116.488 C 105.358 127.618 113.308 149.2 129.208 192.384 L 155.814 264.591 C 163.785 286.237 167.792 297.07 176.548 298.999 C 185.303 300.928 193.465 292.766 209.789 276.442 Z" fill="white"/></svg>`

  // Lucide circle icon
  const RECORD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>`

  // Lucide square icon
  const STOP_RECORDING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>`

  // Lucide x icon
  const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

  // ── Build toolbar buttons ──────────────────────────────────────────────────

  // Clipboard / pin element button
  pinBtn = document.createElement('button')
  pinBtn.className = 'btn'
  pinBtn.setAttribute(
    'aria-label',
    'Pin element — click any element to copy inspection code for a playwriter -e call',
  )
  pinBtn.setAttribute('title', 'Pin element (click to copy inspection code)')
  pinBtn.innerHTML = CLIPBOARD_SVG
  pinBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    setPinMode(!pinModeActive)
  })

  // Demonstration recording button
  recordBtn = document.createElement('button')
  recordBtn.className = 'btn recording'
  recordBtn.setAttribute('aria-pressed', 'false')
  recordBtn.innerHTML = RECORD_SVG
  recordBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    if (recordingBusy) return

    recordingBusy = true
    updateRecordButton()
    sendToolbarBridgeRequest('recording-toggle')
      .then((result) => {
        applyRecordingResult(result)
        if (recordingActive) {
          showToast('Recording started', recordBtn.getBoundingClientRect())
          return
        }
        const handoffText = replayAiHandoffText(result)
        if (handoffText) {
          copyText(handoffText)
          showToast('Recording saved · copied for AI', recordBtn.getBoundingClientRect())
          return
        }
        const suffix = result.path ? `: ${result.path}` : ''
        showToast(`Recording saved${suffix}`, recordBtn.getBoundingClientRect())
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(message, recordBtn.getBoundingClientRect())
      })
      .finally(() => {
        recordingBusy = false
        updateRecordButton()
      })
  })
  updateRecordButton()

  const dividerEl = document.createElement('div')
  dividerEl.className = 'divider'
  dividerEl.setAttribute('aria-hidden', 'true')

  // Close button
  const closeBtn = document.createElement('button')
  closeBtn.className = 'btn'
  closeBtn.setAttribute('aria-label', 'Close Playwriter toolbar')
  closeBtn.setAttribute('title', 'Close toolbar')
  closeBtn.innerHTML = CLOSE_SVG
  closeBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    setPinMode(false)
    closeAnnotationEditor()
    clearAnnotationBadges()
    host.style.display = 'none'
  })

  toolbarEl.appendChild(pinBtn)
  toolbarEl.appendChild(recordBtn)
  toolbarEl.appendChild(dividerEl)
  toolbarEl.appendChild(closeBtn)

  // Attach host to the document (appended to <html> so it survives body rewrites)
  document.documentElement.appendChild(host)

  // ── Cleanup hook called by background.ts on tab disconnect ─────────────────

  window.__playwriterToolbarDestroy = function (): void {
    setPinMode(false)
    closeAnnotationEditor()
    clearAnnotationBadges()
    removeOverlay()
    host.remove()
    delete window.__playwriterToolbarInstalled
    delete window.__playwriterToolbarDestroy
    delete window.__playwriterPinCount
  }

  sendToolbarBridgeRequest('recording-status')
    .then((result) => {
      applyRecordingResult(result)
      updateRecordButton()
    })
    .catch(() => {})
}
