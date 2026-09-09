# Tabwright 4.0.0 发布验收

2026-09-09，分支 `codex-browser-cli-pilot`。用户确认浏览器核心重构符合预期，
授权与原生 WebMCP、完整内置 Tabwright Skill 一起发布；扩展版本为 0.0.165。

- 固定 4.0.0、Node 22.22.0 串行全量回归：39 个文件通过，337 项通过，2 项原有跳过，0 失败（529 秒）。原生 Chrome 152 WebMCP 10/10、截图 10/10 均包含在此运行中。
- 之前的 Hacker News 标签超时本次未复现；未改变该测试断言、增加跳过或批量更新快照。报告在仓库临时目录 `tmp/release-full-results.json`。
- CLI、扩展构建与 CLI/官网类型检查通过；Skill 格式、独立脚本及 OpenSpec 严格校验通过。
- 实际 4.0.0 tarball 在独立目录安装，从 npm 安装运行依赖，禁用 postinstall。CLI 版本、WebMCP 模块加载、命令帮助、本地浏览器参考、Skill 安装及 `current` 状态均通过，Skill 与源文件逐字节相同。没有替换个人 Skill 或全局 CLI。
- 远程浏览器验收同时覆盖调试链路和原生 Chrome 153 WebMCP；CI 使用已有 Tabwright Chrome 下载器，避开旧 fork 下载器的 `onExit` 错误。测试使用 Node 22 串行执行以减少已观察到的 Vitest IPC `EPIPE`。

CLI 4.0.0 删除录制与托管业务 runtime 的公开接口，升级前阅读
[迁移说明](./browser-core-migration.md)。WebMCP 首版只发现顶层文档，需要浏览器
提供原生 API；不支持时明确报错。Web Code 保留为可选兼容入口。

发布结果以 [PR #9](https://github.com/Yuyang-Hou/Tabwright/pull/9)、npm 与 GitHub
Release 的实际回执为准。Chrome Web Store 上传/审核和网站公开部署是独立状态；
构建通过或 ZIP 已发布不代表已上架，也不代表官网已部署。
