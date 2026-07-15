import fs from 'node:fs'
import path from 'node:path'
import { getTabwrightUserDataDir } from './product-paths.js'
import { getSavedRrwebRecordingWithEvents } from './rrweb-recording-relay.js'
import type { RrwebEvent } from './protocol.js'

// rrweb.record already stores rrweb-snapshot serialized DOM nodes in full snapshots and mutation adds.
// This index keeps raw replay as evidence and derives AI-readable labels, fields, and selector hints; rrweb ids are recording-scoped, not future selectors.
type ReplayNodeType = 0 | 1 | 2 | 3 | 4 | 5
type ReplayActionKind = 'click' | 'input'

interface ReplayDomNode {
  id: number
  type: ReplayNodeType
  tagName?: string
  textContent?: string
  attributes: Record<string, string>
  childIds: number[]
  parentId?: number
}

interface ReplayDomState {
  nodes: Map<number, ReplayDomNode>
}

export interface ReplayAiNodeSummary {
  id: number
  type: string
  tagName?: string
  text?: string
  label?: string
  role?: string
  name?: string
  placeholder?: string
  className?: string
  selectorHints: string[]
  ancestorText: string[]
}

export interface ReplayAiAction {
  kind: ReplayActionKind
  timestamp: number
  relativeTime?: number
  nodeId?: number
  label: string
  value?: string
  checked?: boolean
  node?: ReplayAiNodeSummary
}

export interface ReplayAiField {
  key: string
  label: string
  nodeId?: number
  selectorHints: string[]
  value?: string
  checked?: boolean
  actionCount: number
  updatedAt: number
}

export interface ReplayAiIndexStats {
  eventCount: number
  fullSnapshotCount: number
  mutationEventCount: number
  clickEventCount: number
  inputEventCount: number
  annotationCount: number
}

export interface ReplayAiAnnotationRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ReplayAiAnnotationTarget {
  tagName?: string
  label?: string
  text?: string
  role?: string
  name?: string
  placeholder?: string
  selectorHints: string[]
  rect?: ReplayAiAnnotationRect
}

export interface ReplayAiAnnotation {
  id: string
  text: string
  timestamp: number
  relativeTime?: number
  url?: string
  target?: ReplayAiAnnotationTarget
}

export interface ReplayAiIndex {
  schemaVersion: 1
  replayId: string
  url?: string
  generatedAt: number
  stats: ReplayAiIndexStats
  actions: ReplayAiAction[]
  fields: ReplayAiField[]
  annotations: ReplayAiAnnotation[]
  interactiveElements: ReplayAiNodeSummary[]
  pageText: string[]
  warnings: string[]
}

export interface SavedReplayAiIndex {
  id: string
  replayId: string
  path: string
  generatedAt: number
  size: number
  actionCount: number
  fieldCount: number
  url?: string
}

const MAX_AI_ACTIONS = 200
const MAX_INTERACTIVE_ELEMENTS = 120
const MAX_PAGE_TEXTS = 160

function getReplayAiIndexesDir(): string {
  return path.join(getTabwrightUserDataDir(), 'replay-ai-indexes')
}

function getReplayAiIndexesIndexPath(): string {
  return path.join(getReplayAiIndexesDir(), 'index.json')
}

