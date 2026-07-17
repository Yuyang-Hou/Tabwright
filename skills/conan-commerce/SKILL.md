---
name: conan-commerce
description: 使用 Tabwright 只读查询 Deal 电商后台的用户、群组、优惠券模板与已发放优惠券、商品中心旧商品、新商品管理商品、订单、旧版与新版价格策略，并验证用户是否属于群组。用户提到“用户查询”“查询群组”“群组详情”“群组数据验证”“优惠券管理”“优惠券模板”“优惠券查询”“商品管理”“新商品管理”“订单管理”“订单查询”或“价格策略”时使用。不要用于新增、编辑、删除、上下线、发券、回收、发布等写操作，也不要用于获取用户完整明文手机号。
---

## Tabwright Runtime

Resolve `<runtime-dir>` to the absolute `runtime/` directory next to this `SKILL.md` and run it directly. Use `tabwright` when available; if it is missing or too old for Skill runtime paths, replace it with `npm exec --yes --package=tabwright@latest -- tabwright`. Ask the user only if Node.js or npm is unavailable.

Tabwright validates the runtime and refreshes declared browser authentication automatically. Do not run `describe`, `trust`, `--force`, or `refresh-auth` as setup. Pause only if Tabwright reports that the required Chrome login is unavailable.


# 电商后台统一查询

直接运行本 Skill 的 runtime，不要先执行 capability search/route。固定使用用户浏览器：

```bash
tabwright capability run "<runtime-dir>" --browser user --input-json '<json>' --json
```

## 选择 action

| 用户意图 | action | 关键输入 |
| --- | --- | --- |
| 用户查询 | `user.query` | `query`: User ID 或手机号 |
| 群组基础信息 | `group.query` | `groupIds` |
| 群组深层详情 | `group.detail` | `groupIds` |
| 验证用户是否属于群组 | `group.validate` | `groupIds`、`userIds` |
| 优惠券模板 | `coupon-template.query` | `filters` |
| 已发放优惠券 | `coupon.query` | `query` 或 `filters` |
| 商品中心 → 商品管理 | `legacy-product.query` / `legacy-product.detail` | `filters` 或 `id` |
| 新商品管理 → 商品管理 | `product.query` / `product.detail` | `filters` 或 `id` |
| 订单管理 | `order.query` / `order.detail` | `filters` 或 `id` |
| 旧版价格策略 | `legacy-price-strategy.query` / `legacy-price-strategy.detail` | `filters` 或 `id` |
| 新版价格策略 | `price-strategy.query` / `price-strategy.detail` | `filters` 或 `id` |

“商品管理”未说明旧版或新版时，对同一条件分别调用 `legacy-product.*` 和 `product.*`，按来源分组返回；“价格策略”未说明版本时同理调用两类价格策略 action。不要让用户先回答版本问题。

列表查询默认 `limit: 20`。只传页面支持的筛选字段；能力会再按 action 白名单过滤。详情查询只取一个 ID；群组查询和验证支持多个群组 ID。

## 常用调用

```bash
tabwright capability run "<runtime-dir>" --browser user --input-json '{"action":"user.query","query":"123456"}' --json
tabwright capability run "<runtime-dir>" --browser user --input-json '{"action":"group.detail","groupIds":[6412]}' --json
tabwright capability run "<runtime-dir>" --browser user --input-json '{"action":"group.validate","groupIds":[6412],"userIds":[10001,10002]}' --json
tabwright capability run "<runtime-dir>" --browser user --input-json '{"action":"coupon-template.query","filters":{"ids":[123],"page":0,"pageSize":20}}' --json
tabwright capability run "<runtime-dir>" --browser user --input-json '{"action":"order.query","filters":{"orderIds":[123456]},"limit":20}' --json
```

## 约束与展示

- 用户查询默认只返回脱敏手机号、主子账号和基础信息；不要自动调用完整手机号接口。
- 订单或优惠券按手机号查询若命中多孩账号，先运行 `user.query`，展示主子账号并要求改用明确的 User ID。
- 订单没有精确条件和时间范围时，能力自动限定最近一年，避免全量扫描。
- 默认输出归一化常用字段并简洁回答；仅在用户明确要求接口原始数据时传 `includeRaw: true`。
- 结果为空时说明已按哪些条件查询，不猜测数据。
- 能力报告无法自动恢复认证时暂停，提示用户恢复 Deal 登录态或 Tabwright 连接；不要读取或展示 Cookie 值。
