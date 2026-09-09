---
name: zgy-conan-webapp-release-list
description: 使用 Tabwright 只读查询 Zhenguanyu Console 中 Conan WebApp 项目的近期发布版本、发布状态、提交信息、创建与发布人员、发布时间、构建 ID、预览地址和当前全量版本。用户提到“Conan WebApp 发布记录”“WebApp 版本列表”“version management”“最近发布版本”“当前全量版本”或给出对应版本管理页面时使用。不要用于发布、回滚、锁定或修改发布配置。
---

## 输入

- `projectName`：Console 项目名，默认 `conan-pedia-web`；也接受别名 `project`。
- `key`：指定 WebAppKey；也接受别名 `webAppKey`。省略时使用项目返回的第一个 key。
- `page`：从 0 开始的页码，默认 0。
- `pageSize`：返回数量，默认 10，范围 1–100。

例如：

```bash
tabwright -s <id> -e 'state.input = {"projectName":"conan-pedia-web","key":"conan-pedia-web-member-manage","pageSize":10}'
tabwright -s <id> -f "<skill-dir>/scripts/run.js"
```

## 输出与边界

- 简洁展示版本号、发布状态、提交摘要、创建/发布人、发布时间和当前全量版本；用户需要时再补充构建 ID、预览地址或原始提交信息。
- 这是只读能力。不要用它执行发布、回滚、锁定或修改配置。
- 查询不到指定 key 时，列出 `availableKeys` 帮助用户修正，不要猜测。
- 认证失败时提示用户恢复 Console/Conan WebApp 登录态，不要读取或展示 Cookie。

## 独立执行

本 Skill 由用户和 AI 自主管理，不注册到 Tabwright，不需要 capability manifest。
先用 Tabwright 创建自己的 session，选定或创建任务专用的已登录页面并保存在
`state.page`；脚本可能导航此页面，不要传入用户有未保存数据的页面。
把业务输入赋给 `state.input`，再用 `-f` 执行 `scripts/run.js`。
结果在 `state.result` 中，也会输出到调用方。Cookie 留在浏览器内，不导出、不落盘。
`references/input-schema.json` 是业务输入参考，不是 Tabwright 协议。
确认目标环境与真实响应；登录过期、业务错误或结果不明时不要自动重试。
