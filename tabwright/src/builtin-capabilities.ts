import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as nodeUrl from 'node:url'
import {
  createCapability,
  getCapabilityDir,
  readCapabilityScript,
  updateCapabilityManifest,
  updateCapabilityScript,
  type CapabilityLocation,
  type CapabilityRecord,
} from './capability-registry.js'
import { removeCapabilityAuthFiles } from './capability-auth-state.js'

export interface InstallBuiltinCapabilitySuiteOptions {
  suite: string
  cwd?: string
  location?: CapabilityLocation
  overwrite?: boolean
  trust?: boolean
  installAgentSkills?: boolean
  codexHome?: string
}

export interface InstalledBuiltinCapabilitySuite {
  suite: string
  capabilities: CapabilityRecord[]
  agentSkills: InstalledBuiltinAgentSkill[]
}

export function isBuiltinCapabilitySuite(suite: string): suite is 'conan-config' {
  return suite === 'conan-config'
}

interface BuiltinCapabilityDefinition {
  id: string
  title: string
  description: string
  script: string
  manifest: Parameters<typeof updateCapabilityManifest>[0]['patch']
}

interface BuiltinAgentSkillFileDefinition {
  relativePath: string
  bundledPath: string
}

interface BuiltinAgentSkillDefinition {
  target: 'codex'
  name: string
  files: BuiltinAgentSkillFileDefinition[]
}

export interface InstalledBuiltinAgentSkillFile {
  path: string
  status: 'created' | 'updated' | 'unchanged'
}

export interface InstalledBuiltinAgentSkill {
  target: 'codex'
  name: string
  dir: string
  files: InstalledBuiltinAgentSkillFile[]
}

const conanConfigSearchScript = String.raw`
const CONFIG_ENVIRONMENTS = {
  "cn-prod": "https://conan.zhenguanyu.com",
  "cn-test": "https://ytkconan.zhenguanyu.com",
};
const DEFAULT_MODES = ["config", "configValue", "grouping"];

function resolveEnvironment(rawInput) {
  const nextInput = rawInput || {};
  const explicit = String(nextInput.environment || "").trim();
  if (explicit) {
    if (!CONFIG_ENVIRONMENTS[explicit]) {
      throw new Error("Unsupported environment: " + explicit + ". Use cn-prod or cn-test.");
    }
    return explicit;
  }
  const urlText = nextInput.url || nextInput.configUrl || "";
  if (!urlText) return "cn-prod";
  const hostname = new URL(urlText).hostname;
  if (hostname === "ytkconan.zhenguanyu.com" || hostname === "buff-test.zhenguanyu.com") return "cn-test";
  if (hostname === "conan.zhenguanyu.com" || hostname === "buff.zhenguanyu.com") return "cn-prod";
  throw new Error("Unsupported Conan config host: " + hostname);
}

const environment = resolveEnvironment(input);
const CONFIG_API_ORIGIN = CONFIG_ENVIRONMENTS[environment];

function normalizeInput(rawInput) {
  const nextInput = rawInput || {};
  const query = String(nextInput.query || nextInput.keyword || nextInput.search || "").trim();
  if (!query) {
    throw new Error("Missing search query. Provide input.query, input.keyword, or input.search.");
  }

  const requestedMode = String(nextInput.mode || "").trim();
  const modes = requestedMode
    ? requestedMode
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : DEFAULT_MODES;
  const unsupported = modes.filter((mode) => !DEFAULT_MODES.includes(mode));
  if (unsupported.length) {
    throw new Error("Unsupported search mode(s): " + unsupported.join(", ") + ". Use config, configValue, grouping.");
  }

  return {
    query,
    modes,
    limit: Number.isInteger(nextInput.limit) && nextInput.limit > 0 ? nextInput.limit : 100,
    includeRawTree: nextInput.includeRawTree === true,
  };
}

async function requestJson(path) {
  const cookieHeader = secrets.cookieHeader;
  if (!cookieHeader) {
    throw new Error("Missing saved cookie auth. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }

  const response = await fetch(CONFIG_API_ORIGIN + path, {
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
  });
  const body = await response.json();

  if (response.status === 401 || response.status === 403) {
    throw new Error("Request failed " + response.status + ": login expired. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error("Request failed " + response.status + ": " + JSON.stringify(body));
  }
  if (body && body.code !== undefined && body.code !== 0) {
    throw new Error("API failed: " + (body.msg || JSON.stringify(body)));
  }
  return body;
}

function nodeLabel(node) {
  return node.name || node.desc || node.groupingKey || node.key || "";
}

function extractResultsFromTree(tree, mode) {
  const results = [];

  function visit(node, ancestors = []) {
    const label = nodeLabel(node);
    const nextAncestors = label ? ancestors.concat(label) : ancestors;

    if (node.key) {
      const root = ancestors[0] || "";
      const groupingPath = ancestors.slice(1).join(" / ");
      results.push({
        mode,
        id: node.id,
        name: node.name || "",
        desc: node.desc || "",
        key: node.key,
        schemaId: node.schemaId,
        rootGroupingKey: node.rootGroupingKey || node.rootGroupingId || "",
        groupingId: node.groupingId,
        root,
        groupingPath,
        path: nextAncestors.join(" / "),
        createdLdap: node.createdLdap || node.ldap || "",
        updatedLdap: node.updatedLdap || "",
        createdTime: node.createdTime || node.dbctime,
        updatedTime: node.updatedTime || node.dbutime,
      });
    }

    for (const child of node.children || []) {
      visit(child, nextAncestors);
    }
  }

  for (const node of tree || []) {
    visit(node, []);
  }

  return results;
}

function dedupeResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const result of results) {
    const key = result.mode + ":" + result.key + ":" + (result.id || "");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function markdownTableCell(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function buildMarkdown(output) {
  const lines = [
    "# 配置查询：" + output.query,
    "",
    "- 查询接口: /conan-config/api/enhancedConfigs/searchTree",
    "- 查询维度: " + output.modes.join(", "),
    "- 命中配置: " + output.resultCount + " 个",
    "",
    "## 分维度结果",
    "",
  ];

  for (const modeResult of output.resultsByMode) {
    lines.push("### " + modeResult.mode + ": " + modeResult.query);
    lines.push("");
    if (!modeResult.results.length) {
      lines.push("- 无匹配配置项", "");
      continue;
    }
    lines.push("| 配置名称 | key | desc | path | schemaId |");
    lines.push("| --- | --- | --- | --- | ---: |");
    for (const result of modeResult.results) {
      lines.push(
        "| " +
          markdownTableCell(result.name) +
          " | " +
          markdownTableCell(result.key) +
          " | " +
          markdownTableCell(result.desc) +
          " | " +
          markdownTableCell(result.path) +
          " | " +
          markdownTableCell(result.schemaId) +
          " |",
      );
    }
    lines.push("");
  }

  lines.push("## 全部命中");
  lines.push("");
  if (!output.results.length) {
    lines.push("- 无匹配配置项");
  } else {
    lines.push("| mode | 配置名称 | key | path |");
    lines.push("| --- | --- | --- | --- |");
    for (const result of output.results) {
      lines.push("| " + result.mode + " | " + markdownTableCell(result.name) + " | " + markdownTableCell(result.key) + " | " + markdownTableCell(result.path) + " |");
    }
  }

  return lines.join("\n");
}

async function searchMode(query, mode) {
  const params = new URLSearchParams({ [mode]: query });
  const body = await requestJson("/conan-config/api/enhancedConfigs/searchTree?" + params.toString());
  const tree = body.data?.configBases || [];
  const results = extractResultsFromTree(tree, mode);
  return {
    mode,
    query,
    rootCount: tree.length,
    resultCount: results.length,
    results,
    rawTree: tree,
  };
}

const normalized = normalizeInput(input);
const modeResults = [];
for (const mode of normalized.modes) {
  modeResults.push(await searchMode(normalized.query, mode));
}

const combined = dedupeResults(modeResults.flatMap((item) => item.results)).slice(0, normalized.limit);
  const output = {
    action: "search",
    environment,
    query: normalized.query,
  modes: normalized.modes,
  suggestions: normalized.modes.map((mode) => ({ mode, text: mode + ": " + normalized.query })),
  resultCount: combined.length,
  results: combined,
  resultsByMode: modeResults.map((item) => ({
    mode: item.mode,
    query: item.query,
    rootCount: item.rootCount,
    resultCount: item.resultCount,
    results: item.results.slice(0, normalized.limit),
    rawTree: normalized.includeRawTree ? item.rawTree : undefined,
  })),
};

return {
  ...output,
  view: {
    markdown: buildMarkdown(output),
    table: combined,
  },
};
`

