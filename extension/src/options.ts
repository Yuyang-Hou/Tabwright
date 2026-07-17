declare const process: { env: { TABWRIGHT_PORT: string; PLAYWRITER_PORT: string } }
declare const __PLAYWRITER_VERSION__: string

import { EventType, Replayer, ReplayerEvents, type eventWithTime } from 'rrweb'
import 'rrweb/dist/style.css'
import { createReplayLogger, type ReplayLoggerController } from './replay-logger'
import { isRelayVersionOutdated, type RelayReviewIssue } from './relay-warning'

const RELAY_HOST = '127.0.0.1'
const RELAY_PORT = Number(process.env.TABWRIGHT_PORT || process.env.PLAYWRITER_PORT) || 19988
const RELAY_BASE_URL = `http://${RELAY_HOST}:${RELAY_PORT}`
const LANGUAGE_STORAGE_KEY = 'playwriterOptionsLanguage'

type ActiveTab = 'recordings' | 'skills'
type LanguageCode = 'en' | 'zh_CN'
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

interface CapabilityLifecycle {
  stage: 'drafted' | 'validated' | 'trusted' | 'drifted' | 'disabled'
  nextAction: 'validate' | 'trust' | 'run' | 'repair' | 'enable'
  nextCommand: string
  contractHealth: {
    state: 'healthy' | 'drifted' | 'unknown'
    checkedAt?: string
    reasons: string[]
  }
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
  lifecycle?: CapabilityLifecycle
}

interface CapabilitiesResponse {
  cwd: string
  capabilities: CapabilityContract[]
}

interface RelayVersionUpdate {
  currentVersion: string
  requiredVersion: string
}

type LoadError = { type: 'relay'; issue: RelayReviewIssue } | { type: 'message'; message: string }
type CapabilityContractPayload = Omit<CapabilityContract, 'recentRuns' | 'lifecycle'> & {
  recentRuns: unknown[]
  lifecycle?: unknown
}

const messageFallbacks = {
  app_title: 'Tabwright',
  app_subtitle: 'Local browser automation cockpit',
  status_label: 'Status',
  status_loading_recordings: 'Loading recordings...',
  refresh_button: 'Refresh',
  recordings_tab: 'Recordings',
  capabilities_tab: 'Capabilities',
  language_label: 'Language',
  language_switch_aria_label: 'Language switch',
  language_en: 'English',
  language_zh_cn: 'Chinese',
  recordings_eyebrow: 'Replay library',
  recordings_heading: 'DOM replays',
  recordings_description: 'Review saved page recordings and turn repeatable flows into capabilities.',
  capabilities_eyebrow: 'Automation library',
  capabilities_heading: 'Capabilities',
  capabilities_description: 'Review local automations and recent runs.',
  search_label: 'Search',
  search_recordings_placeholder: 'Filter recordings',
  search_capabilities_placeholder: 'Filter capabilities',
  metric_replays: 'Replays',
  metric_total_duration: 'Total duration',
  metric_events: 'Events',
  metric_capabilities: 'Capabilities',
  metric_trusted: 'Available',
  metric_runtimes: 'Runtime contracts',
  detail_eyebrow: 'Detail',
  replay_detail_title: 'Replay preview',
  capability_detail_title: 'Capability detail',
  select_replay: 'Select a DOM replay.',
  select_capability: 'Select a capability.',
  play_button: 'Play',
  pause_button: 'Pause',
  sections_aria_label: 'Options sections',
  metrics_aria_label: 'Current view summary',
  replay_timeline_label: 'Replay timeline',
  replay_warning_missing_nodes_one:
    'Some visual details could not be reconstructed because 1 DOM update referenced a missing node. The replay may still be usable.',
  replay_warning_missing_nodes_other:
    'Some visual details could not be reconstructed because $1 DOM updates referenced missing nodes. The replay may still be usable.',
  replay_warning_aria_label: 'Replay reconstruction notice',
  status_copied: '$1 copied',
  status_loading_replay: 'Loading replay $1...',
  status_replay_ready: 'Replay ready $1',
  status_replay_count_one: '$1 replay',
  status_replay_count_other: '$1 replays',
  status_loading_capabilities: 'Loading capabilities...',
  status_capability_count_one: '$1 capability from $2',
  status_capability_count_other: '$1 capabilities from $2',
  error_load_replay: 'Failed to load replay: $1',
  error_invalid_replay_events: 'Invalid replay events response',
  error_load_recordings: 'Failed to load recordings: $1',
  error_invalid_recordings: 'Invalid recordings response',
  error_load_capabilities: 'Failed to load capabilities: $1',
  error_invalid_capabilities: 'Invalid capabilities response',
  relay_review_warning_title: 'Saved data is temporarily unavailable',
  relay_version_outdated: 'Local service update required. Current version $1, required version $2.',
  relay_version_update_instructions: 'Run these commands in a terminal, then refresh this page.',
  relay_review_outdated:
    'Browser control is connected, but this local service cannot list saved recordings or capabilities. Your files were not deleted. Restart or update Tabwright, then refresh.',
  relay_review_unavailable:
    'Browser control is connected, but saved recordings and capabilities are temporarily unavailable. Your files were not deleted. Restart Tabwright, then refresh.',
  lifecycle_unsupported:
    'This extension cannot interpret the capability lifecycle. Update Tabwright before running it.',
  empty_no_replays: 'No DOM replays yet.',
  empty_no_capabilities: 'No capabilities yet.',
  empty_no_matches: 'No matches for this search.',
  copy_for_ai: 'Copy for AI',
  copy_command: 'Copy command',
  label_ai_context: 'AI context',
  label_next_command: 'CLI command',
  detail_id: 'ID',
  detail_path: 'Path',
  detail_saved: 'Saved',
  detail_duration: 'Duration',
  detail_size: 'Size',
  detail_events: 'Events',
  detail_tab: 'Tab',
  detail_url: 'URL',
  detail_session: 'Session',
  events_count: '$1 events',
  tab_label: 'tab $1',
  no_fields_declared: 'No fields declared.',
  field_description: 'Description',
  field_when_to_use: 'When to use',
  field_when_not_to_use: 'When not to use',
  field_match: 'Match',
  field_permissions: 'Permissions',
  field_input: 'Input',
  field_output: 'Output',
  field_autonomy: 'Autonomy',
  field_recent_runs: 'Recent runs',
  field_runtime: 'Runtime',
  field_effect: 'Side effect',
  field_routing: 'Routing',
  field_location: 'Location',
  field_contract_health: 'Validation status',
  technical_details: 'Technical details',
  badge_auto_ready: 'Can run automatically',
  badge_needs_confirmation: 'Needs your confirmation',
  badge_local_draft: 'Local draft',
  badge_validation_expired: 'Needs update',
  badge_disabled: 'Disabled',
  runtime_browser: 'Browser',
  runtime_node: 'Node.js',
  effect_read: 'Read only',
  effect_write: 'Modifies data',
  effect_dangerous: 'High-risk changes',
  routing_exact: 'Exact match',
  routing_semantic: 'Semantic match',
  routing_manual: 'Manual',
  location_project: 'Project',
  location_global: 'Global',
  lifecycle_health_checked: '$1 · checked $2',
  lifecycle_health_not_checked: 'Not yet checked for usability',
  lifecycle_health_healthy: 'Contract healthy',
  lifecycle_health_drifted: 'Contract drift detected',
  lifecycle_health_unknown: 'Usability not confirmed',
  autonomy_trusted_readonly: 'trusted read-only capability',
  open_replay_aria: 'Open replay $1',
  open_capability_aria: 'Open capability $1',
} as const

