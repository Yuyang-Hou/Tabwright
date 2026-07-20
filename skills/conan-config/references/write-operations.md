# 写入操作

每次写入都必须先执行只读准备，展示结构化预览，并针对该次已准备状态获得明确确认。不要自动重试失败或仅部分完成的写入。

## 修改内容

准备完整的目标配置值：

```bash
tabwright capability run "<runtime-dir>" --input-json '{"action":"prepare-change","url":"<config-url>","value":<complete-target-json>,"changeSummary":"<summary>"}' --json
```

展示环境、变更路径、修改前后的值、警告和现有草稿状态。获得确认后，仅执行以下一个操作：

- `save-draft` with `--confirm conan-config:save-draft`
- `apply-change` with `--confirm conan-config:apply-change`

传入未变更的目标值、摘要和校验报告。不要覆盖现有草稿。

## 发布或丢弃草稿

执行 `prepare-publish-draft`，校验 `draftValue`，并展示差异、操作人、环境、警告、`configDraftId` 和 `draftSha256`。

- 使用 `--confirm conan-config:publish-draft` 发布。
- 明确说明丢弃草稿的破坏性影响后，才能使用 `--confirm conan-config:discard-draft`。

## 创建或复制

- 新建对应 Schema 时，先使用 `search-schemas` 检查可复用项。用户只提供目标配置 JSON 时，严格按 [schema-components.md](schema-components.md) 生成完整的 `type=2` Formily `{form, schema}`，再执行 `prepare-create-schema`；不要创建与目标值无关的空表单，也不要发明项目未注册的组件。
- 校验完整 Schema、元数据、重名候选、环境警告和准备哈希；确认后使用 `conan-config:create-schema`。如返回 `creation_result_unknown` 或 `created_verification_failed`，Schema 可能已经创建，不要自动重试，先按名称或 ID 查询。
- 使用已回读验证的 `schemaId` 执行 `prepare-create`；确认后使用 `conan-config:create`。创建配置与创建 Schema 是两个独立写入，避免其中一步失败时隐藏部分完成状态。
- 确定 `groupingId` 后执行 `prepare-create`；使用 `conan-config:create` 确认。
- 执行 `prepare-copy`；使用 `conan-config:copy` 确认。
- 复制会复用元数据和 Schema，但不会复制源配置值。后续通过标准修改流程复制内容。
- 新配置创建后如需初始化内容，继续使用 `prepare-change` 和 `apply-change`，不要把配置值混入创建定义。

## 回滚

列出历史记录，选择一个 `historyId`，然后执行 `prepare-rollback`。校验历史值和 Schema，展示语义差异；如存在草稿则暂停。使用 `conan-config:rollback` 确认。

## 允许的确认令牌

- `conan-config:save-draft`
- `conan-config:apply-change`
- `conan-config:publish-draft`
- `conan-config:discard-draft`
- `conan-config:create-schema`
- `conan-config:create`
- `conan-config:copy`
- `conan-config:rollback`
