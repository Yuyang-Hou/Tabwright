declare const process: { env: { PLAYWRITER_PORT: string } }

import { EventType, Replayer, ReplayerEvents, type eventWithTime } from 'rrweb'
import 'rrweb/dist/style.css'

const RELAY_HOST = '127.0.0.1'
const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988
const RELAY_BASE_URL = `http://${RELAY_HOST}:${RELAY_PORT}`

type ActiveTab = 'recordings' | 'skills'
type RrwebEvent = eventWithTime
type ReplayMetaEvent = Extract<RrwebEvent, { type: EventType.Meta }>

interface ReplayViewport {
  width: number
  height: number
}

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

interface CapabilityRunRecord {
  id: string
  status: string
  url?: string
  durationMs: number
  inputHash: string
  error?: string
  createdAt: string
}

interface CapabilityAgentSkillStatus {
  target: string
  draftExists: boolean
  draftPath: string
  installedExists: boolean
  installedPath: string
  initCommand: string
  showCommand: string
  installCommand: string
}

interface CapabilityContract {
  id: string
  title: string
  description: string
  status: string
  runtime: string
  match: string[]
  routingHint: string
  permissions: string[]
  sideEffect: string
  requiresConfirmation: boolean
  whenToUse: string[]
  whenNotToUse: string[]
  tags: string[]
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  location: string
  dir: string
  autonomousInvocation: {
    allowed: boolean
    reasons: string[]
  }
  recentRuns: CapabilityRunRecord[]
  agentSkill: CapabilityAgentSkillStatus
}

