if (input.action === "search") { return await (async () => {

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
    detailLevel: nextInput.detailLevel === "full" || nextInput.includeRawTree === true ? "full" : "compact",
  };
}

async function requestJson(path) {
  const cookieHeader = secrets.cookieHeader;
  if (!cookieHeader) {
    throw new Error("Missing saved cookie auth. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
  }

  const response = await fetch(CONFIG_API_ORIGIN + path, {
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
  });
  const body = await response.json();

  if (response.status === 401 || response.status === 403) {
    throw new Error("Request failed " + response.status + ": login expired. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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
  const byConfig = results.reduce((index, result) => {
    const identity = [result.rootGroupingKey, result.key, result.id || ""].join(":");
    const existing = index.get(identity);
    index.set(identity, {
      ...(existing || result),
      matchedModes: Array.from(new Set([...(existing?.matchedModes || []), result.mode])),
    });
    return index;
  }, new Map());
  return Array.from(byConfig.values());
}

function compactResult(result) {
  return {
    id: result.id,
    configId: result.id,
    name: result.name,
    desc: result.desc,
    namespace: result.rootGroupingKey,
    rootGroupingKey: result.rootGroupingKey,
    key: result.key,
    path: result.path,
    schemaId: result.schemaId,
    matchedModes: result.matchedModes,
  };
}

function markdownTableCell(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function buildMarkdown(output) {
  const lines = [
    "# 配置查询：" + output.query,
    "",
    "- 环境: " + output.environment,
    "- 唯一配置: " + output.resultCount + " 个",
    "- 分维度命中: " + output.matchCount + " 条",
    "",
  ];

  if (!output.results.length) {
    lines.push("- 无匹配配置项");
  } else {
    lines.push("| 配置名称 | namespace | key | 命中维度 |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(
      ...output.results.map((result) => {
        return "| " + markdownTableCell(result.name) + " | " + markdownTableCell(result.namespace || result.rootGroupingKey) + " | " + markdownTableCell(result.key) + " | " + markdownTableCell(result.matchedModes.join(", ")) + " |";
      }),
    );
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
const modeResults = await Promise.all(
  normalized.modes.map(async (mode) => {
    return await searchMode(normalized.query, mode);
  }),
);

const combined = dedupeResults(modeResults.flatMap((item) => item.results)).slice(0, normalized.limit);
const compactResults = combined.map((result) => {
  return compactResult(result);
});
const output = {
  action: "search",
  environment,
  query: normalized.query,
  modes: normalized.modes,
  detailLevel: normalized.detailLevel,
  matchCount: modeResults.reduce((total, item) => {
    return total + item.resultCount;
  }, 0),
  resultCount: combined.length,
  results: normalized.detailLevel === "full" ? combined : compactResults,
  resultsByMode:
    normalized.detailLevel === "full"
      ? modeResults.map((item) => {
          return {
            mode: item.mode,
            query: item.query,
            rootCount: item.rootCount,
            resultCount: item.resultCount,
            results: item.results.slice(0, normalized.limit),
            rawTree: normalized.includeRawTree ? item.rawTree : undefined,
          };
        })
      : undefined,
};

return {
  ...output,
  view: {
    markdown: buildMarkdown(output),
    table: normalized.detailLevel === "full" ? combined : undefined,
  },
};

})() }
if (input.action === "get") { return await (async () => {

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
    throw new Error("Missing saved cookie auth. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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
    throw new Error("Request failed " + response.status + ": login expired. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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

})() }
if (input.action === "prepare-change") { return await (async () => {

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
    throw new Error("Missing saved cookie auth. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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

})() }
if (input.action === "apply-change") { return await (async () => {

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
    throw new Error("Missing saved cookie auth. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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

})() }
if (["list-spaces", "history", "get-schema", "prepare-publish-draft", "prepare-create", "prepare-copy", "prepare-rollback"].includes(input.action)) { return await (async () => {

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
    throw new Error("Missing saved cookie auth. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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
    throw new Error("Request failed " + response.status + ": login expired. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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

})() }
if (["save-draft", "publish-draft", "discard-draft", "create", "copy", "rollback"].includes(input.action)) { return await (async () => {

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
    throw new Error("Missing saved cookie auth. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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
    throw new Error("Request failed " + response.status + ": login expired. Refresh this Skill runtime with: tabwright capability refresh-auth <runtime-dir> --browser user --json");
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

})() }
throw new Error("Unsupported Conan config action: " + input.action)
