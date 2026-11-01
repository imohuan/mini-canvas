# 节点标题配置（titleOffset / titleScaleMinZoom）实时生效调研

> 调研目的：给 `plugin-theme-default` 加"节点标题位置偏移 titleOffset、标题缩放阈值 titleScaleMinZoom"两个配置项，
> 让它能像 v1 core 的 `nodeTitleOffset / nodeTitleScaleMinZoom` 一样生效，并回答"改动后是否实时反映到渲染上"。
> 只调查、不改源码。检索命令：`rg -g '!**/node_modules/**'`（Windows / D:/Code/Git/mini-canvas）。

---

## 一句话结论（先看这里）

**目前没有"自动"的 settings→视觉 桥。** canvas-render/canvas-core-v2/plugin-theme-default 三者内部都不订阅配置变更；
那条桥只存在于**更高一层的成品应用** `packages/ui/src/App.vue`（宿主侧手写）：它 `reactive` 一份 `cfg` 分组对象 → 订阅
`ctx.settings.onChange` 窄更新 `cfg` → 把 `cfg` 作为 `:edge-visual / :handle-visual / :debug-visual / :snap-zone-visual`
props 传给 CanvasHost → CanvasHost/CanvasSurface **原引用** provide → BaseNode 经 `useCanvasRender()` 读到同一份响应式对象，
属性一改即实时生效。

所以新增"标题配置"要实时生效，正解是：**走 (a) CanvasHost 的"统一 reactive 视觉对象"路线，但桥必须由宿主（或插件）手动接**——
canvas-render 本身不会替你订阅。也就是说：给 titleOffset / titleScaleMinZoom 加进 theme-default 的 Config schema + 导出键集合 +
建一份 `cfg.title`（或并入某份 visual）→ 在 `bindThemeSettings` 里把这两个键窄更新进去 → 作为新 `:title-visual`（或并入现有）传进
CanvasHost → CanvasSurface provide 原引用 → BaseNode 读 `useCanvasRender().titleVisual?.titleOffset` 等，本地回落默认值。
**只加 Config 字段而不接"订阅→写回 reactive→传 prop→provide"这条链，改了不会实时生效。**

---

## 问题 1：settings 变更 → 视觉 的完整通路（关键）

### 通路总览（从配置面板改值到画面变化）

```
设置面板控件改值
  → SettingsSchemaField.vue 调 props.settings.set(key, value)     [字段控件，theme 插件 settings 皮]
  → settingsSource 适配的 SettingsStore.set()                     [ctx.get('settings') 即内核 SettingsStore]
  → SettingsStore.onChange 触发                                    [plain class，非 Vue 响应式]
  → ui/App.vue bindThemeSettings 的 onChange 回调「窄更新」 cfg     [★ 唯一桥，宿主侧手写]
  → cfg.edge / cfg.handle / cfg.debug / cfg.snapZone 响应式对象被写
  → 作为 :edge-visual 等 props 传入 <CanvasHost>
  → CanvasHost.vue 选引用 props.edgeVisual ?? 内部 DEFAULT reactive
  → CanvasSurface.vue provide RENDER_CONTEXT_KEY（原引用，非拷贝）
  → BaseNode / CustomEdge useCanvasRender() 取同一响应式引用
  → Vue computed 追踪属性变化 → 实时重渲染
```

### ★ 桥的具体位置

**桥不在 canvas-render / canvas-core-v2 / plugin-theme-default 里**，而在 `packages/ui/src/App.vue`（成品应用层，宿主自己写的桥）。

- `packages/ui/src/App.vue:65-71`：`const cfg = reactive({ edge:{...DEFAULT_THEME_EDGE}, handle:{...DEFAULT_THEME_HANDLE}, debug:{...DEFAULT_THEME_DEBUG}, snapZone:{...DEFAULT_THEME_SNAP_ZONE} })`
  先按 plugin 申报的默认值建 4 份响应式分组。
