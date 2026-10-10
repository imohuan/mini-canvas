# API 总览

这一分类是**纯 API 参考**：只讲**有哪些 API、怎么用**，不铺教学。写代码时按名字查签名和用法。

## 两端都能查

| 端 | 服务/能力 | 页面 |
| --- | --- | --- |
| **前端** | `doc` / `save` / `selection` / `command` / `slots` / `settings` / `resources` / `nodeRegistry` / `themeRegistry` / `nodeFactory` / `settingsPersist` / `nodeLayout` / `viewport` / `pluginManager` / `tools` | [内置服务](/services/)（每个一篇：方法签名 + 用法 + 注意事项） |
| **前端** | `ctx` 本体方法、注册场 `ctx.registryOf`、语法糖 | [上下文 ctx](/api/ctx) · [注册场](/api/registry) |
| **前端** | 自省 `ctx.surface()`（看这台画布装了什么） | [自省](/core/self-inspect) |
| **后端** | `ctx.routes` / `ctx.store` / `ctx.jobs` / `ctx.mcp` / `ctx.agent` | [后端总览](/api/server) |

前后端**共用同一颗内核**：前端插件与后端插件都是"往 `ctx` 上注册"，形状同构。
差别只在 `ctx` 多出的能力段 —— 前端多 `nodes` / `theme` / `commands` / `slots` / `settings`，
后端多 `routes` / `store` / `jobs` / `mcp` / `agent`。

## 前端：最常查的 API

| 查什么 | 页面 |
| --- | --- |
| 建/改/删节点，事务与撤销 | [`doc`](/services/doc) |
| 注册节点类型全字段 | [`ctx.nodes.register`](/canvas-data/node-types) |
| 存取键值、换存储后端 | [`save`](/services/save) |
| 选中了哪些节点 | [`selection`](/services/selection) |
| 注册/执行命令、快捷键 | [`command`](/services/command) |
| 往画布叠浮层 UI | [`slots`](/services/slots) |
| 配置读写与订阅 | [`settings`](/services/settings) |
| 注册生成工具（AI 可调） | [`tools`](/services/tools) |
| 实测节点尺寸 / 控制视口 | [`nodeLayout`](/services/node-layout) · [`viewport`](/services/viewport) |
| 上下文全部方法 | [`ctx`](/api/ctx) |
| 注册场全部方法 | [注册场](/api/registry) |

## 后端：五个能力段

| 能力 | 一句话 | 页面 |
| --- | --- | --- |
| `ctx.routes` | 后台加一个接口 = 装一个插件 | [routes](/api/server-routes) |
| `ctx.store` | 插件私有持久化（一个插件一个命名空间，卸载即清） | [store](/api/server-store) |
| `ctx.jobs` | 定时 / 延时任务 / 事件订阅 | [jobs](/api/server-jobs) |
| `ctx.mcp` | 给 AI 加一个可调用的工具 | [mcp](/api/server-mcp) |
| `ctx.agent` | 拦截 / 改写一次对话轮次 | [agent](/api/server-agent) |