interface CapabilitiesResponse {
  cwd: string
  capabilities: CapabilityContract[]
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
    overflow: hidden;
  }
  .shell {
    display: grid;
    grid-template-columns: minmax(280px, 380px) minmax(480px, 1fr);
    gap: 14px;
    height: 100vh;
    padding: 14px;
    overflow: hidden;
  }
  .list-panel,
  .detail-panel {
    min-width: 0;
    overflow: hidden;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
  }
  .list-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .panel-header {
    display: grid;
    gap: 10px;
    flex: none;
    padding: 14px;
    border-bottom: 1px solid #e5e7eb;
  }
  .header-row,
  .tabs,
  .recording-actions,
  .skill-actions,
  .badge-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .header-row {
    justify-content: space-between;
    gap: 12px;
  }
  h1,
  h2,
  h3 {
    margin: 0;
    letter-spacing: 0;
  }
  h1 {
    font-size: 16px;
    font-weight: 650;
  }
  h2 {
    font-size: 18px;
    font-weight: 650;
  }
  h3 {
    font-size: 12px;
    font-weight: 650;
    color: #334155;
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
  .tab-button.active {
    border-color: #2563eb;
    background: #eff6ff;
    color: #1d4ed8;
  }
  .list-heading {
    flex: none;
    margin: 10px 10px 4px;
    color: #334155;
    font-size: 12px;
    font-weight: 650;
  }
  #recordings-view,
  #skills-view {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
  }
  .list-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px;
  }
  .recording-item,
  .skill-item {
    width: 100%;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 10px;
    background: transparent;
    text-align: left;
  }
  .recording-item:hover,
  .skill-item:hover {
    background: #f8fafc;
  }
  .recording-item.active,
  .skill-item.active {
    border-color: #93c5fd;
    background: #eff6ff;
  }
  .recording-title,
  .skill-title {
    color: #0f172a;
    font-size: 13px;
    font-weight: 650;
  }
  .recording-meta,
  .skill-meta,
  .detail-meta,
  .field-value {
    margin-top: 5px;
    color: #64748b;
    font-size: 11px;
    line-height: 1.45;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .detail-panel {
    min-height: 0;
  }
  .replay-view {
    display: grid;
    grid-template-rows: minmax(280px, 1fr) auto minmax(120px, auto);
    height: 100%;
    min-height: 0;
  }
  .replay-player {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: #111827;
  }
  .replay-player .replayer-wrapper {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
    will-change: transform;
  }
  .replay-player iframe {
    border: 0;
    background: #fff;
  }
  .replay-controls {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    border-top: 1px solid #0f172a;
    border-bottom: 1px solid #e5e7eb;
    padding: 8px 10px;
    background: #fff;
  }
  .replay-controls input[type="range"] {
    flex: 1;
    min-width: 0;
  }
  .replay-time {
    min-width: 78px;
    color: #475569;
    font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    text-align: right;
  }
  .recording-details,
  .skill-detail {
    padding: 12px;
    color: #334155;
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .recording-details {
    max-height: 190px;
    min-height: 120px;
    overflow: auto;
    border-top: 1px solid #e5e7eb;
  }
  .skill-detail {
    display: grid;
    gap: 14px;
    height: 100%;
    min-height: 0;
    overflow: auto;
    font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    white-space: normal;
  }
  .skill-header {
    display: grid;
    gap: 6px;
  }
  .skill-actions {
    flex-wrap: wrap;
  }
  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .field {
    min-width: 0;
    border-top: 1px solid #e5e7eb;
    padding-top: 10px;
  }
  .field.full {
    grid-column: 1 / -1;
  }
  .field-value {
    font-size: 12px;
    white-space: pre-wrap;
  }
  .badge-row {
    flex-wrap: wrap;
    margin-top: 7px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    border: 1px solid #e5e7eb;
    border-radius: 999px;
    padding: 0 7px;
    color: #475569;
    background: #f8fafc;
    font-size: 11px;
    line-height: 1;
  }
  .badge-trusted,
  .badge-read,
  .badge-ready {
    border-color: #bbf7d0;
    color: #166534;
    background: #f0fdf4;
  }
  .badge-draft,
  .badge-write {
    border-color: #fed7aa;
    color: #9a3412;
    background: #fff7ed;
  }
  .badge-disabled,
  .badge-dangerous,
  .badge-blocked {
    border-color: #fecaca;
    color: #991b1b;
    background: #fef2f2;
  }
  .empty-state {
    color: #64748b;
    padding: 10px;
    font-size: 12px;
  }
  [hidden] {
    display: none !important;
  }
  @media (max-width: 880px) {
    body {
      min-width: 0;
    }
    .shell {
      grid-template-columns: 1fr;
    }
    .field-grid {
      grid-template-columns: 1fr;
    }
  }
`
document.head.appendChild(style)

const statusText = document.querySelector<HTMLParagraphElement>('#status-text')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-button')
const recordingsView = document.querySelector<HTMLElement>('#recordings-view')
const skillsView = document.querySelector<HTMLElement>('#skills-view')
const replayView = document.querySelector<HTMLElement>('#replay-view')
const skillDetail = document.querySelector<HTMLDivElement>('#skill-detail')
const replaysList = document.querySelector<HTMLDivElement>('#replays-list')
const skillsList = document.querySelector<HTMLDivElement>('#skills-list')
const replayPlayer = document.querySelector<HTMLDivElement>('#replay-player')
const replayControls = document.querySelector<HTMLDivElement>('#replay-controls')
const replayPlayToggle = document.querySelector<HTMLButtonElement>('#replay-play-toggle')
const replayTimeline = document.querySelector<HTMLInputElement>('#replay-timeline')
const replayTime = document.querySelector<HTMLSpanElement>('#replay-time')
const replayDetails = document.querySelector<HTMLDivElement>('#replay-details')

let activeTab: ActiveTab = 'recordings'
let selectedReplayId: string | null = null
let selectedCapabilityId: string | null = null
let capabilities: CapabilityContract[] = []
let capabilityCwd = ''
let replayFitCleanup: (() => void) | null = null
let activeReplayer: Replayer | null = null
let replayIsPlaying = false
let replayTotalTime = 0
let replayProgressTimer: number | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => {
    return typeof item === 'string'
  })
}

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isRrwebEvent(value: unknown): value is RrwebEvent {
  return isRecord(value) && typeof value.type === 'number' && typeof value.timestamp === 'number'
}

function isReplayMetaEvent(event: RrwebEvent): event is ReplayMetaEvent {
  return event.type === EventType.Meta
}

function getReplayViewport(events: RrwebEvent[]): ReplayViewport | null {
  const metaEvent = events.find(isReplayMetaEvent)
  if (!metaEvent) {
    return null
  }

  const { width, height } = metaEvent.data
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
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

function isCapabilityRunRecord(value: unknown): value is CapabilityRunRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    isStringOrUndefined(value.url) &&
    typeof value.durationMs === 'number' &&
    typeof value.inputHash === 'string' &&
    isStringOrUndefined(value.error) &&
    typeof value.createdAt === 'string'
  )
}

function isCapabilityAgentSkillStatus(value: unknown): value is CapabilityAgentSkillStatus {
  return (
    isRecord(value) &&
    typeof value.target === 'string' &&
    typeof value.draftExists === 'boolean' &&
    typeof value.draftPath === 'string' &&
    typeof value.installedExists === 'boolean' &&
    typeof value.installedPath === 'string' &&
    typeof value.initCommand === 'string' &&
    typeof value.showCommand === 'string' &&
    typeof value.installCommand === 'string'
  )
}

function isAutonomousInvocation(value: unknown): value is CapabilityContract['autonomousInvocation'] {
  return isRecord(value) && typeof value.allowed === 'boolean' && isStringArray(value.reasons)
}

function isCapabilityContract(value: unknown): value is CapabilityContract {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    typeof value.status === 'string' &&
    typeof value.runtime === 'string' &&
    isStringArray(value.match) &&
    typeof value.routingHint === 'string' &&
    isStringArray(value.permissions) &&
    typeof value.sideEffect === 'string' &&
    typeof value.requiresConfirmation === 'boolean' &&
    isStringArray(value.whenToUse) &&
    isStringArray(value.whenNotToUse) &&
    isStringArray(value.tags) &&
    isRecord(value.inputSchema) &&
    isRecord(value.outputSchema) &&
    typeof value.location === 'string' &&
    typeof value.dir === 'string' &&
    isAutonomousInvocation(value.autonomousInvocation) &&
    Array.isArray(value.recentRuns) &&
    value.recentRuns.every(isCapabilityRunRecord) &&
    isCapabilityAgentSkillStatus(value.agentSkill)
  )
}

function isCapabilitiesResponse(value: unknown): value is CapabilitiesResponse {
  return isRecord(value) && typeof value.cwd === 'string' && Array.isArray(value.capabilities) && value.capabilities.every(isCapabilityContract)
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

function formatReplayTime(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '0:00'
  }
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
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

function cssToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'unknown'
}

function displayList(values: string[], emptyText: string): string {
  if (values.length === 0) return emptyText
  return values.join('\n')
}

function createBadge(text: string, tone = text): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.className = `badge badge-${cssToken(tone)}`
  badge.textContent = text
  return badge
}

async function copyTextToClipboard(options: { label: string; text: string }): Promise<void> {
  await navigator.clipboard.writeText(options.text)
  setStatus(`${options.label} copied`)
}

function copyWithStatus(options: { label: string; text: string }): void {
  copyTextToClipboard(options).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    setStatus(message)
  })
}

function setActiveTab(tab: ActiveTab): void {
  if (tab !== 'recordings' && activeReplayer && replayIsPlaying) {
    activeReplayer.pause()
  }
  activeTab = tab
  document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab)
  })
  if (recordingsView) {
    recordingsView.hidden = tab !== 'recordings'
  }
  if (skillsView) {
    skillsView.hidden = tab !== 'skills'
  }
  if (replayView) {
    replayView.hidden = tab !== 'recordings'
  }
  if (skillDetail) {
    skillDetail.hidden = tab !== 'skills'
  }
  if (tab === 'skills' && capabilities.length === 0) {
    loadCapabilities().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(message)
    })
  }
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

function fitReplayToPanel(viewport: ReplayViewport): () => void {
  if (!replayPlayer) {
    return () => {}
  }

  const update = (): void => {
    const wrapper = replayPlayer.querySelector<HTMLElement>('.replayer-wrapper')
    if (!wrapper) {
      return
    }

    const availableWidth = replayPlayer.clientWidth
    const availableHeight = replayPlayer.clientHeight
    if (availableWidth <= 0 || availableHeight <= 0) {
      return
    }

    const scale = Math.min(availableWidth / viewport.width, availableHeight / viewport.height, 1)
    const scaledWidth = viewport.width * scale
    const scaledHeight = viewport.height * scale
    const offsetLeft = Math.max(0, (availableWidth - scaledWidth) / 2)
    const offsetTop = Math.max(0, (availableHeight - scaledHeight) / 2)

    wrapper.style.width = `${viewport.width}px`
    wrapper.style.height = `${viewport.height}px`
    wrapper.style.left = `${offsetLeft}px`
    wrapper.style.top = `${offsetTop}px`
    wrapper.style.transform = `scale(${scale})`
  }

  const observer = new ResizeObserver(() => {
    update()
  })
  observer.observe(replayPlayer)

  const animationFrameIds: number[] = [window.requestAnimationFrame(update)]
  const timeoutIds: number[] = [
    window.setTimeout(update, 0),
    window.setTimeout(update, 50),
    window.setTimeout(update, 150),
  ]
  update()

  return () => {
    observer.disconnect()
    animationFrameIds.forEach((id) => {
      window.cancelAnimationFrame(id)
    })
    timeoutIds.forEach((id) => {
      window.clearTimeout(id)
    })
  }
}

function clampReplayTime(timeOffset: number): number {
  if (!Number.isFinite(timeOffset)) {
    return 0
  }
  return Math.max(0, Math.min(timeOffset, replayTotalTime))
}

function stopReplayProgressLoop(): void {
  if (replayProgressTimer === null) {
    return
  }
  window.clearInterval(replayProgressTimer)
  replayProgressTimer = null
}

function updateReplayControls(timeOffset = activeReplayer?.getCurrentTime() ?? 0): void {
  const currentTime = clampReplayTime(timeOffset)
  if (replayTimeline) {
    replayTimeline.max = String(Math.round(replayTotalTime))
    replayTimeline.value = String(Math.round(currentTime))
  }
  if (replayTime) {
    replayTime.textContent = `${formatReplayTime(currentTime)} / ${formatReplayTime(replayTotalTime)}`
  }
  if (replayPlayToggle) {
    replayPlayToggle.textContent = replayIsPlaying ? 'Pause' : 'Play'
    replayPlayToggle.disabled = !activeReplayer
  }
}

function startReplayProgressLoop(): void {
  stopReplayProgressLoop()
  replayProgressTimer = window.setInterval(() => {
    updateReplayControls()
  }, 200)
}

function setReplayPlaying(isPlaying: boolean): void {
  replayIsPlaying = isPlaying
  if (isPlaying) {
    startReplayProgressLoop()
    updateReplayControls()
    return
  }
  stopReplayProgressLoop()
  updateReplayControls()
}

function resetReplayControls(totalTime: number): void {
  replayTotalTime = Math.max(0, totalTime)
  replayIsPlaying = false
  stopReplayProgressLoop()
  if (replayControls) {
    replayControls.hidden = false
  }
  updateReplayControls(0)
}

function destroyActiveReplayer(): void {
  const replayer = activeReplayer
  activeReplayer = null
  replayFitCleanup?.()
  replayFitCleanup = null
  stopReplayProgressLoop()
  if (replayer) {
    replayer.destroy()
  }
  updateReplayControls(0)
}

function mountReplay(events: RrwebEvent[]): void {
  if (!replayPlayer) return
  destroyActiveReplayer()
  replayPlayer.textContent = ''
  const replayer = new Replayer(events, {
    root: replayPlayer,
    mouseTail: false,
    UNSAFE_replayCanvas: true,
    triggerFocus: false,
  })
  activeReplayer = replayer
  replayer.on(ReplayerEvents.Start, () => {
    setReplayPlaying(true)
  })
  replayer.on(ReplayerEvents.Pause, () => {
    setReplayPlaying(false)
  })
  replayer.on(ReplayerEvents.Finish, () => {
    replayIsPlaying = false
    stopReplayProgressLoop()
    updateReplayControls(replayTotalTime)
  })

  const viewport = getReplayViewport(events)
  if (viewport) {
    replayFitCleanup = fitReplayToPanel(viewport)
  }
  resetReplayControls(replayer.getMetaData().totalTime)
  replayer.pause(0)
}

function getReplayTimelineValue(): number {
  if (!replayTimeline) {
    return activeReplayer?.getCurrentTime() ?? 0
  }
  return clampReplayTime(Number(replayTimeline.value))
}

function toggleReplayPlayback(): void {
  if (!activeReplayer) {
    return
  }
  if (replayIsPlaying) {
    activeReplayer.pause()
    return
  }

  const currentTime = getReplayTimelineValue()
  const startTime = currentTime >= replayTotalTime ? 0 : currentTime
  activeReplayer.play(startTime)
}

function seekReplayToTimeline(): void {
  if (!activeReplayer) {
    return
  }
  const timeOffset = getReplayTimelineValue()
  if (replayIsPlaying) {
    activeReplayer.play(timeOffset)
    return
  }
  activeReplayer.pause(timeOffset)
  updateReplayControls(timeOffset)
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
  setStatus(`Replay ready ${recording.id}`)
}

function createRecordingActions(recording: SavedReplayRecording): HTMLDivElement {
  const actions = document.createElement('div')
  actions.className = 'recording-actions'

  const handoff = document.createElement('button')
  handoff.type = 'button'
  handoff.textContent = 'Copy handoff'
  handoff.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation()
    copyWithStatus({ label: 'AI handoff', text: replayAiHandoffText(recording) })
  })

  const compile = document.createElement('button')
  compile.type = 'button'
  compile.textContent = 'Copy compile'
  compile.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation()
    copyWithStatus({ label: 'Compile command', text: replayMakeCommand(recording) })
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

function schemaExampleValue(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return 'value'
  }
  if (schema.default !== undefined) {
    return schema.default
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0]
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    return 0
  }
  if (schema.type === 'boolean') {
    return false
  }
  if (schema.type === 'array') {
    return []
  }
  if (schema.type === 'object') {
    return {}
  }
  return 'value'
}

function buildExampleInput(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const input: Record<string, unknown> = Object.fromEntries(
    Object.entries(properties).map(([key, propertySchema]) => {
      return [key, schemaExampleValue(propertySchema)]
    }),
  )
  return input
}

function schemaSummary(schema: Record<string, unknown>): string {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const entries = Object.entries(properties)
  if (entries.length === 0) {
    return 'No fields declared.'
  }
  return entries
    .map(([key, propertySchema]) => {
      const type = isRecord(propertySchema) && typeof propertySchema.type === 'string' ? propertySchema.type : 'unknown'
      return `${key}: ${type}`
    })
    .join('\n')
}

function capabilityRunCommand(capability: CapabilityContract): string {
  const input = JSON.stringify(buildExampleInput(capability.inputSchema))
  return [
    'playwriter capability run',
    shellQuote(capability.id),
    '--input-json',
    shellQuote(input),
    '--json',
    capability.status === 'trusted' ? '' : '--force',
  ]
    .filter((part) => {
      return part.length > 0
    })
    .join(' ')
}

function capabilityRouteCommand(): string {
  return ['playwriter capability route', shellQuote('<user task or URL>'), '--json'].join(' ')
}

function capabilityEditPrompt(capability: CapabilityContract): string {
  return [
    `请帮我修改 Playwriter capability：${capability.id}`,
    `当前目录：${capability.dir}`,
    '',
    '先查看当前能力：',
    `playwriter capability describe ${capability.id} --json`,
    `playwriter capability show ${capability.id} --script`,
    '',
    '我的修改需求：<在这里写清楚要改什么>',
    '',
    '要求：',
    '- 先判断只需要改 contract，还是也要改 script.js',
    '- 修改后运行当前包的 typecheck 或相关测试',
    '- 不要 trust 这个 capability，除非我明确要求',
  ].join('\n')
}

function capabilityUsePrompt(capability: CapabilityContract): string {
  return [
    `请使用 Playwriter capability：${capability.id}`,
    '',
    '先尝试路由：',
    capabilityRouteCommand(),
    '',
    '如果确认要直接运行，用：',
    capabilityRunCommand(capability),
    '',
    '我的任务：<在这里写任务或粘贴 URL>',
  ].join('\n')
}

function capabilitySkillPrompt(capability: CapabilityContract): string {
  return [
    `请帮我为 Playwriter capability：${capability.id} 创建或完善 agent skill。`,
    '',
    '先查看当前能力：',
    `playwriter capability describe ${capability.id} --json`,
    '',
    capability.agentSkill.draftExists ? `已有草稿：${capability.agentSkill.draftPath}` : capability.agentSkill.initCommand,
    capability.agentSkill.draftExists ? capability.agentSkill.showCommand : '',
    '',
    'skill 里需要写清：什么时候用、什么时候不用、第一条命令、auth/sandbox 注意事项、默认输出格式。',
    '',
    '完成后再安装：',
    capability.agentSkill.installCommand,
  ]
    .filter((line) => {
      return line.length > 0
    })
    .join('\n')
}

function createField(options: { title: string; value: string; full?: boolean }): HTMLDivElement {
  const field = document.createElement('div')
  field.className = options.full ? 'field full' : 'field'

  const title = document.createElement('h3')
  title.textContent = options.title

  const value = document.createElement('div')
  value.className = 'field-value'
  value.textContent = options.value

  field.replaceChildren(title, value)
  return field
}

function createCapabilityActions(capability: CapabilityContract): HTMLDivElement {
  const actions = document.createElement('div')
  actions.className = 'skill-actions'

  const editPrompt = document.createElement('button')
  editPrompt.type = 'button'
  editPrompt.textContent = 'Copy edit prompt'
  editPrompt.addEventListener('click', () => {
    copyWithStatus({ label: 'Edit prompt', text: capabilityEditPrompt(capability) })
  })

  const usePrompt = document.createElement('button')
  usePrompt.type = 'button'
  usePrompt.textContent = 'Copy use prompt'
  usePrompt.addEventListener('click', () => {
    copyWithStatus({ label: 'Use prompt', text: capabilityUsePrompt(capability) })
  })

  const skillPrompt = document.createElement('button')
  skillPrompt.type = 'button'
  skillPrompt.textContent = 'Copy skill prompt'
  skillPrompt.addEventListener('click', () => {
    copyWithStatus({ label: 'Skill prompt', text: capabilitySkillPrompt(capability) })
  })

  const runCommand = document.createElement('button')
  runCommand.type = 'button'
  runCommand.textContent = 'Copy run'
  runCommand.addEventListener('click', () => {
    copyWithStatus({ label: 'Run command', text: capabilityRunCommand(capability) })
  })

  actions.replaceChildren(editPrompt, usePrompt, skillPrompt, runCommand)
  return actions
}

function renderCapabilityDetail(capability: CapabilityContract): void {
  if (!skillDetail) return

  const header = document.createElement('div')
  header.className = 'skill-header'

  const title = document.createElement('h2')
  title.textContent = capability.title

  const meta = document.createElement('div')
  meta.className = 'detail-meta'
  meta.textContent = `${capability.id} | ${capability.location} | ${capability.dir}`

  const badges = document.createElement('div')
  badges.className = 'badge-row'
  badges.replaceChildren(
    createBadge(capability.status),
    createBadge(capability.runtime),
    createBadge(capability.sideEffect),
    createBadge(capability.routingHint),
    createBadge(capability.autonomousInvocation.allowed ? 'ai-ready' : 'ai-blocked', capability.autonomousInvocation.allowed ? 'ready' : 'blocked'),
    createBadge(capability.agentSkill.installedExists ? 'skill-installed' : capability.agentSkill.draftExists ? 'skill-draft' : 'skill-missing'),
  )

  header.replaceChildren(title, meta, badges, createCapabilityActions(capability))

  const fields = document.createElement('div')
  fields.className = 'field-grid'
  fields.replaceChildren(
    createField({ title: 'Description', value: capability.description || '-', full: true }),
    createField({ title: 'When to use', value: displayList(capability.whenToUse, '-'), full: true }),
    createField({ title: 'When not to use', value: displayList(capability.whenNotToUse, '-'), full: true }),
    createField({ title: 'Match', value: displayList(capability.match, '-') }),
    createField({ title: 'Permissions', value: displayList(capability.permissions, '-') }),
    createField({ title: 'Input', value: schemaSummary(capability.inputSchema) }),
    createField({ title: 'Output', value: schemaSummary(capability.outputSchema) }),
    createField({
      title: 'Autonomy',
      value: capability.autonomousInvocation.allowed
        ? 'trusted read-only capability'
        : displayList(capability.autonomousInvocation.reasons, '-'),
    }),
    createField({
      title: 'Recent runs',
      value:
        capability.recentRuns.length === 0
          ? '-'
          : capability.recentRuns
              .map((run) => {
                return `${run.status} ${formatDuration(run.durationMs)} ${run.createdAt}`
              })
              .join('\n'),
    }),
    createField({
      title: 'Agent skill',
      value: [
        capability.agentSkill.installedExists ? `installed: ${capability.agentSkill.installedPath}` : '',
        capability.agentSkill.draftExists ? `draft: ${capability.agentSkill.draftPath}` : '',
        capability.agentSkill.draftExists || capability.agentSkill.installedExists ? '' : 'not created',
      ]
        .filter((line) => {
          return line.length > 0
        })
        .join('\n'),
      full: true,
    }),
  )

  skillDetail.replaceChildren(header, fields)
}

function updateActiveCapability(): void {
  document.querySelectorAll('.skill-item').forEach((node) => {
    const element = node as HTMLElement
    element.classList.toggle('active', element.dataset.capabilityId === selectedCapabilityId)
  })
}

function selectCapability(capability: CapabilityContract): void {
  selectedCapabilityId = capability.id
  updateActiveCapability()
  renderCapabilityDetail(capability)
}

function createCapabilityItem(capability: CapabilityContract): HTMLButtonElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'skill-item'
  item.dataset.capabilityId = capability.id
  item.ariaLabel = `Open capability ${capability.id}`

  const title = document.createElement('div')
  title.className = 'skill-title'
  title.textContent = capability.title

  const meta = document.createElement('div')
  meta.className = 'skill-meta'
  meta.textContent = [capability.status, capability.runtime, capability.location, capability.sideEffect, capability.id].join(' | ')

  const badges = document.createElement('div')
  badges.className = 'badge-row'
  badges.replaceChildren(
    createBadge(capability.status),
    createBadge(capability.sideEffect),
    createBadge(capability.autonomousInvocation.allowed ? 'ai-ready' : 'ai-blocked', capability.autonomousInvocation.allowed ? 'ready' : 'blocked'),
  )

  item.replaceChildren(title, meta, badges)
  item.addEventListener('click', () => {
    selectCapability(capability)
  })
  return item
}

function renderCapabilities(): void {
  if (!skillsList) return

  if (capabilities.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = 'No capabilities yet.'
    skillsList.replaceChildren(empty)
    if (skillDetail) {
      skillDetail.replaceChildren(empty.cloneNode(true))
    }
    return
  }

  skillsList.replaceChildren(
    ...capabilities.map((capability) => {
      return createCapabilityItem(capability)
    }),
  )
  const selected = capabilities.find((capability) => {
    return capability.id === selectedCapabilityId
  })
  if (selected) {
    renderCapabilityDetail(selected)
    updateActiveCapability()
    return
  }
  if (skillDetail) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = 'Select a capability.'
    skillDetail.replaceChildren(empty)
  }
}

async function loadCapabilities(): Promise<void> {
  setStatus('Loading capabilities...')
  const response = await fetch(`${RELAY_BASE_URL}/capabilities`)
  if (!response.ok) {
    throw new Error(`Failed to load capabilities: ${response.status}`)
  }
  const data: unknown = await response.json()
  if (!isCapabilitiesResponse(data)) {
    throw new Error('Invalid capabilities response')
  }
  capabilityCwd = data.cwd
  capabilities = data.capabilities
  renderCapabilities()
  setStatus(`${data.capabilities.length} ${data.capabilities.length === 1 ? 'capability' : 'capabilities'} from ${capabilityCwd}`)
}

refreshButton?.addEventListener('click', () => {
  const loader = activeTab === 'recordings' ? loadReplays : loadCapabilities
  loader().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    setStatus(message)
  })
})

replayPlayToggle?.addEventListener('click', () => {
  toggleReplayPlayback()
})

replayTimeline?.addEventListener('input', () => {
  updateReplayControls(getReplayTimelineValue())
})

replayTimeline?.addEventListener('change', () => {
  seekReplayToTimeline()
})

document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.tab === 'recordings' || button.dataset.tab === 'skills') {
      setActiveTab(button.dataset.tab)
    }
  })
})

setActiveTab('recordings')
loadReplays().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  setStatus(message)
})
