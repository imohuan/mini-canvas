# v1 基础服务类插件审核 → v2 Save 层改造建议（audit-storage）

审核范围：v1 画布"基础服务 + 持久化"插件（对应 v2 自研 Cordis 式内核 + 统一 `save(key, value, type)` 持久化 + Save 层）。

本文件回答四件事：① 逐插件"存什么/存哪/何时触发/读取入口"表；② 按严重度的问题清单（每条给 v2 改法）；③ v2 Save 层"最佳组合"API 草案；④ 哪些整段吸收、哪些重写。

---

## 0. 一句话结论（给重构者先读）

v1 的持久化不是"一个中心"，而是**四套互不相干的落点**在各自为政：
- **画布图**走 `StoragePlugin`(localStorage+FS 双写) / `BackendSync`(只上云) 两套，互不感知；
- **配置/主题/快捷键**全部挤进 `useStorage('canvas-state')` **一个 localStorage 键**一锅端（config 与 shortcut、theme 与 plugin 命名空间全混）；
- **二进制资产**走 `AssetManager` 下可插拔 `AssetStore`（这套抽象其实是最干净、最接近 v2 目标的）；
- **持久化触发时机**千奇百怪：AutoSave 定时防抖、beforeunload 直写、BackendSync 定时全量轮询、ShortcutManager 卸载才写回、theme/useStorage 改即写但写错键。

v2 的目标动作（改即入队 + 可靠 flush + 四类 type 分桶 + 本地/云端 adapter 隔离）**正好能把这四套归一**。下面逐条给依据和改法。

---

## 1. 逐插件解剖

### 1.1 StoragePlugin（本地 localStorage + FileSystem 双写画布图）

文件 `packages/canvas-core/src/plugins/storage/StoragePlugin.ts`

| 维度 | 现状 | file:line |
|---|---|---|
| 存什么 | 画布图 `{nodes,edges}`（已 sanitize）+ 项目索引 `ProjectMeta[]` + FS handle | 全文件 |
| 存哪 | ①localStorage：`canvas-ai:project-index`、`canvas-ai:project:{id}`；②FileSystem(经 `FileSystemAdapter`)：root `canvas-ai-project-index.json` + `project-{id}/project.json` | 常量 L75-76；localStorage 写 L109/113；FS 写 L418/434/500-501 |
| 项目索引 | `ProjectMeta[]{id,name,createdAt,updatedAt}`，同时存 localStorage 与 FS | L99-110, L198-204 |
| FS handle 存哪 | IndexedDB（`IndexedDBAdapter`，storeName='handles'，key='directoryHandle'），仅存 handle 不存数据 | L86, L255, L31-46 |
| 何时触发 | 用户显式调 `api.saveCanvas(nodes,edges)`；AutoSavePlugin 定时调它 | L484-512；见 1.2 |
| 每次 saveCanvas 干的事 | sanitize→内存 cache→**写 localStorage**→**再写 FS**（同一份数据两处写）→更新项目索引(又双写) | L487-509 |
| 读取入口 | `loadCanvas(projectId)`：先读内存 cache，无则读 localStorage(清洗运行时字段+还原 assetId→objectURL)，**不回读 FS** | L514-545 |
| 模式切换 | connect FS 时 asset 切 `FileSystemAssetStore`，断线/handle 失效回退 `IndexedDBAssetStore` | L292/L388, L223-233, L320 |
| 资产读取入口 | `context.getPluginAPI('storage').assets`（AssetManager 包装，见 1.7） | StorageAPI L68 |

> 注：本插件名 `'storage'`，AutoSave `dependencies:['storage']` 直接 `getPluginAPI('storage').saveCanvas(...)`。

### 1.2 AutoSavePlugin（定时防抖 + beforeunload 兜底）

文件 `packages/canvas-core/src/plugins/auto-save/AutoSavePlugin.ts`