type MessageKey = keyof typeof messageFallbacks
type LocaleMessages = Partial<Record<MessageKey, string>>

let activeLanguage: LanguageCode = 'en'
let activeMessages: LocaleMessages = {}

function chromeMessage(key: string, substitutions?: string | string[]): string {
  if (typeof chrome === 'undefined' || !chrome.i18n?.getMessage) {
    return ''
  }
  return chrome.i18n.getMessage(key, substitutions)
}

function languageFromLocale(locale: string): LanguageCode {
  return locale.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en'
}

function applyFallbackSubstitutions(text: string, substitutions?: string | string[]): string {
  if (!substitutions) {
    return text
  }
  const values: string[] = Array.isArray(substitutions) ? substitutions : [substitutions]
  return values.reduce((result, value, index) => {
    return result.replaceAll(`$${index + 1}`, value)
  }, text)
}

function msg(key: MessageKey, substitutions?: string | string[]): string {
  const activeMessage = activeMessages[key]
  if (activeMessage) {
    return applyFallbackSubstitutions(activeMessage, substitutions)
  }
  if (activeLanguage === languageFromLocale(getUiLocale())) {
    const browserMessage = chromeMessage(key, substitutions)
    if (browserMessage) {
      return browserMessage
    }
  }
  return applyFallbackSubstitutions(messageFallbacks[key], substitutions)
}

function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(messageFallbacks, value)
}

function isLanguageCode(value: unknown): value is LanguageCode {
  return value === 'en' || value === 'zh_CN'
}

function getUiLocale(): string {
  return chromeMessage('@@ui_locale') || navigator.language || 'en'
}

function isChineseLocale(): boolean {
  return activeLanguage === 'zh_CN'
}

function localeMessagesUrl(language: LanguageCode): string {
  const path = `_locales/${language}/messages.json`
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path)
  }
  return `../${path}`
}

function normalizeLocaleMessage(rawMessage: Record<string, unknown>): string {
  const message = typeof rawMessage.message === 'string' ? rawMessage.message : ''
  if (!isRecord(rawMessage.placeholders)) {
    return message
  }
  return Object.entries(rawMessage.placeholders).reduce((result, [name, rawPlaceholder]) => {
    if (!isRecord(rawPlaceholder) || typeof rawPlaceholder.content !== 'string') {
      return result
    }
    return result.replaceAll(`$${name}$`, rawPlaceholder.content)
  }, message)
}

function parseLocaleMessages(value: unknown): LocaleMessages {
  if (!isRecord(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, rawMessage]) => {
      if (!isMessageKey(key) || !isRecord(rawMessage) || typeof rawMessage.message !== 'string') {
        return []
      }
      return [[key, normalizeLocaleMessage(rawMessage)]]
    }),
  )
}

async function loadActiveMessages(language: LanguageCode): Promise<void> {
  if (language === 'en') {
    activeMessages = {}
    return
  }
  try {
    const response = await fetch(localeMessagesUrl(language))
    if (!response.ok) {
      throw new Error(`Failed to load locale messages: ${response.status}`)
    }
    activeMessages = parseLocaleMessages(await response.json())
  } catch (error: unknown) {
    activeMessages = {}
    console.warn(error)
  }
}

async function readSavedLanguage(): Promise<LanguageCode | null> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const result = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY)
    const value: unknown = result[LANGUAGE_STORAGE_KEY]
    return isLanguageCode(value) ? value : null
  }
  const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return isLanguageCode(value) ? value : null
}

async function saveSelectedLanguage(language: LanguageCode): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: language })
    return
  }
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
}

function setText(element: HTMLElement | null, text: string): void {
  if (!element) {
    return
  }
  element.textContent = text
}

function setMessage(element: HTMLElement | null, key: MessageKey, substitutions?: string | string[]): void {
  setText(element, msg(key, substitutions))
}

function localizeDocument(): void {
  const direction = chromeMessage('@@bidi_dir') || 'ltr'
  document.documentElement.lang = getUiLocale().replace('_', '-')
  document.documentElement.dir = direction
  document.title = msg('app_title')

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n
    if (!key || !isMessageKey(key)) {
      return
    }
    element.textContent = msg(key)
  })

  document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((element) => {
    const key = element.dataset.i18nPlaceholder
    if (!key || !isMessageKey(key)) {
      return
    }
    element.placeholder = msg(key)
  })

  document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    const key = element.dataset.i18nAriaLabel
    if (!key || !isMessageKey(key)) {
      return
    }
    element.setAttribute('aria-label', msg(key))
  })

  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    const key = element.dataset.i18nTitle
    if (!key || !isMessageKey(key)) {
      return
    }
    element.title = msg(key)
  })
}