function getReplayAiIndexPath(replayId: string): string {
  return path.join(getReplayAiIndexesDir(), `${replayId}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => {
    return typeof item === 'string' && item.length > 0
  })
}

function normalizeText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => {
    return value.length > 0
  })))
}

function recordToStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => {
        if (typeof item === 'string') {
          return [key, item] as const
        }
        if (typeof item === 'number' || typeof item === 'boolean') {
          return [key, String(item)] as const
        }
        if (isRecord(item)) {
          return [key, JSON.stringify(item)] as const
        }
        return null
      })
      .filter((entry): entry is readonly [string, string] => {
        return Boolean(entry)
      }),
  )
}

function getEventType(event: RrwebEvent): number | undefined {
  return numberValue(event.type)
}

function getEventTimestamp(event: RrwebEvent): number | undefined {
  return numberValue(event.timestamp)
}

function getEventData(event: RrwebEvent): Record<string, unknown> {
  return isRecord(event.data) ? event.data : {}
}

function getNodeId(value: unknown): number | undefined {
  return numberValue(isRecord(value) ? value.id : undefined)
}

function readReplayNode(rawNode: unknown, parentId?: number): ReplayDomNode | null {
  if (!isRecord(rawNode)) {
    return null
  }
  const id = numberValue(rawNode.id)
  const rawType = numberValue(rawNode.type)
  if (!id || rawType === undefined || ![0, 1, 2, 3, 4, 5].includes(rawType)) {
    return null
  }
  const type = rawType as ReplayNodeType
  const childNodes = Array.isArray(rawNode.childNodes) ? rawNode.childNodes : []
  return {
    id,
    type,
    tagName: optionalString(rawNode.tagName)?.toLowerCase(),
    textContent: optionalString(rawNode.textContent),
    attributes: recordToStringMap(rawNode.attributes),
    childIds: childNodes
      .map((child) => {
        return getNodeId(child)
      })
      .filter((nodeId): nodeId is number => {
        return nodeId !== undefined
      }),
    parentId,
  }
}

function addReplayNode(state: ReplayDomState, rawNode: unknown, parentId?: number): void {
  const node = readReplayNode(rawNode, parentId)
  const childNodes = isRecord(rawNode) && Array.isArray(rawNode.childNodes) ? rawNode.childNodes : []
  if (!node && childNodes.length === 0) {
    return
  }
  if (!node) {
    childNodes.forEach((child) => {
      addReplayNode(state, child, parentId)
    })
    return
  }
  state.nodes.set(node.id, node)
  childNodes.forEach((child) => {
    addReplayNode(state, child, node.id)
  })
}

function removeReplayNode(state: ReplayDomState, nodeId: number): void {
  const node = state.nodes.get(nodeId)
  if (!node) {
    return
  }
  node.childIds.forEach((childId) => {
    removeReplayNode(state, childId)
  })
  state.nodes.delete(nodeId)
}

function applyMutationEvent(state: ReplayDomState, data: Record<string, unknown>): void {
  const removes = Array.isArray(data.removes) ? data.removes : []
  removes
    .map((remove) => {
      return isRecord(remove) ? numberValue(remove.id) : undefined
    })
    .filter((nodeId): nodeId is number => {
      return nodeId !== undefined
    })
    .forEach((nodeId) => {
      removeReplayNode(state, nodeId)
    })

  const adds = Array.isArray(data.adds) ? data.adds : []
  adds.forEach((add) => {
    if (!isRecord(add)) {
      return
    }
    addReplayNode(state, add.node, numberValue(add.parentId))
  })

  const texts = Array.isArray(data.texts) ? data.texts : []
  texts.forEach((text) => {
    if (!isRecord(text)) {
      return
    }
    const nodeId = numberValue(text.id)
    const node = nodeId === undefined ? undefined : state.nodes.get(nodeId)
    if (!node) {
      return
    }
    node.textContent = optionalString(text.value) || ''
  })

  const attributes = Array.isArray(data.attributes) ? data.attributes : []
  attributes.forEach((attribute) => {
    if (!isRecord(attribute)) {
      return
    }
    const nodeId = numberValue(attribute.id)
    const node = nodeId === undefined ? undefined : state.nodes.get(nodeId)
    if (!node) {
      return
    }
    node.attributes = {
      ...node.attributes,
      ...recordToStringMap(attribute.attributes),
    }
  })
}

function isNoisyText(value: string): boolean {
  return /to pick up a draggable item/i.test(value) || value === 'SCRIPT_PLACEHOLDER'
}

function nodeText(state: ReplayDomState, nodeId: number, depth = 0): string {
  const node = state.nodes.get(nodeId)
  if (!node || depth > 20) {
    return ''
  }
  const childText = node.childIds
    .map((childId) => {
      return nodeText(state, childId, depth + 1)
    })
    .filter((text) => {
      return text.length > 0
    })
    .join(' ')
  return normalizeText([node.textContent, childText].filter(Boolean).join(' '))
}

function nodeAndAncestors(state: ReplayDomState, nodeId: number, maxDepth: number): ReplayDomNode[] {
  const current = state.nodes.get(nodeId)
  if (!current) {
    return []
  }
  const ancestors: ReplayDomNode[] = [current]
  let next = current.parentId === undefined ? undefined : state.nodes.get(current.parentId)
  let depth = 1
  while (next && depth < maxDepth) {
    ancestors.push(next)
    next = next.parentId === undefined ? undefined : state.nodes.get(next.parentId)
    depth += 1
  }
  return ancestors
}

function actionLabelFromText(value: string): string | undefined {
  const text = normalizeText(value)
  if (!text || text.length > 120 || isNoisyText(text)) {
    return undefined
  }
  const matchers: Array<{ label: string; pattern: RegExp }> = [
    { label: '重新编辑', pattern: /重新编辑/ },
    { label: '继续编辑', pattern: /继续编辑/ },
    { label: 'Add entry', pattern: /add entry/i },
    { label: '新增', pattern: /新增|添加/ },
    { label: '提交', pattern: /提交|submit/i },
    { label: 'OK', pattern: /\bOK\b|确定/ },
    { label: 'Cancel', pattern: /cancel|取消/i },
    { label: '编辑', pattern: /编辑/ },
  ]
  return matchers.find((matcher) => {
    return matcher.pattern.test(text)
  })?.label
}

function nodeLabelFromStructure(state: ReplayDomState, nodeId: number): string | undefined {
  const ancestors = nodeAndAncestors(state, nodeId, 8)
  const classText = ancestors
    .map((node) => {
      return node.attributes.class || ''
    })
    .join(' ')
  const inModal = classText.includes('designer-modal')
  if (classText.includes('designer-formily-array-base-addition')) {
    return 'Add entry'
  }
  if (inModal && classText.includes('designer-btn-dangerous')) {
    return '重新编辑'
  }
  if (inModal && classText.includes('designer-btn-primary')) {
    return 'OK'
  }
  return undefined
}

function nodeLabelFromAttributes(node: ReplayDomNode): string | undefined {
  return (
    optionalString(node.attributes['aria-label']) ||
    optionalString(node.attributes.title) ||
    optionalString(node.attributes.placeholder) ||
    optionalString(node.attributes.name)
  )
}

function nodeLabel(state: ReplayDomState, nodeId: number): string | undefined {
  const structuredLabel = nodeLabelFromStructure(state, nodeId)
  if (structuredLabel) {
    return structuredLabel
  }
  const current = state.nodes.get(nodeId)
  const currentAttributeLabel = current ? nodeLabelFromAttributes(current) : undefined
  if (currentAttributeLabel) {
    return currentAttributeLabel
  }
  const candidates = nodeAndAncestors(state, nodeId, 8)
    .flatMap((node) => {
      return [nodeLabelFromAttributes(node), nodeText(state, node.id)]
    })
    .filter((text): text is string => {
      return Boolean(text)
    })
  const actionLabel = candidates
    .map((text) => {
      return actionLabelFromText(text)
    })
    .find((label) => {
      return Boolean(label)
    })
  if (actionLabel) {
    return actionLabel
  }
  return candidates.find((text) => {
    return text.length <= 120 && !isNoisyText(text)
  })
}

function attrSelector(name: string, value: string): string {
  return `[${name}=${JSON.stringify(value)}]`
}

function selectorHints(node: ReplayDomNode): string[] {
  const tagName = node.tagName || ''
  const className = node.attributes.class || ''
  const classHints = className
    .split(/\s+/)
    .filter((classPart) => {
      return classPart === 'designer-formily-array-base-addition' || classPart === 'designer-input'
    })
    .map((classPart) => {
      return tagName ? `${tagName}.${classPart}` : `.${classPart}`
    })
  return uniqueStrings([
    node.attributes.id ? `#${node.attributes.id}` : '',
    node.attributes['data-testid'] ? attrSelector('data-testid', node.attributes['data-testid']) : '',
    node.attributes['data-test'] ? attrSelector('data-test', node.attributes['data-test']) : '',
    node.attributes.name && tagName ? `${tagName}${attrSelector('name', node.attributes.name)}` : '',
    node.attributes.placeholder && tagName ? `${tagName}${attrSelector('placeholder', node.attributes.placeholder)}` : '',
    node.attributes['aria-label'] && tagName ? `${tagName}${attrSelector('aria-label', node.attributes['aria-label'])}` : '',
    ...classHints,
  ])
}

