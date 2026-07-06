import { getSavedRrwebRecordingWithEvents } from './rrweb-recording-relay.js'
import { buildReplayAiIndex } from './replay-ai-index.js'
import { saveWorkflowCapability, type SavedWorkflowCapability } from './workflow-capability.js'
import type { RrwebEvent } from './protocol.js'

type ReplayNodeType = 2 | 3

interface ReplayDomNode {
  id: number
  type: ReplayNodeType
  tagName?: string
  textContent?: string
  attributes: Record<string, string>
  childIds: number[]
  parentId?: number
}

interface ReplayClick {
  timestamp: number
  nodeId: number
  text: string
  tagName?: string
}

interface ReplayInput {
  timestamp: number
  nodeId: number
  value: string
  tagName?: string
}

export interface ReplayWorkflowAnalysis {
  replayId: string
  url?: string
  demonstratedValue?: string
  clickedTexts: string[]
  inputValues: string[]
  annotations: Array<{
    text: string
    target?: string
    selectorHints: string[]
  }>
  actionKind: 'list-append' | 'unknown'
  draftDialogAction?: 'continue' | 'restart'
  confidence: 'low' | 'medium' | 'high'
  reasons: string[]
}

export interface CompileReplayWorkflowOptions {
  replayId: string
  id: string
  title?: string
  description?: string
  cwd?: string
  overwrite?: boolean
  valueInputPath?: string
}

