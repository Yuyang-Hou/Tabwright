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
const UNSUPPORTED_LIFECYCLE_REASON = '__tabwright_unsupported_lifecycle__'

type ActiveTab = 'recordings' | 'skills'
type LanguageCode = 'en' | 'zh_CN'
type CapabilityViewState = 'ready' | 'attention' | 'disabled'
type CapabilityStatusFilter = 'all' | CapabilityViewState
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
  operation?: string
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

type AgentSkillManager = 'codex' | 'agents' | 'claude' | 'custom'
type AgentSkillScope = 'project' | 'user' | 'custom'
type CapabilityAuthStatus = 'not-required' | 'missing' | 'authenticated' | 'expiring' | 'expired' | 'unknown'

interface AgentSkillInstallation {
  manager: AgentSkillManager
  scope: AgentSkillScope
  skillDir: string
  runtimeDir: string
}

interface AgentSkillMetadata {
  installations: AgentSkillInstallation[]
  hasRuntimeConflict?: boolean
  localState: {
    stateDir: string
    auth: {
      type: string
      status: CapabilityAuthStatus
      canRefresh: boolean
      refreshedAt?: string
      expiresAt?: string
    }
    artifactCount: number
  }
}

interface CapabilityOperation {
  title: string
  description: string
  permissions: string[]
  sideEffect: string
  requiresConfirmation: boolean
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
  operations: Record<string, CapabilityOperation>
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
  agentSkill?: AgentSkillMetadata
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
type CapabilityContractPayload = Omit<CapabilityContract, 'operations' | 'recentRuns' | 'lifecycle' | 'agentSkill'> & {
  operations?: unknown
  recentRuns: unknown[]
  lifecycle?: unknown
  agentSkill?: unknown
}

const messageFallbacks = {
  app_title: 'Tabwright',
  app_subtitle: 'Local browser automation cockpit',
  status_label: 'Status',
  status_loading_recordings: 'Loading recordings...',
  refresh_button: 'Refresh',
  recordings_tab: 'Recordings',
  capabilities_tab: 'Tabwright Skills',
  language_label: 'Language',
  language_switch_aria_label: 'Language switch',
  language_en: 'English',
  language_zh_cn: 'Chinese',
  recordings_eyebrow: 'Replay library',
  recordings_heading: 'DOM replays',
  recordings_description: 'Review saved page recordings and turn repeatable flows into capabilities.',
  capabilities_eyebrow: 'Agent Skills',
  capabilities_heading: 'Tabwright Skills',
  capabilities_description: 'See installed Agent Skills and their safe local Tabwright runtime state.',
  search_label: 'Search',
  search_recordings_placeholder: 'Filter recordings',
  search_capabilities_placeholder: 'Filter Tabwright Skills',
  filter_status_label: 'Filter by status',
  filter_status_all: 'All statuses',
  filter_status_ready: 'Ready',
  filter_status_attention: 'Needs attention',
  filter_status_disabled: 'Disabled',
  metric_replays: 'Replays',
  metric_total_duration: 'Total duration',
  metric_events: 'Events',
  metric_capabilities: 'Skills',
  metric_trusted: 'Available',
  metric_runtimes: 'Installations',
  detail_eyebrow: 'Detail',
  replay_detail_title: 'Replay preview',
  capability_detail_title: 'Tabwright Skill detail',
  select_replay: 'Select a DOM replay.',
  select_capability: 'Select a Tabwright Skill.',
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
  status_loading_capabilities: 'Loading Tabwright Skills...',
  status_service_ready: 'Local service ready',
  status_capability_count_one: '$1 Tabwright Skill',
  status_capability_count_other: '$1 Tabwright Skills and local capabilities',
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
  empty_no_capabilities: 'No installed Tabwright Skills or local capabilities found.',
  empty_no_matches: 'No matches for this search.',
  copy_for_ai: 'Copy for AI',
  copy_skill_context: 'Copy details',
  copy_command: 'Copy command',
  label_ai_context: 'AI context',
  label_skill_context: 'Skill details',
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
  field_description: 'Purpose',
  field_when_to_use: 'When to use',
  field_when_not_to_use: 'When not to use',
  field_match: 'Match',
  field_permissions: 'Permissions',
  field_input: 'Input',
  field_output: 'Output',
  field_autonomy: 'Autonomy',
  field_recent_runs: 'Recent runs',
  field_installed_by: 'Installed by',
  field_installation_paths: 'Installation paths',
  field_runtime_status: 'Local status',
  field_last_run: 'Last run',
  field_local_state: 'Local runtime state',
  field_auth_status: 'Authentication',
  field_artifacts: 'Artifacts',
  field_install_source: 'Installed from',
  field_saved_results: 'Saved results',
  field_runtime: 'Runtime',
  field_effect: 'Side effect',
  skills_summary: '$1 Skills · $2 ready · $3 need attention',
  status_ready: 'Ready',
  status_attention: 'Needs attention',
  status_disabled: 'Disabled',
  last_used: 'Last used $1',
  last_used_never: 'Never used',
  operations_title: 'What it can do',
  operation_group_read: 'Read',
  operation_group_write: 'Changes data',
  operation_group_dangerous: 'High impact',
  operation_confirmation: 'Confirms before running',
  recent_activity_title: 'Recent activity',
  recent_activity_empty: 'No recent activity on this device.',
  runtime_conflict_title: 'Installed copies differ',
  runtime_conflict_description: 'This Skill has different runtime contracts across Agent managers. Check the installed copies before use.',
  diagnostic_details: 'Copy diagnostic details',
  field_routing: 'Routing',
  field_location: 'Location',
  field_contract_health: 'Validation status',
  technical_details: 'Technical details',
  badge_auto_ready: 'Can run automatically',
  badge_needs_confirmation: 'Needs your confirmation',
  badge_partial_confirmation: 'Some actions need confirmation',
  badge_local_draft: 'Local draft',
  badge_validation_expired: 'Needs update',
  badge_disabled: 'Disabled',
  runtime_browser: 'Browser',
  runtime_node: 'Node.js',
  effect_read: 'Read only',
  effect_write: 'Modifies data',
  effect_dangerous: 'High-risk changes',
  effect_mixed: 'Reads and modifies data',
  routing_exact: 'Exact match',
  routing_semantic: 'Semantic match',
  routing_manual: 'Manual',
  location_project: 'Project',
  location_global: 'Global',
  location_skill: 'Agent Skill',
  manager_codex: 'Codex',
  manager_agents: 'Agent Skills',
  manager_claude: 'Claude',
  manager_custom: 'Custom directory',
  scope_project: 'project',
  scope_user: 'user',
  scope_custom: 'custom',
  auth_status_not_required: 'Not required',
  auth_status_missing: 'Not ready',
  auth_status_authenticated: 'Ready',
  auth_status_expiring: 'Expires soon',
  auth_status_expired: 'Expired',
  auth_status_unknown: 'Unknown',
  artifact_count_one: '$1 file',
  artifact_count_other: '$1 files',
  runtime_status_ready: 'Ready to run',
  runtime_status_auto_auth: 'Authentication refreshes when needed',
  runtime_status_auth_required: 'Authentication required',
  runtime_status_auth_expiring: 'Ready · authentication expires soon',
  runtime_status_disabled: 'Disabled locally',
  runtime_status_update: 'Runtime contract needs attention',
  run_never: 'Not run on this device',
  run_success: 'Succeeded',
  run_error: 'Failed',
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
const statusFilter = document.querySelector<HTMLSelectElement>('#status-filter')
const viewEyebrow = document.querySelector<HTMLParagraphElement>('#view-eyebrow')
const viewTitle = document.querySelector<HTMLHeadingElement>('#view-title')
const viewDescription = document.querySelector<HTMLParagraphElement>('#view-description')
const skillsSummary = document.querySelector<HTMLParagraphElement>('#skills-summary')
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

let activeTab: ActiveTab = 'skills'
let selectedReplayId: string | null = null
let selectedCapabilityId: string | null = null
let replayRecordings: SavedReplayRecording[] = []
let capabilities: CapabilityContract[] = []
let replayLoadError: LoadError | null = null
let capabilityLoadError: LoadError | null = null
let relayVersionUpdate: RelayVersionUpdate | null = null
let searchQuery = ''
let capabilityStatusFilter: CapabilityStatusFilter = 'all'
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
    isStringOrUndefined(value.operation) &&
    typeof value.status === 'string' &&
    isStringOrUndefined(value.url) &&
    typeof value.durationMs === 'number' &&
    typeof value.inputHash === 'string' &&
    isStringOrUndefined(value.error) &&
    typeof value.createdAt === 'string'
  )
}

