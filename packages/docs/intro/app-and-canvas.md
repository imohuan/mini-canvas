# 应用级与画布级：一个 Provider，两段启动

一句话：**整个应用只有一个 Provider、一个 Context。** 项目页一开始就启动；只有进入画布时，才把画布服务临时装上去。

## 先记住这张表

| 东西 | 什么时候有 | 谁提供 |
| --- | --- | --- |
| `slots` / `settings` / `settingsMenu` / `tools` | 应用启动到关闭 | 内核与画布能力层 |
| `save` / `resources` / `notify` | 应用启动到关闭 | 根级应用底座 + `theme-components` |
| `doc` / `selection` / `view` / `canvas` / `nodeToolbar` | 只在画布路由内 | `canvas-session` |
| `cloud-client` / `cloud-client:history` | 应用启动到关闭 | `cloud-client` 的连接部分 |

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

离开画布执行 `unmountCanvas()`：先落盘，再卸载 `canvas-session`。依赖它的插件会自动回到 PENDING，注册的节点类型、槽位与主题条目一起回收。

## 在项目页加一个面板

项目页主内容区有一个固定插槽：`app.projects.main`。

```ts
// 文件：my-plugin/src/index.ts（参照 packages/ui/src/projectsPanelPlugin.ts）
import type { PluginModule } from '@mini-canvas/canvas-base'

export const name = 'my-projects-panel'
export const inject: string[] = []   // 不依赖 doc，项目页就能启动

export const plugin: PluginModule = {
  name,
  inject,
  apply(ctx) {
    ctx.slots.register('app.projects.main', {
      id: 'my-projects-panel/main',
      order: 10,
      component: MyPanel,
    })
  },
}
```

面板组件里要画布能力时现取：

```ts
const { ctx } = useCanvasContext()
const hasCanvas = computed(() => Boolean(ctx.tryGet('doc')))
```

## 主题也分两半

`plugin-theme-default` 现在导出三个插件：

| 导出 | 作用 | 何时启动 |
| --- | --- | --- |
| `themeComponentsPlugin` | 通用 UI 目录、设置面板、外观变量 | 应用级常驻 |
| `themeCanvasPlugin` | 节点壳、连线、背景、节点工具栏 | 进画布（`inject: ['doc']`） |
| `themeDefaultPlugin` | 旧入口：一次装上前两件 | 兼容已有装配 |

新装配请分开用，项目页就不必启动画布外观。

## 云端插件也分两段

`plugin-cloud-client` 仍然只有一个插件身份，但内部按两段启动：

- `apply`：建立连接、历史查询、状态服务与设置订阅。项目页也能查历史。
- `onCanvasReady`：切换存档域、恢复当前画布、注册动作与实时同步。离开画布时执行返回的清理。

判断标准只有一条：**需要的东西在不在。** 不在就跳过，不要伪造一个空服务。