| 维度 | 现状 | file:line |
|---|---|---|
| 存什么 | 整张画布图（经 `sanitizeForSave`） | 全文件 |
| 存哪（正常路径） | 调 `storage.saveCanvas` → StoragePlugin 双写（见 1.1） | L50 |
| 存哪（beforeunload） | **绕过 storage 抽象，直接 `localStorage.setItem('canvas-ai:project:'+id, ...)`** | L87 |
| 何时触发 | nodesChange/edgesChange/nodeDragStop/connect 任一 → `markDirty()` → 防抖 interval(默认 1s) `performSave` | L35-40, L92-95 |
| 兜底触发 | `visibilitychange→hidden` 与 `beforeunload` 都 flush | L65-90 |
| 读取入口 | 无独立读取，读的是 StoragePlugin 存的那份 | — |
| 问题 | beforeunload 那段在 FS 模式只写 localStorage，丢了 FS 这份；且 sanitize 逻辑与 StoragePlugin 重复 | L83-89 |

### 1.3 BackendStoragePlugin（云端资产的"可插拔 storage"替换）

文件 `packages/canvas-core/src/plugins/storage/BackendStoragePlugin.ts`

| 维度 | 现状 | file:line |
|---|---|---|
| 存什么 | 仅二进制资产；**不含画布图、不含任何 config/shortcut** | 全文件 |
| 存哪 | 后端 `/api/canvases/{id}/resources/{assetId}`（`BackendAssetStore`，字节真上云，SHA-256 去重） | L41, BackendAssetStore L49-64 |
| 何时触发 | 节点 upload/drop/paste 经 `AssetManager.saveAsset` → `backendStore.save` | AssetManager L32-45 |
| 读取入口 | `getPluginAPI('storage').assets`（与本地 StoragePlugin 同名入口，靠"插件 name 也叫 storage"顶替） | L32-34, L45 |
| 问题 | **API 形状与 StoragePlugin 不一致**：只有 `assets/canvasId/backendStore`，没有 `saveCanvas/loadCanvas`。谁 `dependencies:['storage']` 后调 saveCanvas 在装上它时即崩（AutoSave/StoragePlugin 用户都中招）。且画布图本地不落盘 | L45-55 |

### 1.4 BackendSyncPlugin（画布图只上云 + SSE 双向）

文件 `packages/canvas-core/src/plugins/backend-sync/BackendSyncPlugin.ts` / `rest.ts` / `sse.ts`

| 维度 | 现状 | file:line |
|---|---|---|
| 存什么 | 画布图全量 + 增量（node add/remove/pos/edge 增删 + 定时整推 data 覆盖） | 全文件 |
| 存哪 | 后端 REST `batch-nodes`/`batch-edges`；`getCanvas` 全量拉取。**本地不落盘任何画布图** | rest.ts L40-52 |
| 何时触发 | 本地事件增量防抖(默认400ms) `scheduleFlush→flushNow`；**定时 full-sync(默认3s)** 轮询比较 data 指纹；visibility hidden flush | L257-320, L360-389, L456 |
| 读取入口 | `connect/loadCanvas` 时 `rest.getCanvas` 全量 replaceAll | L243-251, L460-474 |
| 记住上次画布 | localStorage `backend-sync:canvas-id`（不参与画布图持久化） | L49, L68, L462 |
| 问题 | ①上云"改即上报"，但**本地不落盘**：断网/后台挂即丢本地副本，与 AutoSave 本地抽象割裂；②full-sync 轮询是"打补丁"式自维护 data 差异，不是干净的 flush；③与 1.1 的本地 storage 各自为政，同一画布图可能被两套驱动 | 全文件 |

### 1.5 ShortcutManager（内存单例 + 卸载才写回）

文件 `packages/canvas-core/src/plugins/ShortcutManager.ts`（核心类）、`plugins/shortcut-manager/ShortcutManagerPlugin.ts`（面板入口）、`RemapPanel.vue`、`ShortcutHelpPanel.vue`、`Canvas.vue`

| 维度 | 现状 | file:line |
|---|---|---|
| 存什么 | 快捷键注册表 `{id→{keys,handler,...}}` + 反向键位表 + 默认键表。**纯内存** | ShortcutManager.ts L113-124 |
| 存哪（持久化） | 写回 `canvas.state.core.shortcutKeymap` → 经 `useStorage('canvas-state')` 落 localStorage | Canvas.vue L642-644 |
| 何时触发持久化 | **只在 Canvas `onUnmounted` 一次性 `exportKeymap()` 写回** | Canvas.vue L642-644 |
| remap/重置/导入 | 只改内存单例 `manager.remap/resetDefaults/loadKeymap`，**不碰 store** | ShortcutManager.ts L209-240, L347-351, L382-394；RemapPanel.vue L202-216 只调 manager.remap |
| 读取入口 | 加载：Canvas.vue 启动 `loadKeymap(state.core.shortcutKeymap)` | Canvas.vue L609-610 |
| 面板挂载 | `registerShortcut('ctrl+/', mountHelpPanel)` | ShortcutManagerPlugin.ts L41 |
| 问题 | ①**卸载才存**：remap 后若页面崩溃/整页刷新而非组件卸载，改键全丢；②**全局单例**跨多 canvas 共享一份 registry，A 画布卸载 `destroy()` 会连带清空 B 画布快捷键；③键位数据塞在 `canvas-state.core` 与纯配置混桶（见 2.1） | 见上 |