const statusText = document.querySelector<HTMLParagraphElement>('#status-text')
const relayReviewWarning = document.querySelector<HTMLElement>('#relay-review-warning')
const relayReviewWarningTitle = document.querySelector<HTMLElement>('#relay-review-warning-title')
const relayReviewWarningText = document.querySelector<HTMLParagraphElement>('#relay-review-warning-text')
const relayReviewWarningCommand = document.querySelector<HTMLElement>('#relay-review-warning-command')
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-button')
const searchInput = document.querySelector<HTMLInputElement>('#search-input')
const viewEyebrow = document.querySelector<HTMLParagraphElement>('#view-eyebrow')
const viewTitle = document.querySelector<HTMLHeadingElement>('#view-title')
const viewDescription = document.querySelector<HTMLParagraphElement>('#view-description')
const recordingsCount = document.querySelector<HTMLSpanElement>('#recordings-count')
const skillsCount = document.querySelector<HTMLSpanElement>('#skills-count')
const localeText = document.querySelector<HTMLElement>('#locale-text')
const languageButtons = document.querySelectorAll<HTMLButtonElement>('.language-button')
const metricPrimaryLabel = document.querySelector<HTMLSpanElement>('#metric-primary-label')
const metricPrimaryValue = document.querySelector<HTMLElement>('#metric-primary-value')
const metricSecondaryLabel = document.querySelector<HTMLSpanElement>('#metric-secondary-label')
const metricSecondaryValue = document.querySelector<HTMLElement>('#metric-secondary-value')
const metricTertiaryLabel = document.querySelector<HTMLSpanElement>('#metric-tertiary-label')
const metricTertiaryValue = document.querySelector<HTMLElement>('#metric-tertiary-value')
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
const replayWarning = document.querySelector<HTMLParagraphElement>('#replay-warning')
const replayDetails = document.querySelector<HTMLDivElement>('#replay-details')
const toast = document.querySelector<HTMLDivElement>('#toast')

let activeTab: ActiveTab = 'recordings'
let selectedReplayId: string | null = null
let selectedCapabilityId: string | null = null
let replayRecordings: SavedReplayRecording[] = []
let capabilities: CapabilityContract[] = []
let capabilityCwd = ''
let replayLoadError: LoadError | null = null
let capabilityLoadError: LoadError | null = null
let relayVersionUpdate: RelayVersionUpdate | null = null
let searchQuery = ''
let replayFitCleanup: (() => void) | null = null
let activeReplayer: Replayer | null = null
let replayIsPlaying = false
let replayTotalTime = 0
let replayProgressTimer: number | null = null
let replayMissingNodeWarningCount = 0
let replayWarningTimer: number | null = null
let activeReplayLoggerController: ReplayLoggerController | null = null
let toastTimer: number | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      return typeof item === 'string'
    })
  )
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

function isAutonomousInvocation(value: unknown): value is CapabilityContract['autonomousInvocation'] {
  return isRecord(value) && typeof value.allowed === 'boolean' && isStringArray(value.reasons)
}

function isLifecycleStage(value: unknown): value is CapabilityLifecycle['stage'] {
  return (
    value === 'drafted' || value === 'validated' || value === 'trusted' || value === 'drifted' || value === 'disabled'
  )
}

function isLifecycleAction(value: unknown): value is CapabilityLifecycle['nextAction'] {
  return value === 'validate' || value === 'trust' || value === 'run' || value === 'repair' || value === 'enable'
}

function isCapabilityLifecycle(value: unknown): value is CapabilityLifecycle {
  if (!isRecord(value) || !isRecord(value.contractHealth)) {
    return false
  }
  if (!isLifecycleStage(value.stage) || !isLifecycleAction(value.nextAction)) {
    return false
  }
  const expectedAction: Record<CapabilityLifecycle['stage'], CapabilityLifecycle['nextAction']> = {
    drafted: 'validate',
    validated: 'trust',
    trusted: 'run',
    drifted: 'repair',
    disabled: 'enable',
  }
  const hasConsistentHealth = (() => {
    if (value.stage === 'validated') {
      return value.contractHealth.state === 'healthy'
    }
    if (value.stage === 'trusted') {
      return value.contractHealth.state !== 'drifted'
    }
    if (value.stage === 'drifted') {
      return value.contractHealth.state === 'drifted'
    }
    return true
  })()
  return (
    value.nextAction === expectedAction[value.stage] &&
    typeof value.nextCommand === 'string' &&
    ['healthy', 'drifted', 'unknown'].includes(String(value.contractHealth.state)) &&
    isStringOrUndefined(value.contractHealth.checkedAt) &&
    isStringArray(value.contractHealth.reasons) &&
    hasConsistentHealth
  )
}

function isCapabilityContractPayload(value: unknown): value is CapabilityContractPayload {
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
    Array.isArray(value.recentRuns)
  )
}

function normalizeCapabilityContract(value: unknown): CapabilityContract | null {
  if (!isCapabilityContractPayload(value)) {
    return null
  }
  const hasUnsupportedLifecycle = value.lifecycle !== undefined && !isCapabilityLifecycle(value.lifecycle)
  const unsupportedReason = msg('lifecycle_unsupported')
  return {
    ...value,
    autonomousInvocation: hasUnsupportedLifecycle
      ? { allowed: false, reasons: [unsupportedReason] }
      : value.autonomousInvocation,
    recentRuns: value.recentRuns.filter(isCapabilityRunRecord),
    lifecycle: hasUnsupportedLifecycle
      ? {
          stage: 'drifted',
          nextAction: 'repair',
          nextCommand: `tabwright capability describe ${shellQuote(value.id)} --json`,
          contractHealth: { state: 'drifted', reasons: [unsupportedReason] },
        }
      : isCapabilityLifecycle(value.lifecycle)
        ? value.lifecycle
        : undefined,
  }
}

function parseCapabilitiesResponse(value: unknown): CapabilitiesResponse | null {
  if (!isRecord(value) || typeof value.cwd !== 'string' || !Array.isArray(value.capabilities)) {
    return null
  }
  return {
    cwd: value.cwd,
    capabilities: value.capabilities.flatMap((capability) => {
      const normalized = normalizeCapabilityContract(capability)
      return normalized ? [normalized] : []
    }),
  }
}

function setStatus(text: string): void {
  if (!statusText) return
  statusText.textContent = text
}