function isCapabilityOperation(value: unknown): value is CapabilityOperation {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    (value.permissions === undefined || isStringArray(value.permissions)) &&
    typeof value.sideEffect === 'string' &&
    typeof value.requiresConfirmation === 'boolean'
  )
}

function normalizeCapabilityOperations(value: unknown): Record<string, CapabilityOperation> {
  if (!isRecord(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, operation]) => {
      if (!isCapabilityOperation(operation)) {
        return []
      }
      return [
        [
          id,
          {
            ...operation,
            permissions: operation.permissions || [],
          },
        ],
      ]
    }),
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

function isAgentSkillManager(value: unknown): value is AgentSkillManager {
  return value === 'codex' || value === 'agents' || value === 'claude' || value === 'custom'
}

function isAgentSkillScope(value: unknown): value is AgentSkillScope {
  return value === 'project' || value === 'user' || value === 'custom'
}

function isCapabilityAuthStatus(value: unknown): value is CapabilityAuthStatus {
  return (
    value === 'not-required' ||
    value === 'missing' ||
    value === 'authenticated' ||
    value === 'expiring' ||
    value === 'expired' ||
    value === 'unknown'
  )
}

function isAgentSkillInstallation(value: unknown): value is AgentSkillInstallation {
  return (
    isRecord(value) &&
    isAgentSkillManager(value.manager) &&
    isAgentSkillScope(value.scope) &&
    typeof value.skillDir === 'string' &&
    typeof value.runtimeDir === 'string'
  )
}