### 1.6 ThemePlugin（写 context.store→canvas-state.plugins.theme）

文件 `packages/canvas-core/src/plugins/theme/ThemePlugin.ts`

| 维度 | 现状 | file:line |
|---|---|---|
| 存什么 | 主题状态 7 字段（preset/accent/surface/三档文本色/customVariables） | types.ts ThemeState |
| 存哪 | `context.store` = `state.plugins['theme']` → 最终进 `useStorage('canvas-state')` 的 plugins 命名空间 | ThemePlugin.ts L44-66；PluginContext.ts createPluginStore L503-562 |
| 何时触发 | 改即写（applyPreset/applyCustom/setVariable 都 `writeState`），且面板 toRef 双向绑定 | ThemePlugin.ts L166-222 |
| 读取入口 | `readState(store)` 每次刷新 / 面板 via `state.plugins.theme` | ThemePlugin.ts L44-55 |
| 问题 | 持久化介质正确（改即写）但**写错桶**：混进 canvas-state 配置键，非独立 type=config/theme；与 shortcut/config 共享一个 localStorage 键，无法独立迁移/云端 | 见 2.1 |

### 1.7 AssetManager + AssetStore 族（唯一干净的可插拔抽象）

文件 `plugins/storage/adapters/AssetStore.ts`(接口) / `AssetManager.ts`(封装) / `IndexedDBAssetStore.ts` / `FileSystemAssetStore.ts` / `BackendAssetStore.ts` / `IndexedDBAdapter.ts` / `FileSystemAdapter.ts`

| 维度 | 现状 | file:line |
|---|---|---|
| 抽象 | `AssetStore{ save/get/delete/list/has/clear }`——**本地/云端同接口可插拔**，最接近 v2 目标 | AssetStore.ts L22-39 |
| AssetManager | 封装 store + objectURL 缓存 + content-hash 去重；`setStore` 切后端 | AssetManager.ts L9-128 |
| 三个实现 | IndexedDB(blob)/FileSystem(文件+_manifest.json)/Backend(HTTP 上云) | 各文件 |
| setStore 切换点 | StoragePlugin connect/disconnect/handle失效时切本地两 store | StoragePlugin.ts L96, L292, L230, L320 |
| Backend 版 | `BackendStoragePlugin` 里切到 `BackendAssetStore` | BackendStoragePlugin.ts L41-43 |
| 问题（局部） | ①本地两 store 由"连接状态"在 StoragePlugin 内硬切，**抽象本身没有把"本地/云端"当两条隔离管线**，而是同一 AssetManager 上切换当前 store；②BackendAssetStore.list/has 靠会话内存 meta（后端无 list 端点），清空不彻底 | BackendAssetStore L21-22, L87-93 |

### 1.8 全局"config + theme + shortcut 一锅端"（useCanvasStore）

文件 `packages/canvas-core/src/composables/useCanvasStore.ts`