function relayReviewMessage(issue: RelayReviewIssue): string {
  return issue === 'outdated' ? msg('relay_review_outdated') : msg('relay_review_unavailable')
}

function loadErrorText(error: LoadError | null): string {
  if (!error) {
    return ''
  }
  return error.type === 'relay' ? relayReviewMessage(error.issue) : error.message
}

function currentRelayReviewIssue(): RelayReviewIssue | null {
  const issues = [replayLoadError, capabilityLoadError].flatMap((error) => {
    return error?.type === 'relay' ? [error.issue] : []
  })
  if (issues.includes('outdated')) {
    return 'outdated'
  }
  return issues.includes('unavailable') ? 'unavailable' : null
}

function updateRelayReviewWarning(): void {
  if (!relayReviewWarning || !relayReviewWarningTitle || !relayReviewWarningText || !relayReviewWarningCommand) {
    return
  }
  const issue = currentRelayReviewIssue()
  relayReviewWarning.hidden = !issue && !relayVersionUpdate
  if (relayVersionUpdate) {
    relayReviewWarningTitle.textContent = msg('relay_version_outdated', [
      relayVersionUpdate.currentVersion,
      relayVersionUpdate.requiredVersion,
    ])
    relayReviewWarningText.hidden = false
    relayReviewWarningText.textContent = msg('relay_version_update_instructions')
    relayReviewWarningCommand.hidden = false
    return
  }
  relayReviewWarningTitle.textContent = msg('relay_review_warning_title')
  relayReviewWarningText.hidden = false
  relayReviewWarningText.textContent = issue ? relayReviewMessage(issue) : ''
  relayReviewWarningCommand.hidden = false
}

