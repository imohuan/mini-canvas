# 文档站入口（apps/docs）

本目录是 plume-canvas 的**正式文档**（VitePress，默认端口 5290）：讲「现在怎么用」，不是开发过程记录。
根目录的 `AGENTS.md` 负责项目开发流程；这里只说文档站自己的事。

## 写文档先看这里

| 想写什么 | 去哪 | 挂侧边栏 |
| --- | --- | --- |
| 案例教程（照抄能跑） | `examples/<编号>-<名字>.md` | `.vitepress/config.ts` 的 `examplesSidebar` 加一行 |
| 概念讲解 | `intro/` `start/` `kernel/` `canvas-data/` `canvas-render/` `theme/` | `guideSidebar` 加一行 |
| 组件说明 | `plugins/theme-components/<组件名>.md` | `pluginsSidebar` 对应分组加一行 |
| 插件能力解析 | `plugins/parsed/<插件>/index.md` + 子页 | 不用改：构建时扫目录自动生成 |
| 某个插件的完整使用说明 | `plugins/<插件名>.md` | `pluginsSidebar` 加一行 |

页面结构、口吻、代码必须是真实能跑的、有流程就画 mermaid —— 这几条以根目录 `AGENTS.md`
的「六、写文档规范」为准。

## 常见主题，优先读哪一篇

遇到下面这些需求时，先看对应文档，再动代码。

| 用户提到 | 先读 |
| --- | --- |
| 热重载 / 改插件不刷新 / watch 不生效 / 插件调试页 | [热重载插件](/plugins/hot-reload)（`plugins/hot-reload.md`） |
| 界面怎么写、缺组件怎么补、按名取组件 | [UI 开发](/plugins/ui-development) |
| 设置面板加一页、菜单分级、配置项 | [设置面板](/plugins/theme-components/plugin-settings-content) 与[配置面板案例](/examples/config-panel) |
| 节点、连线、插槽、命令怎么写 | [示例速查](/examples/recipe-map) |
| 后台插件、路由、存储、定时任务 | `cloud-server/` 与 `api/` |

## 热重载这一篇的特别约定

`plugins/hot-reload.md` 是热重载插件的**唯一正式说明**，改动它之前先确认代码与文档一致：

- 前端半：`packages/plugins/plugin-hot-reload/src/data/hotReload.ts`；
- 后台半：`packages/plugins/plugin-hot-reload/src/server.ts`（`/api/hot-reload/server/*`）；
- 配置项：`packages/plugins/plugin-hot-reload/src/index.ts` 的 `Config`（`watchBackend`、`autoUninstallOnStale`）。

行为变了（例如新增配置、改了上报字段、改了接口路径），**先改这篇文档**，再在画布里实测一遍。

## 写完必须做

1. `pnpm -C apps/docs dev` 起文档站（端口被占就 `--port 529x` 换一个），逐项看 H1、代码块、mermaid、锚点、侧边栏入口；
2. 在 `examples/recipe-map.md` 加一行，让「我想做 X」能查到这篇；
3. 检查与本页相关的其它文档的交叉引用没断。
