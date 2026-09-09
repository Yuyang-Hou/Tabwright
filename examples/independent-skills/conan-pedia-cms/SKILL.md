---
name: conan-pedia-cms
description: 通过独立 Node 脚本查询、检查、校验并安全管理百科 CMS 的硬件、营销增长、内容体验、百科研学、成就体系、图书、百科 AI 和向量知识库。用户提到“百科后台”“CMS”“硬件管理”“营销增长”“内容体验”“百科研学”“成就体系”“图书配置”“百科 AI”“AIGC 资产”“AI 答疑”“推荐问题”或“向量知识库”时使用。只读操作可自主执行；写入前必须回读当前状态、展示预览并获得明确确认。
---

# 百科 CMS 后台

使用 `node "<skill-dir>/scripts/run.mjs" input.json` 做离线输入检查；加 `--execute` 才执行脚本中的业务操作。不要把 `action` 当作 Shell 命令，不要自行拼接后台接口。

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
# input.json 内容：{"action":"<action>","environment":"cn-prod","params":{}}
node "<skill-dir>/scripts/run.mjs" input.json
# 预览并确认后执行；写操作使用本次预览返回的 hash
node "<skill-dir>/scripts/run.mjs" input.json --execute
```

保持结果紧凑：说明环境、筛选条件、总数和关键字段，不展开凭据、邀请码、手机号或大段原始响应。

## 写入

1. 先调用对应列表或详情操作回读当前状态；创建、上传等无既有目标时完整展示输入。
2. 展示 `action`、环境、目标 ID、关键字段、影响范围和结构化差异。
3. 等待用户对本次具体输入明确确认。
4. 使用所选操作的本次完整输入对应的确认 hash 执行。
5. 回读目标并验证结果。

```bash
# input.json 内容：<confirmed-input-json>
node "<skill-dir>/scripts/run.mjs" input.json
# 预览并确认后执行；写操作使用本次预览返回的 hash
node "<skill-dir>/scripts/run.mjs" input.json --execute --confirm <hash-from-preview>
```

不要复用旧确认处理已变化的输入。

## 认证失败

认证失败时暂停，请用户恢复对应账号的登录；不自动刷新凭据或重试业务请求。

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
产物默认保存在当前目录下新建的 `artifacts/conan-pedia-cms/<run-id>`；
也可显式指定 `--artifacts <directory>`，不会覆盖旧 Tabwright 报告。

这些是仓库源码迁移副本，未替换已安装的 Skill，未执行真实业务写入验收。