async function loadRelayVersion(): Promise<void> {
  try {
    const response = await fetch(`${RELAY_BASE_URL}/version`)
    if (!response.ok) {
      relayVersionUpdate = null
      updateRelayReviewWarning()
      return
    }
    const data: unknown = await response.json()
    const currentVersion = isRecord(data) && typeof data.version === 'string' ? data.version : null
    relayVersionUpdate =
      currentVersion &&
      isRelayVersionOutdated({ currentVersion, requiredVersion: __PLAYWRITER_VERSION__ })
        ? { currentVersion, requiredVersion: __PLAYWRITER_VERSION__ }
        : null
    updateRelayReviewWarning()
  } catch (error: unknown) {
    relayVersionUpdate = null
    updateRelayReviewWarning()
    console.warn(error)
  }
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

function replayCountText(count: number): string {
  return count === 1 ? msg('status_replay_count_one', String(count)) : msg('status_replay_count_other', String(count))
}

function capabilityCountText(count: number, cwd: string): string {
  const key: MessageKey = count === 1 ? 'status_capability_count_one' : 'status_capability_count_other'
  return msg(key, [String(count), cwd])
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function recordingSearchText(recording: SavedReplayRecording): string {
  return [
    recording.id,
    recording.path,
    formatDate(recording.savedAt),
    String(recording.eventCount),
    String(recording.tabId),
    recording.url || '',
    recording.sessionId || '',
  ].join('\n')
}

function capabilitySearchText(capability: CapabilityContract): string {
  return [
    capability.id,
    capability.title,
    capability.description,
    capability.status,
    capability.runtime,
    capability.location,
    capability.sideEffect,
    capability.routingHint,
    capability.tags.join('\n'),
    capability.match.join('\n'),
  ].join('\n')
}

function getFilteredRecordings(): SavedReplayRecording[] {
  if (!searchQuery) {
    return replayRecordings
  }
  return replayRecordings.filter((recording) => {
    return recordingSearchText(recording).toLowerCase().includes(searchQuery)
  })
}

function getFilteredCapabilities(): CapabilityContract[] {
  if (!searchQuery) {
    return capabilities
  }
  return capabilities.filter((capability) => {
    return capabilitySearchText(capability).toLowerCase().includes(searchQuery)
  })
}

function updateTabCounts(): void {
  setText(recordingsCount, replayLoadError ? '–' : String(replayRecordings.length))
  setText(skillsCount, capabilityLoadError ? '–' : String(capabilities.length))
}

function updateViewLabels(): void {
  if (activeTab === 'recordings') {
    setMessage(viewEyebrow, 'recordings_eyebrow')
    setMessage(viewTitle, 'recordings_heading')
    setMessage(viewDescription, 'recordings_description')
    setMessage(metricPrimaryLabel, 'metric_replays')
    setMessage(metricSecondaryLabel, 'metric_total_duration')
    setMessage(metricTertiaryLabel, 'metric_events')
    if (searchInput) {
      searchInput.placeholder = msg('search_recordings_placeholder')
    }
    return
  }

  setMessage(viewEyebrow, 'capabilities_eyebrow')
  setMessage(viewTitle, 'capabilities_heading')
  setMessage(viewDescription, 'capabilities_description')
  setMessage(metricPrimaryLabel, 'metric_capabilities')
  setMessage(metricSecondaryLabel, 'metric_trusted')
  setMessage(metricTertiaryLabel, 'metric_runtimes')
  if (searchInput) {
    searchInput.placeholder = msg('search_capabilities_placeholder')
  }
}

function updateMetrics(): void {
  updateTabCounts()
  const activeLoadError = activeTab === 'recordings' ? replayLoadError : capabilityLoadError
  if (activeLoadError) {
    setText(metricPrimaryValue, '–')
    setText(metricSecondaryValue, '–')
    setText(metricTertiaryValue, '–')
    return
  }
  if (activeTab === 'recordings') {
    const totalDuration = replayRecordings.reduce((total, recording) => {
      return total + recording.duration
    }, 0)
    const eventCount = replayRecordings.reduce((total, recording) => {
      return total + recording.eventCount
    }, 0)
    setText(metricPrimaryValue, String(replayRecordings.length))
    setText(metricSecondaryValue, formatReplayTime(totalDuration))
    setText(metricTertiaryValue, String(eventCount))
    return
  }

  const availableCount = capabilities.filter((capability) => {
    return resolveCapabilityLifecycle(capability).stage === 'trusted'
  }).length
  setText(metricPrimaryValue, String(capabilities.length))
  setText(metricSecondaryValue, String(availableCount))
  setText(metricTertiaryValue, String(capabilities.length))
}

function languageLabel(language: LanguageCode): string {
  return language === 'en' ? msg('language_en') : msg('language_zh_cn')
}

function updateLanguageControls(): void {
  setText(localeText, languageLabel(activeLanguage))
  languageButtons.forEach((button) => {
    const isActive = button.dataset.language === activeLanguage
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-pressed', String(isActive))
  })
}

function rerenderLocalizedContent(): void {
  localizeDocument()
  updateLanguageControls()
  updateViewLabels()
  updateMetrics()
  updateReplayControls()
  updateReplayWarning()
  updateRelayReviewWarning()

  if (selectedReplayId) {
    const selectedRecording = replayRecordings.find((recording) => {
      return recording.id === selectedReplayId
    })
    if (selectedRecording) {
      setReplayDetails(selectedRecording)
    }
  }

  if (activeTab === 'recordings') {
    renderReplays()
    setStatus(loadErrorText(replayLoadError) || replayCountText(replayRecordings.length))
    return
  }

  renderCapabilities()
  setStatus(loadErrorText(capabilityLoadError) || capabilityCountText(capabilities.length, capabilityCwd))
}

async function applyLanguage(language: LanguageCode): Promise<void> {
  activeLanguage = language
  await loadActiveMessages(language)
  rerenderLocalizedContent()
}

async function selectLanguage(language: LanguageCode): Promise<void> {
  await saveSelectedLanguage(language)
  await applyLanguage(language)
}

async function initializeLanguage(): Promise<void> {
  const savedLanguage = await readSavedLanguage()
  await applyLanguage(savedLanguage || languageFromLocale(getUiLocale()))
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

function runtimeLabel(runtime: string): string {
  if (runtime === 'browser') return msg('runtime_browser')
  if (runtime === 'node') return msg('runtime_node')
  return runtime
}

function effectLabel(effect: string): string {
  if (effect === 'read') return msg('effect_read')
  if (effect === 'write') return msg('effect_write')
  if (effect === 'dangerous') return msg('effect_dangerous')
  return effect
}

function routingLabel(routingHint: string): string {
  if (routingHint === 'exact-match-direct-run') return msg('routing_exact')
  if (routingHint === 'semantic-match') return msg('routing_semantic')
  if (routingHint === 'manual') return msg('routing_manual')
  return routingHint
}

function locationLabel(location: string): string {
  if (location === 'project') return msg('location_project')
  if (location === 'global') return msg('location_global')
  return location
}

function capabilityReadinessBadge(capability: CapabilityContract): HTMLSpanElement {
  const lifecycle = resolveCapabilityLifecycle(capability)
  if (lifecycle.stage === 'disabled') {
    return createBadge(msg('badge_disabled'), 'disabled')
  }
  if (lifecycle.stage === 'drifted') {
    return createBadge(msg('badge_validation_expired'), 'drifted')
  }
  if (lifecycle.stage === 'drafted' || lifecycle.stage === 'validated') {
    return createBadge(msg('badge_local_draft'), 'draft')
  }
  if (capability.requiresConfirmation) {
    return createBadge(msg('badge_needs_confirmation'), 'write')
  }
  return createBadge(msg('badge_auto_ready'), 'ready')
}

function createBadge(text: string, tone = text): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.className = `badge badge-${cssToken(tone)}`
  badge.textContent = text
  return badge
}

async function copyTextToClipboard(options: { label: string; text: string }): Promise<void> {
  await navigator.clipboard.writeText(options.text)
  if (!toast) {
    setStatus(msg('status_copied', options.label))
    return
  }
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer)
  }
  toast.textContent = msg('status_copied', options.label)
  toast.hidden = false
  toastTimer = window.setTimeout(() => {
    toast.hidden = true
    toastTimer = null
  }, 2200)
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
  const tabChanged = activeTab !== tab
  activeTab = tab
  if (tabChanged) {
    searchQuery = ''
    if (searchInput) {
      searchInput.value = ''
    }
  }
  document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((button) => {
    const isActive = button.dataset.tab === tab
    button.classList.toggle('active', isActive)
    button.setAttribute('aria-selected', String(isActive))
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
  updateViewLabels()
  updateMetrics()
  if (tab === 'recordings') {
    renderReplays()
    const errorText = loadErrorText(replayLoadError)
    if (errorText) {
      setStatus(errorText)
    }
  }
  if (tab === 'skills') {
    renderCapabilities()
    const errorText = loadErrorText(capabilityLoadError)
    if (errorText) {
      setStatus(errorText)
    }
  }
  if (tab === 'skills' && capabilities.length === 0) {
    loadCapabilities().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(message)
    })
  }
}

function replayAiContextText(recording: SavedReplayRecording): string {
  if (isChineseLocale()) {
    return [
      '这是一个 Tabwright DOM replay 录制。',
      `Replay ID：${recording.id}`,
      `文件路径：${recording.path}`,
      recording.url ? `录制 URL：${recording.url}` : '',
    ]
      .filter((line) => {
        return line.length > 0
      })
      .join('\n')
  }

  return [
    'This is a Tabwright DOM replay recording.',
    `Replay ID: ${recording.id}`,
    `File path: ${recording.path}`,
    recording.url ? `Recorded URL: ${recording.url}` : '',
  ]
    .filter((line) => {
      return line.length > 0
    })
    .join('\n')
}

function setReplayDetails(recording: SavedReplayRecording): void {
  if (!replayDetails) return
  replayDetails.textContent = [
    `${msg('detail_id')}: ${recording.id}`,
    `${msg('detail_path')}: ${recording.path}`,
    `${msg('detail_saved')}: ${formatDate(recording.savedAt)}`,
    `${msg('detail_duration')}: ${formatDuration(recording.duration)}`,
    `${msg('detail_size')}: ${formatSize(recording.size)}`,
    `${msg('detail_events')}: ${recording.eventCount}`,
    `${msg('detail_tab')}: ${recording.tabId}`,
    recording.url ? `${msg('detail_url')}: ${recording.url}` : '',
    recording.sessionId ? `${msg('detail_session')}: ${recording.sessionId}` : '',
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
    replayPlayToggle.textContent = replayIsPlaying ? msg('pause_button') : msg('play_button')
    replayPlayToggle.disabled = !activeReplayer
  }
}

