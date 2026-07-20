---
name: cozy-pedia-order-refund
description: "当用户明确要求通过后端 API 为指定 Cozy UID 退款近期尚未退款的百科订单时，使用此 Tabwright 技能。该操作会产生真实退款，只能在展示具体 UID 和影响后获得用户明确确认再执行。"
---

## 使用场景

- 当用户说出类似 `帮我操作退款204032468`、`退款 uid 最近所有未退款百科订单`，或要求退款某个 Cozy UID 的百科订单时使用。
- 唯一输入参数为 `uid`，以字符串形式传入。
- 直接使用此能力；退款流程中不要打开或调试浏览器页面。
- 不适用于非百科订单、需要填写退货物流信息的退款流程，以及百科默认商品退款场景。

## 操作流程

1. 展示 UID 和将执行真实退款的影响，等待用户对本次具体操作明确确认。

```bash
tabwright capability run "<runtime-dir>" --confirm cozy-pedia-order-refund --input-json '{"uid":"204032468"}' --json
```

2. 如果沙箱环境无法访问网络或写入运行产物，请在获得所需执行授权后重试同一命令。若后端返回业务错误，不要盲目重试真实退款；先检查返回的订单 ID 和错误信息。

## 输出与展示

- 简要回复以下信息：UID、已退款订单 ID、存在时展示金额、操作人，以及已退款/已跳过/失败数量。
- 如果 `refundedCount` 为零，优先展示后端错误或跳过原因。
- 仅当用户要求查看原始输出，或存在多条结果需要检查时，才提及产物路径。

## Tabwright 运行环境

将本 `SKILL.md` 同级的 `runtime/` 目录解析为绝对路径，并通过 `tabwright capability run "<技能绝对路径>/runtime" ...` 直接执行。不要将运行目录复制或安装到 Tabwright 数据目录。

优先使用 `tabwright`。如命令不存在或不支持技能运行目录，改用 `npm exec --yes --package=tabwright@latest -- tabwright`。仅当 Node.js 或 npm 不可用时才询问用户。

Tabwright 每次执行都会校验 `runtime/capability.json` 和 `runtime/script.js`，并按需自动刷新已声明的浏览器认证。不要将 `describe`、`trust`、`--force` 或 `refresh-auth` 作为初始化步骤。本地准备就绪不能替代每次操作前的明确确认。仅当 Tabwright 报告浏览器登录不可用，或所选操作需要明确确认时才暂停。
