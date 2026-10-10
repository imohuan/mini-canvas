
# createMiniCanvasHost 用法

**一句话定位**：**`createMiniCanvasHost()` 是「把内核、数据层、渲染层、插件装到一起」的工厂函数 —— 它不画界面，它给你一个装好的画布宿主和一把装卸插件的遥控器。**

**它属于哪一档**：**渲染层的装配入口**。源码：`packages/canvas-render/src/host/createMiniCanvasHost.ts`（插件安装句柄在 `host/pluginManager.ts`）。「窗口上出现一张画布」那条路是 `<CanvasHost>` 组件，而 `<CanvasHost>` 内部调的就是它。

## 它是什么

`createMiniCanvasHost()` 是个 `async` 函数，跑完这几步（顺序不能换）：

```
① new Context({ dev })                       建插件框架上下文
② createCanvasBasePlugin({ adapter, … })     建画布数据层的整套服务（save/doc/selection/command/…）
③ ctx.inject('nodeLayout', …)                注入渲染层第 1 件（要量 DOM）
④ ctx.inject('viewport', …)                  注入渲染层第 2 件（要挂 VueFlow 后端）
⑤ ctx.plugin(base.plugin)                    装基础插件（core: true，拒绝热卸）
⑥ registryOf('capability').add(…)            宿主那一份能力默认实现（order 100）
⑦ ctx.inject('pluginManager', manager)       注入插件安装句柄（渲染层第 3 件）
⑧ 冷启动插件（manifest 或 coldPlugins）        你给的那批业务插件
⑨ ctx.start() + restore 画布 + seedDefault     启动、恢复上次数据、首次空图才播种
```

跑完返回四个东西：**宿主句柄 + window API 面 + 统一安装句柄 + 一个挂 window 的小函数**。

## 为什么需要它

不提供这个工厂，每个宿主都要自己写一遍上面九步。会踩的坑很具体：

**坑一：忘了注入 `nodeLayout` / `viewport`。** 这两个服务**必须由渲染层注入**，数据层的 `canvasBasePlugin` 给不了。忘了注入，插件里 `ctx.get('viewport')` 就是 `undefined`，用户看到的症状是「缩放的按钮点了没反应」。

**坑二：恢复与播种的顺序搞反。** 「存储里有一条保存过的空图」和「从来没保存过」是两回事：前者要**原样恢复成空画布**，后者才该跑 `seedDefault` 播默认内容。判定写错，用户把节点删光了刷新一下，默认节点又长回来了。

**坑三：配置恢复跑在插件声明之前。** 用户保存过的设置要能命中为「初值」，就必须在插件把配置项 `define` 完**之后**再 `settingsPersist.restore()`。反了，用户上次改的配色要等下次再动一下才生效。

这些坑全在工厂里处理好了，所以你用它就行。

## 怎么用

### 返回值逐项看

```ts
const { host, api, manager, exposeToWindow } = await createMiniCanvasHost(opts)
```

| 返回值 | 是什么 | 什么时候用 |
| --- | --- | --- |
| `host` | `CanvasHostHandle`：宿主句柄（**给 Vue 渲染 / 给宿主自己用**） | 要渲染画面（`CanvasHost` 把它交给 `CanvasSurface`）、要读服务、要落盘 |
| `api` | `MiniCanvasApi`：挂到 window 的那把门面 | 脚本 / AI / 调试工具要从外部装卸插件 |
| `manager` | `PluginManager`：统一安装句柄（带**外部来源**与**装配清单**） | 运行期装 / 卸 / 换版本、按清单装配、诊断 |
| `exposeToWindow` | `(key?: string) => void` | 想在控制台里直接敲 `MiniCanvas.getContext()` |

**宿主句柄 `host` 上的字段**（逐字来自 `CanvasHostHandle`）：