const conanConfigQueryScript = String.raw`
const CONFIG_ENVIRONMENTS = {
  "cn-prod": "https://conan.zhenguanyu.com",
  "cn-test": "https://ytkconan.zhenguanyu.com",
};

function resolveEnvironment(rawInput) {
  const nextInput = rawInput || {};
  const explicit = String(nextInput.environment || "").trim();
  if (explicit) {
    if (!CONFIG_ENVIRONMENTS[explicit]) {
      throw new Error("Unsupported environment: " + explicit + ". Use cn-prod or cn-test.");
    }
    return explicit;
  }
  const urlText = nextInput.url || nextInput.configUrl || "";
  if (!urlText) return "cn-prod";
  const hostname = new URL(urlText).hostname;
  if (hostname === "ytkconan.zhenguanyu.com" || hostname === "buff-test.zhenguanyu.com") return "cn-test";
  if (hostname === "conan.zhenguanyu.com" || hostname === "buff.zhenguanyu.com") return "cn-prod";
  throw new Error("Unsupported Conan config host: " + hostname);
}

const environment = resolveEnvironment(input);
const CONFIG_API_ORIGIN = CONFIG_ENVIRONMENTS[environment];

function parseConfigUrl(urlText) {
  if (!urlText || typeof urlText !== "string") return {};
  try {
    const url = new URL(urlText);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const queryIndex = hash.indexOf("?");
    const hashParams = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
    return {
      key: hashParams.get("key") || url.searchParams.get("key") || "",
      namespace:
        hashParams.get("rootGroupingKey") ||
        hashParams.get("namespace") ||
        url.searchParams.get("rootGroupingKey") ||
        url.searchParams.get("namespace") ||
        "",
    };
  } catch {
    return {};
  }
}

function normalizeInput(rawInput) {
  const nextInput = rawInput || {};
  const parsedUrl = parseConfigUrl(nextInput.url || nextInput.configUrl || "");
  const namespace =
    nextInput.namespace || nextInput.rootGroupingKey || nextInput.grouping || parsedUrl.namespace || "Space_Pedia";
  const key = nextInput.key || parsedUrl.key || "";
  if (!key) {
    throw new Error("Missing config key. Provide input.key or a config admin URL containing ?key=...");
  }

  return {
    namespace,
    key,
    includeRawValue: nextInput.includeRawValue === true,
    saveArtifacts: nextInput.saveArtifacts !== false,
  };
}

function parseValue(valueText) {
  if (!valueText || valueText === "{}") return {};
  return JSON.parse(valueText);
}

function orderedSchemaChildren(schema) {
  return Object.values(schema?.properties || {}).sort((left, right) => {
    return (left?.["x-index"] ?? 0) - (right?.["x-index"] ?? 0);
  });
}

function isValueSchemaField(schema) {
  return !!(schema && schema.name && schema.type !== "void");
}

function isArraySchema(schema) {
  return String(schema?.type || "").toLowerCase().startsWith("array");
}

function schemaFieldLabel(schema, fallback = "") {
  return String(schema?.title || schema?.["x-component-props"]?.title || schema?.name || fallback || "").trim();
}

function summarizeSchemaField(definition) {
  return {
    name: definition.name || "",
    label: schemaFieldLabel(definition, definition.name || ""),
    title: definition.title || "",
    type: definition.type || "any",
    component: definition["x-component"] || "",
    required: definition.required === true,
    description: definition.description || "",
    enum: Array.isArray(definition.enum)
      ? definition.enum.map((item) => ({ label: item.label, value: item.value }))
      : undefined,
    default: definition.default,
  };
}

function collectSchemaFields(schema, path = [], acc = []) {
  if (!schema || typeof schema !== "object") return acc;

  for (const child of orderedSchemaChildren(schema)) {
    if (isValueSchemaField(child)) {
      const fieldPath = path.concat(child.name);
      acc.push([fieldPath.join("."), summarizeSchemaField(child)]);

      const nestedPath = isArraySchema(child) ? path.concat(child.name + "[]") : fieldPath;
      if (child.items) collectSchemaFields(child.items, nestedPath, acc);
      else collectSchemaFields(child, nestedPath, acc);
    } else {
      collectSchemaFields(child, path, acc);
    }
  }

  return acc;
}

function summarizeSchema(schema) {
  return Object.fromEntries(collectSchemaFields(schema));
}

function findNamedSchemaProperty(schema, key) {
  if (!schema || typeof schema !== "object") return undefined;

  const children = orderedSchemaChildren(schema);
  const direct = children.find((child) => isValueSchemaField(child) && child.name === key);
  if (direct) return direct;

  for (const child of children) {
    if (!isValueSchemaField(child)) {
      const nested = findNamedSchemaProperty(child, key);
      if (nested) return nested;
    }
  }

  if (schema.items) return findNamedSchemaProperty(schema.items, key);
  return undefined;
}

function schemaDisplayKey(key, schema) {
  const label = schemaFieldLabel(schema, key);
  return label && label !== key ? label + " (" + key + ")" : key;
}

function buildLabeledValue(value, schema) {
  if (Array.isArray(value)) {
    const itemSchema = schema?.items || schema;
    return value.map((item) => buildLabeledValue(item, itemSchema));
  }

  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const childSchema = findNamedSchemaProperty(schema, key);
      return [schemaDisplayKey(key, childSchema), buildLabeledValue(item, childSchema)];
    }),
  );
}

function summarizeValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      type: Array.isArray(value) ? "array" : typeof value,
      topLevelKeys: [],
      arrays: [],
      objects: [],
      primitives: [],
    };
  }

  const entries = Object.entries(value);
  return {
    type: "object",
    topLevelKeys: entries.map(([key]) => key),
    arrays: entries
      .filter(([, item]) => Array.isArray(item))
      .map(([key, items]) => ({
        key,
        count: items.length,
        sampleKeys:
          items.length > 0 && items[0] && typeof items[0] === "object" && !Array.isArray(items[0])
            ? Object.keys(items[0])
            : [],
      })),
    objects: entries
      .filter(([, item]) => item && typeof item === "object" && !Array.isArray(item))
      .map(([key, item]) => ({ key, keys: Object.keys(item) })),
    primitives: entries
      .filter(([, item]) => !item || typeof item !== "object")
      .map(([key, item]) => ({ key, value: item })),
  };
}

function markdownTableCell(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function schemaFieldsMarkdown(schemaSummary) {
  const rows = Object.entries(schemaSummary);
  if (!rows.length) return "- 无 schema 字段信息";

  return [
    "| path | schema label | type | required | component |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(([path, definition]) => {
      return "| " + markdownTableCell(path) + " | " + markdownTableCell(definition.label || definition.title || definition.name || "") + " | " + markdownTableCell(definition.type || "") + " | " + (definition.required ? "是" : "否") + " | " + markdownTableCell(definition.component || "") + " |";
    }),
  ].join("\n");
}

function fullValueSectionsMarkdown(labeledValue) {
  if (!labeledValue || typeof labeledValue !== "object" || Array.isArray(labeledValue)) {
    return ["~~~json", JSON.stringify(labeledValue, null, 2), "~~~"].join("\n");
  }

  return Object.entries(labeledValue)
    .flatMap(([key, item]) => [
      "### " + key,
      "",
      "~~~json",
      JSON.stringify(item, null, 2),
      "~~~",
      "",
    ])
    .join("\n");
}

function buildArrayTables(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.entries(value)
    .filter(([, item]) => Array.isArray(item))
    .map(([key, rows]) => {
      const arraySchema = findNamedSchemaProperty(schema, key);
      return {
        name: schemaDisplayKey(key, arraySchema),
        rows: rows.map((row) => buildLabeledValue(row, arraySchema?.items || arraySchema)),
      };
    });
}

function buildMarkdown(meta, schemaSummary, labeledValue, valueSummary) {
  const summaryLines = [
    "- namespace: " + meta.namespace,
    "- key: " + meta.key,
    "- configId: " + meta.id,
    "- schemaId: " + (meta.schemaId || "无"),
    "- 草稿: " + (meta.hasDraft ? "有" : "无"),
    "- 描述: " + (meta.desc || meta.name || "无"),
    "- 顶层字段: " + (valueSummary.topLevelKeys.join(", ") || "无"),
    ...valueSummary.arrays.map((item) => "- " + item.key + ": 数组 " + item.count + " 条；示例字段 " + (item.sampleKeys.join(", ") || "无")),
    ...valueSummary.objects.map((item) => "- " + item.key + ": 对象；字段 " + item.keys.join(", ")),
    ...valueSummary.primitives.map((item) => "- " + item.key + ": " + item.value),
    "- 完整字段和值见下方 JSON；字段名优先使用 schema label，括号内保留原始 key",
  ];

  return [
    "# " + (meta.desc || meta.name || meta.key),
    "",
    "## 总览",
    "",
    ...summaryLines,
    "",
    "## Schema 字段",
    "",
    schemaFieldsMarkdown(schemaSummary),
    "",
    "## 完整配置 JSON（按顶层字段拆分，schema label / 原始 key）",
    "",
    fullValueSectionsMarkdown(labeledValue),
  ].join("\n");
}

function sanitizeArtifactPart(value) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "unknown";
}

function artifactTimestamp(value) {
  const date = typeof value === "number" ? new Date(value) : new Date();
  return date.toISOString().replace(/[:.]/g, "-");
}

function saveConfigArtifacts(output) {
  if (typeof artifacts === "undefined" || !artifacts.writeJson || !artifacts.writeText || !artifacts.path) {
    return undefined;
  }

  const baseDir =
    "conan-config/" +
    (output.environment === "cn-prod" ? "" : sanitizeArtifactPart(output.environment) + "/") +
    sanitizeArtifactPart(output.namespace) +
    "/" +
    sanitizeArtifactPart(output.key);
  const stamp = artifactTimestamp(output.updatedTime);
  const artifactPaths = {
    root: artifacts.root,
    latestFullJson: artifacts.path({ filename: baseDir + "/latest.full.json" }),
    latestValueJson: artifacts.path({ filename: baseDir + "/latest.value.json" }),
    latestLabeledValueJson: artifacts.path({ filename: baseDir + "/latest.labeled-value.json" }),
    latestSummaryJson: artifacts.path({ filename: baseDir + "/latest.summary.json" }),
    latestSummaryMarkdown: artifacts.path({ filename: baseDir + "/latest.summary.md" }),
    snapshotFullJson: artifacts.path({ filename: baseDir + "/" + stamp + ".full.json" }),
  };
  const summary = {
    action: output.action,
    environment: output.environment,
    namespace: output.namespace,
    key: output.key,
    configId: output.configId,
    schemaId: output.schemaId,
    metadata: output.metadata,
    updatedTime: output.updatedTime,
    hasDraft: output.hasDraft,
    view: {
      kind: output.view.kind,
      summary: output.view.summary,
      schemaFields: output.view.schemaFields,
      tables: output.view.tables,
    },
    artifacts: artifactPaths,
  };
  const outputWithArtifacts = {
    ...output,
    artifacts: artifactPaths,
  };

  artifacts.writeJson({ filename: baseDir + "/latest.value.json", value: output.value });
  artifacts.writeJson({ filename: baseDir + "/latest.labeled-value.json", value: output.view.labeledValue });
  artifacts.writeJson({ filename: baseDir + "/latest.summary.json", value: summary });
  artifacts.writeText({ filename: baseDir + "/latest.summary.md", text: output.view.markdown + "\n" });
  artifacts.writeJson({ filename: baseDir + "/latest.full.json", value: outputWithArtifacts });
  artifacts.writeJson({ filename: baseDir + "/" + stamp + ".full.json", value: outputWithArtifacts });

  return artifactPaths;
}

async function requestJson(path, options = {}) {
  const cookieHeader = secrets.cookieHeader;
  if (!cookieHeader) {
    throw new Error("Missing saved cookie auth. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }

  const url = path.startsWith("http") ? path : CONFIG_API_ORIGIN + path;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Request failed " + response.status + ": login expired. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error("Request failed " + response.status + ": " + (typeof body === "string" ? body : JSON.stringify(body)));
  }
  if (body && typeof body === "object" && body.code !== undefined && body.code !== 0) {
    throw new Error("API failed: " + (body.msg || JSON.stringify(body)));
  }
  return body;
}

async function requestJsonOptional(path) {
  try {
    return await requestJson(path);
  } catch {
    return undefined;
  }
}

async function loadConfig(normalized) {
  const namespace = encodeURIComponent(normalized.namespace);
  const key = encodeURIComponent(normalized.key);

  const newConfig = await requestJson("/conan-config/api/newConfigs/" + namespace + "/" + key);
  const enhancedDetail = await requestJsonOptional("/conan-config/api/enhancedConfigs/detail/" + namespace + "/" + key);

  const config = enhancedDetail?.data?.config || {};
  const draft = enhancedDetail?.data?.configDraft;
  const schemaId = config.schemaId;
  let schema = {};
  let schemaSummary = {};
  if (schemaId) {
    const schemaRows = await requestJson("/conan-config/api/schema?ids=" + encodeURIComponent(schemaId));
    const schemaRow = Array.isArray(schemaRows) ? schemaRows[0] : undefined;
    if (schemaRow?.schemaJson) {
      schema = JSON.parse(schemaRow.schemaJson).schema || {};
      schemaSummary = summarizeSchema(schema);
    }
  }

  const rawValue = newConfig.value ?? config.value ?? "{}";
  const value = typeof rawValue === "string" ? parseValue(rawValue) : rawValue;
  const labeledValue = buildLabeledValue(value, schema);
  const valueSummary = summarizeValue(value);
  const meta = {
    id: newConfig.id || config.id,
    namespace: newConfig.namespace || normalized.namespace,
    key: newConfig.key || normalized.key,
    desc: newConfig.desc || config.desc || "",
    name: config.name || "",
    ldapId: newConfig.ldapId || "",
    createdTime: newConfig.createdTime || config.createdTime,
    updatedTime: newConfig.updatedTime || config.updatedTime,
    schemaId,
    hasDraft: !!draft,
  };

  const output = {
    action: "get",
    environment,
    namespace: meta.namespace,
    key: meta.key,
    configId: meta.id,
    schemaId: schemaId || null,
    metadata: meta,
    value,
    rawValue: normalized.includeRawValue ? rawValue : undefined,
    schema: schemaSummary,
    view: {
      kind: "conan_config_query",
      summary: {
        topLevelKeys: valueSummary.topLevelKeys,
        arrays: valueSummary.arrays,
        objects: valueSummary.objects,
        schemaFieldCount: Object.keys(schemaSummary).length,
        hasDraft: !!draft,
      },
      schemaFields: schemaSummary,
      labeledValue,
      tables: buildArrayTables(value, schema),
      markdown: buildMarkdown(meta, schemaSummary, labeledValue, valueSummary),
    },
    updatedTime: meta.updatedTime,
    hasDraft: !!draft,
  };
  if (!normalized.saveArtifacts) {
    return output;
  }
  const artifactPaths = saveConfigArtifacts(output);
  if (!artifactPaths) {
    return output;
  }
  return {
    ...output,
    artifacts: artifactPaths,
  };
}

const normalized = normalizeInput(input);
return await loadConfig(normalized);
`

