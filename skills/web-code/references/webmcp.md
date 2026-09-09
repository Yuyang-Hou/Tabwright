# 连接、发现和保存 WebMCP 工具

按用户选择的客户端和脚本管理器当前文档操作，不要求某个特定扩展组合。
只读取此次缺口涉及的文档；没有必要每次重新做兼容性研究。

## 发现与调用

Tabwright 4.0 提供统一入口：先使用现有扩展连接目标页面，再通过
`list_webmcp_tools({pageUrl})` 发现，使用同一 MCP 会话的
`execute_webmcp_tool({toolId,input})` 调用。CLI 对应 `webmcp list/call`，完整参数见
`tabwright docs browser`。旧 CLI/MCP 需要升级后才能使用这些入口。
Tabwright 首版只列出指定顶层文档的工具，不聚合 iframe。工具 ID 在页面导航、
工具变更、重新发现或会话重置后失效，需要重新发现。`returned` 只表示收到原始字符串；
`unknown`/null、异常或超时不能当作业务成功，也不能自动重试。

优先用客户端现成的“列出页面 WebMCP 工具”和“执行 WebMCP 工具”。
例如当前 Chrome DevTools MCP 暴露 `list_webmcp_tools` / `execute_webmcp_tool`，
实际参数以宿主本次提供的工具说明为准，页面 ID 从本次页面列表取得。
其他客户端不必有相同工具名；缺少这两个接口也不直接等于不能使用。

仅有 CDP 时，读取其能力文档后在目标页面上下文访问原生 API；不另建调试连接。
当前已验证的 API 是 `document.modelContext`，先检查方法存在，再执行：

```js
const tools = await document.modelContext.getTools()
// 先把 name/description/inputSchema/origin 等必要元数据返回给 AI 判断。
// selectedTool 必须取自本次列表，input 必须符合其 schema 和用户任务。
const result = await document.modelContext.executeTool(selectedTool, JSON.stringify(input))
```

以上是调用形态，`selectedTool` 和 `input` 不是可直接照抄的占位值。
schema 可能以 JSON 字符串返回，按实际类型解析；工具结果可能是字符串或因导航而为 null，
不得一律解析为 JSON 或当作成功。客户端的 Completed 也不代替业务结果中的 ok/code。
无工具、原生 API 不支持、连接失败和权限受限分开报告；空列表不证明整个网站没有能力。
调用只取当前任务需要的数据，不逐一执行工具来“发现”它们；副作用提示不是权限凭据。

## 制作用户脚本

结合真实代码、请求或页面行为，将有用的业务能力注册到原生 WebMCP。
工具说明写清业务用途、适用范围、输入输出与副作用，让使用者不必先读脚本源码。
工具划分按业务语义，不把每个 HTTP 接口机械转成一个工具，也不封装任意代码执行器。

- 元数据匹配尽量窄；执行时再次检查 origin、路径、路由及必要的身份/租户条件。
- 采用管理器支持的页面执行环境；沙箱里的对象不一定就是页面原生对象。
  脚本猫可以按其文档使用 `@inject-into page`；其他管理器按自己的机制，不假设元数据通用。
- 检查 `document.modelContext.registerTool` 是否可用，不伪造原生对象或悄悄注入远程 polyfill。
- 使用稳定工具名、明确 schema 和运行时参数检查；复用站点请求客户端或已核实请求。
  登录态留在浏览器，不把 Cookie 或令牌写进脚本，也不以跨域请求特权绕过权限。
- 注册本身不执行业务操作。用自己的 AbortController 管理注册，重复加载不重复注册；
  离开目标路由或页面时撤销，返回时恢复。不得移除其他脚本或网站自己的工具。
- SPA/微前端按实际路由和挂载事件处理，不把 hashchange 当成全部导航。
  跨源 iframe 另核对原生权限策略和来源授权，不通过顶层注入假定可达。
- 为请求设置超时、限制返回字段和数量；核对响应约定。预期失败返回明确的结构化结果，
  如 `{ok:false,code:"AUTH_REQUIRED"}`，避免浏览器只给调用方通用抛错。
  原生注销不保证取消在途操作，晚到结果和取消逻辑须与实际业务语义一致。

## 保存与更新

先利用用户已有管理器；没有时让用户选择并按其官方说明安装，不强行换产品。
只申请目标页面所需能力，遇到浏览器安全确认或受限编辑器交回用户，不绕过。
如果所选管理器没有可用自动化入口，交付完整 `.user.js`，引导用户创建普通脚本、
替换模板、保存启用并刷新目标页。已安装则更新同一条，不另建重复脚本。

更新前比较用户当前版本，保留可恢复旧版，递增脚本版本；更新或禁用后提示刷新。
保存成功、原生注册成功、发现/调用成功分别确认，不用状态标记代替实际工具调用。
只在确有必要时保留外部证据和测试文件，不把每站点 Skill 变成用户维护负担。

来源与兼容边界（2026-09-08）：[Chrome 原生 API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)、
[ScriptCat 元数据](https://docs.scriptcat.org/docs/dev/meta/)。脚本猫和当前两种客户端发现路径
已有局部实测；其他管理器、浏览器版本与客户端不能据此宣称兼容。