function updateReplayWarning(): void {
  if (!replayWarning) {
    return
  }
  if (replayMissingNodeWarningCount === 0) {
    replayWarning.hidden = true
    replayWarning.textContent = ''
    return
  }
  const key: MessageKey =
    replayMissingNodeWarningCount === 1 ? 'replay_warning_missing_nodes_one' : 'replay_warning_missing_nodes_other'
  replayWarning.textContent = msg(key, String(replayMissingNodeWarningCount))
  replayWarning.hidden = false
}

function resetReplayDiagnostics(): void {
  if (replayWarningTimer !== null) {
    window.clearTimeout(replayWarningTimer)
    replayWarningTimer = null
  }
  replayMissingNodeWarningCount = 0
  updateReplayWarning()
}

function recordMissingReplayNodeWarning(): void {
  replayMissingNodeWarningCount += 1
  if (replayWarningTimer !== null) {
    return
  }
  replayWarningTimer = window.setTimeout(() => {
    replayWarningTimer = null
    updateReplayWarning()
  }, 250)
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
  const loggerController = activeReplayLoggerController
  activeReplayer = null
  activeReplayLoggerController = null
  replayFitCleanup?.()
  replayFitCleanup = null
  stopReplayProgressLoop()
  loggerController?.dispose()
  if (replayer) {
    replayer.destroy()
  }
  resetReplayDiagnostics()
  updateReplayControls(0)
}

function mountReplay(events: RrwebEvent[]): void {
  if (!replayPlayer) return
  destroyActiveReplayer()
  replayPlayer.textContent = ''
  const loggerController = createReplayLogger({
    logger: console,
    onMissingNodeWarning: recordMissingReplayNodeWarning,
  })
  const replayer = (() => {
    try {
      return new Replayer(events, {
        root: replayPlayer,
        mouseTail: false,
        UNSAFE_replayCanvas: true,
        triggerFocus: false,
        logger: loggerController.logger,
      })
    } catch (error) {
      loggerController.dispose()
      throw error
    }
  })()
  activeReplayer = replayer
  activeReplayLoggerController = loggerController
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
  setStatus(msg('status_loading_replay', recording.id))
  setReplayDetails(recording)

  const response = await fetch(`${RELAY_BASE_URL}/rrweb-recordings/${encodeURIComponent(recording.id)}/events`)
  if (!response.ok) {
    throw new Error(msg('error_load_replay', String(response.status)))
  }
  const data: unknown = await (async () => {
    try {
      return await response.json()
    } catch (cause: unknown) {
      throw new Error(msg('error_invalid_replay_events'), { cause })
    }
  })()
  if (!isReplayEventsResponse(data)) {
    throw new Error(msg('error_invalid_replay_events'))
  }
  setReplayDetails(data.recording)
  mountReplay(data.events)
  setStatus(msg('status_replay_ready', recording.id))
}

function createRecordingActions(recording: SavedReplayRecording): HTMLDivElement {
  const actions = document.createElement('div')
  actions.className = 'recording-actions'

  const copyForAi = document.createElement('button')
  copyForAi.type = 'button'
  copyForAi.textContent = msg('copy_for_ai')
  copyForAi.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation()
    copyWithStatus({ label: msg('label_ai_context'), text: replayAiContextText(recording) })
  })

  actions.replaceChildren(copyForAi)
  return actions
}

function createRecordingItem(recording: SavedReplayRecording): HTMLDivElement {
  const item = document.createElement('div')
  item.className = 'recording-item'
  item.dataset.replayId = recording.id

  const select = document.createElement('button')
  select.type = 'button'
  select.className = 'recording-select'
  select.ariaLabel = msg('open_replay_aria', recording.id)

  const title = document.createElement('div')
  title.className = 'recording-title'
  title.textContent = formatDate(recording.savedAt)

  const meta = document.createElement('div')
  meta.className = 'recording-meta'
  meta.textContent = [
    formatDuration(recording.duration),
    msg('events_count', String(recording.eventCount)),
    recording.url || '',
  ]
    .filter((part) => {
      return part.length > 0
    })
    .join(' | ')

  select.replaceChildren(title, meta)
  select.addEventListener('click', () => {
    playReplay(recording).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(message)
    })
  })
  item.replaceChildren(select, createRecordingActions(recording))
  return item
}

function renderReplays(): void {
  if (!replaysList) return
  updateMetrics()

  const errorText = loadErrorText(replayLoadError)
  if (errorText && replayRecordings.length === 0) {
    const error = document.createElement('div')
    error.className = 'empty-state empty-state-warning'
    error.textContent = errorText
    replaysList.replaceChildren(error)
    return
  }

  if (replayRecordings.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = msg('empty_no_replays')
    replaysList.replaceChildren(empty)
    return
  }

  const recordings = getFilteredRecordings()
  if (recordings.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = msg('empty_no_matches')
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
  setStatus(msg('status_loading_recordings'))
  replayLoadError = null
  updateRelayReviewWarning()
  const response: Response = await (async () => {
    try {
      return await fetch(`${RELAY_BASE_URL}/rrweb-recordings`)
    } catch (cause: unknown) {
      replayLoadError = { type: 'relay', issue: 'unavailable' }
      renderReplays()
      updateRelayReviewWarning()
      throw new Error(loadErrorText(replayLoadError), { cause })
    }
  })()
  if (!response.ok) {
    replayLoadError = { type: 'relay', issue: response.status === 404 ? 'outdated' : 'unavailable' }
    renderReplays()
    updateRelayReviewWarning()
    throw new Error(loadErrorText(replayLoadError))
  }
  const data: unknown = await (async () => {
    try {
      return await response.json()
    } catch (cause: unknown) {
      replayLoadError = { type: 'message', message: msg('error_invalid_recordings') }
      renderReplays()
      throw new Error(loadErrorText(replayLoadError), { cause })
    }
  })()
  if (!isReplaysResponse(data)) {
    replayLoadError = { type: 'message', message: msg('error_invalid_recordings') }
    renderReplays()
    throw new Error(loadErrorText(replayLoadError))
  }
  replayRecordings = data.recordings
  replayLoadError = null
  renderReplays()
  updateRelayReviewWarning()
  setStatus(replayCountText(data.recordings.length))
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
    return msg('no_fields_declared')
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
    'tabwright capability run',
    shellQuote(capability.id),
    capability.runtime === 'browser' ? '--browser user' : '',
    '--input-json',
    shellQuote(input),
    '--json',
    capability.status === 'trusted' ? '' : '--force',
    capability.requiresConfirmation ? '--confirm' : '',
    capability.requiresConfirmation ? shellQuote(capability.id) : '',
  ]
    .filter((part) => {
      return part.length > 0
    })
    .join(' ')
}

