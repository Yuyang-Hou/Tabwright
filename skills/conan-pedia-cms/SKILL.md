---
name: conan-pedia-cms
description: Query, inspect, validate, and safely manage Pedia CMS hardware, growth, content, study-tour, achievement, books, AI, and vector-knowledge administration through the Tabwright conan-pedia-cms capability. Use for 百科后台, CMS, 硬件管理, 营销增长, 内容体验, 百科研学, 成就体系, 图书配置, 百科AI, AIGC资产, AI答疑, 推荐问题, or 向量知识库 requests. Run reads autonomously; require a current-state preview and explicit confirmation for writes.
---

## Tabwright Runtime

Resolve `<runtime-dir>` to the absolute `runtime/` directory next to this `SKILL.md` and run it directly. Use `tabwright` when available; if it is missing or too old for Skill runtime paths, replace it with `npm exec --yes --package=tabwright@latest -- tabwright`. Ask the user only if Node.js or npm is unavailable.

Tabwright validates the runtime and refreshes declared browser authentication automatically. Do not run `describe`, `trust`, `--force`, or `refresh-auth` as setup. Pause only if Tabwright reports that the required Chrome login is unavailable.


# 百科 CMS 后台

只通过 `tabwright capability run "<runtime-dir>"` 执行本 Skill 的 runtime；不要把 action 当作 shell 命令，不要自行拼接后台接口。

## 选择环境

- 默认使用 `cn-prod`，并在结果中说明该假设。
- 用户明确说测试环境、ytkconan 或测试后台时使用 `cn-test`。
- 百科落地页 `/buff-minecraft` 是外部微应用，不属于本能力。

## 选择 Action

只读取与请求相关的一个 reference：

- 硬件管理：[references/hardware.md](references/hardware.md)
- 营销增长：[references/growth.md](references/growth.md)
- 内容体验：[references/content.md](references/content.md)
- 百科研学：[references/study-tour.md](references/study-tour.md)
- 成就体系：[references/achievement.md](references/achievement.md)
- 图书：[references/books.md](references/books.md)
- 百科 AI：[references/ai.md](references/ai.md)
- 向量知识库：[references/vdb.md](references/vdb.md)
- 文件上传：[references/shared-upload.md](references/shared-upload.md)

## 只读

直接运行匹配的只读 action。

```bash
tabwright capability run "<runtime-dir>" --input-json '{"action":"<action>","environment":"cn-prod","params":{}}' --json
```

保持结果紧凑：说明环境、筛选条件、总数和关键字段，不展开凭据、邀请码、手机号或大段原始响应。

## 写入

1. 先调用对应列表或详情 action 回读当前状态；创建、上传等无既有目标时完整展示输入。
2. 展示 action、环境、目标 ID、关键字段、影响范围和结构化差异。
3. 等待用户对本次具体输入明确确认。
4. 使用 operation 的精确确认令牌执行。
5. 回读目标并验证结果。

```bash
tabwright capability run "<runtime-dir>" --confirm 'conan-pedia-cms:<action>' --input-json '<confirmed-input-json>' --json
```

不要复用旧确认处理已变化的输入。

## 认证失败

只有 Tabwright 无法自动恢复认证时才暂停，并提示用户恢复对应后台的 Chrome 登录态或 Tabwright 连接。