const conanConfigPrepareChangeScript = String.raw`
const CONFIG_ENVIRONMENTS = {
  "cn-prod": "https://conan.zhenguanyu.com",
  "cn-test": "https://ytkconan.zhenguanyu.com",
};

function resolveEnvironment(rawInput) {
  const nextInput = rawInput || {};
  const explicit = String(nextInput.environment || "").trim();
  if (explicit) {
    if (!CONFIG_ENVIRONMENTS[explicit]) throw new Error("Unsupported environment: " + explicit + ". Use cn-prod or cn-test.");
    return explicit;
  }
  if (!nextInput.url) return "cn-prod";
  const hostname = new URL(nextInput.url).hostname;
  if (hostname === "ytkconan.zhenguanyu.com" || hostname === "buff-test.zhenguanyu.com") return "cn-test";
  if (hostname === "conan.zhenguanyu.com" || hostname === "buff.zhenguanyu.com") return "cn-prod";
  throw new Error("Unsupported Conan config host: " + hostname);
}

const environment = resolveEnvironment(input);
const API_ORIGIN = CONFIG_ENVIRONMENTS[environment];

function parseTarget(rawInput) {
  const nextInput = rawInput || {};
  const parsed = (() => {
    if (!nextInput.url) return {};
    const url = new URL(nextInput.url);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    return {
      key: params.get("key") || url.searchParams.get("key") || "",
      namespace:
        params.get("rootGroupingKey") ||
        params.get("namespace") ||
        url.searchParams.get("rootGroupingKey") ||
        url.searchParams.get("namespace") ||
        "",
    };
  })();
  const key = nextInput.key || parsed.key || "";
  const namespace = nextInput.namespace || nextInput.rootGroupingKey || parsed.namespace || "";
  if (!key || !namespace) throw new Error("Provide url or namespace/key for the target config.");
  return { key, namespace };
}

async function requestJson(path) {
  if (!secrets.cookieHeader) {
    throw new Error("Missing saved cookie auth. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }
  const response = await fetch(API_ORIGIN + path, {
    headers: { "Content-Type": "application/json", Cookie: secrets.cookieHeader },
  });
  const text = await response.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })();
  if (response.status === 401 || response.status === 403) throw new Error("Login expired: " + response.status);
  if (!response.ok) throw new Error("Request failed " + response.status + ": " + (typeof body === "string" ? body : JSON.stringify(body)));
  if (body && typeof body === "object" && body.code !== undefined && body.code !== 0) {
    throw new Error("API failed: " + (body.msg || JSON.stringify(body)));
  }
  return body;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function collectDiff(before, after, path = "$") {
  if (canonicalJson(before) === canonicalJson(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }).flatMap((_, index) => {
      return collectDiff(before[index], after[index], path + "[" + index + "]");
    });
  }
  if (before && after && typeof before === "object" && typeof after === "object") {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => {
      return collectDiff(before[key], after[key], path + "." + key);
    });
  }
  return [{ path, before, after }];
}

const target = parseTarget(input);
const namespace = encodeURIComponent(target.namespace);
const key = encodeURIComponent(target.key);
const detailBody = await requestJson("/conan-config/api/enhancedConfigs/detail/" + namespace + "/" + key);
const config = detailBody?.data?.config;
if (!config) throw new Error("Config detail does not exist.");
if (!config.schemaId) throw new Error("Config has no schemaId and cannot enter AI validation.");
const schemaRows = await requestJson("/conan-config/api/schema?ids=" + encodeURIComponent(config.schemaId));
const schemaRow = Array.isArray(schemaRows) ? schemaRows[0] : undefined;
if (!schemaRow?.schemaJson) throw new Error("Schema API did not return schemaJson.");
const parsedSchema = JSON.parse(schemaRow.schemaJson);
const currentValue = JSON.parse(config.value || "{}");
const sourceSha256 = await sha256(currentValue);
const hasTargetValue = input.value && typeof input.value === "object" && !Array.isArray(input.value);
const targetSha256 = hasTargetValue ? await sha256(input.value) : undefined;
const diff = hasTargetValue ? collectDiff(currentValue, input.value) : [];

return {
  action: "prepare-change",
  environment,
  ...target,
  configId: config.id,
  schemaId: config.schemaId,
  updatedTime: config.updatedTime,
  sourceSha256,
  targetSha256,
  hasDraft: !!detailBody?.data?.configDraft,
  currentValue,
  targetValue: hasTargetValue ? input.value : undefined,
  changeSummary: input.changeSummary || "",
  diff,
  schema: parsedSchema.schema || {},
  form: parsedSchema.form || {},
  instruction:
    "AI must validate the complete targetValue against schema, x-validator, x-reactions, component semantics, and the structured diff. Return validationReport with passed, errors, warnings, warningsAccepted, environment, schemaId, updatedTime, sourceSha256, targetSha256, and summary. Show the semantic diff and target environment, then obtain explicit user confirmation before apply-change.",
};
`

const conanConfigApplyChangeScript = String.raw`
const CONFIG_ENVIRONMENTS = {
  "cn-prod": "https://conan.zhenguanyu.com",
  "cn-test": "https://ytkconan.zhenguanyu.com",
};

function resolveEnvironment(rawInput) {
  const nextInput = rawInput || {};
  const explicit = String(nextInput.environment || "").trim();
  if (explicit) {
    if (!CONFIG_ENVIRONMENTS[explicit]) throw new Error("Unsupported environment: " + explicit + ". Use cn-prod or cn-test.");
    return explicit;
  }
  if (!nextInput.url) return "cn-prod";
  const hostname = new URL(nextInput.url).hostname;
  if (hostname === "ytkconan.zhenguanyu.com" || hostname === "buff-test.zhenguanyu.com") return "cn-test";
  if (hostname === "conan.zhenguanyu.com" || hostname === "buff.zhenguanyu.com") return "cn-prod";
  throw new Error("Unsupported Conan config host: " + hostname);
}

const environment = resolveEnvironment(input);
const API_ORIGIN = CONFIG_ENVIRONMENTS[environment];

function parseTarget(rawInput) {
  const nextInput = rawInput || {};
  const parsed = (() => {
    if (!nextInput.url) return {};
    const url = new URL(nextInput.url);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    return {
      key: params.get("key") || url.searchParams.get("key") || "",
      namespace:
        params.get("rootGroupingKey") ||
        params.get("namespace") ||
        url.searchParams.get("rootGroupingKey") ||
        url.searchParams.get("namespace") ||
        "",
    };
  })();
  const key = nextInput.key || parsed.key || "";
  const namespace = nextInput.namespace || nextInput.rootGroupingKey || parsed.namespace || "";
  if (!key || !namespace) throw new Error("Provide url or namespace/key for the target config.");
  return { key, namespace };
}

async function requestJson(path, options = {}) {
  if (!secrets.cookieHeader) {
    throw new Error("Missing saved cookie auth. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }
  const response = await fetch(API_ORIGIN + path, {
    ...options,
    headers: { "Content-Type": "application/json", Cookie: secrets.cookieHeader, ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })();
  if (response.status === 401 || response.status === 403) throw new Error("Login expired: " + response.status);
  if (!response.ok) throw new Error("Request failed " + response.status + ": " + (typeof body === "string" ? body : JSON.stringify(body)));
  if (body && typeof body === "object" && body.code !== undefined && body.code !== 0) {
    throw new Error("API failed: " + (body.msg || JSON.stringify(body)));
  }
  return body;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const target = parseTarget(input);
const report = input.validationReport;
if (!report?.passed || (report.errors || []).length) {
  return { status: "ai_validation_failed", environment, ...target, validationErrors: report?.errors || ["AI validation did not pass."], submitted: false };
}
if ((report.warnings || []).length && report.warningsAccepted !== true) {
  return { status: "warnings_not_accepted", environment, ...target, validationErrors: report.warnings, submitted: false };
}
if (report.environment !== environment) {
  return { status: "environment_changed_after_validation", environment, ...target, validationErrors: ["Target environment changed after validation."], submitted: false };
}
const targetSha256 = await sha256(input.value);
if (targetSha256 !== report.targetSha256) {
  return { status: "target_changed_after_validation", environment, ...target, validationErrors: ["Target JSON changed after validation."], submitted: false };
}

const namespace = encodeURIComponent(target.namespace);
const key = encodeURIComponent(target.key);
const detailBody = await requestJson("/conan-config/api/enhancedConfigs/detail/" + namespace + "/" + key);
const config = detailBody?.data?.config;
if (!config) throw new Error("Config detail does not exist.");
if (detailBody?.data?.configDraft) {
  return { status: "draft_exists", environment, ...target, validationErrors: ["An existing draft must not be overwritten."], submitted: false };
}
const currentValue = JSON.parse(config.value || "{}");
const sourceSha256 = await sha256(currentValue);
if (
  config.schemaId !== report.schemaId ||
  config.updatedTime !== report.updatedTime ||
  sourceSha256 !== report.sourceSha256
) {
  return {
    status: "source_changed_after_validation",
    environment,
    ...target,
    schemaId: config.schemaId || null,
    updatedTime: config.updatedTime,
    sourceSha256,
    validationErrors: ["schemaId, updatedTime, or source value changed. Prepare and validate again."],
    submitted: false,
  };
}

const updatePayload = {
  desc: config.desc,
  groupingId: config.groupingId,
  id: config.id,
  name: config.name,
  schemaId: config.schemaId,
  updatedTime: config.updatedTime,
  value: JSON.stringify(input.value),
  operationType: 3,
};
const updateBody = await requestJson("/conan-config/api/enhancedConfigs/update", {
  method: "POST",
  body: JSON.stringify(updatePayload),
});
const configDraftId = updateBody?.data;
if (!configDraftId) throw new Error("Update API did not return configDraftId; config was not published.");
const publishBody = await requestJson("/conan-config/api/enhancedConfigs/publish", {
  method: "POST",
  body: JSON.stringify({ configId: config.id, configDraftId }),
});
if (!publishBody?.data) throw new Error("Publish API did not return success.");

const verifiedConfig = await requestJson("/conan-config/api/newConfigs/" + namespace + "/" + key);
const verifiedValue = typeof verifiedConfig.value === "string" ? JSON.parse(verifiedConfig.value || "{}") : verifiedConfig.value;
const verifiedSha256 = await sha256(verifiedValue);
if (verifiedSha256 !== targetSha256) throw new Error("Published config verification failed: target hash mismatch.");

return {
  status: "published",
  environment,
  ...target,
  configId: config.id,
  schemaId: config.schemaId,
  configDraftId,
  sourceSha256,
  targetSha256,
  verifiedSha256,
  validationErrors: [],
  validationWarnings: report.warnings || [],
  submitted: true,
  verified: true,
  changeSummary: input.changeSummary,
};
`

