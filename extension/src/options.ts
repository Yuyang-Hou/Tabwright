declare const process: { env: { PLAYWRITER_PORT: string } }

import { EventType, Replayer, ReplayerEvents, type eventWithTime } from 'rrweb'
import 'rrweb/dist/style.css'
import { createReplayLogger, type ReplayLoggerController } from './replay-logger'
import type { RelayReviewIssue } from './relay-warning'

const RELAY_HOST = '127.0.0.1'
const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988
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
  agentSkill: CapabilityAgentSkillStatus
  lifecycle?: CapabilityLifecycle
}

interface CapabilitiesResponse {
  cwd: string
  capabilities: CapabilityContract[]
}

type LoadError = { type: 'relay'; issue: RelayReviewIssue } | { type: 'message'; message: string }
type CapabilityContractPayload = Omit<CapabilityContract, 'recentRuns' | 'lifecycle'> & {
  recentRuns: unknown[]
  lifecycle?: unknown
}

const messageFallbacks = {
  app_title: 'Playwriter',
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
  capabilities_description: 'Inspect runnable capabilities, trust status, schemas, and agent skill coverage.',
  search_label: 'Search',
  search_recordings_placeholder: 'Filter recordings',
  search_capabilities_placeholder: 'Filter capabilities',
  metric_replays: 'Replays',
  metric_total_duration: 'Total duration',
  metric_events: 'Events',
  metric_capabilities: 'Capabilities',
  metric_trusted: 'AI-ready',
  metric_agent_skills: 'Agent skills',
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
  relay_review_outdated:
    'Browser control is connected, but this local service cannot list saved recordings or capabilities. Your files were not deleted. Restart or update Playwriter, then refresh.',
  relay_review_unavailable:
    'Browser control is connected, but saved recordings and capabilities are temporarily unavailable. Your files were not deleted. Restart Playwriter, then refresh.',
  lifecycle_unsupported:
    'This extension cannot interpret the capability lifecycle. Update Playwriter before running it.',
  empty_no_replays: 'No DOM replays yet.',
  empty_no_capabilities: 'No capabilities yet.',
  empty_no_matches: 'No matches for this search.',
  copy_handoff: 'Copy handoff',
  copy_compile: 'Copy compile',
  copy_edit_prompt: 'Copy edit prompt',
  copy_use_prompt: 'Copy use prompt',
  copy_skill_prompt: 'Copy skill prompt',
  copy_run: 'Copy run',
  copy_run_after_approval: 'Copy approved run',
  copy_next_step: 'Copy next step',
  label_ai_handoff: 'AI handoff',
  label_compile_command: 'Compile command',
  label_edit_prompt: 'Edit prompt',
  label_use_prompt: 'Use prompt',
  label_skill_prompt: 'Skill prompt',
  label_run_command: 'Run command',
  label_next_command: 'Next-step command',
  detail_id: 'ID',
  detail_path: 'Path',
  detail_saved: 'Saved',
  detail_duration: 'Duration',
  detail_size: 'Size',
  detail_events: 'Events',
  detail_tab: 'Tab',
  detail_url: 'URL',
  detail_session: 'Session',
  detail_ai_handoff: 'AI handoff',
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
  field_agent_skill: 'Agent skill',
  lifecycle_title: 'Lifecycle',
  lifecycle_step_drafted: 'Draft',
  lifecycle_step_validated: 'Validated',
  lifecycle_step_trusted: 'Trusted',
  lifecycle_stage_drafted: 'Drafted',
  lifecycle_stage_validated: 'Validated',
  lifecycle_stage_trusted: 'Trusted',
  lifecycle_stage_drifted: 'Drifted',
  lifecycle_stage_disabled: 'Disabled',
  lifecycle_next_step: 'Next step: $1',
  lifecycle_action_validate: 'Validate contract',
  lifecycle_action_trust: 'Mark trusted',
  lifecycle_action_run: 'Run capability',
  lifecycle_action_repair: 'Repair contract drift',
  lifecycle_action_enable: 'Enable as draft',
  lifecycle_health_checked: '$1 · checked $2',
  lifecycle_health_not_checked: '$1 · no conformance run recorded',
  lifecycle_health_healthy: 'Contract healthy',
  lifecycle_health_drifted: 'Contract drift detected',
  lifecycle_health_unknown: 'Contract not validated',
  lifecycle_drift_warning: 'Normal execution and AI autonomy stay blocked until the contract passes validation again.',
  lifecycle_disabled_warning: 'This capability is disabled. Enable it as a draft before validation or execution.',
  autonomy_trusted_readonly: 'trusted read-only capability',
  agent_skill_installed: 'installed: $1',
  agent_skill_draft: 'draft: $1',
  agent_skill_missing: 'not created',
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
}