| 字段 | 是什么 |
| --- | --- |
| `ctx` | 内核上下文（`ctx.get('服务名')`、`ctx.on(...)`、`ctx.registryOf(...)` 都从这进） |
| `save` | 持久化服务（`save.get` / `save.set` / `save.flush` / `save.isDirty`） |
| `doc` | **数据唯一门面**：节点 + 边 + 事务 + 撤销 + 快照 + 订阅合成的一个名字 |
| `nodeStore` / `edgeStore` | 节点表 / 边表的**实例**（渲染层要 `subscribe` 重灌、要量尺寸；插件请走 `doc`） |
| `nodeRegistry` / `themeRegistry` | 展示注册表 / 主题槽注册表（供 Vue 层装配） |
| `selection` / `command` / `history` / `nodeFactory` / `graph` | 选中 / 命令 / 撤销栈 / 建节点工厂 / 图唯一写入口（都是**实例**） |
| `nodeLayout` / `viewport` | 渲染层注入的两件服务（也是**实例**，方便宿主直接调） |
| `settingsPersist?` | 配置落盘桥；`persistSettings: false` 时是 `undefined` |
| `resources` | 资源生命周期（Blob / objectURL 登记与回收） |
| `stop()` | **停用并回收**：先 `save.flush()` 保住脏数据，再解色板订阅、停插件、清 window 挂载 |

**门面 `api` 上的方法**（逐字来自 `MiniCanvasApi`）：

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `installPlugin` | `installPlugin(mod: HostPlugin): string` | 热装一个插件，返回插件名 |
| `uninstallPlugin` | `uninstallPlugin(name: string): boolean` | 热卸；副作用 / 注册 / UI 自动回收；返回是否真卸到 |
| `reloadPlugin` | `reloadPlugin(name: string, nextMod?: HostPlugin): void` | 先卸旧再装新（开发期改插件代码后用）；不传 `nextMod` = 只卸 |
| `listPlugins` | `listPlugins(): string[]` | 已装插件名（**不含**宿主自有的 canvas-base） |
| `inspectPlugins` | `inspectPlugins(): PluginRuntimeStatus[]` | 只读诊断：每个插件的运行时态 + 卡住时缺哪个依赖 |
| `getContext` | `getContext(): Context` | 拿 ctx |
| `getRegistry` | `getRegistry(): NodeRegistry` | 拿节点展示注册表 |
| `getNodeStore` / `getEdgeStore` | 返回两个 store 实例 | 兼容老代码；新代码走 `getContext().get('doc')` |
| `getGraph` | `getGraph(): GraphDocumentService` | 拿图唯一写入口 |
| `getHost` | `getHost(): CanvasHostHandle` | 拿整个宿主句柄（`api` 上能做的事它都能做） |

### MiniCanvasOptions 全字段

源码：`packages/canvas-render/src/host/createMiniCanvasHost.ts` 的 `interface MiniCanvasOptions`。

| 字段 | 类型 | 缺省 | 干什么 |
| --- | --- | --- | --- |
| `adapter` | `StorageAdapter` | 内存 adapter | 存储后端（本地 localStorage / 云端可插拔）。不传 = 刷新即丢 |
| `coldPlugins` | `HostPlugin[]` | `[]` | 冷启动要装的插件，**数组顺序即装载顺序**。元素可以是对象插件 `{name, apply}`，也可以是 `Service` 类 |
| `manifest` | `PluginManifest` | 无 | 装配清单冷启动（见下）。**给则优先走 manifest**，与 `coldPlugins` 二选一 |
| `nodeRegistry` | `NodeRegistry` | 内部新建 | 宿主想在 boot 前就把注册表 provide 给 Vue 时自建传入 |
| `themeRegistry` | `ThemeRegistry` | 内部新建 | 同上，主题槽注册表 |
| `seedDefault` | `() => CanvasNode[]` | 无 | **只在「存储里从未保存过」时**跑，返回的节点 `replaceAll` 进去 |
| `persistSettings` | `boolean` | `true` | 是否接上配置持久化桥（`ctx.settings` ↔ `save(config)` 域）。多宿主 / 临时画布可关 |
| `dev` | `boolean` | `false` | 落到 `ctx.isDev`：能力缺项时 **dev 当场抛错 / prod 只 warn**。库不读打包器全局变量，判据只从调用方来 |