// Mirrors the B-side workflow in conan-oversea-designer: update creates a draft, publish consumes
// that draft id, unPublish discards it, updatedTime provides optimistic concurrency, rollback uses
// operationType 4, and copy creates a new definition that reuses the source schema without content.
const conanConfigLifecycleReadScript = String.raw`
const CONFIG_ENVIRONMENTS = {
  "cn-prod": "https://conan.zhenguanyu.com",
  "cn-test": "https://ytkconan.zhenguanyu.com",
};

function resolveEnvironment(rawInput) {
  const nextInput = rawInput || {};
  const explicit = String(nextInput.environment || "").trim();
  if (explicit) {
    if (!CONFIG_ENVIRONMENTS[explicit]) throw new Error("Unsupported environment: " + explicit + ". Use cn-prod or cn-test.");
    return explicit;
  }
  const urlText = nextInput.url || nextInput.configUrl || nextInput.sourceUrl || "";
  if (!urlText) return "cn-prod";
  const hostname = new URL(urlText).hostname;
  if (hostname === "ytkconan.zhenguanyu.com" || hostname === "buff-test.zhenguanyu.com") return "cn-test";
  if (hostname === "conan.zhenguanyu.com" || hostname === "buff.zhenguanyu.com") return "cn-prod";
  throw new Error("Unsupported Conan config host: " + hostname);
}

function parseTarget(rawInput, prefix = "") {
  const nextInput = rawInput || {};
  const urlText = nextInput[prefix + "Url"] || (prefix ? "" : nextInput.url || nextInput.configUrl || "");
  const parsed = (() => {
    if (!urlText) return {};
    const url = new URL(urlText);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    return {
      key: params.get("key") || url.searchParams.get("key") || "",
      namespace:
        params.get("rootGroupingKey") ||
        params.get("namespace") ||
        url.searchParams.get("rootGroupingKey") ||
        url.searchParams.get("namespace") ||
        "",
    };
  })();
  const key = nextInput[prefix + "Key"] || (prefix ? "" : nextInput.key) || parsed.key || "";
  const namespace =
    nextInput[prefix + "Namespace"] ||
    (prefix ? "" : nextInput.namespace || nextInput.rootGroupingKey) ||
    parsed.namespace ||
    "";
  if (!key || !namespace) throw new Error("Provide " + (prefix || "target") + "Url or namespace/key.");
  return { key, namespace };
}

function parseJsonValue(value) {
  if (value === undefined || value === null || value === "") return {};
  return typeof value === "string" ? JSON.parse(value || "{}") : value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function collectDiff(before, after, path = "$") {
  if (canonicalJson(before) === canonicalJson(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }).flatMap((_, index) => {
      return collectDiff(before[index], after[index], path + "[" + index + "]");
    });
  }
  if (before && after && typeof before === "object" && typeof after === "object") {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((key) => {
      return collectDiff(before[key], after[key], path + "." + key);
    });
  }
  return [{ path, before, after }];
}

const environment = resolveEnvironment(input);
const API_ORIGIN = CONFIG_ENVIRONMENTS[environment];

async function requestJson(path, options = {}) {
  if (!secrets.cookieHeader) {
    throw new Error("Missing saved cookie auth. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }
  const response = await fetch(API_ORIGIN + path, {
    ...options,
    headers: { "Content-Type": "application/json", Cookie: secrets.cookieHeader, ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })();
  if (response.status === 401 || response.status === 403) {
    throw new Error("Request failed " + response.status + ": login expired. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }
  if (!response.ok) throw new Error("Request failed " + response.status + ": " + (typeof body === "string" ? body : JSON.stringify(body)));
  if (body && typeof body === "object" && body.code !== undefined && body.code !== 0) {
    throw new Error("API failed: " + (body.msg || JSON.stringify(body)));
  }
  return body;
}

async function loadDetail(target) {
  const namespace = encodeURIComponent(target.namespace);
  const key = encodeURIComponent(target.key);
  const body = await requestJson("/conan-config/api/enhancedConfigs/detail/" + namespace + "/" + key);
  if (!body?.data?.config) throw new Error("Config detail does not exist.");
  return body.data;
}

async function loadSchema(schemaId) {
  if (!schemaId) return { row: null, schema: {}, form: {} };
  const rows = await requestJson("/conan-config/api/schema?ids=" + encodeURIComponent(schemaId));
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row?.schemaJson) throw new Error("Schema API did not return schemaJson for schemaId " + schemaId + ".");
  const parsed = JSON.parse(row.schemaJson);
  return { row, schema: parsed.schema || {}, form: parsed.form || {} };
}

function flattenTree(nodes, rootGroupingKey = "") {
  return (nodes || []).flatMap((node) => {
    const root = rootGroupingKey || node.rootGroupingKey || node.groupingKey || "";
    return [{ node, rootGroupingKey: root }, ...flattenTree(node.children || [], root)];
  });
}

async function loadTree() {
  const body = await requestJson("/conan-config/api/enhancedConfigs/searchTree");
  return body?.data?.configBases || [];
}

function validateDefinition(rawInput, grouping) {
  const definition = {
    groupingId: Number(rawInput.groupingId),
    key: String(rawInput.targetKey || rawInput.key || "").trim(),
    name: String(rawInput.targetName || rawInput.name || "").trim(),
    desc: String(rawInput.targetDesc || rawInput.desc || "").trim(),
    schemaId: Number(rawInput.schemaId),
  };
  const errors = [
    Number.isInteger(definition.groupingId) && definition.groupingId > 0 ? "" : "groupingId must be a positive integer.",
    /^[a-zA-Z0-9_]{5,50}$/.test(definition.key) ? "" : "key must be 5-50 letters, digits, or underscores.",
    definition.name && definition.name.length <= 20 ? "" : "name is required and must be at most 20 characters.",
    definition.desc && definition.desc.length <= 45 ? "" : "desc is required and must be at most 45 characters.",
    Number.isInteger(definition.schemaId) && definition.schemaId >= 0 ? "" : "schemaId must be a non-negative integer.",
    grouping ? "" : "groupingId does not exist.",
  ].filter(Boolean);
  if (errors.length) throw new Error(errors.join(" "));
  return { ...definition, rootGroupingKey: grouping.rootGroupingKey };
}

async function prepareDefinition(rawInput, overrides = {}) {
  const tree = await loadTree();
  const flatTree = flattenTree(tree);
  const groupingId = Number(rawInput.groupingId);
  const grouping = flatTree.find((item) => item.node.id === groupingId && item.node.type === 2);
  const definition = validateDefinition({ ...rawInput, ...overrides }, grouping);
  const duplicate = flatTree.find((item) => {
    return item.node.key === definition.key && item.rootGroupingKey === definition.rootGroupingKey;
  });
  if (duplicate) throw new Error("Config key already exists in target root grouping: " + definition.rootGroupingKey + "/" + definition.key);
  const schema = await loadSchema(definition.schemaId);
  return {
    definition,
    schema,
    groupingUpdatedTime: grouping.node.updatedTime || null,
    targetSha256: await sha256(definition),
  };
}

if (input.action === "list-spaces") {
  const body = await requestJson("/conan-config/api/enhancedConfigGroupings/rootGrouping");
  const spaces = body?.data || [];
  return { action: "list-spaces", environment, count: spaces.length, spaces };
}

if (input.action === "history") {
  const target = parseTarget(input);
  const detail = await loadDetail(target);
  const histories = detail.configHistories || [];
  const requestedIds = Array.isArray(input.historyIds) ? input.historyIds.map(Number).filter(Number.isInteger) : [];
  const details = requestedIds.length
    ? (await requestJson("/conan-config/api/enhancedConfigs/detailHistory?ids=" + requestedIds.join(",")))?.data || []
    : [];
  return {
    action: "history",
    environment,
    ...target,
    configId: detail.config.id,
    historyCount: histories.length,
    histories,
    details,
  };
}

if (input.action === "get-schema") {
  const schemaId = Number(input.schemaId) || (await loadDetail(parseTarget(input))).config.schemaId;
  const loaded = await loadSchema(schemaId);
  return {
    action: "get-schema",
    environment,
    schemaId,
    metadata: loaded.row,
    schema: loaded.schema,
    form: loaded.form,
  };
}

if (input.action === "prepare-publish-draft") {
  const target = parseTarget(input);
  const detail = await loadDetail(target);
  const config = detail.config;
  const draft = detail.configDraft;
  if (!draft?.id || !draft.config) throw new Error("Config has no draft to publish.");
  const currentValue = parseJsonValue(config.value);
  const draftValue = parseJsonValue(draft.config.value);
  const schemaId = draft.config.schemaId || config.schemaId;
  const loaded = await loadSchema(schemaId);
  return {
    action: "prepare-publish-draft",
    environment,
    ...target,
    configId: config.id,
    configDraftId: draft.id,
    draftOperator: draft.opLdap || "",
    schemaId,
    updatedTime: config.updatedTime,
    sourceSha256: await sha256(currentValue),
    draftSha256: await sha256(draftValue),
    currentValue,
    draftValue,
    diff: collectDiff(currentValue, draftValue),
    schema: loaded.schema,
    form: loaded.form,
    instruction: "Validate the complete draftValue, show the semantic diff and target environment, then obtain confirmation before publish-draft.",
  };
}

if (input.action === "prepare-create") {
  const prepared = await prepareDefinition(input);
  return {
    action: "prepare-create",
    environment,
    definition: prepared.definition,
    groupingUpdatedTime: prepared.groupingUpdatedTime,
    targetSha256: prepared.targetSha256,
    schema: prepared.schema.schema,
    form: prepared.schema.form,
    warnings: prepared.definition.schemaId === 0 ? ["The new config has no Formily schema."] : [],
    instruction: "Show the complete definition and environment, then obtain confirmation before create.",
  };
}

if (input.action === "prepare-copy") {
  const source = parseTarget(input, "source");
  const sourceDetail = await loadDetail(source);
  const sourceConfig = sourceDetail.config;
  const prepared = await prepareDefinition(input, {
    schemaId: sourceConfig.schemaId || 0,
    targetName: input.targetName || sourceConfig.name,
    targetDesc: input.targetDesc || sourceConfig.desc,
  });
  return {
    action: "prepare-copy",
    environment,
    source: { ...source, configId: sourceConfig.id, schemaId: sourceConfig.schemaId },
    target: prepared.definition,
    sourceUpdatedTime: sourceConfig.updatedTime,
    sourceDefinitionSha256: await sha256({
      id: sourceConfig.id,
      name: sourceConfig.name,
      desc: sourceConfig.desc,
      schemaId: sourceConfig.schemaId,
      updatedTime: sourceConfig.updatedTime,
    }),
    groupingUpdatedTime: prepared.groupingUpdatedTime,
    targetSha256: prepared.targetSha256,
    schema: prepared.schema.schema,
    form: prepared.schema.form,
    contentCopied: false,
    instruction: "B-side copy duplicates config metadata and schema only, not value content. Show source, target and environment, then obtain confirmation before copy.",
  };
}

if (input.action === "prepare-rollback") {
  const target = parseTarget(input);
  const historyId = Number(input.historyId);
  if (!Number.isInteger(historyId) || historyId <= 0) throw new Error("historyId must be a positive integer.");
  const detail = await loadDetail(target);
  const historyRows = (await requestJson("/conan-config/api/enhancedConfigs/detailHistory?ids=" + historyId))?.data || [];
  const historyRow = historyRows[0];
  if (!historyRow?.config) throw new Error("History record does not exist: " + historyId);
  const currentConfig = detail.config;
  if (historyRow.configId && historyRow.configId !== currentConfig.id) throw new Error("History record belongs to a different config.");
  const currentValue = parseJsonValue(currentConfig.value);
  const historicalValue = parseJsonValue(historyRow.config.value);
  const schemaId = historyRow.config.schemaId;
  const loaded = await loadSchema(schemaId);
  return {
    action: "prepare-rollback",
    environment,
    ...target,
    configId: currentConfig.id,
    historyId,
    hasDraft: !!detail.configDraft,
    schemaId,
    updatedTime: currentConfig.updatedTime,
    sourceSha256: await sha256(currentValue),
    historicalSha256: await sha256(historicalValue),
    currentValue,
    historicalValue,
    diff: collectDiff(currentValue, historicalValue),
    schema: loaded.schema,
    form: loaded.form,
    instruction: "Validate the complete historicalValue against its schema, show the semantic diff and environment, then obtain confirmation before rollback.",
  };
}

throw new Error("Unsupported Conan config read action: " + input.action);
`

