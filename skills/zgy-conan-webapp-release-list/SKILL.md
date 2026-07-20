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
tabwright capability run "<runtime-dir>" --browser user --input-json '{"projectName":"conan-pedia-web","key":"conan-pedia-web-member-manage","pageSize":10}' --json
```

## 输出与边界

- 简洁展示版本号、发布状态、提交摘要、创建/发布人、发布时间和当前全量版本；用户需要时再补充构建 ID、预览地址或原始提交信息。
- 这是只读能力。不要用它执行发布、回滚、锁定或修改配置。
- 查询不到指定 key 时，列出 `availableKeys` 帮助用户修正，不要猜测。
- 认证失败时提示用户恢复 Console/Conan WebApp 登录态，不要读取或展示 Cookie。

## Tabwright Runtime

Resolve the absolute `runtime/` directory next to this `SKILL.md` and execute it directly with `tabwright capability run "<absolute-skill-directory>/runtime" ...`. Never copy or install the runtime into a Tabwright data directory.

Use `tabwright` when available. If the command is missing or rejects a Skill runtime directory, use `npm exec --yes --package=tabwright@latest -- tabwright` in its place. Ask the user only when Node.js or npm is unavailable.

Tabwright validates `runtime/capability.json` and `runtime/script.js` on every run and automatically refreshes declared browser authentication when needed. Do not run `describe`, `trust`, `--force`, or `refresh-auth` as setup steps. Pause only when Tabwright reports that browser login is unavailable or the selected operation requires explicit confirmation.