- `packages/ui/src/App.vue:115-160 bindThemeSettings()`：桥本体
  - `targetOf(key)`（120-129 行）按 `EDGE_SETTING_KEYS / HANDLE_SETTING_KEYS / DEBUG_SETTING_KEYS / SNAP_ZONE_SETTING_KEYS` 判定某个 key 属于哪份 cfg 分组；
  - `store.onChange((key, value) => { ... targetOf(key) 命中则 t[key]=value })`（146-159 行）——**这就是"settings 订阅 → 写响应式对象"的那一步**；
  - 由 `onReady()`（99-107 行）调用。
- `packages/ui/src/App.vue:211-224`：模板把 4 份 cfg 作为 `:edge-visual="cfg.edge" :handle-visual="cfg.handle" :debug-visual="cfg.debug" :snap-zone-visual="cfg.snapZone"` 传入 CanvasHost。

### 桥之后：canvas-render 内部是"原引用透传"，没有第二个桥

- `CanvasHost.vue:175-182`：宿主若没收到该 props，就用内部 `reactive({...DEFAULT_*})` 回落；收到 props 则**用传入的引用**：
  ```ts
  const edgeDefaultR   = reactive({ ...DEFAULT_EDGE_VISUAL })
  const handleDefaultR = reactive({ ...DEFAULT_HANDLE_VISUAL })
  const debugDefaultR  = reactive({ ...DEFAULT_DEBUG_VISUAL })
  const snapZoneDefaultR = reactive({ ...DEFAULT_SNAP_ZONE_CONFIG })
  const edgeVisualToProvide   = props.edgeVisual   ?? edgeDefaultR
  const handleToProvide       = props.handleVisual ?? handleDefaultR
  const debugToProvide        = props.debugVisual  ?? debugDefaultR
  const snapZoneToProvide     = props.snapZoneVisual ?? snapZoneDefaultR
  ```
- `CanvasHost.vue:1037-1046`：把它们作为 props 传给内层 `<CanvasSurface ... :edge-visual="edgeVisualToProvide" ... />`。
- `CanvasSurface.vue:166-190`：把这些 props **原引用**塞进 `renderCtx`（`handleParams: props.handleParams` 等），`provide(RENDER_CONTEXT_KEY, renderCtx)`；还用同引用 provide 旧 6 令牌（196-199 行）。注释（renderContext.ts:19）明确："字段里凡宿主注入的响应式对象保持原引用，属性改即实时生效"。
- BaseNode 经 `useCanvasRender()` 解构读（BaseNode.vue:26），Vue computed 追踪到同一响应式对象。

### 结论（回答问题 1 的选择题）

**(b) 目前没有自动同步，宿主须自己 subscribe。** 并没有一个把 `ctx.settings` 值同步进 CanvasHost 那几份 reactive 对象的"内置桥"。
CanvasHost 只是"被动接收"宿主传进来的响应式引用 + 内部 DEFAULT 回落，它**自己不订阅 ctx.settings**。
真正把 settings 写进 reactive 的桥（`ui/App.vue` 的 `bindThemeSettings`）位于宿主/应用层，且只处理 edge/handle/debug/snapZone 四个命名空间。

> 佐证：`plugin-theme-default/src/index.ts:437` 注释明说——
> "P4：config 已内核校验+补默认；如需在插件内就地订阅自己 config 的变化并窄更新，可 ctx.settings.onChange(...)（demo 侧已演示该链路）"。
> 即插件自己没接、把链路留给宿主(demo 侧)演示。

### 两份"默认值集合"的关系（问题 1 末尾）

