---
name: conan-config
description: 通过独立 Node 脚本搜索、读取、检查、校验并安全管理国内 Conan/Buff Space_Enhanced_Config 配置及其 Formily Schema，包括新建 Schema、新建配置和初始化配置值。用户提供配置或 Schema 关键词、精确后台 URL、namespace/key，询问 Schema 或历史记录，或明确要求修改 cn-prod/cn-test 配置时使用。只读操作可自主执行；写入前必须准备不可变报告、展示结构化语义差异并获得明确确认。
---

# Conan 配置管理

使用 `node "<skill-dir>/scripts/run.mjs" input.json` 做离线输入检查；只有加 `--execute` 才发送业务请求。

## 快速只读路径

将简单关键词或精确 URL 查询视为独立任务。不要先检查记忆、工作区文件、能力元数据或后台页面。

- 关键词查询未指定环境时，默认使用 `cn-prod`，并说明该假设。
- URL 包含 `ytkconan.zhenguanyu.com` 或 `buff-test.zhenguanyu.com` 时，推断为 `cn-test`。
- 完成离线检查和凭据授权后，用 `--execute` 执行所需查询，然后基于精简输出回答。
- 搜索结果有歧义时，不要自动读取每个候选项；展示匹配项并让用户选择。

```bash
# input.json 内容：{"action":"search","environment":"cn-prod","query":"<keyword>"}
node "<skill-dir>/scripts/run.mjs" input.json
# 预览并确认后执行；写操作使用本次预览返回的 hash
node "<skill-dir>/scripts/run.mjs" input.json --execute
# input.json 内容：{"action":"get","url":"<config-url>"}
node "<skill-dir>/scripts/run.mjs" input.json
# 预览并确认后执行；写操作使用本次预览返回的 hash
node "<skill-dir>/scripts/run.mjs" input.json --execute
# input.json 内容：{"action":"search-schemas","environment":"cn-prod","name":"<schema-name>","bizKey":"config"}
node "<skill-dir>/scripts/run.mjs" input.json
# 预览并确认后执行；写操作使用本次预览返回的 hash
node "<skill-dir>/scripts/run.mjs" input.json --execute
```

仅当用户需要每个搜索维度的完整记录时，使用 `"detailLevel":"full"`。用户给出精确的 `namespace` 和 `key` 时，直接调用 `get`。

## 写入操作

处理修改、草稿、发布、创建、复制或回滚时，读取 [references/write-operations.md](references/write-operations.md)。校验配置值时，同时读取 [references/validation.md](references/validation.md)。创建或检查 Schema 时，还必须读取 [references/schema-components.md](references/schema-components.md)，只使用项目已注册组件及其值类型协议。不要直接根据原始请求执行写入。

## 结果展示

只读结果保持精简：展示 `environment`、名称、`namespace`、`key` 和 `configId`。写入结果还要展示已准备的差异、确认状态、存在时的 `configDraftId`、发布状态及回读验证。

## 独立执行与凭据

需要 Node.js 20 或以上，无 npm 依赖，也不依赖 Tabwright 的 Skill runtime。
业务脚本和校验参考均归本 Skill 所有。先将输入写入本地 `input.json`，
执行 `node scripts/run.mjs input.json` 只做离线输入检查，返回 `executed:false`。
这不是后端预览，不能证明目标状态或业务校验已通过；已有准备、回读和差异步骤仍然适用。
需要执行时才加 `--execute`。写操作还要求用户确认后提供本次预览的
`--confirm <hash>`；输入或代码变化会使旧 hash 失效。hash 不代表人类已经批准，
AI 仍必须取得本次具体操作的授权。禁止把错误或超时当作自动重试依据。

该迁移版本保留已有 Node 请求实现，凭据必须通过受保护的本地通道显式注入
`SKILL_COOKIE_HEADER` 和精确的 `SKILL_COOKIE_ORIGIN`。
不从旧 Tabwright 状态目录读取，不自动提取/刷新/保存 Cookie，不将值写进 Skill、
命令历史、报告或模型输出。请求跨 origin 或发生重定向时拒绝发送/跟随。
只有用户明确授权该账号、origin、用途和本地接收进程后才可提供浏览器 Cookie；
否则暂停。凭据可能不足以替代 CSRF 或其他认证机制。
新编写的浏览器任务默认使用页面内请求；不能把这个旧 Node 迁移例外当作默认 Cookie 导出流程。
产物默认保存在当前目录下新建的 `artifacts/conan-config/<run-id>`；
也可显式指定 `--artifacts <directory>`，不会覆盖旧 Tabwright 报告。

这些是仓库源码迁移副本，未替换已安装的 Skill，未执行真实业务写入验收。