function nodeTypeName(type: ReplayNodeType): string {
  if (type === 0) {
    return 'document'
  }
  if (type === 1) {
    return 'doctype'
  }
  if (type === 2) {
    return 'element'
  }
  if (type === 3) {
    return 'text'
  }
  if (type === 4) {
    return 'cdata'
  }
  return 'comment'
}

function summarizeNode(state: ReplayDomState, nodeId: number): ReplayAiNodeSummary | undefined {
  const node = state.nodes.get(nodeId)
  if (!node) {
    return undefined
  }
  const text = nodeText(state, nodeId)
  const ancestors = nodeAndAncestors(state, nodeId, 8).slice(1)
  return {
    id: node.id,
    type: nodeTypeName(node.type),
    tagName: node.tagName,
    text: text && text.length <= 240 && !isNoisyText(text) ? text : undefined,
    label: nodeLabel(state, nodeId),
    role: optionalString(node.attributes.role),
    name: optionalString(node.attributes.name),
    placeholder: optionalString(node.attributes.placeholder),
    className: optionalString(node.attributes.class),
    selectorHints: selectorHints(node),
    ancestorText: uniqueStrings(
      ancestors
        .map((ancestor) => {
          return nodeText(state, ancestor.id)
        })
        .filter((ancestorText) => {
          return ancestorText.length > 0 && ancestorText.length <= 160 && !isNoisyText(ancestorText)
        }),
    ).slice(0, 6),
  }
}