### 最简用法

```ts
// 文件：src/host.ts
// 格式：TypeScript 模块（不依赖 Vue）
// 位置：应用里建宿主的唯一地方
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'

export const canvas = await createMiniCanvasHost({
  adapter: new LocalStorageAdapter(),                 // ① 落盘到 localStorage
  coldPlugins: [themeDefaultPlugin, nodeTextPlugin],   // ② 皮在前、业务节点在后
  dev: import.meta.env.DEV,                           // ③ 由调用方显式给（库不自读）
  seedDefault: () => [                                // ④ 只有「从未保存过」才会跑
    { id: 'welcome', type: 'text', position: { x: 120, y: 120 }, data: { text: '双击编辑' } },
  ],
})

canvas.exposeToWindow()   // ⑤ 控制台：MiniCanvas.getContext().get('doc').getNodes()
```

### 全链路：建图 + 命令 + 撤销重做 + 落盘

下面这段是**不需要浏览器**的完整链路（`packages/canvas-render/src/host/__tests__/fullchain.test.ts` 覆盖的就是这条），可以直接用 vitest 跑：

```ts
// 文件：src/__tests__/host-chain.test.ts
// 格式：TypeScript 测试模块（vitest，Node 环境，无需 DOM）
// 位置：验证「建宿主 → 建节点 → 改数据 → 落盘 → 再启动还在」这条链
import { describe, it, expect } from 'vitest'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'

describe('全链路', () => {
  it('建 → 改 → 落盘 → 恢复', async () => {
    const storage = new MemoryStorageAdapter()   // ① 同一份 adapter = 模拟同一台浏览器
    const boot = () => createMiniCanvasHost({ adapter: storage, coldPlugins: [nodeTextPlugin] })

    // —— 第一次会话 ——
    const { host } = await boot()
    const text = host.ctx.get<TextNodeService>('text')   // ② 插件上架的服务
    const id = text.addTextNode({ x: 0, y: 0 })           // ③ 建节点（走 doc.transaction，自动进历史）
    text.editText(id, '刷新后还在')                        // ④ 改数据（走 doc.updateNode）
    await host.save.flush()                              // ⑤ 落盘（不 flush 只在内存里）
    host.stop()                                          // ⑥ 先 flush 再停，最后一条脏数据也不丢

    // —— 第二次会话（模拟刷新页面） ——
    const { host: h2 } = await boot()
    expect(h2.nodeStore.getNode(id)?.data.text).toBe('刷新后还在')   // ⑦ 自动恢复
    expect(h2.doc.getNodes()).toHaveLength(1)
    h2.stop()
  })
})
```

同一条链在浏览器里，用宿主句柄驱动数据的部分长这样：

```ts
// 片段：拿到宿主后用宿主句柄做事（命令 / 撤销 / 重做都走同一批服务）
const { host } = await createMiniCanvasHost({ coldPlugins: [themeDefaultPlugin, nodeTextPlugin] })

// ① 用命令建节点（命令是「按 id 调」的公共入口，快捷键 / 右键菜单 / 脚本都走它）
host.command.execute('command:create-node', { type: 'text', position: { x: 300, y: 200 } })

// ② 撤销 / 重做（数据层自带那四条命令，宿主 boot 时就注册好了）
host.history.canUndo()   // true
host.command.execute('command:undo')
host.command.execute('command:redo')

// ③ 删选中：先选，再执行
host.selection.set(new Set(['welcome']))
host.command.execute('command:delete')

// ④ 落盘（save.set 只是进脏队列；flush 才真正写进 adapter）
await host.save.flush()
```

### seedDefault 的准确定义

它**不是**「每次启动都播一次」，而是「**存储里从来没有保存过任何画布**时才播」。源码里的判定只看一件事：

