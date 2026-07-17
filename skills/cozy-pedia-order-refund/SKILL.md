---
name: cozy-pedia-order-refund
description: "当用户明确要求通过后端 API 为指定 Cozy UID 退款近期尚未退款的百科订单时，使用此 Tabwright Skill。该操作会产生真实退款，只能在展示具体 UID 和影响后获得用户明确确认再执行。"
---

## Tabwright Runtime

Resolve `<runtime-dir>` to the absolute `runtime/` directory next to this `SKILL.md` and run it directly. Use `tabwright` when available; if it is missing or too old for Skill runtime paths, replace it with `npm exec --yes --package=tabwright@latest -- tabwright`. Ask the user only if Node.js or npm is unavailable.

Tabwright validates the runtime and refreshes declared browser authentication automatically. Do not run `describe`, `trust`, `--force`, or `refresh-auth` as setup. Local readiness never replaces per-run confirmation. Pause only if Tabwright reports that the required Chrome login is unavailable.


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
