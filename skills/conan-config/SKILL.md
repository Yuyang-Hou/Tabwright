---
name: conan-config
description: 通过 Tabwright conan-config 能力搜索、读取、检查、校验并安全管理国内 Conan/Buff Space_Enhanced_Config 配置及其 Formily Schema，包括新建 Schema、新建配置和初始化配置值。用户提供配置或 Schema 关键词、精确后台 URL、namespace/key，询问 Schema 或历史记录，或明确要求修改 cn-prod/cn-test 配置时使用。只读操作可自主执行；写入前必须准备不可变报告、展示结构化语义差异并获得明确确认。
---

# Conan 配置管理

使用 `tabwright capability run "<runtime-dir>"` 执行；不要将能力 ID 当作 Shell 命令。

## 快速只读路径

将简单关键词或精确 URL 查询视为独立任务。不要先检查记忆、工作区文件、能力元数据或后台页面。

- 关键词查询未指定环境时，默认使用 `cn-prod`，并说明该假设。
- URL 包含 `ytkconan.zhenguanyu.com` 或 `buff-test.zhenguanyu.com` 时，推断为 `cn-test`。
- 只执行一次能力命令，然后基于精简输出回答。
- 搜索结果有歧义时，不要自动读取每个候选项；展示匹配项并让用户选择。

```bash
tabwright capability run "<runtime-dir>" --input-json '{"action":"search","environment":"cn-prod","query":"<keyword>"}' --json
tabwright capability run "<runtime-dir>" --input-json '{"action":"get","url":"<config-url>"}' --json
tabwright capability run "<runtime-dir>" --input-json '{"action":"search-schemas","environment":"cn-prod","name":"<schema-name>","bizKey":"config"}' --json
```

仅当用户需要每个搜索维度的完整记录时，使用 `"detailLevel":"full"`。用户给出精确的 `namespace` 和 `key` 时，直接调用 `get`。

## 写入操作

处理修改、草稿、发布、创建、复制或回滚时，读取 [references/write-operations.md](references/write-operations.md)。校验配置值时，同时读取 [references/validation.md](references/validation.md)。创建或检查 Schema 时，还必须读取 [references/schema-components.md](references/schema-components.md)，只使用项目已注册组件及其值类型协议。不要直接根据原始请求执行写入。

## 结果展示

只读结果保持精简：展示 `environment`、名称、`namespace`、`key` 和 `configId`。写入结果还要展示已准备的差异、确认状态、存在时的 `configDraftId`、发布状态及回读验证。

## Tabwright 运行环境

将本 `SKILL.md` 同级的 `runtime/` 目录解析为绝对路径，并通过 `tabwright capability run "<技能绝对路径>/runtime" ...` 直接执行。不要将运行目录复制或安装到 Tabwright 数据目录。

优先使用 `tabwright`。如命令不存在或不支持技能运行目录，改用 `npm exec --yes --package=tabwright@latest -- tabwright`。仅当 Node.js 或 npm 不可用时才询问用户。

Tabwright 每次执行都会校验 `runtime/capability.json` 和 `runtime/script.js`，并按需自动刷新已声明的浏览器认证。不要将 `describe`、`trust`、`--force` 或 `refresh-auth` 作为初始化步骤。仅当 Tabwright 报告浏览器登录不可用，或所选操作需要明确确认时才暂停。