const statusText = document.querySelector<HTMLParagraphElement>('#status-text')
const relayReviewWarning = document.querySelector<HTMLElement>('#relay-review-warning')
const relayReviewWarningText = document.querySelector<HTMLParagraphElement>('#relay-review-warning-text')
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

let activeTab: ActiveTab = 'recordings'
let selectedReplayId: string | null = null
let selectedCapabilityId: string | null = null
let replayRecordings: SavedReplayRecording[] = []
let capabilities: CapabilityContract[] = []
let capabilityCwd = ''
let replayLoadError: LoadError | null = null
let capabilityLoadError: LoadError | null = null
let searchQuery = ''
let replayFitCleanup: (() => void) | null = null
let activeReplayer: Replayer | null = null
let replayIsPlaying = false
let replayTotalTime = 0
let replayProgressTimer: number | null = null
let replayMissingNodeWarningCount = 0
let replayWarningTimer: number | null = null
let activeReplayLoggerController: ReplayLoggerController | null = null

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
    Array.isArray(value.recentRuns) &&
    isCapabilityAgentSkillStatus(value.agentSkill)
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
          nextCommand: `playwriter capability describe ${shellQuote(value.id)} --json`,
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
  if (!relayReviewWarning || !relayReviewWarningText) {
    return
  }
  const issue = currentRelayReviewIssue()
  relayReviewWarning.hidden = !issue
  relayReviewWarningText.textContent = issue ? relayReviewMessage(issue) : ''
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
  setMessage(metricTertiaryLabel, 'metric_agent_skills')
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

  const trustedCount = capabilities.filter((capability) => {
    return capability.autonomousInvocation.allowed
  }).length
  const skillCount = capabilities.filter((capability) => {
    return capability.agentSkill.installedExists || capability.agentSkill.draftExists
  }).length
  setText(metricPrimaryValue, String(capabilities.length))
  setText(metricSecondaryValue, String(trustedCount))
  setText(metricTertiaryValue, String(skillCount))
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

function createBadge(text: string, tone = text): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.className = `badge badge-${cssToken(tone)}`
  badge.textContent = text
  return badge
}

async function copyTextToClipboard(options: { label: string; text: string }): Promise<void> {
  await navigator.clipboard.writeText(options.text)
  setStatus(msg('status_copied', options.label))
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

function replayCapabilityId(recording: SavedReplayRecording): string {
  return `replay-${
    recording.id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(-28) || 'workflow'
  }`
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
  const capabilityId = replayCapabilityId(recording)
  return [
    'playwriter capability run',
    shellQuote(capabilityId),
    '--browser user',
    '--force',
    '--confirm',
    shellQuote(capabilityId),
    '--input-json',
    shellQuote('{"value":"example"}'),
    '--json',
  ].join(' ')
}

function replayAiHandoffText(recording: SavedReplayRecording): string {
  if (isChineseLocale()) {
    return [
      '使用这个 Playwriter DOM replay 作为工作流证据。',
      `Replay id: ${recording.id}`,
      recording.url ? `录制 URL: ${recording.url}` : '',
      '',
      '编译能力：',
      replayMakeCommand(recording),
      '',
      '修改输入后运行：',
      '先暂停并取得用户明确确认；确认后才可执行：',
      replayRunCommand(recording),
    ]
      .filter((line) => {
        return line.length > 0
      })
      .join('\n')
  }

  return [
    'Use this Playwriter DOM replay as workflow evidence.',
    `Replay id: ${recording.id}`,
    recording.url ? `Recorded URL: ${recording.url}` : '',
    '',
    'Compile:',
    replayMakeCommand(recording),
    '',
    'Stop and ask for explicit user confirmation. Only after approval, edit the input and run:',
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
    `${msg('detail_id')}: ${recording.id}`,
    `${msg('detail_path')}: ${recording.path}`,
    `${msg('detail_saved')}: ${formatDate(recording.savedAt)}`,
    `${msg('detail_duration')}: ${formatDuration(recording.duration)}`,
    `${msg('detail_size')}: ${formatSize(recording.size)}`,
    `${msg('detail_events')}: ${recording.eventCount}`,
    `${msg('detail_tab')}: ${recording.tabId}`,
    recording.url ? `${msg('detail_url')}: ${recording.url}` : '',
    recording.sessionId ? `${msg('detail_session')}: ${recording.sessionId}` : '',
    '',
    `${msg('detail_ai_handoff')}:`,
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

  const handoff = document.createElement('button')
  handoff.type = 'button'
  handoff.textContent = msg('copy_handoff')
  handoff.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation()
    copyWithStatus({ label: msg('label_ai_handoff'), text: replayAiHandoffText(recording) })
  })

  const compile = document.createElement('button')
  compile.type = 'button'
  compile.textContent = msg('copy_compile')
  compile.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation()
    copyWithStatus({ label: msg('label_compile_command'), text: replayMakeCommand(recording) })
  })

  actions.replaceChildren(handoff, compile)
  return actions
}