| 集合 | 位置 | 用途 |
|---|---|---|
| `DEFAULT_EDGE_VISUAL` / `DEFAULT_HANDLE_VISUAL` / `DEFAULT_DEBUG_VISUAL` | `canvas-render/src/host/canvasHostCore.ts:111/135/147`（类型=contracts 的 EdgeVisual/CanvasParams/CanvasDebug） | **CanvasHost 内部 DEFAULT reactive 回落**用它 |
| `DEFAULT_SNAP_ZONE_CONFIG` | `canvas-render/src/connection/geometry.ts:54` | CanvasHost snapZone 回落用它 |
| `DEFAULT_THEME_EDGE` / `DEFAULT_THEME_HANDLE` / `DEFAULT_THEME_DEBUG` / `DEFAULT_THEME_SNAP_ZONE` | `plugin-theme-default/src/index.ts:37/61/73/79` | **插件 Config schema 的字段默认值 + 配置单一数据源初始值**，也是 `cfg`(ui/App) 的初始值 |

两者字段**一致对齐**（注释都写"对齐 canvasHostCore DEFAULT_*"），数值相同，但语义上：canvasHostCore 那份是"宿主没被喂 prop 时的渲染回落默认"；plugin 那份是"config 声明/设置面板的初始值"。CanvasHost 实际渲染用的是哪一份？
- 没传 visual props（如 theme-default 的 demo-web，只传 `:plugins`）→ 用 **canvasHostCore 的 DEFAULT_\***（host 内部 reactive 回落）；
- 传了 props（ui/App 传 `cfg.*`）→ 用 **plugin 的 DEFAULT_THEME_\*** 副本（cfg 初始由它铺，随后 settings 变更窄更新）。
两处数值一样所以视觉一致；改动任一默认值都要两边同步（除非宿主总喂 cfg）。

> 注意：snapZone 的"默认兜底带宽/高比"最终在 `geometry.ts` 的函数默认参数 `cfg: SnapZoneConfig = DEFAULT_SNAP_ZONE_CONFIG` 及逐字段 `cfg.heightRatio || 0.8` 处（geometry.ts:121 等）再兜一层，与 BaseNode 侧的 `useNodeDebugOverlay` 同源。

---

## 问题 2：renderContext / CanvasSurface 里几个字段的类型与来源 + 回落语义

统一上下文 `renderContext.ts:41-97`（`CanvasRenderContext`）。BaseNode.vue:26 解构 `{ registry, nodeWrite, handleParams, connectionState, interaction, debug, snapZone }`。

| useCanvasRender 字段 | 类型（contracts） | 来源 | BaseNode 读法 / 回落 |
|---|---|---|---|
| `handleParams` | `CanvasParams`（canvasParamKey.ts:10） | CanvasHost prop `handleVisual ?? handleDefaultR` → CanvasSurface `props.handleParams` | **无整份回落、字段级用 `??`/`||` 兜底**。BaseNode 342-346 行：`Number(handleParams.portZoneWidth)||0`、`handleParams.portZoneShape ?? 'arc'`、`Number(handleParams.portZoneHeightRatio)||0.8`。注意 CanvasHost 注释 100-101/174 行：BaseNode 读 handle 字段**无回落**，故宿主传 handleVisual 需是"含全字段"的响应式对象（这也是为什么 ui/App 用 `{...DEFAULT_THEME_HANDLE}` 铺全 8 字段）。前 3 个字段（handleRestOffset/handleCursorGap/handleButtonSize）在 CanvasParams 里是必填，BaseNode 模板 510/534 直接透传无兜底 |
| `debug` | `CanvasDebug`（debugContext.ts:14，2 个布尔） | CanvasHost prop `debugVisual ?? debugDefaultR` → CanvasSurface | **读点回落**：BaseNode 326/334 行 `Boolean(debug.handleDebug)` / `Boolean(debug.connectionSnapDebugVisible)`（undefined→false） |
| `snapZone` | `SnapZoneConfig`（geometry.ts:42） | CanvasHost prop `snapZoneVisual ?? snapZoneDefaultR` → CanvasSurface | **交给 useNodeDebugOverlay 整体消费**（BaseNode 347-352 行），最终默认兜在 geometry.ts 函数默认参数 |
| `edgeVisual` | `Partial<EdgeVisual>`（edgeContext.ts:11） | CanvasHost prop `edgeVisual ?? edgeDefaultR` | **CustomEdge（边组件）消费，BaseNode 不读**。CustomEdge 侧逐字段 `??` 回落（本调研未展开 CustomEdge，属边外观链路） |