```ts
// 摘自 packages/canvas-render/src/host/createMiniCanvasHost.ts
const saved = await save.get<CanvasNode[] | GraphEnvelope>(GRAPH_KEY, 'canvas')
const hasStoredGraph = saved !== undefined      // ← 关键：undefined 才是「从未保存」
if (hasStoredGraph) { /* 恢复存档（可能是空数组 []） */ }
else if (opts.seedDefault) { /* 播种 */ }
```

所以：**用户把节点删光并落盘后，刷新回来是空画布，默认节点不会复活**（这条有测试锁着：`createMiniCanvasHost.test.ts` 的「已保存的空图在刷新后不被 seedDefault 复活」）。

### manifest 冷启动

`manifest` 与 `coldPlugins` 二选一，**给 `manifest` 就走 `manager.applyManifest()`**（热装语义，支持停用项、单插件配置覆盖、同 id 换版本）。

```ts
// 文件：src/assembly.ts
// 格式：TypeScript 模块（也可以是 JSON，只放 manifest 的 plugins 数组）
// 位置：声明「这一版装了哪些插件、什么顺序、每个插件的配置」
import { createMiniCanvasHost, type PluginManifest } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'

export const manifest: PluginManifest = {
  plugins: [
    { id: 'theme-default', source: themeDefaultPlugin },                              // ① 皮：顺序放在最前
    { id: 'node-text', source: nodeTextPlugin, group: '节点' },                        // ② group 只供 UI 分组，不影响装载
    { id: 'node-image', source: { url: '/plugins/node-image.js' }, disabled: true },    // ③ disabled：登记但不装
    { id: 'node-image', source: { url: '/plugins/node-image.next.js' } },               // ④ 同 id 后装覆盖先装（换版本）
  ],
}

const { manager } = await createMiniCanvasHost({ manifest })
manager.manifestReport(manifest)   // ⑤ 只读分析：谁将装 / 谁被覆盖 / 谁是停用的（不改动装载）
```

`PluginEntrySource`（每项的 `source`）支持五种形态：

| 形态 | 例子 | `sourceKind()` 判成 |
| --- | --- | --- |
| 内存里的插件对象 | `{ name, apply }` | `'inline'` |
| `Service` 类 | `class MyPlugin extends Service {}` | `'inline'` |
| 懒加载 | `{ module: () => import('./plug.js') }` | `'lazy'` |
| 外部 URL | `{ url: '/plugins/x.js' }` | `'url'` |
| 单文件插件 js 文本 | `{ text: 'export const name = …' }` | `'text'` |

后三种由 `pluginManager.ts` 里的 `resolveSource` / `loadPluginFromUrl` / `loadPluginFromText` 负责取回（`text` 走 ESM data-URL，不用 `eval`）。**信任策略由宿主自己定**：`sourceKind` 只分类、不决策，因为它不知道你的白名单。

### 热装 / 热卸 / 热重载 / 外部来源

```ts
// 片段：运行期装卸（两条路等价：api.* 是 manager.* 的薄包装）
const { host, api, manager } = await createMiniCanvasHost({ coldPlugins: [] })

// ① 热装：注册表、服务、往画布塞的 UI 全随插件作用域自动回收
api.installPlugin(myPluginModule)

// ② 诊断：谁卡在 pending、缺哪个依赖
manager.diagnose().forEach((p) => console.log(p.name, p.state, p.missingDeps, p.error))

// ③ 换版本：先卸旧再装新（reload 会重放上次那份装配 config）
await manager.reload('my-plugin', { url: '/plugins/my-plugin.next.js' })

// ④ 只卸不装
api.uninstallPlugin('my-plugin')
```

两条禁线（源码里是**抛错**，不是静默失败）：

- **核心插件热卸不动**：`canvas-base` 是宿主自有装配（`core: true`），`uninstallPlugin` 会抛 `cannot uninstall plugin … (core)`；`reloadPlugin` 撞上核心插件也会抛（旧写法是「卸不动还继续装」，结果抛一句更难看懂的 `[core] Duplicate plugin name`）。
- **命令 id 重复必抛**：画布那四条通用命令（建节点 / 删选中 / 撤销 / 重做）由基础插件注册，宿主**不要再注册一遍**。

