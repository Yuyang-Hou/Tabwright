---
title: 浏览器调试核心版验收
description: 本地预览的使用入口、验收结果和后续开发边界。
prompt: |
  Document the delivered product from @../openspec/changes/agent-debugging-core/
  and the executable checks in @../tabwright/src/agent-debugging.test.ts.
  Separate local validation from publication and live account acceptance.
---

# 历史预览：浏览器调试核心版

> 本文记录前一轮预览，不代表当前产品。当前版本已经完整移除录制、
> 业务 Skill runtime 和云 SaaS。请以 [当前验收说明](./browser-core-acceptance.md)
> 和 [迁移指南](./browser-core-migration.md) 为准。以下旧包与测试数据仅供追溯。


Tabwright 基于 Playwriter，把已登录浏览器当作一个正在运行的应用交给 Agent：
页面、网络、源码和执行状态可以按需组合使用。产品提供能力和证据，不替 AI
安排固定步骤，也不要求先录制、生成 Skill 或逐个点击。

## 直接验收

在仓库根目录运行：

```bash
pnpm --dir tabwright test:acceptance
```

它启动独立 Chrome 测试 profile 和本地虚构订单页面，结束后自行清理测试窗口、
服务和临时源码。不会访问你的登录账号或关闭你的日常浏览器。

验收链路：

1. 页面显示两件商品，折扣 5，合计 120。
2. Network 找到 `/api/items`，读取 JSON、响应状态、发起函数及源码位置。
3. Editor 保存当前运行源码，校验哈希，并验证同一源码命中缓存。
4. Debugger 在计算结果处暂停，读取 `discount=5`、`total=120`，确认原价合计 125。
5. 结束 Network 检查后仍能调试；恢复执行，折扣改为 0 后页面显示 125。
6. 确认上述调试过程没有启动后台 DOM 录制。
7. 通过 CLI relay 执行一个故意延迟的动作：超时返回“结果未知”，并发重试和
   reset 被拒绝；原动作确实完成后，session 恢复可用，没有执行被拒绝的动作。

另一个独立 Chrome 用例验证：Network 先启动、随后才打开 Editor/Debugger，
已有脚本和样式仍可读；暂停时查看源码不丢断点、局部变量或暂停现场；页面导航后
不再使用旧资源。并发源码读取也不能让旧响应覆盖新一代缓存。

## 在本地使用这一版

本地验收包：

- [CLI 与内置扩展包](../tmp/agent-debugging-preview/tabwright-debugging-preview.tgz)
- [Chrome 扩展 ZIP](../tmp/agent-debugging-preview/tabwright-extension-0.0.163-preview.zip)

这是未发布的开发预览。CLI 包内版本仍为 `3.5.0`，正式版本由 Changesets 在发布时
生成；扩展预览为 `0.0.163`。TGZ 包含构建产物、扩展与离线文档，依赖不打包，
不是独立可执行程序。本地验证使用仓库现有依赖，并非空机器安装验收。

预览源码分支：`feat-agent-debugging-core`。无需覆盖全局 CLI 即可读取本版能力：

```bash
node tabwright/bin.js docs
node tabwright/bin.js docs network
node tabwright/bin.js docs debugger --offset 0 --limit 100
```

源码更新后用 `pnpm --dir tabwright build` 重建。该命令同时构建匹配的扩展，
位于 `tabwright/dist/extension`。它不是 Chrome Web Store 已发布版本。
若现有扩展已在使用，切换扩展/重启 relay 会影响已有连接，应在空闲时操作。

要手动试用真实页面，先在 Chrome 加载本版解压扩展，并确认旧 relay 的任务均已结束。
之后在一个终端前台运行本版 relay（会替换旧服务、断开旧连接）：

```bash
node tabwright/bin.js serve --host 127.0.0.1 --replace
```

另一个终端运行 `node tabwright/bin.js session new`，后续也通过
`node tabwright/bin.js -s <返回的ID> -e '<代码>'` 调用，避免误用旧全局 CLI/relay。
这些切换步骤没有替你执行；若只验收本次能力，优先使用上面的隔离自动验收命令。