function isInteractiveNode(node: ReplayDomNode): boolean {
  const tagName = node.tagName || ''
  const role = node.attributes.role || ''
  const className = node.attributes.class || ''
  return (
    ['button', 'a', 'input', 'textarea', 'select', 'option'].includes(tagName) ||
    ['button', 'textbox', 'checkbox', 'combobox', 'menuitem', 'tab'].includes(role) ||
    className.includes('designer-formily-array-base-addition')
  )
}

function getFirstTimestamp(events: RrwebEvent[]): number | undefined {
  return events
    .map((event) => {
      return getEventTimestamp(event)
    })
    .find((timestamp) => {
      return timestamp !== undefined
    })
}

function buildFields(actions: ReplayAiAction[]): ReplayAiField[] {
  return Object.values(
    actions
      .filter((action) => {
        return action.kind === 'input'
      })
      .reduce<Record<string, ReplayAiField>>((fields, action) => {
        const key = action.nodeId === undefined ? action.label : `rrweb:${action.nodeId}`
        const existing = fields[key]
        return {
          ...fields,
          [key]: {
            key,
            label: action.node?.label || action.label,
            nodeId: action.nodeId,
            selectorHints: uniqueStrings([...(existing?.selectorHints || []), ...(action.node?.selectorHints || [])]),
            value: action.value ?? existing?.value,
            checked: action.checked ?? existing?.checked,
            actionCount: (existing?.actionCount || 0) + 1,
            updatedAt: action.timestamp,
          },
        }
      }, {}),
  ).sort((a, b) => {
    return a.updatedAt - b.updatedAt
  })
}

function extractUrlFromEvent(event: RrwebEvent): string | undefined {
  const data = getEventData(event)
  return optionalString(data.href) || optionalString(data.url)
}

function readAnnotationRect(value: unknown): ReplayAiAnnotationRect | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const x = numberValue(value.x)
  const y = numberValue(value.y)
  const width = numberValue(value.width)
  const height = numberValue(value.height)
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined
  }
  return { x, y, width, height }
}

