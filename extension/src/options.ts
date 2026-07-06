declare const process: { env: { PLAYWRITER_PORT: string } }

import { Replayer, type eventWithTime } from 'rrweb'
import 'rrweb/dist/style.css'

const RELAY_HOST = '127.0.0.1'
const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988
const RELAY_BASE_URL = `http://${RELAY_HOST}:${RELAY_PORT}`

type RrwebEvent = eventWithTime

interface SavedReplayRecording {
  id: string
  path: string
  startedAt: number
  savedAt: number
  duration: number
  size: number
  eventCount: number
  tabId: number
  sessionId?: string
  url?: string
}

interface ReplaysResponse {
  recordings: SavedReplayRecording[]
}

interface ReplayEventsResponse {
  recording: SavedReplayRecording
  events: RrwebEvent[]
}

const style = document.createElement('style')
style.textContent = `
  :root {
    color-scheme: light;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #111827;
    background: #f8fafc;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-width: 820px;
  }
  .shell {
    display: grid;
    grid-template-columns: minmax(280px, 380px) minmax(480px, 1fr);
    gap: 14px;
    min-height: 100vh;
    padding: 14px;
  }
  .recordings-panel,
  .player-panel {
    min-width: 0;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
  }
  .recordings-panel {
    display: flex;
    flex-direction: column;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px;
    border-bottom: 1px solid #e5e7eb;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
  }
  .list-heading {
    margin: 10px 10px 4px;
    color: #334155;
    font-size: 12px;
    font-weight: 650;
  }
  #status-text {
    margin: 5px 0 0;
    color: #64748b;
    font-size: 12px;
  }
  button {
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #fff;
    color: #111827;
    padding: 6px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover {
    background: #f3f4f6;
  }
  button:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
  .recordings-list {
    overflow: auto;
    padding: 8px;
  }
  .recording-item {
    width: 100%;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 10px;
    background: transparent;
    text-align: left;
  }
  .recording-item:hover {
    background: #f8fafc;
  }
  .recording-item.active {
    border-color: #93c5fd;
    background: #eff6ff;
  }
  .recording-title {
    color: #0f172a;
    font-size: 13px;
    font-weight: 650;
  }
  .recording-meta {
    margin-top: 5px;
    color: #64748b;
    font-size: 11px;
    line-height: 1.45;
    word-break: break-word;
  }
  .recording-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 9px;
  }
  .player-panel {
    display: grid;
    grid-template-rows: minmax(420px, 1fr) auto;
  }
  .replay-player {
    min-height: 420px;
    overflow: hidden;
    background: #111827;
  }
  .recording-details {
    min-height: 120px;
    border-top: 1px solid #e5e7eb;
    padding: 12px;
    color: #334155;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .empty-state {
    color: #64748b;
    padding: 10px;
    font-size: 12px;
  }
`
document.head.appendChild(style)

const statusText = document.querySelector<HTMLParagraphElement>('#status-text')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-button')
const replaysList = document.querySelector<HTMLDivElement>('#replays-list')
const replayPlayer = document.querySelector<HTMLDivElement>('#replay-player')
const replayDetails = document.querySelector<HTMLDivElement>('#replay-details')

let selectedReplayId: string | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isRrwebEvent(value: unknown): value is RrwebEvent {
  return isRecord(value) && typeof value.type === 'number' && typeof value.timestamp === 'number'
}

function isSavedReplayRecording(value: unknown): value is SavedReplayRecording {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.startedAt === 'number' &&
    typeof value.savedAt === 'number' &&
    typeof value.duration === 'number' &&
    typeof value.size === 'number' &&
    typeof value.eventCount === 'number' &&
    typeof value.tabId === 'number' &&
    isStringOrUndefined(value.sessionId) &&
    isStringOrUndefined(value.url)
  )
}

function isReplaysResponse(value: unknown): value is ReplaysResponse {
  return isRecord(value) && Array.isArray(value.recordings) && value.recordings.every(isSavedReplayRecording)
}

function isReplayEventsResponse(value: unknown): value is ReplayEventsResponse {
  return (
    isRecord(value) &&
    isSavedReplayRecording(value.recording) &&
    Array.isArray(value.events) &&
    value.events.every(isRrwebEvent)
  )
}