连接本版 CLI 后，Agent 使用 `createNetwork({ cdp })` 开启所需网络检查：

```js
state.cdp = await getCDPSession({ page: state.page })
state.network = createNetwork({ cdp: state.cdp })
await state.network.enable()
// 复现有关行为后，按需查询；requestId 使用查询结果中的真实值。
console.log(state.network.list({ search: '/api/', limit: 10 }))
```

Network 默认保留最近 200 条请求；响应体只有显式请求才返回片段。CLI 的
`docs` 从本地包按主题和行范围读取说明，不需要联网或连接浏览器。
MCP 同样提供 `network-api`、`editor-api`、`debugger-api` 等本地资源。
共享资源从 `getCDPSession` 创建起观察事件；已经由外部裸 CDP 对象启用、且从未
接入共享索引的历史事件无法凭重复 enable 补回。

## 验证范围

- 最终 `pnpm --dir tabwright test`：45 个测试文件通过，341 项通过、3 项保留跳过，
  0 失败，耗时约 7 分钟。[完整机器可读报告](../tmp/agent-debugging-preview/test-results.json)。
- `pnpm --dir tabwright test:unit`：16 个文件、141 项通过。
- CLI 类型检查、CLI/扩展构建通过；官网类型检查与完整 Vite 构建通过。
- Skill 校验、严格 OpenSpec 校验通过；打包后实际启动 MCP，验证 2 个工具和
  5 个本地资源，逐一回读确认与包内文件一致；该检查不连接浏览器。
- 官网首页、安装页、CLI 文档已在本地浏览器走查，导航和正文可见。预览中仍有
  一条样式 JS 资源 404：RSC 插件先生成预加载清单，Vite 随后移除纯 CSS 的空 JS，
  留下失效引用；实际图片缩放 CSS 存在。未阻塞所走查页面，需另行验证框架钩子
  顺序修复；本轮未升级框架，也未复编旧 HEAD 来证明历史状态。
- Network 的成功 JSON 请求、源码发起位置和超时恢复有真实 Chrome 验收；
  重定向、失败状态与 base64 分片主要由纯逻辑测试覆盖，不代表所有网站都已验收。

测试默认串行运行，避免共享测试端口竞争；测试不会自动更新快照。第三方网站
检查稳定的可访问性语义，本地 fixture 保留严格的完整树与字符串断言。
验证没有使用真实登录业务数据，也没有提交、推送、发布、部署或替换全局 CLI。
测试浏览器和本地预览已关闭，开发分支仍为 `feat-agent-debugging-core`。

## 产品取舍

- 录制保留为主动诊断能力；默认连接页面不再滚动记录 DOM。显式录制不是视频，
  也不是自动生成可执行流程的承诺。
- 云租赁、登录购买和 Skill 工厂不进入主产品路径。旧云命令和运行时保留兼容，
  不修改云后端、计费或现有 WebSocket 协议。
- Skill 只帮助发现能力、理解真实边界；不强制截图优先、API 优先或单步调用。
- 超时不代表取消，更不代表网站未产生效果。保护覆盖同一 executor 的 awaited
  工作；主动分离的 Promise、其它 session 和用户操作不在该串行保证内。
- 已知凭据字段脱敏不是全面隐私隔离。响应体、页面内容和任意脚本输出仍可能
  包含敏感数据；CDP 底层读取响应时仍会传输完整响应体。

## 后续开发对齐

继续围绕真实任务改善“找到证据和得到结果”的成本：大型 SPA 的请求到源码定位、
iframe/异步调用的定位、失效证据提示和复杂页面上的工具协作。优先拿真实任务
验证成功率、调用次数和证据体积，再决定补哪个原语。

不回到云浏览器分支、录制流水线或通用任务平台；只有多个真实任务反复需要同一
能力时，再提炼对应帮助函数。正式发布仍需单独确认版本、提交、发布与用户环境升级。