const conanConfigLifecycleWriteScript = String.raw`
const CONFIG_ENVIRONMENTS = {
  "cn-prod": "https://conan.zhenguanyu.com",
  "cn-test": "https://ytkconan.zhenguanyu.com",
};

function resolveEnvironment(rawInput) {
  const nextInput = rawInput || {};
  const explicit = String(nextInput.environment || "").trim();
  if (explicit) {
    if (!CONFIG_ENVIRONMENTS[explicit]) throw new Error("Unsupported environment: " + explicit + ". Use cn-prod or cn-test.");
    return explicit;
  }
  const urlText = nextInput.url || nextInput.configUrl || nextInput.sourceUrl || "";
  if (!urlText) return "cn-prod";
  const hostname = new URL(urlText).hostname;
  if (hostname === "ytkconan.zhenguanyu.com" || hostname === "buff-test.zhenguanyu.com") return "cn-test";
  if (hostname === "conan.zhenguanyu.com" || hostname === "buff.zhenguanyu.com") return "cn-prod";
  throw new Error("Unsupported Conan config host: " + hostname);
}

function parseTarget(rawInput, prefix = "") {
  const nextInput = rawInput || {};
  const urlText = nextInput[prefix + "Url"] || (prefix ? "" : nextInput.url || nextInput.configUrl || "");
  const parsed = (() => {
    if (!urlText) return {};
    const url = new URL(urlText);
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    return {
      key: params.get("key") || url.searchParams.get("key") || "",
      namespace:
        params.get("rootGroupingKey") ||
        params.get("namespace") ||
        url.searchParams.get("rootGroupingKey") ||
        url.searchParams.get("namespace") ||
        "",
    };
  })();
  const key = nextInput[prefix + "Key"] || (prefix ? "" : nextInput.key) || parsed.key || "";
  const namespace =
    nextInput[prefix + "Namespace"] ||
    (prefix ? "" : nextInput.namespace || nextInput.rootGroupingKey) ||
    parsed.namespace ||
    "";
  if (!key || !namespace) throw new Error("Provide " + (prefix || "target") + "Url or namespace/key.");
  return { key, namespace };
}

function parseJsonValue(value) {
  if (value === undefined || value === null || value === "") return {};
  return typeof value === "string" ? JSON.parse(value || "{}") : value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const environment = resolveEnvironment(input);
const API_ORIGIN = CONFIG_ENVIRONMENTS[environment];

async function requestJson(path, options = {}) {
  if (!secrets.cookieHeader) {
    throw new Error("Missing saved cookie auth. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }
  const response = await fetch(API_ORIGIN + path, {
    ...options,
    headers: { "Content-Type": "application/json", Cookie: secrets.cookieHeader, ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })();
  if (response.status === 401 || response.status === 403) {
    throw new Error("Request failed " + response.status + ": login expired. Run: tabwright capability refresh-auth conan-config --browser user --json");
  }
  if (!response.ok) throw new Error("Request failed " + response.status + ": " + (typeof body === "string" ? body : JSON.stringify(body)));
  if (body && typeof body === "object" && body.code !== undefined && body.code !== 0) {
    throw new Error("API failed: " + (body.msg || JSON.stringify(body)));
  }
  return body;
}

async function loadDetail(target) {
  const namespace = encodeURIComponent(target.namespace);
  const key = encodeURIComponent(target.key);
  const body = await requestJson("/conan-config/api/enhancedConfigs/detail/" + namespace + "/" + key);
  if (!body?.data?.config) throw new Error("Config detail does not exist.");
  return body.data;
}

function flattenTree(nodes, rootGroupingKey = "") {
  return (nodes || []).flatMap((node) => {
    const root = rootGroupingKey || node.rootGroupingKey || node.groupingKey || "";
    return [{ node, rootGroupingKey: root }, ...flattenTree(node.children || [], root)];
  });
}

async function loadTree() {
  const body = await requestJson("/conan-config/api/enhancedConfigs/searchTree");
  return body?.data?.configBases || [];
}

function validateDefinition(rawInput, grouping) {
  const definition = {
    groupingId: Number(rawInput.groupingId),
    key: String(rawInput.targetKey || rawInput.key || "").trim(),
    name: String(rawInput.targetName || rawInput.name || "").trim(),
    desc: String(rawInput.targetDesc || rawInput.desc || "").trim(),
    schemaId: Number(rawInput.schemaId),
  };
  const errors = [
    Number.isInteger(definition.groupingId) && definition.groupingId > 0 ? "" : "groupingId must be a positive integer.",
    /^[a-zA-Z0-9_]{5,50}$/.test(definition.key) ? "" : "key must be 5-50 letters, digits, or underscores.",
    definition.name && definition.name.length <= 20 ? "" : "name is required and must be at most 20 characters.",
    definition.desc && definition.desc.length <= 45 ? "" : "desc is required and must be at most 45 characters.",
    Number.isInteger(definition.schemaId) && definition.schemaId >= 0 ? "" : "schemaId must be a non-negative integer.",
    grouping ? "" : "groupingId does not exist.",
  ].filter(Boolean);
  if (errors.length) throw new Error(errors.join(" "));
  return { ...definition, rootGroupingKey: grouping.rootGroupingKey };
}

async function prepareDefinition(rawInput, overrides = {}) {
  const tree = await loadTree();
  const flatTree = flattenTree(tree);
  const groupingId = Number(rawInput.groupingId);
  const grouping = flatTree.find((item) => item.node.id === groupingId && item.node.type === 2);
  const definition = validateDefinition({ ...rawInput, ...overrides }, grouping);
  const duplicate = flatTree.find((item) => {
    return item.node.key === definition.key && item.rootGroupingKey === definition.rootGroupingKey;
  });
  if (duplicate) throw new Error("Config key already exists in target root grouping: " + definition.rootGroupingKey + "/" + definition.key);
  return {
    definition,
    groupingUpdatedTime: grouping.node.updatedTime || null,
    targetSha256: await sha256(definition),
  };
}

function failure(status, target, validationErrors) {
  return {
    status,
    environment,
    ...target,
    validationErrors,
    submitted: false,
    published: false,
    verified: false,
  };
}

function reportErrors(report, expected) {
  if (!report?.passed || (report.errors || []).length) return report?.errors || ["AI validation did not pass."];
  if ((report.warnings || []).length && report.warningsAccepted !== true) return report.warnings;
  return Object.entries(expected).flatMap(([key, value]) => {
    return report[key] === value ? [] : [key + " changed after preparation."];
  });
}

function updatePayload(config, value, operationType, schemaId = config.schemaId) {
  return {
    desc: config.desc,
    groupingId: config.groupingId,
    id: config.id,
    name: config.name,
    schemaId,
    updatedTime: config.updatedTime,
    value: JSON.stringify(value),
    operationType,
  };
}

async function createDraft(config, value, operationType, schemaId = config.schemaId) {
  const body = await requestJson("/conan-config/api/enhancedConfigs/update", {
    method: "POST",
    body: JSON.stringify(updatePayload(config, value, operationType, schemaId)),
  });
  if (!body?.data) throw new Error("Update API did not return configDraftId.");
  return body.data;
}

async function publishDraft(configId, configDraftId) {
  const body = await requestJson("/conan-config/api/enhancedConfigs/publish", {
    method: "POST",
    body: JSON.stringify({ configId, configDraftId }),
  });
  if (!body?.data) throw new Error("Publish API did not return success.");
}

if (input.action === "save-draft") {
  const target = parseTarget(input);
  const detail = await loadDetail(target);
  const config = detail.config;
  if (detail.configDraft) return failure("draft_exists", target, ["An existing draft must be published or discarded first."]);
  const currentValue = parseJsonValue(config.value);
  const targetValue = input.value;
  const expected = {
    environment,
    schemaId: config.schemaId,
    updatedTime: config.updatedTime,
    sourceSha256: await sha256(currentValue),
    targetSha256: await sha256(targetValue),
  };
  const errors = reportErrors(input.validationReport, expected);
  if (errors.length) return failure("validation_failed", target, errors);
  const configDraftId = await createDraft(config, targetValue, 3);
  const verifiedDetail = await loadDetail(target);
  const verifiedDraft = verifiedDetail.configDraft;
  const verifiedDraftSha256 = verifiedDraft?.config ? await sha256(parseJsonValue(verifiedDraft.config.value)) : "";
  const verified = verifiedDraft?.id === configDraftId && verifiedDraftSha256 === expected.targetSha256;
  if (!verified) throw new Error("Draft verification failed.");
  return {
    status: "draft_saved",
    environment,
    ...target,
    configId: config.id,
    configDraftId,
    targetSha256: expected.targetSha256,
    validationErrors: [],
    submitted: true,
    published: false,
    verified,
  };
}

if (input.action === "publish-draft") {
  const target = parseTarget(input);
  const detail = await loadDetail(target);
  const config = detail.config;
  const draft = detail.configDraft;
  if (!draft?.id || !draft.config) return failure("draft_missing", target, ["Config has no draft to publish."]);
  const expected = {
    environment,
    configDraftId: draft.id,
    schemaId: draft.config.schemaId || config.schemaId,
    updatedTime: config.updatedTime,
    sourceSha256: await sha256(parseJsonValue(config.value)),
    draftSha256: await sha256(parseJsonValue(draft.config.value)),
  };
  const errors = reportErrors(input.validationReport, expected);
  if (errors.length) return failure("validation_failed", target, errors);
  await publishDraft(config.id, draft.id);
  const namespace = encodeURIComponent(target.namespace);
  const key = encodeURIComponent(target.key);
  const verifiedConfig = await requestJson("/conan-config/api/newConfigs/" + namespace + "/" + key);
  const verifiedSha256 = await sha256(parseJsonValue(verifiedConfig.value));
  const verifiedDetail = await loadDetail(target);
  const verified = verifiedSha256 === expected.draftSha256 && !verifiedDetail.configDraft;
  if (!verified) throw new Error("Published draft verification failed.");
  return {
    status: "published",
    environment,
    ...target,
    configId: config.id,
    configDraftId: draft.id,
    targetSha256: expected.draftSha256,
    verifiedSha256,
    validationErrors: [],
    submitted: true,
    published: true,
    verified,
  };
}

if (input.action === "discard-draft") {
  const target = parseTarget(input);
  const detail = await loadDetail(target);
  const config = detail.config;
  const draft = detail.configDraft;
  if (!draft?.id || !draft.config) return failure("draft_missing", target, ["Config has no draft to discard."]);
  const draftSha256 = await sha256(parseJsonValue(draft.config.value));
  if (draft.id !== Number(input.configDraftId) || draftSha256 !== input.draftSha256) {
    return failure("draft_changed", target, ["Draft id or content changed after inspection."]);
  }
  await requestJson("/conan-config/api/enhancedConfigs/unPublish", {
    method: "POST",
    body: JSON.stringify({ configId: config.id, configDraftId: draft.id }),
  });
  const verifiedDetail = await loadDetail(target);
  const verified = !verifiedDetail.configDraft;
  if (!verified) throw new Error("Discarded draft verification failed.");
  return {
    status: "draft_discarded",
    environment,
    ...target,
    configId: config.id,
    configDraftId: draft.id,
    validationErrors: [],
    submitted: true,
    published: false,
    verified,
  };
}

if (input.action === "create") {
  const prepared = await prepareDefinition(input);
  const report = input.preparationReport || {};
  const errors = [
    report.environment === environment ? "" : "environment changed after preparation.",
    report.targetSha256 === prepared.targetSha256 ? "" : "target definition changed after preparation.",
    report.groupingUpdatedTime === prepared.groupingUpdatedTime ? "" : "target grouping changed after preparation.",
  ].filter(Boolean);
  if (errors.length) return failure("preparation_changed", { namespace: prepared.definition.rootGroupingKey, key: prepared.definition.key }, errors);
  const body = await requestJson("/conan-config/api/enhancedConfigs/add", {
    method: "POST",
    body: JSON.stringify({
      groupingId: prepared.definition.groupingId,
      key: prepared.definition.key,
      name: prepared.definition.name,
      desc: prepared.definition.desc,
      schemaId: prepared.definition.schemaId,
    }),
  });
  const created = body?.data;
  const configId = Number(created?.id || created);
  const target = { namespace: created?.rootGroupingKey || prepared.definition.rootGroupingKey, key: created?.key || prepared.definition.key };
  const verifiedDetail = Number.isInteger(configId) && configId > 0
    ? (await requestJson("/conan-config/api/enhancedConfigs/detail?id=" + configId))?.data
    : await loadDetail(target);
  const verifiedConfig = verifiedDetail?.config;
  const verified =
    !!verifiedConfig &&
    verifiedConfig.key === target.key &&
    verifiedConfig.groupingId === prepared.definition.groupingId &&
    verifiedConfig.schemaId === prepared.definition.schemaId;
  if (!verified) throw new Error("Created config verification failed.");
  return {
    status: "created",
    environment,
    ...target,
    configId: verifiedConfig.id,
    definition: prepared.definition,
    validationErrors: [],
    submitted: true,
    published: true,
    verified,
  };
}

if (input.action === "copy") {
  const source = parseTarget(input, "source");
  const sourceDetail = await loadDetail(source);
  const sourceConfig = sourceDetail.config;
  const prepared = await prepareDefinition(input, {
    schemaId: sourceConfig.schemaId || 0,
    targetName: input.targetName || sourceConfig.name,
    targetDesc: input.targetDesc || sourceConfig.desc,
  });
  const sourceDefinitionSha256 = await sha256({
    id: sourceConfig.id,
    name: sourceConfig.name,
    desc: sourceConfig.desc,
    schemaId: sourceConfig.schemaId,
    updatedTime: sourceConfig.updatedTime,
  });
  const report = input.preparationReport || {};
  const errors = [
    report.environment === environment ? "" : "environment changed after preparation.",
    report.targetSha256 === prepared.targetSha256 ? "" : "target definition changed after preparation.",
    report.groupingUpdatedTime === prepared.groupingUpdatedTime ? "" : "target grouping changed after preparation.",
    report.sourceDefinitionSha256 === sourceDefinitionSha256 ? "" : "source definition changed after preparation.",
  ].filter(Boolean);
  if (errors.length) return failure("preparation_changed", { namespace: prepared.definition.rootGroupingKey, key: prepared.definition.key }, errors);
  const body = await requestJson("/conan-config/api/enhancedConfigs/add", {
    method: "POST",
    body: JSON.stringify({
      groupingId: prepared.definition.groupingId,
      key: prepared.definition.key,
      name: prepared.definition.name,
      desc: prepared.definition.desc,
      schemaId: sourceConfig.schemaId || 0,
    }),
  });
  const created = body?.data;
  const configId = Number(created?.id || created);
  const target = { namespace: created?.rootGroupingKey || prepared.definition.rootGroupingKey, key: created?.key || prepared.definition.key };
  const verifiedDetail = Number.isInteger(configId) && configId > 0
    ? (await requestJson("/conan-config/api/enhancedConfigs/detail?id=" + configId))?.data
    : await loadDetail(target);
  const verifiedConfig = verifiedDetail?.config;
  const verified = !!verifiedConfig && verifiedConfig.key === target.key && verifiedConfig.schemaId === sourceConfig.schemaId;
  if (!verified) throw new Error("Copied config verification failed.");
  return {
    status: "copied",
    environment,
    source: { ...source, configId: sourceConfig.id },
    target: { ...target, configId: verifiedConfig.id },
    contentCopied: false,
    validationErrors: [],
    submitted: true,
    published: true,
    verified,
  };
}

if (input.action === "rollback") {
  const target = parseTarget(input);
  const historyId = Number(input.historyId);
  const detail = await loadDetail(target);
  if (detail.configDraft) return failure("draft_exists", target, ["Publish or discard the current draft before rollback."]);
  const historyRows = (await requestJson("/conan-config/api/enhancedConfigs/detailHistory?ids=" + historyId))?.data || [];
  const historyRow = historyRows[0];
  if (!historyRow?.config) return failure("history_missing", target, ["History record does not exist."]);
  const config = detail.config;
  if (historyRow.configId && historyRow.configId !== config.id) return failure("history_mismatch", target, ["History record belongs to a different config."]);
  const currentValue = parseJsonValue(config.value);
  const historicalValue = parseJsonValue(historyRow.config.value);
  const expected = {
    environment,
    historyId,
    schemaId: historyRow.config.schemaId,
    updatedTime: config.updatedTime,
    sourceSha256: await sha256(currentValue),
    historicalSha256: await sha256(historicalValue),
  };
  const errors = reportErrors(input.validationReport, expected);
  if (errors.length) return failure("validation_failed", target, errors);
  const configDraftId = await createDraft(config, historicalValue, 4, historyRow.config.schemaId);
  await publishDraft(config.id, configDraftId);
  const verifiedDetail = await loadDetail(target);
  const verifiedConfig = verifiedDetail.config;
  const verifiedSha256 = await sha256(parseJsonValue(verifiedConfig.value));
  const verified = verifiedSha256 === expected.historicalSha256 && verifiedConfig.schemaId === expected.schemaId && !verifiedDetail.configDraft;
  if (!verified) throw new Error("Rollback verification failed.");
  return {
    status: "rolled_back",
    environment,
    ...target,
    configId: config.id,
    configDraftId,
    historyId,
    targetSha256: expected.historicalSha256,
    verifiedSha256,
    validationErrors: [],
    submitted: true,
    published: true,
    verified,
  };
}

throw new Error("Unsupported Conan config write action: " + input.action);
`

