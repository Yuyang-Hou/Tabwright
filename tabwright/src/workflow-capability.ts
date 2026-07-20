import {
  createCapability,
  readCapabilityScript,
  toCapabilitySummary,
  updateCapabilityManifest,
  updateCapabilityScript,
  type CapabilityExample,
  type CapabilityExecutionConfig,
  type CapabilityLocation,
  type CapabilityRecord,
  type CapabilitySideEffect,
} from './capability-registry.js'

export interface SaveWorkflowCapabilityOptions {
  id: string
  title: string
  description?: string
  script: string
  cwd?: string
  location?: CapabilityLocation
  overwrite?: boolean
  sourceRecordingId?: string
  whenToUse?: string[]
  whenNotToUse?: string[]
  match?: string[]
  tags?: string[]
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  examples?: CapabilityExample[]
  sideEffect?: CapabilitySideEffect
  requiresConfirmation?: boolean
  execution?: CapabilityExecutionConfig
}

export interface SavedWorkflowCapability {
  capability: Record<string, unknown>
  script: string
}

type WorkflowValue =
  | {
      inputPath: string
      fallback?: unknown
    }
  | {
      value: unknown
    }

export type RecordingWorkflowStep =
  | {
      action: 'goto'
      url: string | WorkflowValue
    }
  | {
      action: 'fill'
      locator: string
      value: WorkflowValue
    }
  | {
      action: 'click'
      locator: string
    }
  | {
      action: 'setInputFiles'
      locator: string
      path: WorkflowValue
    }
  | {
      action: 'selectOption'
      locator: string
      value: WorkflowValue
    }
  | {
      action: 'waitForURL'
      url: string | WorkflowValue
    }

export interface RecordingWorkflowFinalRequest {
  url: string
  method?: string | string[]
  title?: string
  description?: string
  trigger: RecordingWorkflowStep
}

export interface SaveWorkflowFromRecordingOptions
  extends Omit<SaveWorkflowCapabilityOptions, 'script' | 'sourceRecordingId'> {
  recordingId: string
  steps: RecordingWorkflowStep[]
  finalRequest?: RecordingWorkflowFinalRequest
  batch?: {
    inputPath?: string
    continueOnError?: boolean
  }
}

function workflowTags(options: SaveWorkflowCapabilityOptions): string[] {
  const tags = new Set(['workflow', 'recording-derived', ...(options.tags || [])])
  if (options.sourceRecordingId) {
    tags.add(`recording:${options.sourceRecordingId}`)
  }
  return Array.from(tags)
}

function workflowWhenToUse(options: SaveWorkflowCapabilityOptions): string[] {
  const whenToUse = options.whenToUse || []
  if (whenToUse.length > 0) {
    return whenToUse
  }
  return [
    options.description ||
      `Run the workflow generated from recording ${options.sourceRecordingId || 'a user demonstration'}.`,
  ]
}

function saveScriptCapability(options: SaveWorkflowCapabilityOptions): CapabilityRecord {
  const capability = createCapability({
    id: options.id,
    title: options.title,
    description: options.description,
    location: options.location || 'project',
    cwd: options.cwd,
    overwrite: options.overwrite,
    createdBy: 'ai',
    runtime: 'browser',
  })

  updateCapabilityScript({
    id: capability.manifest.id,
    cwd: options.cwd,
    source: options.script,
  })

  return updateCapabilityManifest({
    id: capability.manifest.id,
    cwd: options.cwd,
    patch: {
      description: options.description || capability.manifest.description,
      whenToUse: workflowWhenToUse(options),
      whenNotToUse: options.whenNotToUse || [],
      match: options.match || [],
      tags: workflowTags(options),
      inputSchema: options.inputSchema || { type: 'object', properties: {}, required: [] },
      outputSchema: options.outputSchema || { type: 'object', properties: {} },
      permissions: ['browser.read', 'browser.write'],
      sideEffect: options.sideEffect || 'write',
      requiresConfirmation: options.requiresConfirmation ?? true,
      execution:
        options.execution ||
        ({
          strategy: 'browser-ui',
          requiresUserBrowser: true,
          humanAssistance: 'on-challenge',
          requirements: ['A signed-in user browser for the recorded website.'],
          observedRequestPatterns: [],
        } satisfies CapabilityExecutionConfig),
      examples: options.examples || [],
      status: 'draft',
      createdBy: 'ai',
      runtime: 'browser',
    },
  })
}