function resolveCapabilityLifecycle(capability: CapabilityContract): CapabilityLifecycle {
  if (capability.lifecycle) {
    return capability.lifecycle
  }
  if (capability.status === 'disabled') {
    return {
      stage: 'disabled',
      nextAction: 'enable',
      nextCommand: `tabwright capability draft ${shellQuote(capability.id)}`,
      contractHealth: { state: 'unknown', reasons: [] },
    }
  }
  if (capability.status === 'drifted') {
    return {
      stage: 'drifted',
      nextAction: 'repair',
      nextCommand: `tabwright capability show ${shellQuote(capability.id)}`,
      contractHealth: { state: 'drifted', reasons: [] },
    }
  }
  if (capability.status === 'trusted') {
    return {
      stage: 'trusted',
      nextAction: 'run',
      nextCommand: capabilityRunCommand(capability),
      contractHealth: { state: 'unknown', reasons: [] },
    }
  }
  return {
    stage: 'drafted',
    nextAction: 'validate',
    nextCommand: capabilityRunCommand(capability),
    contractHealth: { state: 'unknown', reasons: [] },
  }
}

function capabilityAiContextText(capability: CapabilityContract): string {
  if (isChineseLocale()) {
    return [
      '这是一个 Tabwright capability。',
      `Capability ID：${capability.id}`,
      `标题：${capability.title}`,
      `描述：${capability.description}`,
      `目录：${capability.dir}`,
    ].join('\n')
  }

  return [
    'This is a Tabwright capability.',
    `Capability ID: ${capability.id}`,
    `Title: ${capability.title}`,
    `Description: ${capability.description}`,
    `Directory: ${capability.dir}`,
  ].join('\n')
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

function createCapabilityCommandField(options: { command: string }): HTMLDivElement {
  const field = document.createElement('div')
  field.className = 'field full'

  const title = document.createElement('h3')
  title.textContent = msg('label_next_command')

  const command = document.createElement('div')
  command.className = 'technical-command'
  const code = document.createElement('code')
  code.textContent = options.command
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = msg('copy_command')
  copy.addEventListener('click', () => {
    copyWithStatus({ label: msg('label_next_command'), text: options.command })
  })
  command.replaceChildren(code, copy)

  field.replaceChildren(title, command)
  return field
}

function lifecycleHealthMessage(lifecycle: CapabilityLifecycle): string {
  const healthLabel = (() => {
    if (lifecycle.contractHealth.state === 'healthy') return msg('lifecycle_health_healthy')
    if (lifecycle.contractHealth.state === 'drifted') return msg('lifecycle_health_drifted')
    return msg('lifecycle_health_unknown')
  })()
  const summary = (() => {
    if (!lifecycle.contractHealth.checkedAt) {
      return msg('lifecycle_health_not_checked')
    }
    const timestamp = Date.parse(lifecycle.contractHealth.checkedAt)
    const checkedAt = Number.isNaN(timestamp)
      ? lifecycle.contractHealth.checkedAt
      : new Date(timestamp).toLocaleString(activeLanguage === 'zh_CN' ? 'zh-CN' : 'en-US')
    return msg('lifecycle_health_checked', [healthLabel, checkedAt])
  })()
  return [summary, ...lifecycle.contractHealth.reasons].join('\n')
}

function createCapabilityActions(capability: CapabilityContract): HTMLDivElement {
  const actions = document.createElement('div')
  actions.className = 'skill-actions'

  const copyForAi = document.createElement('button')
  copyForAi.type = 'button'
  copyForAi.textContent = msg('copy_for_ai')
  copyForAi.addEventListener('click', () => {
    copyWithStatus({ label: msg('label_ai_context'), text: capabilityAiContextText(capability) })
  })

  actions.replaceChildren(copyForAi)
  return actions
}

function renderCapabilityDetail(capability: CapabilityContract): void {
  if (!skillDetail) return
  const lifecycle = resolveCapabilityLifecycle(capability)

  const header = document.createElement('div')
  header.className = 'skill-header'

  const title = document.createElement('h2')
  title.textContent = capability.title

  const meta = document.createElement('div')
  meta.className = 'detail-meta'
  meta.textContent = capability.id

  const badges = document.createElement('div')
  badges.className = 'badge-row'
  badges.replaceChildren(
    capabilityReadinessBadge(capability),
    createBadge(effectLabel(capability.sideEffect), capability.sideEffect),
  )

  header.replaceChildren(title, meta, badges, createCapabilityActions(capability))

  const primaryFields = document.createElement('div')
  primaryFields.className = 'field-grid'
  primaryFields.replaceChildren(
    createField({ title: msg('field_description'), value: capability.description || '-', full: true }),
    createField({ title: msg('field_when_to_use'), value: displayList(capability.whenToUse, '-'), full: true }),
  )

  const advancedDetails = document.createElement('details')
  advancedDetails.className = 'advanced-details'
  const advancedSummary = document.createElement('summary')
  advancedSummary.textContent = msg('technical_details')
  const advancedFields = document.createElement('div')
  advancedFields.className = 'field-grid'
  advancedFields.replaceChildren(
    createCapabilityCommandField({ command: lifecycle.nextCommand }),
    createField({ title: msg('field_contract_health'), value: lifecycleHealthMessage(lifecycle), full: true }),
    createField({ title: msg('field_runtime'), value: runtimeLabel(capability.runtime) }),
    createField({ title: msg('field_effect'), value: effectLabel(capability.sideEffect) }),
    createField({ title: msg('field_routing'), value: routingLabel(capability.routingHint) }),
    createField({ title: msg('detail_path'), value: capability.dir }),
    createField({ title: msg('field_location'), value: locationLabel(capability.location) }),
    createField({ title: msg('field_when_not_to_use'), value: displayList(capability.whenNotToUse, '-'), full: true }),
    createField({ title: msg('field_match'), value: displayList(capability.match, '-') }),
    createField({ title: msg('field_permissions'), value: displayList(capability.permissions, '-') }),
    createField({ title: msg('field_input'), value: schemaSummary(capability.inputSchema) }),
    createField({ title: msg('field_output'), value: schemaSummary(capability.outputSchema) }),
    createField({
      title: msg('field_autonomy'),
      value: capability.autonomousInvocation.allowed
        ? msg('autonomy_trusted_readonly')
        : displayList(capability.autonomousInvocation.reasons, '-'),
    }),
    createField({
      title: msg('field_recent_runs'),
      value:
        capability.recentRuns.length === 0
          ? '-'
          : capability.recentRuns
              .map((run) => {
                return `${run.status} ${formatDuration(run.durationMs)} ${run.createdAt}`
              })
              .join('\n'),
    }),
  )
  advancedDetails.replaceChildren(advancedSummary, advancedFields)

  skillDetail.replaceChildren(header, primaryFields, advancedDetails)
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
  item.ariaLabel = msg('open_capability_aria', capability.id)

  const title = document.createElement('div')
  title.className = 'skill-title'
  title.textContent = capability.title

  const meta = document.createElement('div')
  meta.className = 'skill-meta'
  meta.textContent = capability.description || capability.id

  const badges = document.createElement('div')
  badges.className = 'badge-row'
  badges.replaceChildren(
    capabilityReadinessBadge(capability),
    createBadge(effectLabel(capability.sideEffect), capability.sideEffect),
  )

  item.replaceChildren(title, meta, badges)
  item.addEventListener('click', () => {
    selectCapability(capability)
  })
  return item
}

function renderCapabilities(): void {
  if (!skillsList) return
  updateMetrics()

  const errorText = loadErrorText(capabilityLoadError)
  if (errorText && capabilities.length === 0) {
    const error = document.createElement('div')
    error.className = 'empty-state empty-state-warning'
    error.textContent = errorText
    skillsList.replaceChildren(error)
    if (skillDetail) {
      skillDetail.replaceChildren(error.cloneNode(true))
    }
    return
  }

  if (capabilities.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = msg('empty_no_capabilities')
    skillsList.replaceChildren(empty)
    if (skillDetail) {
      skillDetail.replaceChildren(empty.cloneNode(true))
    }
    return
  }

  const filteredCapabilities = getFilteredCapabilities()
  if (filteredCapabilities.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = msg('empty_no_matches')
    skillsList.replaceChildren(empty)
    if (skillDetail) {
      skillDetail.replaceChildren(empty.cloneNode(true))
    }
    return
  }

  skillsList.replaceChildren(
    ...filteredCapabilities.map((capability) => {
      return createCapabilityItem(capability)
    }),
  )
  const selected =
    filteredCapabilities.find((capability) => {
      return capability.id === selectedCapabilityId
    }) || filteredCapabilities[0]
  if (selected) {
    selectedCapabilityId = selected.id
    renderCapabilityDetail(selected)
    updateActiveCapability()
    return
  }
  if (skillDetail) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = msg('select_capability')
    skillDetail.replaceChildren(empty)
  }
}

