---
name: conan-pedia-cms
description: 通过 Tabwright conan-pedia-cms 能力查询、检查、校验并安全管理百科 CMS 的硬件、营销增长、内容体验、百科研学、成就体系、图书、百科 AI 和向量知识库。用户提到“百科后台”“CMS”“硬件管理”“营销增长”“内容体验”“百科研学”“成就体系”“图书配置”“百科 AI”“AIGC 资产”“AI 答疑”“推荐问题”或“向量知识库”时使用。只读操作可自主执行；写入前必须回读当前状态、展示预览并获得明确确认。
---

# 百科 CMS 后台

只通过 `tabwright capability run "<runtime-dir>"` 执行本技能的 `runtime/` 目录；不要把 `action` 当作 Shell 命令，不要自行拼接后台接口。

## 选择环境

- 默认使用 `cn-prod`，并在结果中说明该假设。
- 用户明确说测试环境、ytkconan 或测试后台时使用 `cn-test`。
- 百科落地页 `/buff-minecraft` 是外部微应用，不属于本能力。

## 选择操作

只读取与请求相关的一份参考文件：

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

直接运行匹配的只读操作。

```bash
tabwright capability run "<runtime-dir>" --input-json '{"action":"<action>","environment":"cn-prod","params":{}}' --json
```

保持结果紧凑：说明环境、筛选条件、总数和关键字段，不展开凭据、邀请码、手机号或大段原始响应。

## 写入

1. 先调用对应列表或详情操作回读当前状态；创建、上传等无既有目标时完整展示输入。
2. 展示 `action`、环境、目标 ID、关键字段、影响范围和结构化差异。
3. 等待用户对本次具体输入明确确认。
4. 使用所选操作的精确确认令牌执行。
5. 回读目标并验证结果。

```bash
tabwright capability run "<runtime-dir>" --confirm 'conan-pedia-cms:<action>' --input-json '<confirmed-input-json>' --json
```

不要复用旧确认处理已变化的输入。

## 认证失败

只有 Tabwright 无法自动恢复认证时才暂停，并提示用户恢复对应后台的 Chrome 登录态或 Tabwright 连接。

## Tabwright 运行环境

将本 `SKILL.md` 同级的 `runtime/` 目录解析为绝对路径，并通过 `tabwright capability run "<技能绝对路径>/runtime" ...` 直接执行。不要将运行目录复制或安装到 Tabwright 数据目录。

优先使用 `tabwright`。如命令不存在或不支持技能运行目录，改用 `npm exec --yes --package=tabwright@latest -- tabwright`。仅当 Node.js 或 npm 不可用时才询问用户。

Tabwright 每次执行都会校验 `runtime/capability.json` 和 `runtime/script.js`，并按需自动刷新已声明的浏览器认证。不要将 `describe`、`trust`、`--force` 或 `refresh-auth` 作为初始化步骤。仅当 Tabwright 报告浏览器登录不可用，或所选操作需要明确确认时才暂停。
