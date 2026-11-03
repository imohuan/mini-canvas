# canvas-core-v2 重构依赖图 + 文件归属清单（执行期 owner 依据）

日期：2026-09-04 · 分支：feat/cordis-plugin-system
生成：自写 node 脚本扫描 canvas-core/src 全部 import（180 文件,codegraph 已建索引 228 文件/3108 符号/6148 边）。方法:按顶层目录 + 插件子目录归"模块",统计模块间跨模块 import 与被依赖。**这张图是执行期切包/定 owner 的依据,子代理改法须对照它,不许脑补边界。**

---

## 一、文件归属清单（模块 → 文件数 → 内容）

| 模块 | 文件数 | 内容 |
|---|---|---|
| **(root)** | 2 | `Canvas.vue`(741 上帝组件)、`index.ts`(barrel) |
| **plugins/(内核)** | 7 | PluginManager / PluginContext / PluginRegistry / PluginInstaller / PluginDependencyGraph / ShortcutManager / types.ts —— 内核,顶层 7 个 ts |
| **registry/** | 10 | Node/Menu/Command/Toolbar/Panel + DialogRegistry + types + tests |
| **composables/** | 11 | useCanvasStore/Connection/Bootstrap/Flow/Shortcuts/PanelState/PluginSystem/Performance/Theme/UpstreamImages/UpstreamResources |
| **runtime/** | 8 | CanvasRuntime + DomService + Events + Key + Provider + useCanvasRuntime/usePluginApi + index |
| **storage/** | 1 | AssetRuntimeService.ts |
| **types/** | 1 | CanvasNodeData.ts |
| **utils/** | 3 | constants/format/viewportSpace |
| **components/** 顶层 | 3 | CustomEdge/CustomNode/TempTargetNode |
| **components/Decoration** | 6 | BaseNode/BaseTitle/MovingHandle/NodeToolbar/ResizeHandle/ToolbarButton |
| components/Menu | 1 | CanvasMenu |
| components/Panel | 2 | DynamicSettingsPanel/Field |
| components/Performance | 3 | Panel/Sparkline/performanceMetrics |
| components/Toolbar | 1 | BaseToolbar |
| components/Ui | 14 | Ax* 控件族 + useFloating/useTeleportTarget |
| **nodes/image** | 14 | ImageNode+Plugin+7 个子组件+imageModels+backendImageModels+useImageDisplay |
| nodes/Video | 7 | VideoNode+Plugin+Clip/Cropper/utils |
| nodes/panorama | 4 | PanoramaNode+Plugin+Upload |
| nodes/text | 3 | TextNode+Plugin |
| nodes/image-compare | 3 | ImageCompareNode+Plugin |
| **plugins/storage** | 11 | Storage/BackendStoragePlugin + adapters(AssetStore 族)+sanitize |
| plugins/theme | 5 / group 5 / backend-sync 4 / auto-layout 7 / align-arrange 4 / edge-cutting 3 / context-menu 3 / custom-handle 3 / mini-map 3 / multi-select 3 / node-find 3 / align-guide 2 / auto-save 2 / canvas-export 2 / clipboard 2 / history 2 / file-drop 2 / shortcut-manager 5 | 各插件 |

---

## 二、依赖方向图（核心）

```
第三方: vue(24模块) / @vue-flow/core(23) / pinia(2) / vueuse(2) / dagre / three / prosemirror-editor-bundle(4,仅 image)

被依赖数(接缝/枢纽,从高到低):
  plugins内核(顶层)  ← 被 29 个模块依赖    ★最大枢纽 = 所有插件 import 它的 PluginContext/types
  registry           ← 被 17 个模块依赖
  composables        ← 被 12 个模块依赖    (useCanvasStore 被到处用)
  runtime            ← 被 9 个模块依赖
  utils              ← 被 9 个模块依赖
  components/Decoration( BaseNode/BaseToolbar/NodeToolbar/ResizeHandle ) ← 被 7 个模块依赖
  plugins/storage    ← 被 7 个模块依赖
  components/Toolbar( BaseToolbar ) ← 5     components/Ui( Ax* ) ← 4
```

依赖方向总体**干净、无业务环**:
```
Canvas.vue(上帝) ──装配──▶ registry×6 + composables×4 + plugins×4 + components...
每个插件/节点模块 ──▶ registry + runtime + composables(store) + components + plugins内核
所有东西 ──▶ utils / types(底层,无人依赖它们)
```
**插件之间几乎不静态 import**(仅 auto-save→storage、file-drop→storage、file-drop→Video)。印证审计结论:v1 插件靠"字符串事件 + getPluginAPI + Canvas.vue 装配"耦合,不靠代码依赖。

---

## 三、发现的接缝团（切包最关键的信号）

**🔴 内核纠缠团: `plugins内核 ⇄ runtime ⇄ registry` 双向 import(有环)**
- plugins(顶层,PluginManager 等)→ import registry×9、runtime×1
- runtime → import registry×5、plugins×3、plugins/storage×1
- registry → import plugins×1(内核 types)
- **这是 v1 的"内核 + registry 袋子 + runtime"三者互相咬合的团**,Canvas.vue 把它们 new 出来手拼。
- **切包含义**:这团(plugins内核 + registry + runtime)必须**归同一个 owner 一次重构**,不能拆给多路并行——它是 Cordis 内核层的核心,边界在"这团 vs 其它"。

**🟠 Canvas.vue 是唯一装配根**：它一个人 import registry×6 + composables×4 + plugins×4 + storage + runtime + utils + components。所有"跨模块接线"都在这一个文件。v2 拆薄它 = 把这团接线下沉成"宿主 thin layer + 内核 plugin()"。

**🟠 composables(useCanvasStore) 是状态枢纽**:被 12 模块依赖。其中 useCanvasFlow/usePluginSystem/useCanvasShortcuts/useCanvasPanelState/useTheme 审计已知是死代码(与 Canvas.vue 重复)。切包时 composables 里"活的 useCanvasStore/useCanvasConnection/useCanvasBootstrap"与"死的 5 个"要分开。

**🟢 干净可独立模块**(低耦合,适合并行/单独迁):
- components/Ui(Ax* 控件族):只依赖 vue/vueuse/floating,零内部耦合 → 纯 UI 基建
- components/Decoration(BaseNode/BaseToolbar...):依赖 composables/runtime/utils
- 各业务插件、各节点(除 image 依赖面大):依赖内核/registry/store,彼此独立
- utils/types:最底层

---

## 四、切包与 owner 建议（执行期用,呼应"一个文件一个 owner"）

> 原则:① 纠缠团一次一个 owner;② 无相互 import 的模块才可并行;③ 分析已全并行(5 路审计),执行期按下面分。

### 依赖拓扑序(自底向上重构/迁移)
```
L0 最底层(零内部依赖): utils、types、components/Ui(Ax*)
L1 依赖 L0: components/Decoration、registry、composables(store/connection 活件)
L2 内核纠缠团(一次做): plugins内核 + registry + runtime + Canvas.vue 装配  ← Cordis 内核层,单 owner
L3 依赖内核: plugins/storage(Save 层)、history/clipboard/group/selection 内核服务
L4 消费方: 各交互插件、context-menu、各节点(text/image/Video/panorama/image-compare)
```

### 建议的 owner 划分(每个独立可并行)
| # | 包(owner) | 内容 | 并行性 |
|---|---|---|---|
| A | **内核纠缠团** | plugins内核(PluginManager/Context/Registry/死三件套) + registry + runtime + Canvas.vue | 单 owner 一次做,Cordis 化 |
| B | **Save 层** | plugins/storage(AssetStore 族)+ auto-save + shortcut-manager + useCanvasStore 持久化部分 | 依赖 A 的 ctx.save 接口;可 A 定接口后并行 |
| C | **内核服务** | history/clipboard/group/multi-select/context-menu(服务化收编) | 依赖 A,B |
| D | **简单节点+渲染体系** | components/Decoration + text 节点 + NodeRenderer/registry 槽 | 依赖 A;M4 demo 载体 |
| E | **复杂节点** | image/Video/panorama/image-compare | **本任务不做**(另开任务) |
| F | **交互工具** | align-*/auto-layout/custom-handle/mini-map/node-find/export/edge-cutting | 后续任务 |

> 本任务(M1 内核 + M4 text demo)实际只需 owner A(内核)+ D 的"text + NodeRenderer 最小子集 + save 最简(config)"。B/C/E/F 全留后续,不并行抢。

---

## 五、给执行期子代理的 owner 铁律(写进每个 prompt)
1. 你的包范围 = 上面表格某一行,不碰其它 owner 的文件。
2. 你不是代码库里唯一 agent,忽略不属于你包的任何编辑。
3. 涉及跨包接口(内核 ctx/registry/save/NodeRenderer),**只实现/消费共享契约文档(`docs/plan/canvas-core-v2-api.md` + ADR),不许自己发明或改契约**。
4. 遇到规范外/不明确 → 上报停手,不许脑补。
5. Do not change the tests。
6. Done when = 明确的可运行判据(命令 exit 0)。

---

## 附:依赖图脚本
`<app_data_dir>/agents/code-developer/scratchpad/session-*/depmap.js`(扫描全部 import 按模块聚合)。可重跑复核。