### exposeToWindow

```ts
const { exposeToWindow } = await createMiniCanvasHost({})
exposeToWindow()                 // 默认 key = 'MiniCanvas'
exposeToWindow('MyCanvas')       // 自定义 key；重复调用以最后一次为准
```

挂上去就是 `api` 本体，所以控制台里能直接：

```js
MiniCanvas.listPlugins()
MiniCanvas.getContext().get('doc').getNodes().map((n) => n.id)
MiniCanvas.installPlugin({ name: 'x', apply(ctx) { /* … */ } })
```

**`host.stop()` 会把它清掉**（只清自己最后一次挂的那个 key）—— 这样同一个页面里卸掉旧画布、建新画布，不会留一个指向已停用宿主的 `window.MiniCanvas` 骗人。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/canvas-render/src/host/CanvasHost.vue` | **唯一生产调用点**：`onMounted` 里 `await createMiniCanvasHost({ adapter, manifest, coldPlugins: props.plugins, nodeRegistry, seedDefault: props.seed, dev: props.dev })`，然后 `exposeToWindow(props.windowKey)` |
| `packages/canvas-render/src/host/__tests__/createMiniCanvasHost.test.ts` | 门面行为测试：seed 语义、热装热卸重载、manifest、`dev` 落位、window key 清理 |
| `packages/canvas-render/src/host/__tests__/fullchain.test.ts` | 全链路集成测试：建图 → 编辑 → 落盘 → 二次启动恢复 |
| `packages/canvas-render/src/host/__tests__/createMiniCanvasHostPersist.test.ts` | 配置持久化桥（`persistSettings`）的行为测试 |
| `packages/plugins/plugin-cloud-client/src/manager/` | 「插件管理」插件：运行期用 `manager` 装 / 卸 / 重装第三方插件 |

## 完整例子

一个**真能跑**的小工具：播种一张默认画布，建一个节点、撤销回来、再热装一个小插件看看它怎么被回收。全部不需要浏览器。

### 目录长这样

```
canvas-render-host-demo/
├── package.json      # 清单：依赖 canvas-render 与两个插件包
├── src/
│   ├── host.ts       # 建宿主：adapter + coldPlugins + seedDefault
│   └── main.ts       # 主流程：读节点 → 建/改 → 撤销 → 热装卸 → 落盘 → 停用
└── README.md         # 怎么跑（tsx src/main.ts）
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/canvas-render/create-host/`。

### 文件一：清单

```json
// 文件：packages/docs/public/examples/canvas-render/create-host/package.json
// 格式：JSON（npm 包清单）
// 位置：示例包根目录，声明依赖
{
  "name": "canvas-render-host-demo",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/main.ts" },
  "dependencies": {
    "@mini-canvas/canvas-render": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*",
    "@mini-canvas/plugin-theme-default": "workspace:*",
    "@mini-canvas/plugin-node-text": "workspace:*",
    "tsx": "^4.22.4"
  }
}
```

### 文件二：建宿主

```ts
// 文件：packages/docs/public/examples/canvas-render/create-host/src/host.ts
// 格式：TypeScript 模块（Node，无需浏览器 / 无需 Vue）
// 位置：整个示例唯一建宿主的地方
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter, type CanvasNode } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'

// ① 首次打开时的那张默认画布
function seed(): CanvasNode[] {
  return [{ id: 'welcome', type: 'text', position: { x: 120, y: 120 }, data: { text: '双击编辑' } }]
}

export async function boot() {
  return createMiniCanvasHost({
    adapter: new MemoryStorageAdapter(),                 // ② 换 LocalStorageAdapter 就能跨刷新持久化
    coldPlugins: [themeDefaultPlugin, nodeTextPlugin],    // ③ 皮在前，业务节点在后
    seedDefault: seed,                                   // ④ 只在「从未保存过」时跑
    dev: true,                                           // ⑤ 能力缺项当场抛错，方便发现漏声明
  })
}
```

### 文件三：主流程

```ts
// 文件：canvas-render-host-demo/src/main.ts
// 格式：TypeScript 模块（入口，跑完即退出）
// 位置：演示宿主句柄 / 门面 / 安装句柄三件怎么配合
import { boot } from './host'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'

