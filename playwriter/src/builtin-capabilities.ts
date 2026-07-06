import {
  createCapability,
  readCapabilityScript,
  updateCapabilityManifest,
  updateCapabilityScript,
  type CapabilityLocation,
  type CapabilityRecord,
} from './capability-registry.js'

export interface InstallBuiltinCapabilitySuiteOptions {
  suite: string
  cwd?: string
  location?: CapabilityLocation
  overwrite?: boolean
  trust?: boolean
}

export interface InstalledBuiltinCapabilitySuite {
  suite: string
  capabilities: CapabilityRecord[]
}

interface BuiltinCapabilityDefinition {
  id: string
  title: string
  description: string
  script: string
  manifest: Parameters<typeof updateCapabilityManifest>[0]['patch']
}

const conanConfigSearchScript = String.raw`
const CONFIG_API_ORIGIN = "https://conan.zhenguanyu.com";
const DEFAULT_MODES = ["config", "configValue", "grouping"];

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
    throw new Error("Missing saved cookie auth. Run: playwriter capability refresh-auth conan-config-search --browser user --json");
  }

  const response = await fetch(CONFIG_API_ORIGIN + path, {
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
  });
  const body = await response.json();

  if (response.status === 401 || response.status === 403) {
    throw new Error("Request failed " + response.status + ": login expired. Run: playwriter capability refresh-auth conan-config-search --browser user --json");
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
const CONFIG_API_ORIGIN = "https://conan.zhenguanyu.com";

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

async function requestJson(path, options = {}) {
  const cookieHeader = secrets.cookieHeader;
  if (!cookieHeader) {
    throw new Error("Missing saved cookie auth. Run: playwriter capability refresh-auth conan-config-query --browser user --json");
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
    throw new Error("Request failed " + response.status + ": login expired. Run: playwriter capability refresh-auth conan-config-query --browser user --json");
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

  return {
    action: "query",
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
}

const normalized = normalizeInput(input);
return await loadConfig(normalized);
`

const conanConfigCapabilityDefinitions: BuiltinCapabilityDefinition[] = [
  {
    id: 'conan-config-search',
    title: 'Conan config search',
    description:
      'Search Conan enhanced config catalogue through the backend searchTree API without opening the admin page.',
    script: conanConfigSearchScript,
    manifest: {
      runtime: 'node',
      status: 'trusted',
      permissions: ['network:https://conan.zhenguanyu.com/*'],
      sideEffect: 'read',
      requiresConfirmation: false,
      whenToUse: [
        '用户说配置查询、搜索配置、按关键词查配置目录',
        '用户还没有明确 key，只想先搜索有哪些配置命中',
        '需要按 config、configValue、grouping 三种搜索维度查询配置项',
      ],
      whenNotToUse: [
        '用户已经给出明确 key 并要读取完整配置 value；应使用 conan-config-query',
        '用户要修改、发布、回滚配置；当前内置能力只读',
      ],
      tags: ['conan-config', 'copywriting', 'search', 'searchTree', 'node-runtime', 'read-only'],
      auth: {
        type: 'cookie',
        refresh: 'from-browser',
        secretKey: 'cookieHeader',
        browserUrls: ['https://conan.zhenguanyu.com/', 'https://buff.zhenguanyu.com/'],
        requiredCookieNames: [],
        failureSignals: ['Full authentication is required', 'Request failed 401', 'Request failed 403', 'Missing saved cookie auth'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，例如 会员订单、member_order_config、百科会员。' },
          keyword: { type: 'string', description: 'query 的别名。' },
          search: { type: 'string', description: 'query 的别名。' },
          mode: { type: 'string', description: '搜索维度，可为 config、configValue、grouping，或用逗号组合。' },
          limit: { type: 'number', description: '最多返回多少条，默认 100。' },
          includeRawTree: { type: 'boolean', description: '是否返回 searchTree 原始树，默认 false。' },
        },
        required: ['query'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          query: { type: 'string' },
          modes: { type: 'array' },
          resultCount: { type: 'number' },
          results: { type: 'array' },
          resultsByMode: { type: 'array' },
          view: { type: 'object' },
        },
        required: ['action', 'query', 'modes', 'resultCount', 'results', 'resultsByMode', 'view'],
      },
      examples: [{ description: '搜索会员订单相关配置', input: { query: '会员订单' } }],
    },
  },
  {
    id: 'conan-config-query',
    title: 'Conan config query',
    description:
      'Read a Conan config by admin URL or namespace/key using saved browser cookie auth, returning raw value, schema summary, and markdown view.',
    script: conanConfigQueryScript,
    manifest: {
      runtime: 'node',
      status: 'trusted',
      permissions: ['network:https://conan.zhenguanyu.com/*'],
      sideEffect: 'read',
      requiresConfirmation: false,
      whenToUse: [
        '用户给 Conan/Buff 文案配置后台链接，想直接查看配置内容',
        '用户给 namespace/rootGroupingKey 和 key，想查询当前配置 value',
        '用户要看配置 schema 字段、字段 label、顶层结构或完整 JSON',
      ],
      whenNotToUse: [
        '用户要修改、发布、回滚配置；当前内置能力只读',
        '尚未刷新保存登录态，或保存的 cookie 已过期',
      ],
      tags: ['conan-config', 'copywriting', 'query', 'schema-label', 'saved-cookie', 'read-only', 'node-runtime'],
      auth: {
        type: 'cookie',
        refresh: 'from-browser',
        secretKey: 'cookieHeader',
        browserUrls: ['https://conan.zhenguanyu.com/', 'https://buff.zhenguanyu.com/'],
        requiredCookieNames: [],
        failureSignals: ['Full authentication is required', 'Request failed 401', 'Request failed 403', 'Missing saved cookie auth'],
      },
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '后台配置页 URL；能力会从 hash query 解析 key 和 rootGroupingKey。' },
          configUrl: { type: 'string', description: 'url 的别名。' },
          namespace: { type: 'string', description: '配置 namespace；通常等于 URL 里的 rootGroupingKey。' },
          rootGroupingKey: { type: 'string', description: 'namespace 的别名。' },
          grouping: { type: 'string', description: 'namespace 的别名。' },
          key: { type: 'string', description: '配置 key；如果 url 中已有 key 可省略。' },
          includeRawValue: { type: 'boolean', description: '是否返回未解析的 rawValue 字符串，默认 false。' },
        },
        required: [],
      },
      outputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          namespace: { type: 'string' },
          key: { type: 'string' },
          configId: { type: 'number' },
          schemaId: { type: ['number', 'null'] },
          metadata: { type: 'object' },
          value: { type: 'object' },
          schema: { type: 'object' },
          view: { type: 'object' },
          updatedTime: { type: 'number' },
          hasDraft: { type: 'boolean' },
        },
        required: ['action', 'namespace', 'key', 'configId', 'metadata', 'value', 'schema', 'view'],
      },
      examples: [
        {
          description: '按 key 和 namespace 查询配置',
          input: { namespace: 'Space_Pedia', key: 'member_order_config' },
        },
      ],
    },
  },
]

export function installBuiltinCapabilitySuite(
  options: InstallBuiltinCapabilitySuiteOptions,
): InstalledBuiltinCapabilitySuite {
  if (options.suite !== 'conan-config') {
    throw new Error(`Unknown builtin capability suite: ${options.suite}`)
  }
  const location = options.location || 'user'
  const capabilities = conanConfigCapabilityDefinitions.map((definition) => {
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
  return { suite: options.suite, capabilities }
}
