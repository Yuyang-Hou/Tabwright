---
name: cozy-pedia-order-refund
description: '当用户明确要求通过后端 API 为指定 Cozy UID 退款近期尚未退款的百科订单时，使用此独立 Node 脚本技能。该操作会产生真实退款，只能在展示具体 UID 和影响后获得用户明确确认再执行。'
---

## 使用场景

- 当用户说出类似 `帮我操作退款204032468`、`退款 uid 最近所有未退款百科订单`，或要求退款某个 Cozy UID 的百科订单时使用。
- 唯一输入参数为 `uid`，以字符串形式传入。
- 直接使用此能力；退款流程中不要打开或调试浏览器页面。
- 不适用于非百科订单、需要填写退货物流信息的退款流程，以及百科默认商品退款场景。

## 操作流程

1. 展示 UID 和将执行真实退款的影响，等待用户对本次具体操作明确确认。

```bash
# input.json 内容：{"uid":"204032468"}
node "<skill-dir>/scripts/run.mjs" input.json
# 预览并确认后执行；写操作使用本次预览返回的 hash
node "<skill-dir>/scripts/run.mjs" input.json --execute --confirm <hash-from-preview>
```

2. 只有确认请求尚未发出时，才可在恢复所需权限后执行。网络中断、超时、后端错误或产物写入失败均不证明退款未发生；先核实订单状态，结果不明时暂停，不自动重复退款。

## 输出与展示

- 简要回复以下信息：UID、已退款订单 ID、存在时展示金额、操作人，以及已退款/已跳过/失败数量。
- 如果 `refundedCount` 为零，优先展示后端错误或跳过原因。
- 仅当用户要求查看原始输出，或存在多条结果需要检查时，才提及产物路径。

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
产物默认保存在当前目录下新建的 `artifacts/cozy-pedia-order-refund/<run-id>`；
也可显式指定 `--artifacts <directory>`，不会覆盖旧 Tabwright 报告。

这些是仓库源码迁移副本，未替换已安装的 Skill，未执行真实业务写入验收。