const { host, api, manager, exposeToWindow } = await boot()
exposeToWindow('MiniCanvasDemo')   // ① Node 里挂到 globalThis；浏览器里就挂在 window 上

// ② 宿主句柄：服务名走 ctx，数据门面走 doc
const doc = host.ctx.get('doc')
console.log('启动后节点：', doc.getNodes().map((n) => n.id + '(' + n.type + ')'))

// ③ 建一个节点（经插件服务 → doc.transaction，自动进历史 + 提交落盘）
const text = host.ctx.get<TextNodeService>('text')
const id = text.addTextNode({ x: 420, y: 120 })
text.editText(id, '这句话是代码写进去的')

// ④ 撤销 / 重做：数据层自带那四条命令，宿主 boot 时就注册好了
host.command.execute('command:undo')
console.log('撤销后：', host.doc.getNodes().map((n) => n.id))
host.command.execute('command:redo')

// ⑤ 热装一个插件：它写的副作用随卸载自动回收
const mark: { on?: boolean } = {}
api.installPlugin({
  name: 'demo-mark',
  inject: [],
  apply(ctx) {
    mark.on = true
    ctx.effect(() => () => { mark.on = false })   // 卸载时自动跑
  },
})
console.log('插件已装：', api.listPlugins(), '标记：', mark.on)
console.log('运行态诊断：', manager.diagnose())
api.uninstallPlugin('demo-mark')
console.log('卸载后标记：', mark.on)

// ⑥ 落盘 + 停用（stop 会先 flush，再回收服务与插件副作用）
await host.save.flush()
host.stop()
```

### 怎么跑起来

```bash
pnpm -C canvas-render-host-demo start      # → tsx src/main.ts，控制台打印节点与装卸结果
```

想换成看得见的版本：把 `adapter` 换成 `LocalStorageAdapter`，再把 `host` 交给 Vue 那侧的 `<CanvasHost>`，或自己写渲染 —— 见 [端到端可运行 Demo](/canvas-render/demo)。

## 常见坑

1. **`coldPlugins` 不传就一个业务插件都不装**。工厂**刻意不 import 任何具体插件**（不然它就把示例绑死了）。画布上什么都没有不等于坏了，先看清单是不是空的。
2. **`stop()` 不是可选的**。它负责 `save.flush()`、色板 / 主题订阅解绑、`settingsPersist.dispose()`、`resources.dispose()`、清 window 挂载，最后 `ctx.stop()`。热更新、切换画布、单页应用里的路由离开都该调它；不调就是内存与订阅泄漏。
3. **恢复与播种的判定看 `saved === undefined`，不看「数组是否为空」**。想把「用户清空后刷新」改成「又长回默认节点」，得自己改判定 —— 现在的行为是**尊重用户删光这件事**。
4. **`persistSettings: false` 会让 `host.settingsPersist` 变成 `undefined`**，并且启动时**不做那次 restore**（宿主代码里是 `if (settingsPersist) await settingsPersist.restore()`）。同一页面开两张画布、共用一个存储时通常要关掉它，不然两边抢同一份配置。
5. **`dev` 必须由调用方显式传**。原因是实测踩过的坑：`canvas-render` 是独立 workspace 包，在它自己的 `.vue` / `.ts` 里读 `import.meta.env.DEV` 拿到的是 `undefined`（打包器的替换只作用于应用包自己的源码），于是 dev 判定会静默失效。所以 `CanvasHost` 在应用层传 `:dev="import.meta.env.DEV"`，库侧缺省 = 生产语义。
6. **`api.listPlugins()` 看不见 `canvas-base`**。宿主自有装配（画布基础服务）对应用层是「环境」不是「清单项」，被 manager 显式藏掉了；内核里它照常是一个插件（`ctx.listPlugins()` 看得见）。