function isAgentSkillMetadata(value: unknown): value is AgentSkillMetadata {
  if (!isRecord(value) || !Array.isArray(value.installations) || !isRecord(value.localState)) {
    return false
  }
  if (!isRecord(value.localState.auth)) {
    return false
  }
  return (
    value.installations.every(isAgentSkillInstallation) &&
    (value.hasRuntimeConflict === undefined || typeof value.hasRuntimeConflict === 'boolean') &&
    typeof value.localState.stateDir === 'string' &&
    typeof value.localState.auth.type === 'string' &&
    isCapabilityAuthStatus(value.localState.auth.status) &&
    typeof value.localState.auth.canRefresh === 'boolean' &&
    isStringOrUndefined(value.localState.auth.refreshedAt) &&
    isStringOrUndefined(value.localState.auth.expiresAt) &&
    typeof value.localState.artifactCount === 'number'
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
  const unsupportedReason = UNSUPPORTED_LIFECYCLE_REASON
  return {
    ...value,
    operations: normalizeCapabilityOperations(value.operations),
    autonomousInvocation: hasUnsupportedLifecycle
      ? { allowed: false, reasons: [unsupportedReason] }
      : value.autonomousInvocation,
    recentRuns: value.recentRuns.filter(isCapabilityRunRecord),
    agentSkill: isAgentSkillMetadata(value.agentSkill)
      ? { ...value.agentSkill, hasRuntimeConflict: value.agentSkill.hasRuntimeConflict || false }
      : undefined,
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
      currentVersion && isRelayVersionOutdated({ currentVersion, requiredVersion: __PLAYWRITER_VERSION__ })
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
    ...(capability.agentSkill?.installations.flatMap((installation) => {
      return [installation.manager, installation.scope, installation.skillDir, installation.runtimeDir]
    }) || []),
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
  return capabilities.filter((capability) => {
    const matchesSearch = !searchQuery || capabilitySearchText(capability).toLowerCase().includes(searchQuery)
    const matchesStatus =
      capabilityStatusFilter === 'all' || capabilityViewState(capability) === capabilityStatusFilter
    return matchesSearch && matchesStatus
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
  const installationCount = capabilities.reduce((count, capability) => {
    return count + (capability.agentSkill?.installations.length || 1)
  }, 0)
  setText(metricTertiaryValue, String(installationCount))
  const readyCount = capabilities.filter((capability) => {
    return capabilityViewState(capability) === 'ready'
  }).length
  setText(skillsSummary, msg('skills_summary', [String(capabilities.length), String(readyCount), String(capabilities.length - readyCount)]))
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
  setStatus(loadErrorText(capabilityLoadError) || msg('status_service_ready'))
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
  if (effect === 'mixed') return msg('effect_mixed')
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
  if (location === 'global' || location === 'user') return msg('location_global')
  if (location === 'skill') return msg('location_skill')
  return location
}

function agentSkillManagerLabel(manager: AgentSkillManager): string {
  if (manager === 'codex') return msg('manager_codex')
  if (manager === 'agents') return msg('manager_agents')
  if (manager === 'claude') return msg('manager_claude')
  return msg('manager_custom')
}

function agentSkillScopeLabel(scope: AgentSkillScope): string {
  if (scope === 'project') return msg('scope_project')
  if (scope === 'user') return msg('scope_user')
  return msg('scope_custom')
}

function agentSkillInstallationSummary(capability: CapabilityContract): string {
  if (!capability.agentSkill) {
    return locationLabel(capability.location)
  }
  return capability.agentSkill.installations
    .map((installation) => {
      return `${agentSkillManagerLabel(installation.manager)} (${agentSkillScopeLabel(installation.scope)})`
    })
    .join(', ')
}

function agentSkillInstallationDetails(capability: CapabilityContract): string {
  if (!capability.agentSkill) {
    return locationLabel(capability.location)
  }
  return capability.agentSkill.installations
    .map((installation) => {
      return `${agentSkillManagerLabel(installation.manager)} (${agentSkillScopeLabel(installation.scope)})\n${installation.skillDir}`
    })
    .join('\n\n')
}

function capabilityAuthStatusLabel(status: CapabilityAuthStatus): string {
  if (status === 'not-required') return msg('auth_status_not_required')
  if (status === 'missing') return msg('auth_status_missing')
  if (status === 'authenticated') return msg('auth_status_authenticated')
  if (status === 'expiring') return msg('auth_status_expiring')
  if (status === 'expired') return msg('auth_status_expired')
  return msg('auth_status_unknown')
}

function artifactCountText(count: number): string {
  return count === 1 ? msg('artifact_count_one', String(count)) : msg('artifact_count_other', String(count))
}

function capabilityViewState(capability: CapabilityContract): CapabilityViewState {
  const lifecycle = resolveCapabilityLifecycle(capability)
  if (lifecycle.stage === 'disabled') {
    return 'disabled'
  }
  if (lifecycle.stage === 'drifted' || capability.agentSkill?.hasRuntimeConflict) {
    return 'attention'
  }
  const auth = capability.agentSkill?.localState.auth
  if (auth && ['missing', 'expired', 'unknown'].includes(auth.status) && !auth.canRefresh) {
    return 'attention'
  }
  const lastTwoRuns = capability.recentRuns.slice(-2)
  if (
    lastTwoRuns.length === 2 &&
    lastTwoRuns.every((run) => {
      return run.status !== 'success'
    })
  ) {
    return 'attention'
  }
  return 'ready'
}

function capabilityViewStateLabel(state: CapabilityViewState): string {
  if (state === 'ready') return msg('status_ready')
  if (state === 'disabled') return msg('status_disabled')
  return msg('status_attention')
}

function capabilityLastRunText(capability: CapabilityContract): string {
  const run = capability.recentRuns.at(-1)
  if (!run) {
    return msg('run_never')
  }
  const timestamp = Date.parse(run.createdAt)
  const createdAt = Number.isNaN(timestamp)
    ? run.createdAt
    : new Date(timestamp).toLocaleString(activeLanguage === 'zh_CN' ? 'zh-CN' : 'en-US')
  const status = run.status === 'success' ? msg('run_success') : msg('run_error')
  return `${status} · ${createdAt} · ${formatDuration(run.durationMs)}`
}

function capabilityLastUsedText(capability: CapabilityContract): string {
  const run = capability.recentRuns.at(-1)
  if (!run) {
    return msg('last_used_never')
  }
  const timestamp = Date.parse(run.createdAt)
  const createdAt = Number.isNaN(timestamp)
    ? run.createdAt
    : new Date(timestamp).toLocaleDateString(activeLanguage === 'zh_CN' ? 'zh-CN' : 'en-US')
  return msg('last_used', createdAt)
}

function capabilityReadinessBadge(capability: CapabilityContract): HTMLSpanElement {
  const state = capabilityViewState(capability)
  return createBadge(capabilityViewStateLabel(state), state)
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
  const agentSkillContext = capability.agentSkill
    ? [
        `${isChineseLocale() ? '安装位置' : 'Installed by'}：${agentSkillInstallationSummary(capability)}`,
        ...capability.agentSkill.installations.map((installation) => {
          return `${agentSkillManagerLabel(installation.manager)}: ${installation.skillDir}`
        }),
        `${isChineseLocale() ? '本地运行态目录' : 'Local runtime state'}：${capability.agentSkill.localState.stateDir}`,
      ]
    : []
  if (isChineseLocale()) {
    return [
      '这是一个 Tabwright Skill。',
      `Capability ID：${capability.id}`,
      `标题：${capability.title}`,
      `描述：${capability.description}`,
      `运行契约目录：${capability.dir}`,
      ...agentSkillContext,
    ].join('\n')
  }

  return [
    'This is a Tabwright Skill.',
    `Capability ID: ${capability.id}`,
    `Title: ${capability.title}`,
    `Description: ${capability.description}`,
    `Runtime contract directory: ${capability.dir}`,
    ...agentSkillContext,
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
  return [
    summary,
    ...lifecycle.contractHealth.reasons.map((reason) => {
      return reason === UNSUPPORTED_LIFECYCLE_REASON ? msg('lifecycle_unsupported') : reason
    }),
  ].join('\n')
}

function createDiagnosticActions(capability: CapabilityContract): HTMLDivElement {
  const actions = document.createElement('div')
  actions.className = 'technical-actions'

  const copyForAi = document.createElement('button')
  copyForAi.type = 'button'
  copyForAi.textContent = msg('diagnostic_details')
  copyForAi.addEventListener('click', () => {
    copyWithStatus({ label: msg('label_skill_context'), text: capabilityAiContextText(capability) })
  })

  actions.replaceChildren(copyForAi)
  return actions
}

function capabilityOperationEntries(capability: CapabilityContract): Array<[string, CapabilityOperation]> {
  const entries = Object.entries(capability.operations)
  if (entries.length > 0) {
    return entries
  }
  return [
    [
      capability.id,
      {
        title: capability.title,
        description: capability.description,
        permissions: capability.permissions,
        sideEffect: capability.sideEffect,
        requiresConfirmation: capability.requiresConfirmation,
      },
    ],
  ]
}

function operationGroup(effect: string): 'read' | 'write' | 'dangerous' {
  if (effect === 'dangerous') return 'dangerous'
  if (effect === 'write' || effect === 'mixed') return 'write'
  return 'read'
}

function createOperationsSection(capability: CapabilityContract): HTMLElement {
  const section = document.createElement('section')
  section.className = 'product-section'
  const heading = document.createElement('h2')
  heading.className = 'section-heading'
  heading.textContent = msg('operations_title')

  const groups = document.createElement('div')
  groups.className = 'operation-groups'
  const operationCount = capabilityOperationEntries(capability).length
  const groupOrder: Array<'read' | 'write' | 'dangerous'> = ['read', 'write', 'dangerous']
  groups.replaceChildren(
    ...groupOrder.flatMap((group) => {
      const entries = capabilityOperationEntries(capability).filter(([, operation]) => {
        return operationGroup(operation.sideEffect) === group
      })
      if (entries.length === 0) {
        return []
      }
      const groupElement = document.createElement('details')
      groupElement.className = 'operation-group'
      groupElement.open = operationCount <= 12
      const groupHeading = document.createElement('summary')
      groupHeading.className = 'operation-group-summary'
      const groupTitle = document.createElement('strong')
      groupTitle.textContent = msg(
        group === 'read'
          ? 'operation_group_read'
          : group === 'write'
            ? 'operation_group_write'
            : 'operation_group_dangerous',
      )
      const count = document.createElement('span')
      count.textContent = String(entries.length)
      groupHeading.replaceChildren(groupTitle, count)
      const list = document.createElement('div')
      list.className = 'operation-list'
      const createRows = (): HTMLDivElement[] => {
        return entries.map(([id, operation]) => {
          const row = document.createElement('div')
          row.className = 'operation-row'
          const content = document.createElement('div')
          const title = document.createElement('strong')
          title.textContent = operation.title || id
          const description = document.createElement('p')
          description.textContent = operation.description
          content.replaceChildren(title, ...(operation.description ? [description] : []))
          const badges = document.createElement('div')
          badges.className = 'badge-row'
          badges.replaceChildren(
            createBadge(effectLabel(operation.sideEffect), operation.sideEffect),
            ...(operation.requiresConfirmation ? [createBadge(msg('operation_confirmation'), 'write')] : []),
          )
          row.replaceChildren(content, badges)
          return row
        })
      }
      if (groupElement.open) {
        list.replaceChildren(...createRows())
      } else {
        groupElement.addEventListener(
          'toggle',
          () => {
            if (groupElement.open) {
              list.replaceChildren(...createRows())
            }
          },
          { once: true },
        )
      }
      groupElement.replaceChildren(groupHeading, list)
      return [groupElement]
    }),
  )
  section.replaceChildren(heading, groups)
  return section
}

function createRecentActivitySection(capability: CapabilityContract): HTMLElement {
  const section = document.createElement('section')
  section.className = 'product-section'
  const heading = document.createElement('h2')
  heading.className = 'section-heading'
  heading.textContent = msg('recent_activity_title')
  const list = document.createElement('div')
  list.className = 'activity-list'
  const runs = capability.recentRuns.slice(-5).reverse()
  if (runs.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'section-empty'
    empty.textContent = msg('recent_activity_empty')
    list.replaceChildren(empty)
  } else {
    list.replaceChildren(
      ...runs.map((run) => {
        const row = document.createElement('div')
        row.className = 'activity-row'
        const status = document.createElement('span')
        status.className = `activity-status activity-status-${run.status === 'success' ? 'success' : 'error'}`
        status.textContent = run.status === 'success' ? msg('run_success') : msg('run_error')
        const operation = document.createElement('strong')
        operation.textContent = run.operation
          ? capability.operations[run.operation]?.title || run.operation
          : capability.title
        const timestamp = Date.parse(run.createdAt)
        const time = document.createElement('span')
        time.className = 'activity-meta'
        time.textContent = `${Number.isNaN(timestamp) ? run.createdAt : new Date(timestamp).toLocaleString(activeLanguage === 'zh_CN' ? 'zh-CN' : 'en-US')} · ${formatDuration(run.durationMs)}`
        row.replaceChildren(status, operation, time)
        return row
      }),
    )
  }
  section.replaceChildren(heading, list)
  return section
}

function createRuntimeConflictNotice(): HTMLElement {
  const notice = document.createElement('div')
  notice.className = 'skill-notice'
  const title = document.createElement('strong')
  title.textContent = msg('runtime_conflict_title')
  const description = document.createElement('p')
  description.textContent = msg('runtime_conflict_description')
  notice.replaceChildren(title, description)
  return notice
}

function createOverviewItem(options: { title: string; value: string }): HTMLDivElement {
  const item = document.createElement('div')
  item.className = 'overview-item'
  const title = document.createElement('h3')
  title.textContent = options.title
  const value = document.createElement('div')
  value.className = 'overview-value'
  value.textContent = options.value
  item.replaceChildren(title, value)
  return item
}

function createCapabilityOverview(capability: CapabilityContract): HTMLElement {
  const overview = document.createElement('section')
  overview.className = 'capability-overview'

  const purpose = document.createElement('div')
  purpose.className = 'capability-purpose'
  const purposeTitle = document.createElement('h3')
  purposeTitle.textContent = msg('field_description')
  const purposeValue = document.createElement('p')
  purposeValue.textContent = capability.description || displayList(capability.whenToUse, '-')
  purpose.replaceChildren(purposeTitle, purposeValue)

  const summary = document.createElement('div')
  summary.className = 'overview-grid'
  summary.replaceChildren(
    createOverviewItem({
      title: msg('field_install_source'),
      value: agentSkillInstallationSummary(capability),
    }),
    createOverviewItem({
      title: msg('field_last_run'),
      value: capabilityLastRunText(capability),
    }),
    createOverviewItem({
      title: msg('field_saved_results'),
      value: artifactCountText(capability.agentSkill?.localState.artifactCount || 0),
    }),
  )
  overview.replaceChildren(purpose, summary)
  return overview
}

function renderCapabilityDetail(capability: CapabilityContract): void {
  if (!skillDetail) return
  const lifecycle = resolveCapabilityLifecycle(capability)

  const header = document.createElement('div')
  header.className = 'skill-header'

  const title = document.createElement('h2')
  title.textContent = capability.title

  const badges = document.createElement('div')
  badges.className = 'badge-row'
  badges.replaceChildren(
    capabilityReadinessBadge(capability),
    createBadge(effectLabel(capability.sideEffect), capability.sideEffect),
  )

  header.replaceChildren(title, badges)

  const advancedDetails = document.createElement('details')
  advancedDetails.className = 'advanced-details'
  const advancedSummary = document.createElement('summary')
  advancedSummary.textContent = msg('technical_details')
  const advancedFields = document.createElement('div')
  advancedFields.className = 'field-grid'
  const localStateFields: HTMLDivElement[] = capability.agentSkill
    ? [
        createField({
          title: msg('field_auth_status'),
          value: capabilityAuthStatusLabel(capability.agentSkill.localState.auth.status),
        }),
        createField({
          title: msg('field_local_state'),
          value: capability.agentSkill.localState.stateDir,
          full: true,
        }),
      ]
    : []
  const installationFields: HTMLDivElement[] = capability.agentSkill
    ? [
        createField({
          title: msg('field_installation_paths'),
          value: agentSkillInstallationDetails(capability),
          full: true,
        }),
      ]
    : []
  const commandFields: HTMLDivElement[] = capability.agentSkill
    ? []
    : [createCapabilityCommandField({ command: lifecycle.nextCommand })]
  const registryFields: HTMLDivElement[] = capability.agentSkill
    ? []
    : [
        createField({ title: msg('field_routing'), value: routingLabel(capability.routingHint) }),
        createField({ title: msg('field_location'), value: locationLabel(capability.location) }),
      ]
  const optionalContractFields: HTMLDivElement[] = [
    ...(capability.whenToUse.length > 0
      ? [createField({ title: msg('field_when_to_use'), value: displayList(capability.whenToUse, '-'), full: true })]
      : []),
    ...(capability.whenNotToUse.length > 0
      ? [
          createField({
            title: msg('field_when_not_to_use'),
            value: displayList(capability.whenNotToUse, '-'),
            full: true,
          }),
        ]
      : []),
    ...(capability.match.length > 0
      ? [createField({ title: msg('field_match'), value: displayList(capability.match, '-') })]
      : []),
    ...(capability.permissions.length > 0
      ? [createField({ title: msg('field_permissions'), value: displayList(capability.permissions, '-') })]
      : []),
  ]
  advancedFields.replaceChildren(
    ...commandFields,
    createField({ title: msg('field_contract_health'), value: lifecycleHealthMessage(lifecycle), full: true }),
    ...installationFields,
    ...localStateFields,
    createField({ title: msg('field_runtime'), value: runtimeLabel(capability.runtime) }),
    createField({ title: msg('field_effect'), value: effectLabel(capability.sideEffect) }),
    createField({ title: msg('detail_path'), value: capability.dir, full: true }),
    ...registryFields,
    ...optionalContractFields,
    createField({ title: msg('field_input'), value: schemaSummary(capability.inputSchema) }),
    createField({ title: msg('field_output'), value: schemaSummary(capability.outputSchema) }),
  )
  const diagnosticActions = createDiagnosticActions(capability)
  advancedDetails.replaceChildren(advancedSummary, diagnosticActions, advancedFields)

  skillDetail.replaceChildren(
    header,
    ...(capability.agentSkill?.hasRuntimeConflict ? [createRuntimeConflictNotice()] : []),
    createCapabilityOverview(capability),
    createOperationsSection(capability),
    createRecentActivitySection(capability),
    advancedDetails,
  )
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

  const footer = document.createElement('div')
  footer.className = 'skill-list-footer'
  const installation = document.createElement('span')
  installation.textContent = agentSkillInstallationSummary(capability)
  const lastUsed = document.createElement('span')
  lastUsed.textContent = capabilityLastUsedText(capability)
  footer.replaceChildren(installation, lastUsed)

  item.replaceChildren(title, meta, badges, footer)
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
  capabilities = parsed.capabilities
  capabilityLoadError = null
  renderCapabilities()
  updateRelayReviewWarning()
  if (!options.silent) {
    setStatus(msg('status_service_ready'))
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

statusFilter?.addEventListener('change', () => {
  const value = statusFilter.value
  if (value !== 'all' && value !== 'ready' && value !== 'attention' && value !== 'disabled') {
    return
  }
  capabilityStatusFilter = value
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
  setActiveTab('skills')
  await loadRelayVersion()
  await loadCapabilities()
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