const conanConfigScript = [
  'if (input.action === "search") { return await (async () => {',
  conanConfigSearchScript,
  '})() }',
  'if (input.action === "get") { return await (async () => {',
  conanConfigQueryScript,
  '})() }',
  'if (input.action === "prepare-change") { return await (async () => {',
  conanConfigPrepareChangeScript,
  '})() }',
  'if (input.action === "apply-change") { return await (async () => {',
  conanConfigApplyChangeScript,
  '})() }',
  'if (["list-spaces", "history", "get-schema", "prepare-publish-draft", "prepare-create", "prepare-copy", "prepare-rollback"].includes(input.action)) { return await (async () => {',
  conanConfigLifecycleReadScript,
  '})() }',
  'if (["save-draft", "publish-draft", "discard-draft", "create", "copy", "rollback"].includes(input.action)) { return await (async () => {',
  conanConfigLifecycleWriteScript,
  '})() }',
  'throw new Error("Unsupported Conan config action: " + input.action)',
  '',
].join('\n')

const conanConfigEnvironmentProperty = {
  type: 'string',
  enum: ['cn-prod', 'cn-test'],
  description: '国内正式或国内测试环境；配置后台 URL 可自动推断。',
}

const conanConfigTargetInputProperties = {
  environment: conanConfigEnvironmentProperty,
  url: { type: 'string' },
  configUrl: { type: 'string' },
  namespace: { type: 'string' },
  rootGroupingKey: { type: 'string' },
  key: { type: 'string' },
}