export interface CompiledReplayWorkflow {
  analysis: ReplayWorkflowAnalysis
  saved: SavedWorkflowCapability
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

function normalizeText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim()
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

function getEventTimestamp(event: RrwebEvent): number {
  return numberValue(event.timestamp) || 0
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
  const type = numberValue(rawNode.type)
  if (!id || (type !== 2 && type !== 3)) {
    return null
  }
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

function addReplayNode(nodes: Map<number, ReplayDomNode>, rawNode: unknown, parentId?: number): void {
  const node = readReplayNode(rawNode, parentId)
  const childNodes = isRecord(rawNode) && Array.isArray(rawNode.childNodes) ? rawNode.childNodes : []
  if (!node && childNodes.length === 0) {
    return
  }
  if (!node) {
    childNodes.forEach((child) => {
      addReplayNode(nodes, child, parentId)
    })
    return
  }
  nodes.set(node.id, node)
  childNodes.forEach((child) => {
    addReplayNode(nodes, child, node.id)
  })
}

function removeReplayNode(nodes: Map<number, ReplayDomNode>, nodeId: number): void {
  const node = nodes.get(nodeId)
  if (!node) {
    return
  }
  node.childIds.forEach((childId) => {
    removeReplayNode(nodes, childId)
  })
  nodes.delete(nodeId)
}

function applyMutationEvent(nodes: Map<number, ReplayDomNode>, data: Record<string, unknown>): void {
  const removes = Array.isArray(data.removes) ? data.removes : []
  removes
    .map((remove) => {
      return isRecord(remove) ? numberValue(remove.id) : undefined
    })
    .filter((nodeId): nodeId is number => {
      return nodeId !== undefined
    })
    .forEach((nodeId) => {
      removeReplayNode(nodes, nodeId)
    })

  const adds = Array.isArray(data.adds) ? data.adds : []
  adds.forEach((add) => {
    if (!isRecord(add)) {
      return
    }
    const parentId = numberValue(add.parentId)
    addReplayNode(nodes, add.node, parentId)
  })

  const texts = Array.isArray(data.texts) ? data.texts : []
  texts.forEach((text) => {
    if (!isRecord(text)) {
      return
    }
    const nodeId = numberValue(text.id)
    const node = nodeId === undefined ? undefined : nodes.get(nodeId)
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
    const node = nodeId === undefined ? undefined : nodes.get(nodeId)
    if (!node) {
      return
    }
    node.attributes = {
      ...node.attributes,
      ...recordToStringMap(attribute.attributes),
    }
  })
}

function nodeText(nodes: Map<number, ReplayDomNode>, nodeId: number): string {
  const node = nodes.get(nodeId)
  if (!node) {
    return ''
  }
  const childText = node.childIds
    .map((childId) => {
      return nodeText(nodes, childId)
    })
    .filter((text) => {
      return text.length > 0
    })
    .join(' ')
  return normalizeText([node.textContent, childText].filter(Boolean).join(' '))
}

function nodeAndAncestors(nodes: Map<number, ReplayDomNode>, nodeId: number, maxDepth: number): ReplayDomNode[] {
  const current = nodes.get(nodeId)
  if (!current) {
    return []
  }
  const ancestors: ReplayDomNode[] = [current]
  let next = current.parentId === undefined ? undefined : nodes.get(current.parentId)
  let depth = 1
  while (next && depth < maxDepth) {
    ancestors.push(next)
    next = next.parentId === undefined ? undefined : nodes.get(next.parentId)
    depth += 1
  }
  return ancestors
}

function actionLabelFromText(value: string): string | undefined {
  const text = normalizeText(value)
  if (!text || text.length > 80) {
    return undefined
  }
  if (/to pick up a draggable item/i.test(text)) {
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
    { label: '编辑', pattern: /编辑|\bedit\b/i },
  ]
  return matchers.find((matcher) => {
    return matcher.pattern.test(text)
  })?.label
}

function clickLabelFromStructure(nodes: Map<number, ReplayDomNode>, nodeId: number): string | undefined {
  const ancestors = nodeAndAncestors(nodes, nodeId, 8)
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

function nearestText(nodes: Map<number, ReplayDomNode>, nodeId: number): string {
  const structuredLabel = clickLabelFromStructure(nodes, nodeId)
  if (structuredLabel) {
    return structuredLabel
  }
  const candidates = nodeAndAncestors(nodes, nodeId, 8)
    .map((node) => {
      return nodeText(nodes, node.id)
    })
    .filter((text) => {
      return text.length > 0
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
  return ''
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => {
    return value.length > 0
  })))
}

function lastNonEmpty(values: string[]): string | undefined {
  return values
    .slice()
    .reverse()
    .find((value) => {
      return value.length > 0
    })
}

function detectActionKind(options: { clickedTexts: string[]; inputValues: string[] }): ReplayWorkflowAnalysis['actionKind'] {
  const clicked = options.clickedTexts.join('\n').toLowerCase()
  const hasAdd = clicked.includes('add entry') || clicked.includes('新增') || clicked.includes('添加')
  const hasSubmit = clicked.includes('提交') || clicked.includes('submit')
  if (hasAdd && hasSubmit && lastNonEmpty(options.inputValues)) {
    return 'list-append'
  }
  return 'unknown'
}

function isWorkflowClickLabel(value: string): boolean {
  return /编辑|重新编辑|继续编辑|\bedit\b|add entry|新增|添加|提交|submit|\bOK\b|确定|cancel|取消/i.test(value)
}

export function analyzeReplayWorkflow(options: {
  replayId: string
  url?: string
  events: RrwebEvent[]
}): ReplayWorkflowAnalysis {
  const aiIndex = buildReplayAiIndex(options)
  const clickedTexts = uniqueStrings(
    aiIndex.actions
      .filter((action) => {
        return action.kind === 'click' && isWorkflowClickLabel(action.label)
      })
      .map((action) => {
        return action.label
      }),
  )
  const inputValues = uniqueStrings(
    aiIndex.actions
      .filter((action) => {
        return action.kind === 'input'
      })
      .map((action) => {
        return normalizeText(action.value)
      }),
  )
  const actionKind = detectActionKind({ clickedTexts, inputValues })
  const demonstratedValue = lastNonEmpty(inputValues)
  const annotations = aiIndex.annotations.map((annotation) => {
    return {
      text: annotation.text,
      target: annotation.target?.label || annotation.target?.text || annotation.target?.tagName,
      selectorHints: annotation.target?.selectorHints || [],
    }
  })
  const draftDialogAction = clickedTexts.some((text) => {
    return text.includes('重新编辑')
  })
    ? 'restart'
    : clickedTexts.some((text) => {
        return text.includes('继续编辑')
      })
      ? 'continue'
      : undefined
  const reasons = [
    clickedTexts.length > 0 ? `Observed clicks: ${clickedTexts.join(' -> ')}` : 'No click text could be inferred.',
    demonstratedValue ? `Observed final input value: ${demonstratedValue}` : 'No final input value could be inferred.',
    annotations.length > 0 ? `Observed user annotations: ${annotations.map((annotation) => {
      return annotation.text
    }).join(' | ')}` : 'No user annotations were recorded.',
    actionKind === 'list-append' ? 'Detected list append pattern.' : 'Could not classify the replay into a known workflow template.',
  ]
  return {
    replayId: options.replayId,
    url: options.url,
    demonstratedValue,
    clickedTexts,
    inputValues,
    annotations,
    actionKind,
    draftDialogAction,
    confidence: actionKind === 'list-append' && demonstratedValue ? 'high' : clickedTexts.length > 0 ? 'medium' : 'low',
    reasons,
  }
}

function literal(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildListAppendScript(analysis: ReplayWorkflowAnalysis, options: CompileReplayWorkflowOptions): string {
  const valueInputPath = options.valueInputPath || 'value'
  const replayUrl = analysis.url || ''
  const pageKey = (() => {
    if (!replayUrl) {
      return ''
    }
    try {
      const url = new URL(replayUrl)
      const directKey = url.searchParams.get('key')
      if (directKey) {
        return directKey
      }
      const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : ''
      return new URLSearchParams(hashQuery).get('key') || ''
    } catch {
      return ''
    }
  })()
  const draftDialogAction = analysis.draftDialogAction || 'restart'
  return [
    '// Generated by replayWorkflow.compile: execute the inferred user flow first, return needs_ai on drift.',
    `const replayAnalysis = ${literal(analysis)};`,
    `const replayUrl = ${literal(replayUrl)};`,
    `const expectedPageKey = ${literal(pageKey)};`,
    `const valueInputPath = ${literal(valueInputPath)};`,
    `const draftDialogAction = ${literal(draftDialogAction)};`,
    '',
    'function getPathValue(source, path) {',
    '  const parts = String(path || "").split(".").filter((part) => part.length > 0);',
    '  return parts.reduce((current, part) => {',
    '    if (!current || typeof current !== "object") return undefined;',
    '    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;',
    '    return current[part];',
    '  }, source);',
    '}',
    '',
    'function errorMessage(error) {',
    '  if (error && typeof error === "object" && typeof error.message === "string") return error.message;',
    '  return String(error);',
    '}',
    '',
    'async function readSnapshotText() {',
    '  if (typeof snapshot !== "function") return undefined;',
    '  try {',
    '    const value = await snapshot({ page });',
    '    return (typeof value === "string" ? value : JSON.stringify(value, null, 2)).slice(0, 12000);',
    '  } catch (error) {',
    '    return "snapshot failed: " + errorMessage(error);',
    '  }',
    '}',
    '',
    'async function needsAi(reason, extra) {',
    '  return {',
    '    status: "needs_ai",',
    '    reason,',
    '    replayAnalysis,',
    '    ...extra,',
    '    context: {',
    '      url: page.url(),',
    '      title: await page.title().catch(() => ""),',
    '      snapshot: await readSnapshotText(),',
    '    },',
    '  };',
    '}',
    '',
    'async function countVisible(locator) {',
    '  return await locator.evaluateAll((nodes) => nodes.filter((node) => {',
    '    return Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);',
    '  }).length);',
    '}',
    '',
    'async function clickFirstVisible(candidates, phase) {',
    '  for (let index = 0; index < candidates.length; index += 1) {',
    '    const selector = candidates[index];',
    '    const locator = page.locator(selector);',
    '    if (await countVisible(locator).catch(() => 0)) {',
    '      await locator.first().click();',
    '      return { status: "ok", selector };',
    '    }',
    '  }',
    '  return await needsAi("Expected clickable target was not visible.", { phase, candidates });',
    '}',
    '',
    'async function dialogText() {',
    '  const dialog = page.locator(".designer-modal, .ant-modal, [role=dialog]").last();',
    '  if (!(await countVisible(dialog).catch(() => 0))) return "";',
    '  return await dialog.innerText().catch(() => "");',
    '}',
    '',
    'async function waitForConfigValue(value) {',
    '  const detailResponse = await page.waitForResponse((response) => {',
    '    return response.url().includes("/enhancedConfigs/detail?id=") && response.status() === 200;',
    '  }, { timeout: 15000 }).catch((error) => {',
    '    return { error };',
    '  });',
    '  if (detailResponse && detailResponse.error) {',
    '    return { status: "unknown", error: errorMessage(detailResponse.error) };',
    '  }',
    '  try {',
    '    const body = await detailResponse.json();',
    '    const configValue = body && body.data && body.data.config ? body.data.config.value : "";',
    '    return { status: String(configValue).includes(value) ? "matched" : "mismatch", value: configValue };',
    '  } catch (error) {',
    '    return { status: "unknown", error: errorMessage(error) };',
    '  }',
    '}',
    '',
    'const itemValue = String(getPathValue(input, valueInputPath) ?? input.value ?? input.text ?? "").trim();',
    'if (!itemValue) {',
    '  return await needsAi("Missing input value for replay-generated workflow.", { phase: "input", valueInputPath });',
    '}',
    'if (replayUrl && expectedPageKey && !page.url().includes(expectedPageKey)) {',
    '  await page.goto(replayUrl);',
    '  await page.waitForLoadState("domcontentloaded").catch(() => undefined);',
    '}',
    'if (replayUrl && !expectedPageKey && page.url() === "about:blank") {',
    '  await page.goto(replayUrl);',
    '  await page.waitForLoadState("domcontentloaded").catch(() => undefined);',
    '}',
    'if (expectedPageKey && !page.url().includes(expectedPageKey)) {',
    '  return await needsAi("Current page does not match replay target config.", { phase: "page-check", expectedPageKey });',
    '}',
    'if (await page.locator(`text=${itemValue}`).count()) {',
    '  return { status: "completed", reason: "value already exists", value: itemValue, replayAnalysis };',
    '}',
    '',
    'const alreadyEditing =',
    '  (await countVisible(page.locator("button:has-text(\\"提交\\")")).catch(() => 0)) > 0 ||',
    '  (await countVisible(page.locator("button:has-text(\\"Submit\\")")).catch(() => 0)) > 0 ||',
    '  (await countVisible(page.locator(".designer-formily-array-base-addition")).catch(() => 0)) > 0;',
    'if (!alreadyEditing) {',
    '  const editResult = await clickFirstVisible([',
    '    "button:has-text(\\"编辑\\")",',
    '    "button:has-text(\\"Edit\\")",',
    '    "button:has-text(\\"重新编辑\\")",',
    '    "button:has-text(\\"Restart\\")",',
    '  ], "enter-edit");',
    '  if (editResult.status !== "ok") return editResult;',
    '  await page.waitForTimeout(800);',
    '',
    '  const draftText = await dialogText();',
    '  if (draftText.includes("继续编辑上次修改") || /continue previous edit|draft/i.test(draftText)) {',
    '    const draftResult = draftDialogAction === "continue"',
    '      ? await clickFirstVisible(["button:has-text(\\"继续编辑\\")", "button:has-text(\\"Continue\\")"], "draft-dialog")',
    '      : await clickFirstVisible(["button:has-text(\\"重新编辑\\")", "button:has-text(\\"Restart\\")"], "draft-dialog");',
    '    if (draftResult.status !== "ok") return draftResult;',
    '    await page.waitForTimeout(800);',
    '  }',
    '}',
    '',
    'const designerInputs = page.locator("textarea.designer-input");',
    'const beforeValues = await designerInputs.evaluateAll((nodes) => nodes.map((node) => node.value));',
    'const addResult = await clickFirstVisible([',
    '  "button:has-text(\\"Add entry\\")",',
    '  "button:has-text(\\"新增\\")",',
    '  "button:has-text(\\"添加\\")",',
    '  ".designer-formily-array-base-addition",',
    '], "add-entry");',
    'if (addResult.status !== "ok") return addResult;',
    'await page.waitForTimeout(500);',
    'const afterAddCount = await designerInputs.count();',
    'if (afterAddCount <= beforeValues.length) {',
    '  return await needsAi("Add entry did not create a new list input.", { phase: "add-entry", beforeValues, afterAddCount });',
    '}',
    'const targetInput = designerInputs.nth(afterAddCount - 1);',
    'await targetInput.fill(itemValue);',
    'const afterValues = await designerInputs.evaluateAll((nodes) => nodes.map((node) => node.value));',
    'if (!afterValues.includes(itemValue)) {',
    '  return await needsAi("Filled value was not present in list inputs.", { phase: "fill", afterValues, itemValue });',
    '}',
    '',
    'const submitResult = await clickFirstVisible(["button:has-text(\\"提交\\")", "button:has-text(\\"Submit\\")"], "submit");',
    'if (submitResult.status !== "ok") return submitResult;',
    'await page.waitForTimeout(500);',
    'const confirmText = await dialogText();',
    'if (!confirmText.includes(itemValue)) {',
    '  return await needsAi("Confirm diff does not include the new value.", { phase: "confirm-dialog", confirmText, itemValue });',
    '}',
    '',
    'const updatePromise = page.waitForResponse((response) => {',
    '  return response.url().includes("/enhancedConfigs/update") && response.request().method() === "POST";',
    '}, { timeout: 15000 }).catch((error) => {',
    '  return { error };',
    '});',
    'const publishPromise = page.waitForResponse((response) => {',
    '  return response.url().includes("/enhancedConfigs/publish") && response.request().method() === "POST";',
    '}, { timeout: 15000 }).catch((error) => {',
    '  return { error };',
    '});',
    'const detailPromise = waitForConfigValue(itemValue);',
    'const okResult = await clickFirstVisible(["button:has-text(\\"OK\\")", "button:has-text(\\"确定\\")"], "confirm-ok");',
    'if (okResult.status !== "ok") return okResult;',
    'const updateResponse = await updatePromise;',
    'if (updateResponse && updateResponse.error) {',
    '  return await needsAi("Update request was not observed.", { phase: "update-request", error: errorMessage(updateResponse.error) });',
    '}',
    'const publishResponse = await publishPromise;',
    'if (publishResponse && publishResponse.error) {',
    '  return await needsAi("Publish request was not observed.", { phase: "publish-request", error: errorMessage(publishResponse.error) });',
    '}',
    'const updateBody = await updateResponse.json().catch(() => null);',
    'const publishBody = await publishResponse.json().catch(() => null);',
    'if (!updateBody || updateBody.code !== 0) {',
    '  return await needsAi("Update request returned an unexpected body.", { phase: "update-request", updateBody });',
    '}',
    'if (!publishBody || publishBody.code !== 0 || publishBody.data !== true) {',
    '  return await needsAi("Publish request returned an unexpected body.", { phase: "publish-request", publishBody });',
    '}',
    'const detail = await detailPromise;',
    'if (detail.status === "mismatch") {',
    '  return await needsAi("Detail response does not contain the new value.", { phase: "verify", detail, itemValue });',
    '}',
    'return {',
    '  status: "completed",',
    '  value: itemValue,',
    '  replayAnalysis,',
    '  update: { status: updateResponse.status(), body: updateBody },',
    '  publish: { status: publishResponse.status(), body: publishBody },',
    '  detail,',
    '};',
    '',
  ].join('\n')
}

export function compileReplayWorkflow(options: CompileReplayWorkflowOptions): CompiledReplayWorkflow {
  const replay = getSavedRrwebRecordingWithEvents(options.replayId)
  if (!replay) {
    throw new Error(`Replay recording not found: ${options.replayId}`)
  }
  const analysis = analyzeReplayWorkflow({
    replayId: options.replayId,
    url: replay.recording.url,
    events: replay.events,
  })
  if (analysis.actionKind !== 'list-append') {
    throw new Error(`Replay compiler could not infer a supported workflow: ${analysis.reasons.join(' ')}`)
  }
  const script = buildListAppendScript(analysis, options)
  const saved = saveWorkflowCapability({
    id: options.id,
    title: options.title || `Workflow from replay ${options.replayId}`,
    description:
      options.description ||
      'Compiled from an rrweb replay. Appends a list item, submits, publishes, and returns needs_ai on page drift.',
    script,
    cwd: options.cwd,
    location: 'project',
    overwrite: options.overwrite,
    sourceRecordingId: options.replayId,
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
      required: ['value'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        value: { type: 'string' },
      },
    },
    match: replay.recording.url ? [replay.recording.url] : [],
    tags: ['rrweb-replay-compiled'],
  })
  return { analysis, saved }
}
