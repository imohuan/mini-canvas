# canvas-render 开发手册 · pluginManager（统一插件安装句柄）

> 来源：`packages/canvas-render/src/host/pluginManager.ts`、测试 `host/__tests__/pluginManager.test.ts`、
> `createMiniCanvasHost.ts`（manager 的创建）。

## 一句话

`pluginManager` 是画布宿主的"**统一安装句柄**"：把散在 `api`/`ctx` 上的装/卸/换版本收成一个 `manager`，并且支持从 **外部来源** 装插件（不只是内存里的模块对象），以及用一份**装配清单 manifest** 声明"装哪些、什么顺序、每个插件配什么 config"。

它只操作 `Context` 的公开插件 API + config 装配通道，**不新增内核逻辑、不依赖任何具体插件**，所以能被任何宿主复用。

---

## 插件"来源"有 5 种（PluginEntrySource）

```ts
type PluginEntrySource =
  | PluginModule                       // 最常见：源码 import 来的 {name,inject,Config,apply}
  | PluginClassLike                    // Service 子类（cordis 类形态）
  | { module: () => PluginModule | Promise<PluginModule> }  // 懒加载源码
  | { url: string }                    // 外部 URL（浏览器 fetch 拉下来再 ESM import）
  | { text: string }                   // 单文件插件 js 文本（ESM data-URL import）
```

`resolveSource(source)` 会把这些都归一成一个 `PluginModule`。

### 单文件插件（loadPluginFromText）

约定该文件是一个 ESM 模块，导出 `name`/`inject`/`apply`（与仓库插件同款 Cordis 形态）。它用 `data:text/javascript,<percent-encoded>` 经 `import()` 执行——**不需要 eval / new Function**，浏览器与 Node 都能跑。

> 来源说明：`loadPluginFromText` / `loadPluginFromUrl` / `resolveSource` 定义在 `host/pluginManager.ts` 模块内，
> **未从 `@mini-canvas/canvas-render` 包主入口导出**。要直接用它们，请从子路径
> `@mini-canvas/canvas-render/host/pluginManager` 导入；日常最省事的用法是直接把它们作为 `source`
> 交给 `manager.install({ text | url })`（manager 内部自己 `resolveSource`），不必手动 import 这些辅助函数。

```ts
import { loadPluginFromText } from '@mini-canvas/canvas-render/host/pluginManager' // 子路径导入
const mod = await loadPluginFromText(`
  export const name = 'inline'
  export function apply(ctx) { ctx.inject('inlineSvc', { on: 1 }) }
`)
```

支持 named export（`name`/`apply`…）或 `default` 整体导出两种写法。

### 从 URL 加载（loadPluginFromUrl）

```ts
import { loadPluginFromUrl } from '@mini-canvas/canvas-render/host/pluginManager' // 子路径导入
const mod = await loadPluginFromUrl('https://cdn.example/plugins/my-plugin.js')
// fetch 拿文本 → loadPluginFromText
```

---

## PluginManager 接口

```ts
interface PluginManager {
  install(source: PluginEntrySource, opts?: { config? }): Promise<string> // 装，返回插件名
  uninstall(name: string): boolean                    // 卸，返回是否真卸到
  reload(name: string, next?: PluginEntrySource): Promise<void> // 换版本：卸旧装新
  list(): InstalledPluginInfo[]                        // 已装列表（名+config+运行时态）
  diagnose(): InstalledPluginInfo[]                    // 所有 state!=='active' 的（卡 PENDING/FAILED）
  applyManifest(manifest: PluginManifest): Promise<string[]> // 按清单按序装
}
```

`list()` 每行：
```ts
interface InstalledPluginInfo {
  name: string
  config?: object         // per-plugin 装配 config
  state?: string          // pending/loading/active/failed/...
  missingDeps?: string[]  // state!=='active' 时缺哪些依赖
  error?: string          // FAILED 时的错误 message
}
```

---

## 装配清单（PluginManifest / PluginManifestEntry）

```ts
interface PluginManifestEntry {
  id: string          // 稳定身份（推荐=插件 name；换实现仍用同 id → 覆盖旧）
  source: PluginEntrySource
  config?: object     // per-plugin 装配 config（经插件 Config schema 校验+补默认，apply(ctx,config) 收到）
  disabled?: boolean  // 登记但"关闭"→ applyManifest 跳过不装（清单保留，便于日后打开）
  group?: string      // 展示分组名（不影响装载语义）
}
interface PluginManifest {
  plugins: PluginManifestEntry[]
}
```

`applyManifest` 语义（DSH/cordis Loader）：
- 按序装；`disabled` 项跳过（不装、不进列表）。
- 同 id 后装覆盖先装（`installOne` 里已处理：同名先卸再装）。
- `config` 随 `installPlugin` 一起，经插件 `Config` schema **校验 + 补默认**，再传给 `apply(ctx, config)`。

```ts
const { manager } = await createMiniCanvasHost({ manifest })
console.log(manager.list().map(p => p.name))
console.log(manager.diagnose())  // 有问题的插件
```

---

## manager 与 api / ctx 的关系

- `manager.install(source)` ≈ `api.installPlugin(mod)`，但多了 `resolveSource`（能装懒加载/URL/文本）和 config 通道。
- `manager.reload(name, next)` 会**保留上次的 config** 重放给新实现。
- 内部 `installOne`：同名先卸再装（轻量分层、换版本即此），并把 config 记进 `configs` Map 供 `list()`/`reload` 用；插件卸载即清该 config。
- 创建方式是 `createPluginManager(ctx)`，基于一个**已 start 的 Context**。

---

## 最小用例

```ts
import { createPluginManager } from '@mini-canvas/canvas-render'
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'

const { host, manager } = await createMiniCanvasHost()  // manager 已建好

// 1) 装一个内存模块
await manager.install(nodeTextPlugin)

// 2) 装一个单文件插件
await manager.install({ text: `export const name='inline'; export function apply(ctx){ctx.inject('x',{v:1})}` })

// 3) 换版本（保留上次 config）
await manager.reload('text', updatedTextPlugin)

// 4) 看状态
console.log(manager.list())
console.log(manager.diagnose())

// 5) 卸载
manager.uninstall('text')
```

---

## 坑

1. **manager 需要 ctx 已 start**：`createPluginManager` 捕获 ctx，但其 install 走 `ctx.installPlugin`，需要 started 才可动态装。`createMiniCanvasHost` 返回的 manager 已满足（它内部先 start 再建 manager 或用 applyManifest 先空 start）。
2. **同 name（同 id）覆盖**：install/applyManifest 会自动先卸旧同名再装新。冷启动的 `ctx.plugin()`（同 createMiniCanvasHost 的 coldPlugins）阶段如果重名反而会抛 "Duplicate plugin name"——那是冷启动一次性，热装走 manager/installPlugin 就不抛。
3. **单文件插件必须有 `name`**：loadPluginFromText 会校验，没有 name 直接抛错。
4. **URL 加载依赖浏览器 fetch**：纯 Node 环境没有 fetch 会失败，除非你有全局 fetch。
