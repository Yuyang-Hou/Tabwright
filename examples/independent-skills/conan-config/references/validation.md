# 配置值校验

校验完整的目标配置值，不要只校验已修改字段。

检查：

- Formily 字段类型、必填字段、枚举值、默认值、`x-validator` 和 `x-reactions`。
- 组件语义以及嵌套数组、对象结构。
- Schema 可能未暴露的未修改历史字段。
- 结构化语义差异中的每个路径。
- 目标为 `cn-prod` 时，检查可疑的 `ytk`、`.biz` 或 `test` 标记。

返回校验报告，包含 `passed`、`errors`、`warnings`、`warningsAccepted`、`environment`、`schemaId`、`updatedTime`、`sourceSha256`、`targetSha256` 和 `summary`。

除非用户明确接受警告，否则不要将警告标记为已接受。将报告保持原样传给已确认的写入操作。

## Schema 创建校验

对 `prepare-create-schema` 返回的完整 `schemaJson` 执行校验：

- `type=2` 时必须包含 Formily `schema` 对象；存在 `form` 时必须为对象。
- 按 [schema-components.md](schema-components.md) 检查字段类型、项目组件、组件 props、必填项、枚举、默认值、`x-validator`、`x-reactions` 和嵌套结构。
- 字符串列表、数字列表和对象列表必须分别符合 `ArrayItemsSimple`、`ArrayNumbers`、`ArrayCollapse` / `ArrayPagination` 协议；空数组无法推断元素类型时暂停询问用户。
- 检查 `matchingSchemas`，优先复用现有 Schema；确需重名新建时明确说明原因。
- 目标为 `cn-prod` 时检查 `ytk`、`.biz` 和 `test` 标记。

创建报告包含 `passed`、`errors`、`warnings`、`warningsAccepted`、`environment`、`schemaSha256`、`targetSha256`、`matchingSchemasSha256` 和 `summary`。将报告与未变更的完整 Schema 一并传给 `create-schema`。