const conanConfigDefinitionInputProperties = {
  environment: conanConfigEnvironmentProperty,
  groupingId: { type: 'number' },
  key: { type: 'string' },
  targetKey: { type: 'string' },
  name: { type: 'string' },
  targetName: { type: 'string' },
  desc: { type: 'string' },
  targetDesc: { type: 'string' },
  schemaId: { type: 'number' },
}

const conanConfigWriteOutputSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    environment: { type: 'string' },
    validationErrors: { type: 'array' },
    submitted: { type: 'boolean' },
    published: { type: 'boolean' },
    verified: { type: 'boolean' },
  },
  required: ['status', 'environment', 'validationErrors', 'submitted', 'published', 'verified'],
}

const conanConfigCapabilityDefinitions: BuiltinCapabilityDefinition[] = [
  {
    id: 'conan-config',
    title: 'Conan 文案配置',
    description:
      '搜索、读取和管理国内正式/测试环境的 Conan/Buff Space_Enhanced_Config 配置生命周期；只读操作可自动执行，草稿、发布、新建、复制、丢弃草稿和回滚必须人工确认。',
    script: conanConfigScript,
    manifest: {
      runtime: 'node',
      status: 'trusted',
      permissions: ['network:https://conan.zhenguanyu.com/*', 'network:https://ytkconan.zhenguanyu.com/*'],
      sideEffect: 'write',
      requiresConfirmation: true,
      whenToUse: [
        '搜索 Conan/Buff 文案配置目录或配置值',
        '通过 Space_Enhanced_Config 后台链接或 namespace/key 读取完整配置',
        '查看空间、Schema、草稿和历史版本',
        '修改配置前读取当前值和完整 Formily schema，生成语义 Diff 与 AI 校验报告',
        '用户确认结构化 Diff 后保存草稿、发布、丢弃草稿或回滚，并回读验证',
        '经用户确认后新建配置或复制已有配置定义与 Schema',
      ],
      whenNotToUse: [
        '删除配置、管理分组、创建或编辑 Schema、置顶收藏配置',
        '操作海外环境；当前仅支持 cn-prod 和 cn-test',
        '缺少完整目标值、AI 校验报告或用户写入确认时发布配置',
        '覆盖已有草稿或在源配置变化后继续使用旧校验报告',
      ],
      tags: [
        'conan-config',
        'copywriting',
        'search',
        'query',
        'draft',
        'history',
        'rollback',
        'schema-validation',
        'publish',
        'node-runtime',
      ],
      auth: {
        type: 'cookie',
        refresh: 'from-browser',
        secretKey: 'cookieHeader',
        browserUrls: [
          'https://conan.zhenguanyu.com/',
          'https://ytkconan.zhenguanyu.com/',
          'https://buff.zhenguanyu.com/',
          'https://buff-test.zhenguanyu.com/',
        ],
        requiredCookieNames: [],
        failureSignals: [
          'Full authentication is required',
          'Request failed 401',
          'Request failed 403',
          'Missing saved cookie auth',
        ],
      },
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
        },
        required: ['action'],
      },
      outputSchema: {
        type: 'object',
        properties: {},
      },
      operations: {
        search: {
          title: '搜索配置',
          description: '通过 searchTree API 按 config、configValue、grouping 搜索配置目录。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: conanConfigEnvironmentProperty,
              query: { type: 'string' },
              keyword: { type: 'string' },
              search: { type: 'string' },
              mode: { type: 'string' },
              limit: { type: 'number' },
              includeRawTree: { type: 'boolean' },
            },
            required: ['action', 'query'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              query: { type: 'string' },
              resultCount: { type: 'number' },
              results: { type: 'array' },
              view: { type: 'object' },
            },
            required: ['action', 'environment', 'query', 'resultCount', 'results', 'view'],
          },
        },
        get: {
          title: '读取配置',
          description: '通过精确后台链接或 namespace/key 读取当前值、Schema 摘要和本地产物。',
          match: [
            'https://buff.zhenguanyu.com/*Space_Enhanced_Config*key=*rootGroupingKey=*',
            'https://conan.zhenguanyu.com/*Space_Enhanced_Config*key=*rootGroupingKey=*',
            'https://buff-test.zhenguanyu.com/*Space_Enhanced_Config*key=*rootGroupingKey=*',
            'https://ytkconan.zhenguanyu.com/*Space_Enhanced_Config*key=*rootGroupingKey=*',
            'Space_Enhanced_Config key rootGroupingKey namespace',
          ],
          routingHint: 'exact-match-direct-run',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: conanConfigEnvironmentProperty,
              url: { type: 'string' },
              configUrl: { type: 'string' },
              namespace: { type: 'string' },
              rootGroupingKey: { type: 'string' },
              grouping: { type: 'string' },
              key: { type: 'string' },
              includeRawValue: { type: 'boolean' },
              saveArtifacts: { type: 'boolean' },
            },
            required: ['action'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              namespace: { type: 'string' },
              key: { type: 'string' },
              configId: { type: 'number' },
              metadata: { type: 'object' },
              value: { type: 'object' },
              schema: { type: 'object' },
              view: { type: 'object' },
              artifacts: { type: 'object' },
            },
            required: ['action', 'environment', 'namespace', 'key', 'configId', 'metadata', 'value', 'schema', 'view'],
          },
        },
        'list-spaces': {
          title: '列出配置空间',
          description: '读取国内正式或测试环境的根配置空间及权限信息。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: conanConfigEnvironmentProperty,
            },
            required: ['action'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              count: { type: 'number' },
              spaces: { type: 'array' },
            },
            required: ['action', 'environment', 'count', 'spaces'],
          },
        },
        history: {
          title: '查看配置历史',
          description: '读取版本记录，并可按 historyIds 拉取历史版本的完整配置。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigTargetInputProperties,
              historyIds: { type: 'array', items: { type: 'number' } },
            },
            required: ['action'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              namespace: { type: 'string' },
              key: { type: 'string' },
              configId: { type: 'number' },
              historyCount: { type: 'number' },
              histories: { type: 'array' },
              details: { type: 'array' },
            },
            required: ['action', 'environment', 'namespace', 'key', 'configId', 'historyCount', 'histories', 'details'],
          },
        },
        'get-schema': {
          title: '读取配置 Schema',
          description: '按 schemaId 或配置目标读取完整 Formily schema、form 和元数据。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigTargetInputProperties,
              schemaId: { type: 'number' },
            },
            required: ['action'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              schemaId: { type: 'number' },
              metadata: { type: ['object', 'null'] },
              schema: { type: 'object' },
              form: { type: 'object' },
            },
            required: ['action', 'environment', 'schemaId', 'metadata', 'schema', 'form'],
          },
        },
        'prepare-publish-draft': {
          title: '准备发布草稿',
          description: '读取当前线上值和草稿，计算哈希与语义 Diff，供 AI 校验后确认发布。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigTargetInputProperties,
            },
            required: ['action'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              namespace: { type: 'string' },
              key: { type: 'string' },
              configId: { type: 'number' },
              configDraftId: { type: 'number' },
              schemaId: { type: 'number' },
              updatedTime: { type: 'number' },
              sourceSha256: { type: 'string' },
              draftSha256: { type: 'string' },
              currentValue: { type: 'object' },
              draftValue: { type: 'object' },
              diff: { type: 'array' },
              schema: { type: 'object' },
              form: { type: 'object' },
            },
            required: [
              'action',
              'environment',
              'namespace',
              'key',
              'configId',
              'configDraftId',
              'schemaId',
              'updatedTime',
              'sourceSha256',
              'draftSha256',
              'currentValue',
              'draftValue',
              'diff',
              'schema',
              'form',
            ],
          },
        },
        'prepare-create': {
          title: '准备新建配置',
          description: '校验目标分组、key、名称、描述和 Schema，生成不可变的新建预览。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigDefinitionInputProperties,
            },
            required: ['action', 'groupingId', 'key', 'name', 'desc', 'schemaId'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              definition: { type: 'object' },
              groupingUpdatedTime: { type: ['number', 'null'] },
              targetSha256: { type: 'string' },
              schema: { type: 'object' },
              form: { type: 'object' },
              warnings: { type: 'array' },
            },
            required: [
              'action',
              'environment',
              'definition',
              'groupingUpdatedTime',
              'targetSha256',
              'schema',
              'form',
              'warnings',
            ],
          },
        },
        'prepare-copy': {
          title: '准备复制配置定义',
          description: '读取源配置并校验目标分组和 key；与 B 端一致，仅复制元数据和 Schema，不复制内容值。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: conanConfigEnvironmentProperty,
              sourceUrl: { type: 'string' },
              sourceNamespace: { type: 'string' },
              sourceKey: { type: 'string' },
              groupingId: { type: 'number' },
              targetKey: { type: 'string' },
              targetName: { type: 'string' },
              targetDesc: { type: 'string' },
            },
            required: ['action', 'groupingId', 'targetKey'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              source: { type: 'object' },
              target: { type: 'object' },
              sourceUpdatedTime: { type: 'number' },
              sourceDefinitionSha256: { type: 'string' },
              groupingUpdatedTime: { type: ['number', 'null'] },
              targetSha256: { type: 'string' },
              schema: { type: 'object' },
              form: { type: 'object' },
              contentCopied: { type: 'boolean' },
            },
            required: [
              'action',
              'environment',
              'source',
              'target',
              'sourceUpdatedTime',
              'sourceDefinitionSha256',
              'groupingUpdatedTime',
              'targetSha256',
              'schema',
              'form',
              'contentCopied',
            ],
          },
        },
        'prepare-rollback': {
          title: '准备回滚历史版本',
          description: '读取指定历史版本，计算当前值与历史值的哈希和语义 Diff，供 AI 校验。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigTargetInputProperties,
              historyId: { type: 'number' },
            },
            required: ['action', 'historyId'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              namespace: { type: 'string' },
              key: { type: 'string' },
              configId: { type: 'number' },
              historyId: { type: 'number' },
              hasDraft: { type: 'boolean' },
              schemaId: { type: 'number' },
              updatedTime: { type: 'number' },
              sourceSha256: { type: 'string' },
              historicalSha256: { type: 'string' },
              currentValue: { type: 'object' },
              historicalValue: { type: 'object' },
              diff: { type: 'array' },
              schema: { type: 'object' },
              form: { type: 'object' },
            },
            required: [
              'action',
              'environment',
              'namespace',
              'key',
              'configId',
              'historyId',
              'hasDraft',
              'schemaId',
              'updatedTime',
              'sourceSha256',
              'historicalSha256',
              'currentValue',
              'historicalValue',
              'diff',
              'schema',
              'form',
            ],
          },
        },
        'prepare-change': {
          title: '准备并校验修改',
          description: '读取当前值和完整 Formily schema，计算源值/目标值哈希与语义 Diff，供 AI 生成校验报告。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'read',
          requiresConfirmation: false,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: conanConfigEnvironmentProperty,
              url: { type: 'string' },
              namespace: { type: 'string' },
              rootGroupingKey: { type: 'string' },
              key: { type: 'string' },
              value: { type: 'object' },
              changeSummary: { type: 'string' },
            },
            required: ['action'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: { type: 'string' },
              namespace: { type: 'string' },
              key: { type: 'string' },
              schemaId: { type: 'number' },
              updatedTime: { type: 'number' },
              sourceSha256: { type: 'string' },
              currentValue: { type: 'object' },
              schema: { type: 'object' },
              diff: { type: 'array' },
            },
            required: [
              'action',
              'environment',
              'namespace',
              'key',
              'schemaId',
              'updatedTime',
              'sourceSha256',
              'currentValue',
              'schema',
              'diff',
            ],
          },
        },
        'apply-change': {
          title: '发布修改',
          description: '校验 AI 报告、目标哈希、源值和版本后更新发布，并回读验证。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'write',
          requiresConfirmation: true,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: conanConfigEnvironmentProperty,
              url: { type: 'string' },
              namespace: { type: 'string' },
              rootGroupingKey: { type: 'string' },
              key: { type: 'string' },
              value: { type: 'object' },
              changeSummary: { type: 'string' },
              validationReport: { type: 'object' },
            },
            required: ['action', 'value', 'changeSummary', 'validationReport'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              environment: { type: 'string' },
              validationErrors: { type: 'array' },
              submitted: { type: 'boolean' },
            },
            required: ['status', 'environment', 'validationErrors', 'submitted'],
          },
        },
        'save-draft': {
          title: '保存配置草稿',
          description: '校验目标值、源值哈希和版本后保存草稿，不发布；已有草稿时拒绝覆盖。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'write',
          requiresConfirmation: true,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigTargetInputProperties,
              value: { type: 'object' },
              changeSummary: { type: 'string' },
              validationReport: { type: 'object' },
            },
            required: ['action', 'value', 'changeSummary', 'validationReport'],
          },
          outputSchema: conanConfigWriteOutputSchema,
        },
        'publish-draft': {
          title: '发布已有草稿',
          description: '校验草稿 ID、内容哈希、线上源值和 Schema 后发布，并回读验证。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'write',
          requiresConfirmation: true,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigTargetInputProperties,
              validationReport: { type: 'object' },
            },
            required: ['action', 'validationReport'],
          },
          outputSchema: conanConfigWriteOutputSchema,
        },
        'discard-draft': {
          title: '丢弃已有草稿',
          description: '核对草稿 ID 和内容哈希后丢弃草稿，并确认草稿已消失。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'write',
          requiresConfirmation: true,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigTargetInputProperties,
              configDraftId: { type: 'number' },
              draftSha256: { type: 'string' },
            },
            required: ['action', 'configDraftId', 'draftSha256'],
          },
          outputSchema: conanConfigWriteOutputSchema,
        },
        create: {
          title: '新建配置',
          description: '复核 prepare-create 的目标定义和分组版本后新建配置，并回读验证。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'write',
          requiresConfirmation: true,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigDefinitionInputProperties,
              preparationReport: { type: 'object' },
            },
            required: ['action', 'groupingId', 'key', 'name', 'desc', 'schemaId', 'preparationReport'],
          },
          outputSchema: conanConfigWriteOutputSchema,
        },
        copy: {
          title: '复制配置定义',
          description: '复核源配置和目标定义后新建配置，沿用源 Schema；不复制内容值。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'write',
          requiresConfirmation: true,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              environment: conanConfigEnvironmentProperty,
              sourceUrl: { type: 'string' },
              sourceNamespace: { type: 'string' },
              sourceKey: { type: 'string' },
              groupingId: { type: 'number' },
              targetKey: { type: 'string' },
              targetName: { type: 'string' },
              targetDesc: { type: 'string' },
              preparationReport: { type: 'object' },
            },
            required: ['action', 'groupingId', 'targetKey', 'preparationReport'],
          },
          outputSchema: conanConfigWriteOutputSchema,
        },
        rollback: {
          title: '回滚历史版本',
          description: '复核历史版本、当前源值、Schema 和版本后创建回滚草稿、发布并验证。',
          match: [],
          routingHint: 'search-first',
          sideEffect: 'write',
          requiresConfirmation: true,
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              ...conanConfigTargetInputProperties,
              historyId: { type: 'number' },
              validationReport: { type: 'object' },
            },
            required: ['action', 'historyId', 'validationReport'],
          },
          outputSchema: conanConfigWriteOutputSchema,
        },
      },
      examples: [
        {
          description: '用户给 Space_Enhanced_Config 后台链接时，直接解析 URL 并查询配置。',
          input: {
            action: 'get',
            url: 'https://buff.zhenguanyu.com/buff-army/#/buff-oversea-designer/Space_Enhanced_Config?key=wareLandingPageSendCouponConfig&rootGroupingKey=Space_Pedia',
          },
        },
        {
          description: '搜索会员订单相关配置',
          input: { action: 'search', query: '会员订单' },
        },
      ],
    },
  },
]