function readAnnotationTarget(value: unknown): ReplayAiAnnotationTarget | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const selectorHints = stringArrayValue(value.selectorHints)
  const target: ReplayAiAnnotationTarget = {
    tagName: optionalString(value.tagName),
    label: optionalString(value.label),
    text: optionalString(value.text),
    role: optionalString(value.role),
    name: optionalString(value.name),
    placeholder: optionalString(value.placeholder),
    selectorHints,
    rect: readAnnotationRect(value.rect),
  }
  if (
    !target.tagName &&
    !target.label &&
    !target.text &&
    !target.role &&
    !target.name &&
    !target.placeholder &&
    target.selectorHints.length === 0 &&
    !target.rect
  ) {
    return undefined
  }
  return target
}

function readAnnotationEvent(options: {
  data: Record<string, unknown>
  timestamp: number
  relativeTime?: number
}): ReplayAiAnnotation | undefined {
  if (optionalString(options.data.tag) !== 'playwriter.annotation') {
    return undefined
  }
  const payload = isRecord(options.data.payload) ? options.data.payload : {}
  const id = optionalString(payload.id)
  const text = normalizeText(optionalString(payload.text))
  if (!id || !text) {
    return undefined
  }
  return {
    id,
    text,
    timestamp: numberValue(payload.timestamp) || options.timestamp,
    relativeTime: options.relativeTime,
    url: optionalString(payload.url),
    target: readAnnotationTarget(payload.target),
  }
}

function readAnnotationDeleteEvent(options: { data: Record<string, unknown> }): string | undefined {
  if (optionalString(options.data.tag) !== 'playwriter.annotation.delete') {
    return undefined
  }
  const payload = isRecord(options.data.payload) ? options.data.payload : {}
  return optionalString(payload.id)
}

export function buildReplayAiIndex(options: {
  replayId: string
  url?: string
  events: RrwebEvent[]
}): ReplayAiIndex {
  const state: ReplayDomState = { nodes: new Map<number, ReplayDomNode>() }
  const firstTimestamp = getFirstTimestamp(options.events)
  const stats: ReplayAiIndexStats = {
    eventCount: options.events.length,
    fullSnapshotCount: 0,
    mutationEventCount: 0,
    clickEventCount: 0,
    inputEventCount: 0,
    annotationCount: 0,
  }
  const warnings: string[] = []
  const actions: ReplayAiAction[] = []
  const annotationsById: Map<string, ReplayAiAnnotation> = new Map()
  let url = options.url

  options.events.forEach((event) => {
    const eventType = getEventType(event)
    const data = getEventData(event)
    if (!url) {
      url = extractUrlFromEvent(event)
    }
    if (eventType === 2) {
      stats.fullSnapshotCount += 1
      addReplayNode(state, data.node)
      return
    }
    const timestamp = getEventTimestamp(event)
    const relativeTime = firstTimestamp === undefined || timestamp === undefined ? undefined : timestamp - firstTimestamp
    if (eventType === 5) {
      if (timestamp === undefined) {
        warnings.push('Ignored rrweb custom event without timestamp.')
        return
      }
      const deletedAnnotationId = readAnnotationDeleteEvent({ data })
      if (deletedAnnotationId) {
        annotationsById.delete(deletedAnnotationId)
        stats.annotationCount = annotationsById.size
        return
      }
      const annotation = readAnnotationEvent({ data, timestamp, relativeTime })
      if (annotation) {
        annotationsById.set(annotation.id, annotation)
        stats.annotationCount = annotationsById.size
      }
      return
    }
    if (eventType !== 3) {
      return
    }

    const source = numberValue(data.source)
    if (source === 0) {
      stats.mutationEventCount += 1
      applyMutationEvent(state, data)
      return
    }

    if (timestamp === undefined) {
      warnings.push('Ignored rrweb event without timestamp.')
      return
    }

    if (source === 5) {
      stats.inputEventCount += 1
      const nodeId = numberValue(data.id)
      const value = optionalString(data.text) || optionalString(data.value) || ''
      const checked = typeof data.isChecked === 'boolean' ? data.isChecked : undefined
      const node = nodeId === undefined ? undefined : state.nodes.get(nodeId)
      if (node) {
        node.attributes = {
          ...node.attributes,
          value,
        }
      }
      const summary = nodeId === undefined ? undefined : summarizeNode(state, nodeId)
      actions.push({
        kind: 'input',
        timestamp,
        relativeTime,
        nodeId,
        label:
          summary?.label ||
          summary?.placeholder ||
          summary?.name ||
          summary?.selectorHints[0] ||
          (nodeId === undefined ? 'input' : `DOM node #${nodeId}`),
        value,
        checked,
        node: summary,
      })
      return
    }

    if (source === 2 && data.type === 2) {
      stats.clickEventCount += 1
      const nodeId = numberValue(data.id)
      const summary = nodeId === undefined ? undefined : summarizeNode(state, nodeId)
      actions.push({
        kind: 'click',
        timestamp,
        relativeTime,
        nodeId,
        label:
          summary?.label ||
          summary?.text ||
          summary?.selectorHints[0] ||
          (nodeId === undefined ? 'click' : `DOM node #${nodeId}`),
        node: summary,
      })
    }
  })

  const interactiveElements = Array.from(state.nodes.values())
    .filter(isInteractiveNode)
    .map((node) => {
      return summarizeNode(state, node.id)
    })
    .filter((summary): summary is ReplayAiNodeSummary => {
      return Boolean(summary)
    })
    .filter((summary) => {
      return Boolean(summary.label || summary.text || summary.selectorHints.length > 0)
    })
    .slice(0, MAX_INTERACTIVE_ELEMENTS)
  const pageText = uniqueStrings(
    Array.from(state.nodes.values())
      .map((node) => {
        return nodeText(state, node.id)
      })
      .filter((text) => {
        return text.length > 0 && text.length <= 160 && !isNoisyText(text)
      }),
  ).slice(0, MAX_PAGE_TEXTS)

  return {
    schemaVersion: 1,
    replayId: options.replayId,
    url,
    generatedAt: Date.now(),
    stats,
    actions: actions.slice(0, MAX_AI_ACTIONS),
    fields: buildFields(actions),
    annotations: Array.from(annotationsById.values()),
    interactiveElements,
    pageText,
    warnings: uniqueStrings(warnings),
  }
}