export function saveWorkflowCapability(options: SaveWorkflowCapabilityOptions): SavedWorkflowCapability {
  const capability = saveScriptCapability(options)
  return {
    capability: toCapabilitySummary(capability),
    script: readCapabilityScript({ id: capability.manifest.id, cwd: options.cwd }),
  }
}

function workflowLiteral(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildWorkflowScript(options: SaveWorkflowFromRecordingOptions): string {
  const continueOnError = options.batch?.continueOnError ?? false
  const batchInputPath = options.batch?.inputPath || 'items'

  return [
    '// Generated from a user recording: run fast by default, and return needs_ai when the live page diverges.',
    `const workflowSteps = ${workflowLiteral(options.steps)};`,
    `const finalRequest = ${workflowLiteral(options.finalRequest)};`,
    `const batchInputPath = ${workflowLiteral(batchInputPath)};`,
    `const sourceRecordingId = ${workflowLiteral(options.recordingId)};`,
    `const continueOnError = ${continueOnError ? 'true' : 'false'};`,
    '',
    'function getPathValue(source, path, fallback) {',
    '  if (!path) return fallback;',
    '  const parts = path.split(".").filter((part) => part.length > 0);',
    '  const value = parts.reduce((current, part) => {',
    '    if (!current || typeof current !== "object") return undefined;',
    '    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;',
    '    return current[part];',
    '  }, source);',
    '  return value === undefined ? fallback : value;',
    '}',
    '',
    'function resolveWorkflowValue(item, value) {',
    '  if (typeof value === "string") return value;',
    '  if (!value || typeof value !== "object") return value;',
    '  if (Object.prototype.hasOwnProperty.call(value, "inputPath")) return getPathValue(item, value.inputPath, value.fallback);',
    '  if (Object.prototype.hasOwnProperty.call(value, "value")) return value.value;',
    '  return value;',
    '}',
    '',
    'function errorMessage(error) {',
    '  if (error && typeof error === "object" && typeof error.message === "string") return error.message;',
    '  return String(error);',
    '}',
    '',
    'function escapeRegex(value) {',
    '  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
    '}',
    '',
    'function globToRegExp(pattern) {',
    '  return new RegExp("^" + String(pattern).split("*").map(escapeRegex).join(".*") + "$");',
    '}',
    '',
    'function normalizedMethods(method) {',
    '  if (Array.isArray(method)) return method.map((item) => String(item).toUpperCase());',
    '  if (method) return [String(method).toUpperCase()];',
    '  return ["POST", "PUT", "PATCH", "DELETE"];',
    '}',
    '',
    'function requestMatchesFinalRequest(request) {',
    '  if (!finalRequest || !finalRequest.url) return false;',
    '  const methods = normalizedMethods(finalRequest.method);',
    '  if (!methods.includes(request.method().toUpperCase())) return false;',
    '  return globToRegExp(finalRequest.url).test(request.url());',
    '}',
    '',
    'async function readSnapshotText() {',
    '  if (typeof snapshot !== "function") return undefined;',
    '  try {',
    '    const value = await snapshot({ page });',
    '    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);',
    '    return text.slice(0, 12000);',
    '  } catch (error) {',
    '    return "snapshot failed: " + errorMessage(error);',
    '  }',
    '}',
    '',
    'async function captureWorkflowContext({ step, item, index, phase, reason, error }) {',
    '  return {',
    '    status: "needs_ai",',
    '    reason,',
    '    error: error ? errorMessage(error) : undefined,',
    '    phase,',
    '    step,',
    '    item,',
    '    index,',
    '    sourceRecordingId,',
    '    context: {',
    '      url: page.url(),',
    '      title: await page.title().catch(() => ""),',
    '      snapshot: await readSnapshotText(),',
    '    },',
    '  };',
    '}',
    '',
    'async function detectHumanChallenge() {',
    '  const challengeSelectors = [',
    '    "iframe[src*=\\"captcha\\" i]",',
    '    "[class*=\\"captcha\\" i]",',
    '    "[id*=\\"captcha\\" i]",',
    '  ];',
    '  const selectorMatches = await Promise.all(challengeSelectors.map(async (selector) => {',
    '    const count = await page.locator(selector).count().catch(() => 0);',
    '    return count > 0 ? selector : undefined;',
    '  }));',
    '  const selector = selectorMatches.find(Boolean);',
    '  const bodyText = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");',
    '  const text = bodyText.match(/安全验证|请完成验证|滑块验证|扫码验证|短信验证|verification required|verify you are human|captcha/i)?.[0];',
    '  if (!selector && !text) return undefined;',
    '  return { selector, text };',
    '}',
    '',
    'async function captureHumanCheckpoint({ step, item, index, phase, challenge }) {',
    '  return {',
    '    status: "needs_human",',
    '    reason: "The website requires a person to complete a verification step in the user browser.",',
    '    phase,',
    '    step,',
    '    item,',
    '    index,',
    '    challenge,',
    '    sourceRecordingId,',
    '    resume: "Complete the verification in the open browser, then run the same capability again.",',
    '    context: {',
    '      url: page.url(),',
    '      title: await page.title().catch(() => ""),',
    '    },',
    '  };',
    '}',
    '',
    'async function getWorkflowLocator(step, item, index, phase) {',
    '  const target = page.locator(step.locator).first();',
    '  try {',
    '    await target.waitFor({ state: "attached", timeout: 2500 });',
    '    return { target };',
    '  } catch (error) {',
    '    const challenge = await detectHumanChallenge();',
    '    if (challenge) {',
    '      return { handoff: await captureHumanCheckpoint({ step, item, index, phase, challenge }) };',
    '    }',
    '    return {',
    '      handoff: await captureWorkflowContext({',
    '        step,',
    '        item,',
    '        index,',
    '        phase,',
    '        reason: "Expected locator was not found on the live page.",',
    '        error,',
    '      }),',
    '    };',
    '  }',
    '}',
    '',
    'async function runWorkflowStep(step, item, options) {',
    '  const index = options.index;',
    '  const phase = options.phase;',
    '  try {',
    '    if (step.action === "goto") {',
    '      await page.goto(String(resolveWorkflowValue(item, step.url)));',
    '      return { status: "ok" };',
    '    }',
    '    if (step.action === "waitForURL") {',
    '      await page.waitForURL(String(resolveWorkflowValue(item, step.url)));',
    '      return { status: "ok" };',
    '    }',
    '    if (!step.locator) {',
    '      return await captureWorkflowContext({ step, item, index, phase, reason: "Workflow step is missing a locator." });',
    '    }',
    '    const located = await getWorkflowLocator(step, item, index, phase);',
    '    if (located.handoff) return located.handoff;',
    '    if (step.action === "fill") {',
    '      await located.target.fill(String(resolveWorkflowValue(item, step.value) ?? ""));',
    '      return { status: "ok" };',
    '    }',
    '    if (step.action === "click") {',
    '      await located.target.click();',
    '      return { status: "ok" };',
    '    }',
    '    if (step.action === "setInputFiles") {',
    '      await located.target.setInputFiles(String(resolveWorkflowValue(item, step.path)));',
    '      return { status: "ok" };',
    '    }',
    '    if (step.action === "selectOption") {',
    '      await located.target.selectOption(String(resolveWorkflowValue(item, step.value)));',
    '      return { status: "ok" };',
    '    }',
    '    return await captureWorkflowContext({ step, item, index, phase, reason: "Unsupported workflow step." });',
    '  } catch (error) {',
    '    const challenge = await detectHumanChallenge();',
    '    if (challenge) {',
    '      return await captureHumanCheckpoint({ step, item, index, phase, challenge });',
    '    }',
    '    return await captureWorkflowContext({ step, item, index, phase, reason: "Workflow step failed on the live page.", error });',
    '  }',
    '}',
    '',
    'async function runFinalRequestTrigger(item, index) {',
    '  if (!finalRequest || !finalRequest.trigger) return { status: "completed" };',
    '  const requestPromise = page.waitForRequest((request) => {',
    '    return requestMatchesFinalRequest(request);',
    '  }, { timeout: 8000 }).catch((error) => {',
    '    return { error };',
    '  });',
    '  const triggerResult = await runWorkflowStep(finalRequest.trigger, item, { index, phase: "final-request" });',
    '  if (triggerResult.status !== "ok") return triggerResult;',
    '  const request = await requestPromise;',
    '  if (request && request.error) {',
    '    const challenge = await detectHumanChallenge();',
    '    if (challenge) {',
    '      return await captureHumanCheckpoint({',
    '        step: finalRequest.trigger, item, index, phase: "final-request", challenge,',
    '      });',
    '    }',
    '    return await captureWorkflowContext({',
    '      step: finalRequest.trigger,',
    '      item,',
    '      index,',
    '      phase: "final-request",',
    '      reason: "The expected final request was not observed after the trigger.",',
    '      error: request.error,',
    '    });',
    '  }',
    '  const response = await request.response().catch(() => null);',
    '  return {',
    '    status: "completed",',
    '    finalRequest: {',
    '      method: request.method(),',
    '      url: request.url(),',
    '      headers: request.headers(),',
    '      postData: request.postData(),',
    '      responseStatus: response ? response.status() : undefined,',
    '    },',
    '  };',
    '}',
    '',
    'async function runOneWorkflowItem({ item, index }) {',
    '  for (let stepIndex = 0; stepIndex < workflowSteps.length; stepIndex += 1) {',
    '    const step = workflowSteps[stepIndex];',
    '    const result = await runWorkflowStep(step, item, { index, phase: "step-" + (stepIndex + 1) });',
    '    if (result.status !== "ok") return result;',
    '  }',
    '  if (!finalRequest || !finalRequest.trigger) {',
    '    return {',
    '      status: "completed",',
    '      item,',
    '      index,',
    '    };',
    '  }',
    '  const finalResult = await runFinalRequestTrigger(item, index);',
    '  if (finalResult.status !== "completed") return finalResult;',
    '  return {',
    '    status: "completed",',
    '    item,',
    '    index,',
    '    finalRequest: finalResult.finalRequest,',
    '  };',
    '}',
    '',
    'const batchInput = getPathValue(input, batchInputPath, undefined);',
    'const items = Array.isArray(batchInput) ? batchInput : [input];',
    'const results = [];',
    'let completed = 0;',
    'let failed = 0;',
    'let needsAi = null;',
    'let needsHuman = null;',
    'for (let index = 0; index < items.length; index += 1) {',
    '  const item = items[index];',
    '  try {',
    '    const result = await runOneWorkflowItem({ item, index });',
    '    results.push(result);',
    '    if (result.status === "completed") {',
    '      completed += 1;',
    '    } else if (result.status === "needs_ai") {',
    '      needsAi = result;',
    '      if (!continueOnError) break;',
    '    } else if (result.status === "needs_human") {',
    '      needsHuman = result;',
    '      break;',
    '    } else {',
    '      failed += 1;',
    '      if (!continueOnError) break;',
    '    }',
    '  } catch (error) {',
    '    const result = await captureWorkflowContext({',
    '      item,',
    '      index,',
    '      phase: "item",',
    '      reason: "Workflow item failed before completion.",',
    '      error,',
    '    });',
    '    results.push(result);',
    '    needsAi = result;',
    '    if (!continueOnError) break;',
    '  }',
    '}',
    'return {',
    '  status: needsHuman ? "needs_human" : needsAi ? "needs_ai" : failed > 0 ? "failed" : "completed",',
    '  total: items.length,',
    '  completed,',
    '  failed,',
    '  needsAi,',
    '  needsHuman,',
    '  results,',
    '};',
    '',
  ].join('\n')
}

export function saveWorkflowFromRecording(options: SaveWorkflowFromRecordingOptions): SavedWorkflowCapability {
  return saveWorkflowCapability({
    ...options,
    sourceRecordingId: options.recordingId,
    script: buildWorkflowScript(options),
    execution:
      options.execution ||
      ({
        strategy: options.finalRequest ? 'hybrid' : 'browser-ui',
        requiresUserBrowser: true,
        humanAssistance: 'on-challenge',
        requirements: ['A signed-in user browser for the recorded website.'],
        observedRequestPatterns: options.finalRequest ? [options.finalRequest.url] : [],
      } satisfies CapabilityExecutionConfig),
  })
}
