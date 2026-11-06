# 应用级与画布级：一个 Provider，两段启动

一句话：**整个应用只有一个 Provider、一个 Context。** 项目页一开始就启动；只有进入画布时，才把画布服务临时装上去。

## 先记住这张表

| 东西 | 什么时候有 | 谁提供 |
| --- | --- | --- |
| `slots` / `settings` / `settingsMenu` / `tools` | 应用启动到关闭 | 内核与画布能力层 |
| `save` / `resources` / `notify` | 应用启动到关闭 | `canvas-base`（应用级底座）+ `theme-components` |
| `doc` / `selection` / `view` / `canvas` / `nodeToolbar` | 只在画布路由内 | `canvas-data`（画布数据会话） |
| `cloud-client` / `cloud-client:history` | 应用启动到关闭 | `cloud-client` 的连接部分 |
| `projectsApi` | 应用启动到关闭 | `projects-api` 插件 |

项目页没有 `doc`，这不是错误。插件用 `ctx.tryGet('doc')` 判断"现在有没有画布"，有就做，没有就禁用或跳过。

## 启动链

```text
main.ts
  └─ Root.vue
       └─ AppProvider            ← 唯一的根级 Provider
            ├─ Context.start()    ← 应用级服务先起来
            ├─ RouterView
            │    ├─ #/            → 项目页（插件面板插这里）
            │    └─ #/canvas/:id  → App.vue
            │          └─ mountCanvas()  ← 装 doc/selection/view
            └─ Toaster           ← 全应用一只
```

Provider **不挂 key**：切路由只重建路由组件，不重建整棵应用。只有画布工作台会随着画布 id 重建。

## 插件只登记一次

所有插件都在 `AppProvider` 里登记一次，包括画布插件。启动由 `inject` 决定：

| 插件 | `inject` | 项目页 | 画布页 |
| --- | --- | --- | --- |
| 通用插件（主题组件、设置、插件管理、Agent） | `[]` | 启动 | 继续运行 |
| 画布插件（节点、底栏、选区、画布外观） | `['doc', …]` | 停在 PENDING | 自动启动 |

离开画布执行 `unmountCanvas()`：先落盘，再卸载 `canvas-data`。依赖它的插件会自动回到 PENDING，注册的节点类型、槽位与主题条目一起回收。

base / data / render 三层都有自己的插件身份，名字就是分层名：

| 插件 | 名字 | 什么时候在 | 提供什么 |
| --- | --- | --- | --- |
| 应用级底座 | `canvas-base` | 应用启动到关闭 | `save` / `resources` / 注册表容器 / 命令表 / 配置桥 |
| 画布数据会话 | `canvas-data` | 只在画布路由内 | `doc` / `selection` / 历史 / 图写入 / 节点工厂 |
| 渲染层 | `canvas-render` | 应用启动到关闭 | 标准能力包（`registryOf('capability')`） |

## 在项目页加一个页签

项目页左栏有一组「工具」页签，插件注册的是**一整页**：`app.projects.tabs`。

点开页签，主内容区整块换成插件页面；不点就停在原来的项目 / 资产页，
不会在下面多挂一块卡片。

```ts
// 文件：my-plugin/src/index.ts（参照 packages/ui/src/projectsPanelPlugin.ts）
import type { PluginModule } from '@mini-canvas/canvas-base'

export const name = 'my-projects-panel'
export const inject: string[] = []   // 不依赖 doc，项目页就能启动

export const plugin: PluginModule = {
  name,
  inject,
  apply(ctx) {
    ctx.slots.register('app.projects.tabs', {
      id: 'my-projects-panel/main',
      order: 10,
      component: MyPanel,
      meta: { title: '我的面板', icon: BlocksIcon },
    })
  },
}
```

左栏文字来自 `meta.title`，图标来自 `meta.icon`。
页面自己撑满高度、内部要滚动时，再加 `meta.scroll: false`，避免出现两条滚动条。

面板组件里要画布能力时现取：

```ts
const { ctx } = useCanvasContext()
const hasCanvas = computed(() => Boolean(ctx.tryGet('doc')))
```

## 主题也分两半

默认主题拆成了两个独立的插件包，互相不 import：

| 包 | 插件 | 作用 | 何时启动 |
| --- | --- | --- | --- |
| `@mini-canvas/plugin-theme-components` | `themeComponentsPlugin`（`theme-components`） | 通用 UI 目录、设置面板、外观变量、通知服务 | 应用级常驻 |
| `@mini-canvas/plugin-theme-canvas` | `themeCanvasPlugin`（`theme-canvas`） | 节点壳、连线、背景、节点工具栏 | 进画布（`inject: ['doc']`） |

两个包共享的纯数据（配置默认值、外观桥接、图标表）住在 `@mini-canvas/theme-contract`，
两边都能读，但谁也不认识对方的组件。旧的聚合入口 `themeDefaultPlugin` 已删除。

## 云端插件也分两段

`plugin-cloud-client` 仍然只有一个插件身份，但内部按两段启动：

- `apply`：建立连接、历史查询、状态服务与设置订阅。项目页也能查历史。
- `onCanvasReady`：切换存档域、恢复当前画布、注册动作与实时同步。离开画布时执行返回的清理。

判断标准只有一条：**需要的东西在不在。** 不在就跳过，不要伪造一个空服务。