| 维度 | 现状 | file:line |
|---|---|---|
| 存什么 | `state.core`(画布交互/连线/缩放/端口/性能面板/**shortcutKeymap**) + `state.plugins`(**theme 等各插件命名空间**) | L126-221 |
| 存哪 | **一个 localStorage 键 `canvas-state`**，`useStorage('canvas-state', state, localStorage, {serializer})` | L223 |
| 何时触发 | 任何 `state.*` 变化即全量序列化写入（VueUse useStorage 改即写） | L223, serializer L100-110 |
| 读取入口 | store ref；serializer 负责 Set↔数组、ConnectionMode↔字符串迁移 | L32-111 |
| 问题 | ①**四类数据(config/shortcut/theme/plugin)全挤一个键**：任何改都整对象重写，改快捷键会连带 theme 一起落盘、无法只迁移/只上云其中一类；②与"项目相关"的 canvas-state 无 projectId 前缀，多项目共享一份 | L223 |

---

## 2. 问题清单（按严重度）

### 🔴 P0 — 会丢数据 / 架构方向性错误

**P0-1. ShortcutManager 卸载才写回 → 非优雅退出丢改键**
- 依据：remap 只改内存单例（RemapPanel L202-216 / ShortcutManager.remap），写回 store 仅在 `Canvas.vue onUnmounted`（L642-644）。组件崩溃/强刷/未走 unmount 即丢。
- v2 改法：把 ShortcutManager 的"脏键位表"接进 Save 层 `save.set('keymap', exportKeymap(), 'shortcut')`。`remap/resetDefaults/importKeymap` 成功后**改即入队**（不是卸载才写），由 Save 层统一 flush。让单例只管"当前会话注册表 + 匹配"，持久化完全交给外部。

**P0-2. StoragePlugin 每次 saveCanvas 先写 localStorage 再写 FS —— 同数据两处写**
- 依据：saveCanvas 里 `saveCanvasToLocalStorage`（L490）后 `fsAdapter.writeProjectJSON`+`writeRootJSON`（L500-501），项目索引 createProject/deleteProject 也双写。数据源双份、无主从，一旦 FS handle 中途失效（handleFSInvalidated L223）本地那份可能比 FS 旧，反之亦然。
- v2 改法：**删掉"两处写"**。Save 层里"本地画布图"是一个逻辑键（type=canvas, key 归项目命名空间），由 adapter 决定物理落点：纯本地 default adapter 落 IndexedDB，装了文件系统 adapter 落 FS——**一次 save 只写激活的 adapter，不做双镜像**。让"localStorage 双写"从根源消失。

**P0-3. BackendSync 上云不落盘 + 与本地 storage 割裂**
- 依据：BackendSyncPlugin 全文件只 HTTP 上行（rest.ts batch），本地零落盘；画布图在"本地模式"归 StoragePlugin、"云模式"归 BackendSync，两套并行、互不感知。同图可能被 AutoSave(local) 和 full-sync(cloud) 同时驱动。
- v2 改法：把"改即入队"统一放 Save 层。云 adapter 负责把画布图 flush 到后端（替代 BackendSync 的 batch+full-sync 自维护）；本地 adapter 兜底/镜像可选，但**两者都是 Save 层的可插拔 adapter，同一 key 的每次 flush 只走当前激活 adapter**，不再存在"storage 一套 + sync 一套"两套半。BackendSync 退回只做"SSE 下行 + 事件",不再自研上行持久化。

**P0-4. 四类数据(config/shortcut/theme/canvas)挤一个 `canvas-state` 键 → 无法分 type 分桶、无法独立上云**
- 依据：useCanvasStore L223 整棵 state 单键；theme 写 plugins.theme、shortcut 写 core.shortcutKeymap、画布交互配置也写 core……全部一个 localStorage JSON。
- v2 改法：拆成四类独立键（见 §3 键规约），每类 `save.set` 独立入队、独立 flush、可分别配"本地/云端"adapter。pinia 只做响应式内存态，持久化经 Save 层而非 useStorage 直连。

### 🟠 P1 — 抽象被绕过 / 触发时机错

**P1-1. AutoSave beforeunload 绕过 storage 抽象直写 localStorage**
- 依据：AutoSavePlugin L87 `localStorage.setItem('canvas-ai:project:...')`。连 FS 模式时它只写 localStorage，绕过了 StoragePlugin（FS 才是当前权威落点），导致崩溃/断网时丢了 FS 更新版。
- v2 改法：删掉这段直写。Save 层提供同步/可靠的 flush 语义：`visibilitychange/hidden`、`pagehide/beforeunload` 由 Save 层统一 `ctx.save.flush()`（对当前激活 adapter），AutoSave 只负责"入队"标记脏，永远不直接碰 localStorage/FS。把 L83-89 整段移除。

**P1-2. AutoSave sanitize 与 StoragePlugin 重复实现两处过滤**
- 依据：AutoSavePlugin L2 引入 `sanitizeForSave`，StoragePlugin L487 也 sanitize。两处跑同一套清理，一旦规则不同步（前端运行时字段漏清/重复清）就出不一致。
- v2 改法：sanitize 只做一次，放 Save 层 `save.set(..., 'canvas')` 内部（写入 canvas 类型时的统一清洗），AutoSave 只传原始 nodes/edges 引用，读口由 Save 层闭包。AutoSave 删 import。

**P1-3. BackendStoragePlugin 与 StoragePlugin 同名 'storage' 但 API 形状不一致 → 装上即断链**
- 依据：BackendStoragePlugin name 也是 'storage'（L33），API 却只有 assets/canvasId（L45-55），无 saveCanvas/loadCanvas。靠名字顶替会让 `dependencies:['storage']` 且调 saveCanvas 的插件（如 AutoSave）崩。
- v2 改法：不再靠"同名插件顶替"，改由 Save 层 adapter 注入：`storage` 这个概念在 v2 = Save 层内"资源/资产 adapter"。谁需要 assets 就用 `ctx.save.assets`；画布图统一走 `ctx.save`。一个插件不应为提供不同能力而重名。

**P1-4. ShortcutManager 全局单例跨画布污染 + destroy 连坐**
- 依据：ShortcutManager.ts L96-101 静态单例；uninstall 若 `destroy()`（L508-513）会 clear 全部画布。多画布共享一份 registry。
- v2 改法：把单例降为**每个画布实例一个**（随 ctx 生命周期创建/销毁），注册表生命周期 = 画布生命周期。需要"全局默认键位"时从 defaultKeys 重建，而不是共享可变单例。持久化键归到具体画布 projectId 命名空间。

### 🟡 P2 — 局部设计欠妥 / 体验

**P2-1. BackendAssetStore.list/has/clear 靠会话内存 meta，非真后端**
- 依据：BackendAssetStore L21-22 `meta=Map`、L87-93 list/clear 遍历内存。后端无 list 端点 → list 不全、clear 后 `has` 仍可能 hit 旧 meta。
- v2 改法：给后端补 list 端点，或 BackendAssetStore 的 list/clear 明确标注"不支持/降级"，Save 层 assets 抽象允许 adapter 声明能力位（支持 list？支持目录化？）。

**P2-2. 配置键(handle/edge/zoom等)存在 core，无项目前缀，多项目共享**
- 依据：useCanvasStore 无 projectId 维度，canvas-state 全项目一份。
- v2 改法：config 类键按 `scope` 分"全局(app 级)"与"项目级"，键名带 projectId。见 §3 键规约。

---

## 3. v2 Save 层"最佳组合"API 草案

### 3.1 目标原则（直接抄进 v2 设计文档）

1. **改即入队 + 可靠 flush**：`save.set()` 只改内存并标脏入队，`flush()` 在「空闲后 N ms / visibility hidden / pagehide / 显式调用」统一把队列写给当前激活 adapter。**绝不卸载才存 / 不手动才存 / 不同数据写多处**。
2. **四类 type 分桶**：config / canvas / resource / shortcut 各自独立 key、独立队列、可独立配 adapter。
3. **本地默认、云端可插拔、两套互不干扰**：同一 key 在任一时刻只由一个激活 adapter 负责落盘；换 adapter 是"整文件迁移"而非双写。
4. **读回与写同源**：get 永远从与写相同的 adapter 读，读口由 Save 层闭包提供。

### 3.2 API 草案

```ts
type SaveType = 'config' | 'canvas' | 'resource' | 'shortcut'
// canvas 类也分：graph(画布图) 可再细分，但 type 只有这四档，命名空间在 key 上区分

interface SaveAdapter {
  // 每个 adapter 只管"一类 key 的物理落点"，本地/云端各实现一套
  id: string                      // 'indexeddb' | 'filesystem' | 'backend' | 'localStorage'
  capability: { list?: boolean; transactional?: boolean; offline?: boolean }
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>   // 真正落盘的原子写
  remove(key: string): Promise<void>
  flush?(): Promise<void>         // adapter 层落盘（如 batch/批量写文件）
  // 迁移能力：把某 key 从本 adapter 拷到另一个 adapter（换云/换文件系统用）
  exportKeys?(keys: string[]): Promise<Record<string, unknown>>
  importKeys?(kv: Record<string, unknown>): Promise<void>
}

// ctx.save 面向业务（业务方永远只看到 key/value/type，不感知 adapter）
interface SaveService {
  set(key: string, value: unknown, type?: SaveType): void     // 入队（同步返回）
  get<T>(key: string, type?: SaveType): Promise<T | undefined>
  remove(key: string, type?: SaveType): Promise<void>
  flush(opts?: { type?: SaveType }): Promise<void>            // 空闲/隐藏/pagehide/显式
  isDirty(type?: SaveType): boolean
  onSaved?(cb: (info: { type: SaveType; key: string }) => void): () => void
  // 资产：吸收 AssetStore 抽象，本地/云端两套 adapter 各管一套
  assets: AssetService
}

// v2 里这四类 key 由注册中心枚举（禁止任意 key 直写），命名规则见 3.3
```

### 3.3 键命名规则与 type 枚举

- type 固定 4 档；key 统一小写 kebab，前缀 = 类别 + 作用域，避免撞名：

| type | key 示例 | 作用域 | 内容 |
|---|---|---|---|
| `config` | `view.edge-style`、`app.language`、`project:{pid}.theme` | 全局 app / 项目级 | 画布交互/连线/缩放/性能面板开关；主题归这里（独立于画布图） |
| `shortcut` | `project:{pid}.keymap`（或全局 `app.keymap`） | 全局/项目 | 改键映射 `{id:keys}` |
| `canvas` | `project:{pid}.graph`（nodes+edges 整图）；将来可拆 `project:{pid}.graph.nodes` 若需增量 | 项目级 | 画布图，save.set 内部统一 sanitize |
| `resource` | `project:{pid}.resource:{assetId}` | 项目级 | 二进制资产字节（走 assets，不进通用 kv） |

- 理由：**theme 从"plugin 命名空间"提为 type=config 的一把 key**，与 shortcut 彻底分开——改主题不再连带写整个 canvas-state。**shortcut 独立 type**，改键不再触发画布图/config 全量重写。

### 3.4 flush 时机统一规则

- 改即 `save.set` 入队 → 空闲后 debounce(可配，建议 400~1000ms) `flush()`；
- 监听 `visibilitychange(hidden)` + `pagehide/beforeunload` → 强制 `flush()`（对全部 dirty type）；
- 业务关键点(如切项目/保存按钮/卸载)显式 `flush()`；
- **删除所有「在 beforeunload 里绕开抽象直写 localStorage」「onUnmounted 才写回」的分支**。

### 3.5 本地/云端 adapter 隔离模型

推荐**不是**"一个 AssetManager 上 setStore 切后端"，而是**每条管线两个 adapter 实例并存、当前激活一个**：

```
ctx.save
 ├─ 默认管线 (default)  → LocalAdapter: localStorage kv / IndexedDB kv / IndexedDB 资产
 └─ 可选管线 (cloud)    → CloudAdapter: Backend kv / BackendAssetStore 资产
        ↑ 由用户/运行时把某 type 或整个项目"切到云端"
```
- 切换 = `exportKeys` 从旧 adapter 导 → `importKeys` 进新 adapter → 标记激活切换，**不做双镜像/双写**。
- 资产沿用 v1 的 `AssetStore` 接口（save/get/delete/list/has/clear），把 v1 三个实现 **原样吸收**为 adapter 资产实现；BackendAssetStore 补 list 能力或声明降级（见 P2-1）。
- 每个画布/项目一次只激活一个 asset adapter；v1 中"StoragePlugin connect FS 时切 store"的逻辑收敛为 Save 层 adapter 激活逻辑，StoragePlugin 自身退出舞台。

### 3.6 config / resource / shortcut / canvas 各自建议落点与键（汇总）

| 数据 | type | 建议默认落点 | 建议云端落点 | 键 |
|---|---|---|---|---|
| 主题/交互配置 | config | localStorage | 后端 kv 或随画布 | `project:{pid}.theme`、`view.*` |
| 快捷键映射 | shortcut | localStorage | 后端 kv/画布级 | `project:{pid}.keymap` |
| 画布图 | canvas | IndexedDB(经 Save 层) | 后端 graph API(替代 BackendSync 上行) | `project:{pid}.graph` |
| 二进制资产 | resource | IndexedDB/FileSystem | 后端 resources(现 BackendAssetStore) | `project:{pid}.resource:{assetId}` |

---

## 4. 整段吸收 vs 重写（可直接照做的结论清单）

### ✅ 整段/近整段吸收进 v2（基本不改接口）

- **`sanitizeForSave.ts`** 原样搬进 Save 层（RUNTIME_FIELD_SET 保持不变），统一 canvas 写入前清洗，AutoSave/StoragePlugin 各自实现删除。
- **`AssetStore` 接口 + `AssetManager` 封装** 整体保留为 Save 层 `assets` 服务；objectURL 缓存、content-hash 去重逻辑照抄。
- **`IndexedDBAssetStore`、`FileSystemAssetStore`** 几乎原样吸收为"本地资产 adapter 实现"（能力声明稍补）。
- **`BackendAssetStore`** 原样吸收为"云端资产 adapter 实现"，仅补 `list` 能力或显式降级（P2-1）。
- **`IndexedDBAdapter`、`FileSystemAdapter`**：前者吸收为"存目录 handle"的小工具；后者吸收为"文件系统 kv/file 写入工具"供本地 FS adapter 使用。
- **`ShortcutManager` 的核心注册/冲突检测/remap/exportKeymap 逻辑**（ShortcutManager.ts 纯函数部分）保留，但**类实例从全局单例改为随 ctx 创建/销毁**（P1-4），并把持久化外接到 Save 层（P0-1）。
- **ThemePlugin 计算/写 DOM 逻辑（colorUtils/themePresets/refreshTheme/applyThemeToDOM）** 原样保留，只把 `context.store` 读写换成 `save.set(key,state,'config')`。
- **BackendSync 的 SSE 下行 + 增量应用 + replaceAll + edge-retry 逻辑** 原样保留为"云端画布同步只读/下行"角色。

### ♻️ 大幅重写（接口/职责要换）

- **`StoragePlugin` 整体**：它是"模式切换 + 双写 + 资产切 store"的怪兽，职责分散。重写为"纯默认本地 adapter 提供者"，把 saveCanvas/loadCanvas 的本地落盘逻辑折叠进 Save 层 canvas 类型；删除项目索引/localStorage/FS 三处手工管理。
- **`AutoSavePlugin`**：砍到只剩"订阅 nodesChange 等 → 标脏 → `save.set(graph)` + 由 Save 层调度 flush"；**删除 performSave 内对 storage API 的耦合**与 **beforeunload 直写**（L83-89 整段删）。
- **`BackendStoragePlugin`**：不再用"同名 'storage' 顶替"的怪招（P1-3）。重写为"云端 adapter 注册器"：把 `ctx.save` 的当前激活管线切到 backend 资产，同时暴露画布图上云的 flush 端点。
- **`useCanvasStore` 的持久化部分**：删 `useStorage('canvas-state')` 一键直写（L223）；pinia 只做响应式内存态，把 core 配置/shortcutKeymap/theme 各自改走 `save.set`，否则四类永远分不开。
- **ShortcutManagerPlugin/RemapPanel/ShortcutHelpPanel 的"写回"链路**：重写为「confirm() 后立即 `save.set(keymap,'shortcut')`」取代依赖 Canvas unmount 写回。

### 🗑 应移除/不再存在的写法

- AutoSavePlugin `handleBeforeUnload` 直写 localStorage 分支。
- StoragePlugin 每次保存同数据双写（localStorage + FS）。
- Canvas.vue `onUnmounted` 里 `exportKeymap()` 写回 shortcut（改由 remap 后改即入队）。
- "用同名插件顶替 storage" 提供不同 API 的做法。
- ShortcutManager 全局静态单例 + 卸载 destroy 连坐。

---

### 附：与 v2 目标的对应关系速查

| v2 目标 | 落在本审核的哪条改动 |
|---|---|
| 统一 save.set(key,value,type)/get/remove/flush | §3 API；四类数据各自独立 key（P0-4） |
| 四类 type | §3.3 表（config/canvas/resource/shortcut） |
| 本地默认/云端可插拔两套 adapter 互不干扰 | §3.5 + P0-2/P0-3；删双写、单 adapter 激活 |
| 改即入队 + 可靠 flush | §3.4 + P0-1/P1-1；删卸载才存、删 beforeunload 直写 |
| 禁止卸载才存/手动才存/同数据写多处 | P0-1（shortcut 卸载存）、P0-2（storage 双写）、P0-3（sync 不落盘割裂）修复 |