function setStatus(text: string): void {
  if (!statusText) return
  statusText.textContent = text
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return '-'
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function formatSize(size: number): string {
  if (!Number.isFinite(size)) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function replayCapabilityId(recording: SavedReplayRecording): string {
  return `replay-${recording.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(-28) || 'workflow'}`
}

function replayMakeCommand(recording: SavedReplayRecording): string {
  return [
    'playwriter replay make',
    shellQuote(recording.id),
    shellQuote(replayCapabilityId(recording)),
    '--force',
    '--goal',
    shellQuote('describe the repeatable workflow goal here'),
  ].join(' ')
}

function replayRunCommand(recording: SavedReplayRecording): string {
  return [
    'playwriter capability run',
    shellQuote(replayCapabilityId(recording)),
    '--force',
    '--input-json',
    shellQuote('{"value":"example"}'),
  ].join(' ')
}

function replayAiHandoffText(recording: SavedReplayRecording): string {
  return [
    'Use this Playwriter DOM replay as workflow evidence.',
    `Replay id: ${recording.id}`,
    recording.url ? `Recorded URL: ${recording.url}` : '',
    '',
    'Compile:',
    replayMakeCommand(recording),
    '',
    'Run after editing input:',
    replayRunCommand(recording),
  ]
    .filter((line) => {
      return line.length > 0
    })
    .join('\n')
}

async function copyTextToClipboard(options: { label: string; text: string }): Promise<void> {
  await navigator.clipboard.writeText(options.text)
  setStatus(`${options.label} copied`)
}

function setReplayDetails(recording: SavedReplayRecording): void {
  if (!replayDetails) return
  replayDetails.textContent = [
    `ID: ${recording.id}`,
    `Path: ${recording.path}`,
    `Saved: ${formatDate(recording.savedAt)}`,
    `Duration: ${formatDuration(recording.duration)}`,
    `Size: ${formatSize(recording.size)}`,
    `Events: ${recording.eventCount}`,
    `Tab: ${recording.tabId}`,
    recording.url ? `URL: ${recording.url}` : '',
    recording.sessionId ? `Session: ${recording.sessionId}` : '',
    '',
    'AI handoff:',
    replayAiHandoffText(recording),
  ]
    .filter((line) => {
      return line.length > 0
    })
    .join('\n')
}

function updateActiveReplay(): void {
  document.querySelectorAll('.recording-item').forEach((node) => {
    const element = node as HTMLElement
    element.classList.toggle('active', element.dataset.replayId === selectedReplayId)
  })
}

function mountReplay(events: RrwebEvent[]): void {
  if (!replayPlayer) return
  replayPlayer.textContent = ''
  const replayer = new Replayer(events, {
    root: replayPlayer,
    mouseTail: false,
    UNSAFE_replayCanvas: true,
    triggerFocus: false,
  })
  replayer.play()
}

async function playReplay(recording: SavedReplayRecording): Promise<void> {
  selectedReplayId = recording.id
  updateActiveReplay()
  setStatus(`Loading replay ${recording.id}...`)
  setReplayDetails(recording)

  const response = await fetch(`${RELAY_BASE_URL}/rrweb-recordings/${encodeURIComponent(recording.id)}/events`)
  if (!response.ok) {
    throw new Error(`Failed to load replay: ${response.status}`)
  }
  const data: unknown = await response.json()
  if (!isReplayEventsResponse(data)) {
    throw new Error('Invalid replay events response')
  }
  setReplayDetails(data.recording)
  mountReplay(data.events)
  setStatus(`Playing replay ${recording.id}`)
}

function createRecordingActions(recording: SavedReplayRecording): HTMLDivElement {
  const actions = document.createElement('div')
  actions.className = 'recording-actions'

  const handoff = document.createElement('button')
  handoff.type = 'button'
  handoff.textContent = 'Copy handoff'
  handoff.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation()
    copyTextToClipboard({ label: 'AI handoff', text: replayAiHandoffText(recording) }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(message)
    })
  })

  const compile = document.createElement('button')
  compile.type = 'button'
  compile.textContent = 'Copy compile'
  compile.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation()
    copyTextToClipboard({ label: 'Compile command', text: replayMakeCommand(recording) }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(message)
    })
  })

  actions.replaceChildren(handoff, compile)
  return actions
}

function createRecordingItem(recording: SavedReplayRecording): HTMLButtonElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'recording-item'
  item.dataset.replayId = recording.id
  item.ariaLabel = `Open replay ${recording.id}`

  const title = document.createElement('div')
  title.className = 'recording-title'
  title.textContent = formatDate(recording.savedAt)

  const meta = document.createElement('div')
  meta.className = 'recording-meta'
  meta.textContent = [
    formatDuration(recording.duration),
    `${recording.eventCount} events`,
    formatSize(recording.size),
    `tab ${recording.tabId}`,
    recording.url || '',
  ]
    .filter((part) => {
      return part.length > 0
    })
    .join(' | ')

  item.replaceChildren(title, meta, createRecordingActions(recording))
  item.addEventListener('click', () => {
    playReplay(recording).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(message)
    })
  })
  return item
}

function renderReplays(recordings: SavedReplayRecording[]): void {
  if (!replaysList) return

  if (recordings.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = 'No DOM replays yet.'
    replaysList.replaceChildren(empty)
    return
  }

  replaysList.replaceChildren(
    ...recordings.map((recording) => {
      return createRecordingItem(recording)
    }),
  )
  updateActiveReplay()
}

async function loadReplays(): Promise<void> {
  setStatus('Loading recordings...')
  const response = await fetch(`${RELAY_BASE_URL}/rrweb-recordings`)
  if (!response.ok) {
    throw new Error(`Failed to load recordings: ${response.status}`)
  }
  const data: unknown = await response.json()
  if (!isReplaysResponse(data)) {
    throw new Error('Invalid recordings response')
  }
  renderReplays(data.recordings)
  setStatus(`${data.recordings.length} replay${data.recordings.length === 1 ? '' : 's'}`)
}

refreshButton?.addEventListener('click', () => {
  loadReplays().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    setStatus(message)
  })
})

loadReplays().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  setStatus(message)
})