export function createReplayAiIndexFromRecording(replayId: string): ReplayAiIndex {
  const replay = getSavedRrwebRecordingWithEvents(replayId)
  if (!replay) {
    throw new Error(`Replay recording not found: ${replayId}`)
  }
  return buildReplayAiIndex({
    replayId,
    url: replay.recording.url,
    events: replay.events,
  })
}

function isSavedReplayAiIndex(value: unknown): value is SavedReplayAiIndex {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.replayId === 'string' &&
    typeof value.path === 'string' &&
    typeof value.generatedAt === 'number' &&
    typeof value.size === 'number' &&
    typeof value.actionCount === 'number' &&
    typeof value.fieldCount === 'number' &&
    (value.url === undefined || typeof value.url === 'string')
  )
}

function readSavedReplayAiIndexes(): SavedReplayAiIndex[] {
  const indexPath = getReplayAiIndexesIndexPath()
  if (!fs.existsSync(indexPath)) {
    return []
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isSavedReplayAiIndex)
  } catch {
    return []
  }
}

function writeSavedReplayAiIndexes(indexes: SavedReplayAiIndex[]): void {
  const dir = getReplayAiIndexesDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(getReplayAiIndexesIndexPath(), `${JSON.stringify(indexes, null, 2)}\n`)
}

export function saveReplayAiIndex(index: ReplayAiIndex): SavedReplayAiIndex {
  const outputPath = getReplayAiIndexPath(index.replayId)
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const payload = `${JSON.stringify(index, null, 2)}\n`
  fs.writeFileSync(outputPath, payload)
  const saved: SavedReplayAiIndex = {
    id: index.replayId,
    replayId: index.replayId,
    path: outputPath,
    generatedAt: index.generatedAt,
    size: Buffer.byteLength(payload),
    actionCount: index.actions.length,
    fieldCount: index.fields.length,
    url: index.url,
  }
  const nextIndexes = [
    saved,
    ...readSavedReplayAiIndexes().filter((existing) => {
      return existing.id !== saved.id
    }),
  ]
  writeSavedReplayAiIndexes(nextIndexes.slice(0, 500))
  return saved
}