function createRecordingItem(recording: SavedReplayRecording): HTMLButtonElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'recording-item'
  item.dataset.replayId = recording.id
  item.ariaLabel = msg('open_replay_aria', recording.id)

  const title = document.createElement('div')
  title.className = 'recording-title'
  title.textContent = formatDate(recording.savedAt)

  const meta = document.createElement('div')
  meta.className = 'recording-meta'
  meta.textContent = [
    formatDuration(recording.duration),
    msg('events_count', String(recording.eventCount)),
    formatSize(recording.size),
    msg('tab_label', String(recording.tabId)),
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
    'playwriter capability run',
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
      nextCommand: `playwriter capability draft ${shellQuote(capability.id)}`,
      contractHealth: { state: 'unknown', reasons: [] },
    }
  }
  if (capability.status === 'drifted') {
    return {
      stage: 'drifted',
      nextAction: 'repair',
      nextCommand: `playwriter capability show ${shellQuote(capability.id)}`,
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

function isCapabilityReadyToRun(lifecycle: CapabilityLifecycle): boolean {
  return lifecycle.stage === 'trusted' && lifecycle.nextAction === 'run'
}

function lifecycleStageMessage(stage: CapabilityLifecycle['stage']): string {
  if (stage === 'validated') return msg('lifecycle_stage_validated')
  if (stage === 'trusted') return msg('lifecycle_stage_trusted')
  if (stage === 'drifted') return msg('lifecycle_stage_drifted')
  if (stage === 'disabled') return msg('lifecycle_stage_disabled')
  return msg('lifecycle_stage_drafted')
}

function lifecycleActionMessage(action: CapabilityLifecycle['nextAction']): string {
  if (action === 'trust') return msg('lifecycle_action_trust')
  if (action === 'run') return msg('lifecycle_action_run')
  if (action === 'repair') return msg('lifecycle_action_repair')
  if (action === 'enable') return msg('lifecycle_action_enable')
  return msg('lifecycle_action_validate')
}

function capabilityRouteCommand(): string {
  return ['playwriter capability route', shellQuote('<user task or URL>'), '--json'].join(' ')
}

function capabilityEditPrompt(capability: CapabilityContract): string {
  if (!isChineseLocale()) {
    return [
      `Please help me update this Playwriter capability: ${capability.id}`,
      `Current directory: ${capability.dir}`,
      '',
      'Inspect the current capability first:',
      `playwriter capability describe ${capability.id} --json`,
      `playwriter capability show ${capability.id} --script`,
      '',
      'My requested change: <describe the change here>',
      '',
      'Requirements:',
      '- Decide whether this only changes the contract or also script.js',
      '- Run this package typecheck or the relevant tests after editing',
      '- Do not trust this capability unless I explicitly ask',
    ].join('\n')
  }

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
  const lifecycle = resolveCapabilityLifecycle(capability)
  if (!isCapabilityReadyToRun(lifecycle)) {
    if (!isChineseLocale()) {
      return [
        `Please prepare this Playwriter capability: ${capability.id}`,
        '',
        `Current lifecycle stage: ${lifecycleStageMessage(lifecycle.stage)}`,
        `Next step: ${lifecycleActionMessage(lifecycle.nextAction)}`,
        lifecycle.nextCommand,
        '',
        'Use only this lifecycle step. Do not run the capability as a normal task until it reaches Trusted.',
        '',
        'My task: <write the task or paste the URL here>',
      ].join('\n')
    }

    return [
      `请先准备这个 Playwriter capability：${capability.id}`,
      '',
      `当前生命周期：${lifecycleStageMessage(lifecycle.stage)}`,
      `下一步：${lifecycleActionMessage(lifecycle.nextAction)}`,
      lifecycle.nextCommand,
      '',
      '只执行这一步生命周期操作；在状态达到“可信”前，不要把它当作普通任务直接运行。',
      '',
      '我的任务：<在这里写任务或粘贴 URL>',
    ].join('\n')
  }

  if (!isChineseLocale()) {
    return [
      `Please use this Playwriter capability: ${capability.id}`,
      '',
      'Try routing first:',
      capabilityRouteCommand(),
      '',
      capability.requiresConfirmation
        ? 'This capability has side effects. Stop and ask for my explicit approval of the concrete input; only after approval use:'
        : 'If direct execution is appropriate, use:',
      lifecycle.nextCommand,
      '',
      'My task: <write the task or paste the URL here>',
    ].join('\n')
  }

  return [
    `请使用 Playwriter capability：${capability.id}`,
    '',
    '先尝试路由：',
    capabilityRouteCommand(),
    '',
    capability.requiresConfirmation
      ? '这个能力有副作用。先暂停并让我明确确认具体输入；只有确认后才可使用：'
      : '如果确认要直接运行，用：',
    lifecycle.nextCommand,
    '',
    '我的任务：<在这里写任务或粘贴 URL>',
  ].join('\n')
}

function capabilitySkillPrompt(capability: CapabilityContract): string {
  if (!isChineseLocale()) {
    return [
      `Please create or improve the agent skill for this Playwriter capability: ${capability.id}.`,
      '',
      'Inspect the current capability first:',
      `playwriter capability describe ${capability.id} --json`,
      '',
      capability.agentSkill.draftExists
        ? `Existing draft: ${capability.agentSkill.draftPath}`
        : capability.agentSkill.initCommand,
      capability.agentSkill.draftExists ? capability.agentSkill.showCommand : '',
      '',
      'The skill should define when to use it, when not to use it, the first command, auth/sandbox notes, and the default output shape.',
      '',
      'Install it after editing:',
      capability.agentSkill.installCommand,
    ]
      .filter((line) => {
        return line.length > 0
      })
      .join('\n')
  }

  return [
    `请帮我为 Playwriter capability：${capability.id} 创建或完善 agent skill。`,
    '',
    '先查看当前能力：',
    `playwriter capability describe ${capability.id} --json`,
    '',
    capability.agentSkill.draftExists
      ? `已有草稿：${capability.agentSkill.draftPath}`
      : capability.agentSkill.initCommand,
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

function lifecycleStepState(options: {
  stage: CapabilityLifecycle['stage']
  stepIndex: number
}): 'done' | 'current' | 'pending' | 'blocked' {
  if (options.stage === 'disabled') {
    return 'blocked'
  }
  if (options.stage === 'drifted') {
    return options.stepIndex === 0 ? 'blocked' : 'pending'
  }
  const currentIndex = options.stage === 'trusted' ? 2 : options.stage === 'validated' ? 1 : 0
  if (options.stepIndex < currentIndex) {
    return 'done'
  }
  if (options.stepIndex === currentIndex) {
    return 'current'
  }
  return 'pending'
}

function createLifecycleStep(options: {
  label: string
  state: 'done' | 'current' | 'pending' | 'blocked'
}): HTMLLIElement {
  const step = document.createElement('li')
  step.className = 'lifecycle-step'
  step.dataset.state = options.state
  if (options.state === 'current') {
    step.setAttribute('aria-current', 'step')
  }

  const marker = document.createElement('span')
  marker.className = 'lifecycle-marker'
  marker.setAttribute('aria-hidden', 'true')

  const label = document.createElement('span')
  label.textContent = options.label
  step.replaceChildren(marker, label)
  return step
}

function lifecycleHealthMessage(lifecycle: CapabilityLifecycle): string {
  const healthLabel = (() => {
    if (lifecycle.contractHealth.state === 'healthy') return msg('lifecycle_health_healthy')
    if (lifecycle.contractHealth.state === 'drifted') return msg('lifecycle_health_drifted')
    return msg('lifecycle_health_unknown')
  })()
  if (!lifecycle.contractHealth.checkedAt) {
    return msg('lifecycle_health_not_checked', healthLabel)
  }
  const timestamp = Date.parse(lifecycle.contractHealth.checkedAt)
  const checkedAt = Number.isNaN(timestamp)
    ? lifecycle.contractHealth.checkedAt
    : new Date(timestamp).toLocaleString(activeLanguage === 'zh_CN' ? 'zh-CN' : 'en-US')
  return msg('lifecycle_health_checked', [healthLabel, checkedAt])
}

function createCapabilityLifecycle(capability: CapabilityContract): HTMLElement {
  const lifecycle = resolveCapabilityLifecycle(capability)
  const card = document.createElement('section')
  card.className = 'lifecycle-card'
  card.dataset.stage = lifecycle.stage

  const heading = document.createElement('div')
  heading.className = 'lifecycle-heading'
  const title = document.createElement('h3')
  title.textContent = msg('lifecycle_title')
  heading.replaceChildren(title, createBadge(lifecycleStageMessage(lifecycle.stage), lifecycle.stage))

  const steps = document.createElement('ol')
  steps.className = 'lifecycle-steps'
  steps.setAttribute('aria-label', msg('lifecycle_title'))
  steps.replaceChildren(
    createLifecycleStep({
      label: msg('lifecycle_step_drafted'),
      state: lifecycleStepState({ stage: lifecycle.stage, stepIndex: 0 }),
    }),
    createLifecycleStep({
      label: msg('lifecycle_step_validated'),
      state: lifecycleStepState({ stage: lifecycle.stage, stepIndex: 1 }),
    }),
    createLifecycleStep({
      label: msg('lifecycle_step_trusted'),
      state: lifecycleStepState({ stage: lifecycle.stage, stepIndex: 2 }),
    }),
  )

  const summary = document.createElement('div')
  summary.className = 'lifecycle-summary'
  const nextStep = document.createElement('strong')
  nextStep.textContent = msg('lifecycle_next_step', lifecycleActionMessage(lifecycle.nextAction))
  const health = document.createElement('span')
  health.textContent = lifecycleHealthMessage(lifecycle)
  summary.replaceChildren(nextStep, health)

  const command = document.createElement('div')
  command.className = 'lifecycle-command'
  const code = document.createElement('code')
  code.textContent = lifecycle.nextCommand
  code.title = lifecycle.nextCommand
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = msg('copy_next_step')
  copy.addEventListener('click', () => {
    copyWithStatus({ label: msg('label_next_command'), text: lifecycle.nextCommand })
  })
  command.replaceChildren(code, copy)

  const warningText = (() => {
    if (lifecycle.stage === 'drifted') {
      return [msg('lifecycle_drift_warning'), ...lifecycle.contractHealth.reasons].join('\n')
    }
    if (lifecycle.stage === 'disabled') {
      return msg('lifecycle_disabled_warning')
    }
    return ''
  })()
  const warning = document.createElement('p')
  warning.className = 'lifecycle-warning'
  warning.textContent = warningText
  warning.hidden = warningText.length === 0

  card.replaceChildren(heading, steps, summary, command, warning)
  return card
}

function createCapabilityActions(capability: CapabilityContract): HTMLDivElement {
  const actions = document.createElement('div')
  actions.className = 'skill-actions'
  const lifecycle = resolveCapabilityLifecycle(capability)

  const editPrompt = document.createElement('button')
  editPrompt.type = 'button'
  editPrompt.textContent = msg('copy_edit_prompt')
  editPrompt.addEventListener('click', () => {
    copyWithStatus({ label: msg('label_edit_prompt'), text: capabilityEditPrompt(capability) })
  })

  const usePrompt = document.createElement('button')
  usePrompt.type = 'button'
  usePrompt.textContent = msg('copy_use_prompt')
  usePrompt.addEventListener('click', () => {
    copyWithStatus({ label: msg('label_use_prompt'), text: capabilityUsePrompt(capability) })
  })

  const skillPrompt = document.createElement('button')
  skillPrompt.type = 'button'
  skillPrompt.textContent = msg('copy_skill_prompt')
  skillPrompt.addEventListener('click', () => {
    copyWithStatus({ label: msg('label_skill_prompt'), text: capabilitySkillPrompt(capability) })
  })

  const runCommand = document.createElement('button')
  runCommand.type = 'button'
  runCommand.textContent = isCapabilityReadyToRun(lifecycle)
    ? capability.requiresConfirmation
      ? msg('copy_run_after_approval')
      : msg('copy_run')
    : msg('copy_next_step')
  runCommand.addEventListener('click', () => {
    copyWithStatus({
      label: isCapabilityReadyToRun(lifecycle) ? msg('label_run_command') : msg('label_next_command'),
      text: lifecycle.nextCommand,
    })
  })

  actions.replaceChildren(editPrompt, usePrompt, skillPrompt, runCommand)
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
  meta.textContent = `${capability.id} | ${capability.location} | ${capability.dir}`

  const badges = document.createElement('div')
  badges.className = 'badge-row'
  badges.replaceChildren(
    createBadge(lifecycle.stage),
    createBadge(capability.runtime),
    createBadge(capability.sideEffect),
    createBadge(capability.routingHint),
    createBadge(
      capability.autonomousInvocation.allowed ? 'ai-ready' : 'ai-blocked',
      capability.autonomousInvocation.allowed ? 'ready' : 'blocked',
    ),
    createBadge(
      capability.agentSkill.installedExists
        ? 'skill-installed'
        : capability.agentSkill.draftExists
          ? 'skill-draft'
          : 'skill-missing',
    ),
  )

  header.replaceChildren(title, meta, badges, createCapabilityActions(capability))

  const fields = document.createElement('div')
  fields.className = 'field-grid'
  fields.replaceChildren(
    createField({ title: msg('field_description'), value: capability.description || '-', full: true }),
    createField({ title: msg('field_when_to_use'), value: displayList(capability.whenToUse, '-'), full: true }),
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
    createField({
      title: msg('field_agent_skill'),
      value: [
        capability.agentSkill.installedExists ? msg('agent_skill_installed', capability.agentSkill.installedPath) : '',
        capability.agentSkill.draftExists ? msg('agent_skill_draft', capability.agentSkill.draftPath) : '',
        capability.agentSkill.draftExists || capability.agentSkill.installedExists ? '' : msg('agent_skill_missing'),
      ]
        .filter((line) => {
          return line.length > 0
        })
        .join('\n'),
      full: true,
    }),
  )

  skillDetail.replaceChildren(header, createCapabilityLifecycle(capability), fields)
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
  const lifecycle = resolveCapabilityLifecycle(capability)
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
  meta.textContent = [
    lifecycle.stage,
    capability.runtime,
    capability.location,
    capability.sideEffect,
    capability.id,
  ].join(' | ')

  const badges = document.createElement('div')
  badges.className = 'badge-row'
  badges.replaceChildren(
    createBadge(lifecycle.stage),
    createBadge(capability.sideEffect),
    createBadge(
      capability.autonomousInvocation.allowed ? 'ai-ready' : 'ai-blocked',
      capability.autonomousInvocation.allowed ? 'ready' : 'blocked',
    ),
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
  const selected = filteredCapabilities.find((capability) => {
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
    empty.textContent = msg('select_capability')
    skillDetail.replaceChildren(empty)
  }
}

async function loadCapabilities(): Promise<void> {
  setStatus(msg('status_loading_capabilities'))
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
  setStatus(capabilityCountText(parsed.capabilities.length, capabilityCwd))
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
  await loadReplays()
}

initializeOptionsPage().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  setStatus(message)
})