async function loadCapabilities(options: { silent?: boolean } = {}): Promise<void> {
  if (!options.silent) {
    setStatus(msg('status_loading_capabilities'))
  }
  capabilityLoadError = null
  updateRelayReviewWarning()
  const response: Response = await (async () => {
    try {
      return await fetch(`${RELAY_BASE_URL}/capabilities`)
    } catch (cause: unknown) {
      capabilityLoadError = { type: 'relay', issue: 'unavailable' }
      renderCapabilities()
      updateRelayReviewWarning()
      throw new Error(loadErrorText(capabilityLoadError), { cause })
    }
  })()
  if (!response.ok) {
    capabilityLoadError = { type: 'relay', issue: response.status === 404 ? 'outdated' : 'unavailable' }
    renderCapabilities()
    updateRelayReviewWarning()
    throw new Error(loadErrorText(capabilityLoadError))
  }
  const data: unknown = await (async () => {
    try {
      return await response.json()
    } catch (cause: unknown) {
      capabilityLoadError = { type: 'message', message: msg('error_invalid_capabilities') }
      renderCapabilities()
      throw new Error(loadErrorText(capabilityLoadError), { cause })
    }
  })()
  const parsed = parseCapabilitiesResponse(data)
  if (!parsed) {
    capabilityLoadError = { type: 'message', message: msg('error_invalid_capabilities') }
    renderCapabilities()
    throw new Error(loadErrorText(capabilityLoadError))
  }
  capabilityCwd = parsed.cwd
  capabilities = parsed.capabilities
  capabilityLoadError = null
  renderCapabilities()
  updateRelayReviewWarning()
  if (!options.silent) {
    setStatus(capabilityCountText(parsed.capabilities.length, capabilityCwd))
  }
}

refreshButton?.addEventListener('click', () => {
  const loader = activeTab === 'recordings' ? loadReplays : loadCapabilities
  Promise.all([loadRelayVersion(), loader()]).catch((error: unknown) => {
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

searchInput?.addEventListener('input', () => {
  searchQuery = normalizeSearchText(searchInput.value)
  if (activeTab === 'recordings') {
    renderReplays()
    return
  }
  renderCapabilities()
})

languageButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const language = button.dataset.language
    if (!isLanguageCode(language)) {
      return
    }
    selectLanguage(language).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(message)
    })
  })
})

document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.tab === 'recordings' || button.dataset.tab === 'skills') {
      setActiveTab(button.dataset.tab)
    }
  })
})

async function initializeOptionsPage(): Promise<void> {
  await initializeLanguage()
  setActiveTab('recordings')
  await loadRelayVersion()
  await loadReplays()
}

initializeOptionsPage().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  setStatus(message)
})

window.setInterval(() => {
  void loadRelayVersion()
  if (activeTab === 'skills') {
    void loadCapabilities({ silent: true }).catch((error: unknown) => {
      console.warn(error)
    })
  }
}, 60_000)