**新增"标题视觉"字段该照哪种模式？**
照 **debug 的"宿主给响应式引用 + 读点默认回落"** 更稳妥：标题字段未来可能只是其中若干被覆盖、也希望能缺席时不崩——
与 debug 类似它是"壳组件本地消费、非强约束 5 字段合同"。
handleParams 是"全字段必给、无回落"模式（CanvasHost 注释与 CanvasParams 前 3 必填都说明这点），若走它得保证宿主总传全字段，
对"可选的标题配置"来说更重、更易漏。

**推荐落法**：在 CanvasHost 新增一个 prop（如 `titleVisual?: TitleVisual`）+ 一份内部 `DEFAULT_TITLE_VISUAL` 回落
（照 edgeVisual/debugVisual 同一套"`props.titleVisual ?? reactive({...DEFAULT})` → 传 CanvasSurface → provide 原引用 → BaseNode 读 + 读点回落"），
字段如 `{ titleOffset?: number, titleScaleMinZoom?: number }`，BaseNode 用 `useCanvasRender().titleVisual?.titleOffset ?? 12` 之类本地回落。
然后在 Config schema 加同名 2 键 + 键集合，宿主 bindThemeSettings 里窄更新。**（照现有 4 条链的模式扩展第 5 条，不要塞进 CanvasParams。）**

---

## 问题 3：现有 handleRestOffset / edgeColor / handleDebug / snapZone 是否"实时生效"？

**结论：只在 `packages/ui`（成品应用）里实时生效；canvas-render/theme-default 自身不生效。**

证据：
- 写链：设置面板控件改动经 `SettingsSchemaField.vue:64 set(k,v)` → `props.settings.set`（settingsSource 适配的 SettingsStore.set，SettingsHost.vue 现取 `ctx.get('settings')`）→ `SettingsStore.onChange` 触发。内核 `ctx.settings.set/get/onChange` 也全部转交同一份 `SettingsStore`（capabilities.ts:229-242 `settingsStore() = ctx.get<SettingsStore>('settings')`）。
- 读链（谁订阅并写回 reactive）：**只有 `packages/ui/src/App.vue` 的 `bindThemeSettings`（115-160 行）**在订阅 `store.onChange` 并把声明的 edge/handle/debug/snapZone 键窄更新进 `cfg` 响应式对象 → 作为 4 个 visual props 传 CanvasHost。这就是"现有这些 config 项已经实时生效"的唯一桥。
- 反证（不生效的场景）：`plugin-theme-default/demo-web/App.vue`（33-39 行）只传 `:plugins`、**不传任何 visual props、也没有 SettingsHost / bindThemeSettings** → CanvasHost 走内部 `reactive(DEFAULT_*)` 回落，那几份对象没人写，所以在该 demo 里改 config **不会**实时反映。
- canvas-render 内部（CanvasHost.vue/CanvasSurface.vue/canvasHostCore.ts/createMiniCanvasHost.ts）只订阅 nodeStore/edgeStore/selection/themeRegistry/nodeRegistry（CanvasHost.vue:908-946），**没有任何对 ctx.settings/onChange 的订阅**。唯一的 settings.onChange 订阅（canvas-core-v2/src/services/settingsPersist.ts:51）是**持久化**（落盘），不写渲染 reactive。

因此 Q3 答案：edgeColor/handleRestOffset/handleDebug/snapZone 这些字段**已经**接成实时视觉，**但前提是宿主像 ui/App 那样手动接了"订阅→写 cfg→传 props"的桥**；属于宿主责任，不是 canvas-render/plugin 自带能力。

---

## 附：改动落地清单（供后续实现参考，未改任何源码）

1. `plugin-theme-default/src/index.ts`：
   - `Config` 增加 `titleOffset`（number，默认 12，group 如 `节点/标题`）与 `titleScaleMinZoom`（number，默认 0.5）；
   - 新增 `TITLE_SETTING_KEYS = ['titleOffset','titleScaleMinZoom']` 导出。