const conanConfigAgentSkillDefinitions: BuiltinAgentSkillDefinition[] = [
  {
    target: 'codex',
    name: 'conan-config',
    files: [
      {
        relativePath: 'SKILL.md',
        bundledPath: 'agent-skills/conan-config/SKILL.md',
      },
      {
        relativePath: 'agents/openai.yaml',
        bundledPath: 'agent-skills/conan-config/agents/openai.yaml',
      },
    ],
  },
]

export function installBuiltinCapabilitySuite(
  options: InstallBuiltinCapabilitySuiteOptions,
): InstalledBuiltinCapabilitySuite {
  if (!isBuiltinCapabilitySuite(options.suite)) {
    throw new Error(`Unknown builtin capability suite: ${options.suite}`)
  }
  const location = options.location || 'user'
  const capabilities = conanConfigCapabilityDefinitions.map((definition) => {
    if (options.overwrite) {
      removeCapabilityAuthFiles({
        capabilityDir: getCapabilityDir({ id: definition.id, location, cwd: options.cwd }),
      })
    }
    createCapability({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      location,
      cwd: options.cwd,
      overwrite: options.overwrite,
      createdBy: 'ai',
      runtime: 'node',
    })
    updateCapabilityScript({
      id: definition.id,
      cwd: options.cwd,
      source: definition.script.trimStart(),
    })
    const capability = updateCapabilityManifest({
      id: definition.id,
      cwd: options.cwd,
      allowUnvalidatedTrust: options.trust !== false,
      patch: {
        ...definition.manifest,
        status: options.trust === false ? 'draft' : 'trusted',
      },
    })
    const script = readCapabilityScript({ id: definition.id, cwd: options.cwd })
    if (!script.includes('CONFIG_API_ORIGIN')) {
      throw new Error(`Failed to install builtin capability script: ${definition.id}`)
    }
    return capability
  })
  const agentSkills =
    options.installAgentSkills === false
      ? []
      : installBuiltinAgentSkills({
          definitions: conanConfigAgentSkillDefinitions,
          overwrite: options.overwrite,
          codexHome: options.codexHome,
        })
  return { suite: options.suite, capabilities, agentSkills }
}

function installBuiltinAgentSkills(options: {
  definitions: BuiltinAgentSkillDefinition[]
  overwrite?: boolean
  codexHome?: string
}): InstalledBuiltinAgentSkill[] {
  return options.definitions.map((definition) => {
    if (definition.target !== 'codex') {
      throw new Error(`Unsupported builtin agent skill target: ${definition.target}`)
    }
    return installCodexAgentSkill({
      definition,
      overwrite: options.overwrite,
      codexHome: options.codexHome,
    })
  })
}

function installCodexAgentSkill(options: {
  definition: BuiltinAgentSkillDefinition
  overwrite?: boolean
  codexHome?: string
}): InstalledBuiltinAgentSkill {
  const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const dir = path.join(codexHome, 'skills', options.definition.name)
  const files = options.definition.files.map((file) => {
    return installCodexAgentSkillFile({
      skillDir: dir,
      file,
      overwrite: options.overwrite,
    })
  })
  return {
    target: 'codex',
    name: options.definition.name,
    dir,
    files,
  }
}

function installCodexAgentSkillFile(options: {
  skillDir: string
  file: BuiltinAgentSkillFileDefinition
  overwrite?: boolean
}): InstalledBuiltinAgentSkillFile {
  const targetPath = resolveInsideDirectory({
    root: options.skillDir,
    relativePath: options.file.relativePath,
  })
  const content = readBundledAgentSkillFile(options.file.bundledPath)
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, 'utf-8')
    if (existing === content) {
      return { path: targetPath, status: 'unchanged' }
    }
    if (!options.overwrite) {
      throw new Error(
        `Agent skill file already exists with different content: ${targetPath}. Use --force to overwrite.`,
      )
    }
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const status = fs.existsSync(targetPath) ? 'updated' : 'created'
  fs.writeFileSync(targetPath, content)
  return { path: targetPath, status }
}

function readBundledAgentSkillFile(relativePath: string): string {
  const moduleDir = path.dirname(nodeUrl.fileURLToPath(import.meta.url))
  const candidates = [path.join(moduleDir, relativePath), path.join(moduleDir, '..', 'src', relativePath)]
  const sourcePath = candidates.find((candidate) => {
    return fs.existsSync(candidate)
  })
  if (!sourcePath) {
    throw new Error(`Bundled agent skill file not found: ${relativePath}`)
  }
  return fs.readFileSync(sourcePath, 'utf-8')
}

function resolveInsideDirectory(options: { root: string; relativePath: string }): string {
  const root = path.resolve(options.root)
  const targetPath = path.resolve(root, ...options.relativePath.split('/'))
  if (targetPath !== root && !targetPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Agent skill file must stay inside skill directory: ${options.relativePath}`)
  }
  return targetPath
}
