# 开发 @mini-canvas 插件（作者教程入口）

> 这是给「想给画布加自己的东西」的人看的。不堆术语、不甩 API 表，
> 每篇都"照抄几行 → 跑起来 → 看到效果"，跑通了再进下一篇。

## 你最终会写成什么样（一句话）

一个 `.ts` 文件，**散开裸导出几样**，就成插件。给 `apply` 一个能力台 `ctx`，
在里面注册节点 / 主题 / 命令 / 服务 / 配置，卸载时注册自动回收，不用你写清理：

```ts
import type { Context, ConfigSchema } from '@mini-canvas/canvas-base'

export const name = 'my-plugin'          // 插件唯一名
export const inject = []                  // 依赖的服务/插件名，没有可省
export const Config: ConfigSchema = { /* 本插件可配置项 schema（第 5 篇） */ }

export function apply(ctx: Context, config: { /* 已校验、默认补齐 */ }) {
  // ctx 是能力台：nodes/theme/commands/slots/settings + 事件 + 服务 + effect
}
```

不用手写 `unregister`、不用记一堆内核函数从哪 import——注册都自动回收。

## 先读规范

写任何跨插件协作前，先读 `docs/插件开发规范.md`：它规定插件之间只能经 `ctx` 调用、节点数据怎么写、加图片/读上游走哪条公开链路。教程讲“怎么跑”，规范讲“必须怎么做”。

## 教程（按顺序读 9 篇）

1. **《第一个插件》** — 建文件 → 写最小插件 → 在画布宿主里加一行装配 → 跑起来看到效果。
2. **《生命周期与 effect（fiber）》** — 弄懂「经 ctx 建的注册会随插件卸载自动撤销」，
   没被托管的东西用 `ctx.effect` 包住；每个插件身上那个能查能停的 fiber 句柄。
3. **《服务（Service 类 + inject 依赖）》** — 插件向别人公开一项能力（服务），
   别人用 `inject` 声明硬依赖等它到齐，或 `ctx.get` 探测可选依赖。
4. **《事件（五种分发）》** — 插件之间不共享服务也能打招呼：
   `emit / parallel / serial / bail / waterfall` 五种怎么选。
5. **《配置（Config schema + 监听变化实时生效）》** — 给插件导出 Config 声明可配置项，
   宿主自动长出一块面板；改一项只刷对应那一处，不整图重建。
6. **《组合与热重载（manager / manifest / PENDING 诊断）》** — 用一份装配清单把插件装进画布，
   热卸 / 换版本，并诊断为什么有个插件一直卡着不起来。
7. **《进入画布（端到端）》** — 写一个"能点出来 + 改主题 + 加命令 + 上服务"的真画布插件，
   在画布 UI 里真正工作。
8. **《发布到 NPM（前后台成对）》** — 把插件打成只含产物的 npm 包、发布、让别人在
   「插件管理 → NPM 市场」里搜到并一键安装（第 8 篇）。
9. **《插件热重载（开发时改完即生效）》** — 改完插件构建后，画布**自己**重装：
    插件包里跑 `pnpm watch` → 构建成功后把产物地址上报给后台 → 画布自动卸旧装新；
    「设置 → 调试插件」页可看状态、重装、卸载。

每篇正文只说"做什么、为什么"，主体是"把这文件替换成这段代码 → 这一步跑 → 你会看到 X →
下一步"。

## 先备好环境

- 画布应用（真宿主）跑在 `packages/ui`：命令 `pnpm -C packages/ui dev`，浏览器开 **http://localhost:5288**。
  它把宿主 API 挂到 **`window.MiniCanvasUI`**（`getContext()` 拿 ctx、`getHost()` 拿宿主句柄、
  `installPlugin/uninstallPlugin/reloadPlugin/listPlugins/inspectPlugins` 装卸与诊断）。
- 你新建的插件文件放哪都行（演示最省事是放到 `packages/ui/src/` 下），
  关键是把它的导出加进装配清单 `packages/ui/src/assembly.ts` 的 `APP_PLUGINS`（第 1 篇教）。
  > 教程示例统一 `import type { Context } from '@mini-canvas/canvas-base'`（作者入口）。
  > `packages/ui` 已经依赖 `@mini-canvas/canvas-base`（`packages/ui/package.json:30`），不必再加；
  > 也可以把插件文件建在 `packages/plugins/` 下的独立插件包里（见 `packages/plugins/README.md`）。
  > `window.MiniCanvasUI` 是宿主 API；`window.MiniCanvasPlugin` 是给 UMD 插件用的重载器，两者不是同一个对象。
- 仓库里已有一批**生产级插件**可当样板直接读：
  `packages/plugins/plugin-node-text`（节点 + 服务）、`plugin-node-image`、
  `plugin-theme-default`（主题 + 配置）、`plugin-mini-map`（命令 + 插槽 UI）。

## 认识「能力台」ctx

作者在 `apply(ctx)` 里会用的注册面（都自动回收）：

| 想干什么 | 写法 |
|---|---|
| 加一种节点（数据+UI） | `ctx.nodes.register({ type, label, size, in, create })` |
| 顶替/叠加一块主题 UI | `ctx.theme.register('nodeShell' \| 'edge' \| ..., MyComponent, { order })` |
| 加一条命令 | `ctx.commands.register({ id, title, run })` |
| 往某 UI 槽塞个组件 | `ctx.slots.register('overlay', { id, order, component })` |
| 往某节点的某个区域挂个组件 | `ctx.nodes.attach(type \| '*', { region, component, order?, needs?, props? })` |
| 上一项服务给别人用 | `ctx.inject('mySvc', { ... })`（或 `new MyService(ctx)`） |
| 声明本插件可配置项 | 模块级导出 `Config`（第 5 篇） |
| 取服务 | `ctx.get('doc')`（节点 + 边 + 事务/撤销一个门面） |
| 订阅事件 / 收注册 | `ctx.on(name, h)` / `ctx.effect(cleanup)` |
| 存本插件私有状态（不占服务名） | `const s = ctx.state(0)` → `s.value` |
| 看"这台画布注册了什么" | `ctx.surface()`（一次列出服务 / 注册场 / 命令 / 工具及其参数，只读） |

组件引用是 opaque 的（.vue 组件直接传进去），作者 import 自己的 .vue 即可，不用管内核。