2. `canvas-render`：新增一个视觉 prop（`titleVisual`）+ contracts 类型 + `DEFAULT_TITLE_VISUAL` 回落 + CanvasHost 选中/回落 + CanvasSurface provide 原引用 + renderContext 字段。**照 edgeVisual/debugVisual 的模式扩展，别塞进 CanvasParams。**
3. `BaseNode.vue`：`useCanvasRender()` 取 title 视觉，`titleOffset/titleScaleMinZoom` 常量改为读字段并本地回落默认（12 / 0.5）；`titleScale/titleCanvasWidth/titlePositionStyle` 用它们（42-77 行）。
4. 宿主（如 ui/App.vue）：`cfg.title` 铺 `DEFAULT_THEME_TITLE` 副本，`bindThemeSettings` 把 `TITLE_SETTING_KEYS` 加进 `targetOf`/订阅键，传 `:title-visual="cfg.title"`。
5. v1 参照：`packages/canvas-core/src/components/Decoration/BaseNode.vue:50-73` —— `createNodeTitleLocalLayout(zoom,{offset: canvas.state.core.nodeTitleOffset, minZoom: canvas.state.core.nodeTitleScaleMinZoom})`，v2 把这两个值内联成了 `TITLE_OFFSET=12 / TITLE_MIN_ZOOM=0.5`（BaseNode.vue:42-43），本次要把它"外置成可配置"。

---

## 关键文件:行号速查

- `packages/ui/src/App.vue:65-71`（cfg reactive）、`115-160`（bindThemeSettings = 唯一 settings→visual 桥）、`146-159`（onChange 窄更新）、`216-219`（传 4 个 visual props）
- `packages/canvas-render/src/host/CanvasHost.vue:175-182`（内部 DEFAULT reactive 回落 + 选引用）、`1037-1046`（传 CanvasSurface）
- `packages/canvas-render/src/host/CanvasSurface.vue:166-190`（renderCtx 原引用）、`191`（provide RENDER_CONTEXT_KEY）
- `packages/canvas-render/src/contracts/renderContext.ts:19`（注释：宿主注入响应式对象原引用、属性改实时生效）、`41-97`（字段类型）
- `packages/canvas-render/src/host/canvasHostCore.ts:111/135/147`（DEFAULT_EDGE/HANDLE/DEBUG_VISUAL）
- `packages/canvas-render/src/connection/geometry.ts:42-58,121,135`（SnapZoneConfig + DEFAULT_SNAP_ZONE_CONFIG + 函数级兜底）
- `packages/plugins/plugin-theme-default/src/index.ts:37/61/73/79`（DEFAULT_THEME_\*）、`86-105`（\*_SETTING_KEYS）、`116-430`（Config schema）、`437`（注释：config 窄更新链路留宿主/demo 演示）
- `packages/plugins/plugin-theme-default/src/components/settings/SettingsSchemaField.vue:64`（set 入口）、`PluginSettingsDialog.vue`（面板皮）
- `packages/canvas-render/src/components/SettingsHost.vue`、`settingsSource.ts`（ctx.get('settings') 适配面板）
- `packages/canvas-core-v2/src/core/capabilities.ts:229-242`（ctx.settings → SettingsStore）
- `packages/canvas-core-v2/src/services/settingsPersist.ts:51`（settings.onChange 仅用于持久化，非渲染）
- `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue:42-43`（TITLE_MIN_ZOOM/TITLE_OFFSET 常量）、`45/68/71-77`（titleScale/titleCanvasWidth/titlePositionStyle）、`26/342-347`（读 handleParams/debug/snapZone 的回落写法参照）
- `packages/plugins/plugin-theme-default/demo-web/App.vue:33-39`（只传 plugins、无 visual props、无桥 → 改 config 不实时）
- v1 参照：`packages/canvas-core/src/components/Decoration/BaseNode.vue:50-73`（nodeTitleOffset/nodeTitleScaleMinZoom）
