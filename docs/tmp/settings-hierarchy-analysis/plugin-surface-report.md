# 设置面板可配置面盘点报告 —— demo 宿主加载的全部插件

> 调查范围：`D:/Code/Git/mini-canvas/packages/ui/src/App.vue` 的 `plugins` 数组里列出的 **16 个插件**
> （它们是 demo 宿主真正装配、会被用户碰到的所有插件）。
> 方法：逐包读 `src/` 源码（codegraph_files 定位 + read_file 逐行核对），精确到 file:line。
> 归类建议里，一级分类沿用你计划的候选：`节点 node / 边 edge / 主题 theme / 常规 general / 调试 debug / 布局 layout`，
> 我额外用了 `ui`（界面外观，右键菜单/快捷键帮助/设置框本身等全局 UI chrome）与 `minimap`（小地图专用）。
>
> ⚠️ **对上次漏项的修正**：同目录 `research.md`（上次调查）只认定了 3 个导出 Config 的插件
> （theme-default / node-image / auto-layout），**漏了 edge-cutting、canvas-export、mini-map**——
> 这三个都各自导出 `Config`（在独立 `*Config.ts` 文件或 plugin 文件里），会被设置面板读到。
> 本报告把它纠正为 **6 个导出 Config 的插件**，并把"无 Config 但有硬编码视觉"的插件也一并列全。

---

## 结论速览（先看这里）

| 插件 | 导出 Config 进设置面板？ | 硬编码颜色/视觉需补？ | 归类 |
|---|---|---|---|
| theme-default | ✅ 是（唯一"大而全"） | 节点壳用 CSS 变量(全硬编码，未进 Config)；背景/边截图也硬编码 | edge / node / debug |
| node-text | ❌ 无 | 编辑框边框 `#2563eb` 硬编码 | node |
| node-image | ✅ 是 | 少量 | node |
| edge-cutting | ✅ 是 | 无（pathColor/bladeColor 已是 Config 项） | edge |
| canvas-commands | ❌ 无 | 无 | ui/general |
| multi-select | ❌ 无 | 框选 `#3b82f6`、群组框 `rgba(148,163,184,…)` 硬编码 | ui（选中交互视觉）|
| align-guide | ❌ 无 | 参考线 `rgba(99,102,241,0.6)` 硬编码 | ui（对齐参考）|
| auto-layout | ✅ 是 | 无颜色 | layout |
| align-arrange | ❌ 无 | 无 | layout |
| group | ❌ 无 | 色板在 groupEngine，底色是**每节点 data** 非全局 | node（分组容器）|
| context-menu | ❌ 无 | 菜单外观全在 CSS 硬编码 | ui/general |
| clipboard | ❌ 无 | 无 | ui/general |
| canvas-export | ✅ 是 | 导出底白 `#ffffff` 硬编码 | export |
| node-find | ❌ 无 | 类型筛选色板 + 浮层样式硬编码 | ui/general |
| mini-map | ✅ 是 | 小地图边框/节点色硬编码 | minimap |
| shortcut-manager | ❌ 无 | 面板样式硬编码；有键位 remap（行为非外观）| ui/general |

> **最终：16 个被加载插件里，已有 Config 进设置面板 = 6 个**
> （theme-default、node-image、edge-cutting、auto-layout、canvas-export、mini-map）。
> **硬编码颜色/外观、当前无 Config 需要"待补"的 = 8 个**
> （node-text、multi-select、align-guide、group、context-menu、node-find、mini-map 的边框色、theme-default 的节点壳变量）。
> 纯逻辑/无外观需进面板的 = canvas-commands、align-arrange、clipboard、shortcut-manager（行为键位 remap 除外）。

---

## 逐插件详情

### 1. theme-default（@mini-canvas/plugin-theme-default）—— 画布默认"皮"
**归类：edge（连线/辉光）+ debug + node（壳外观用 CSS 变量，未进 Config）**

**导出 Config = ✅ 有**，位置 `packages/plugins/plugin-theme-default/src/index.ts:115 export const Config`。
它同时导出若干 `DEFAULT_THEME_*` 与 `*_SETTING_KEYS`，供宿主做"config 变化→就地窄更新"，见 App.vue 66-71 / 115-164 的 bindThemeSettings。

Config **全部字段**（key : type : default : group，共 27 个，均已在设置面板显示）：

**一级「连线」（group=`连线/…`，二级 = 样式/颜色/显示/箭头/辉光流动）**
- `edgeType` select `bezier`，`连线/样式`（index.ts:117）
- `edgeLineWidth` number `2`，`连线/样式`（:131）
- `edgeDashed` boolean `false`，`连线/样式`（:141）
- `edgeColor` **color** `#1f2937`，`连线/颜色`（:149）
- `edgeGlowColor` **color** `#0891b2`，`连线/颜色`（:156）
- `edgeVisible` boolean `true`，`连线/显示`（:164）
- `edgeVisibleOnSelect` boolean `false`，`连线/显示`（:171）
- `edgeOnTop` boolean `false`，`连线/显示`（:178）
- `edgeMarkerEnd` boolean `false`，`连线/箭头`（:186）
- `edgeMarkerSize` number `8`，`连线/箭头`（:193）
- `edgeGlowEnabled` boolean `true`，`连线/辉光流动`（:203）
- `edgeGlowIntensity` number `1`，`连线/辉光流动`（:210）
- `edgeAnimated` boolean `true`，`连线/辉光流动`（:220）
- `edgeFlowEnabled` boolean `true`，`连线/辉光流动`（:227）
- `edgeFlowBlockSize` number `90`，`连线/辉光流动`（:235）
- `edgeFlowGap` number `260`，`连线/辉光流动`（:246）
- `edgeFlowSpeed` number `2.5`，`连线/辉光流动`（:257）
- `edgeFlowFade` number `35`，`连线/辉光流动`（:267）
- `edgeFlowIntensity` number `0.9`，`连线/辉光流动`（:278）

**一级「端口」（group=`端口/…`，二级 = 浮动球 / 吸附区域）**
- `handleRestOffset` number `36`，`端口/浮动球`（:289）
- `handleCursorGap` number `24`，`端口/浮动球`（:299）
- `handleButtonSize` number `32`，`端口/浮动球`（:309）
- `portZoneWidth` number `86`，`端口/吸附区域`（:319）
- `portZoneArcRatio` number `0.8`，`端口/吸附区域`（:329）
- `portZoneHeightRatio` number `0.55`，`端口/吸附区域`（:340）
- `portZoneOffset` number `0`，`端口/吸附区域`（:350）
- `portZoneShape` select `arc`，`端口/吸附区域`（:360）

**一级「吸附带」（group=`吸附带`，单一分类）**
- `heightRatio` number `0.8`（:372）、`width` number `0`（:382）、`offset` number `0`（:392）、`shape` select `rect`（:402）

**一级「调试」（group=`调试`，单一分类）—— debug**
- `handleDebug` boolean `true`（:414）
- `connectionSnapDebugVisible` boolean `true`（:422）

**硬编码、不在 Config 里的主题面（重要 —— 你要补的"主题"主体）：**

- **节点壳外观全走 CSS 变量，硬编码在 `styles/node-theme.css`，不进 Config：**
  - `--canvas-node-surface: #f9fafb`、`--canvas-node-panel-surface: #ffffff`、hover/active `#f3f4f6/#e5e7eb`（node-theme.css:4-7）
  - `--canvas-node-text-muted: #64748b`、text `#4b5563`、text-strong `#111827`（:8-9）
  - `--canvas-node-border/border-subtle/border-hover: #e5e7eb/#e5e7eb/#d1d5db`（:10-13）
  - 选中环/描边（rgb 灰系）：`--canvas-node-ring: rgb(17 24 39 / .92)` 等（:14-21）
  - 缩放柄：`--canvas-node-resize-handle: #9ca3af`、active `#111827`（:22-23）
  - 端口吸附/接收区（半透明灰）：`:target-zone-*` / `:snap-zone-*`（:24-29）
  - 调试可视化：`:debug-*`（:30-35）
- **BaseNode 引用点（带 CSS 变量回退值）**：surface `#f9fafb`（BaseNode.vue:511）、文字 muted `#6b7280`(:667)、text-strong `#111827`(:674)、text `#4b5563`(:693)、resize handle `#9ca3af`(:744)、snap-zone-highlight `#dc2626`(:636 注：CSS 变量默认是白，此处回退写成红)。选中态/端口文字多为 `#fff`/`#b45309`。
- **画布背景（DefaultBackground.vue）**：`DOT_COLOR = '#cbd5e1'`(:15)、`BG_COLOR = '#f8fafc'`(:16) —— 硬编码，不在 Config。
- **CustomEdge 其余硬编码**：fallback 线色 `#3b82f6`(CustomEdge.vue:57)、剪切小按钮 `rgba(255,255,255,.95)` 背景 / `#ef4444` hover 危险红(:348-352)。
- **设置面板自身/组件库（PluginSettingsDialog.vue / SettingsSchemaField.vue / Select.vue / Dropdown.vue）**：主题青 `#0891b2`、深青 hover `#0e7490`、各种灰阶 —— 全 CSS 硬编码，属 ui chrome。

> 提示：主题插件 group 命名用的是中文 `连线/辉光流动`（一级/二级用 `/` 分隔），与你要建的 node/edge/theme… 英文一级不是一套。

---

### 2. node-text（@mini-canvas/plugin-node-text）—— text 节点
**归类：node**

- **Config = ❌ 无**（nodeTextPlugin.ts 只有 Service + nodes.register，无 ConfigSchema，无 group）。
- **硬编码颜色：** `TextContent.vue:102 .editor { border: 1px solid #2563eb }` —— 编辑态输入框边框蓝，硬编码。
- 其余为字体内边距等，无独立颜色常量。
- 节点本身外观（壳/选中/端口）由 theme-default 的 BaseNode + node-theme.css 负责。

---

### 3. node-image（@mini-canvas/plugin-node-image）—— image 节点
**归类：node**

**Config = ✅ 有**，位置 `nodeImagePlugin.ts:65 export const Config`，全部字段：
- `cornerRadius` number `8`，group=`图片`（:67）
- `showShadow` boolean `true`，group=`图片`（:68）
- `borderWidth` number `1`，group=`边框`（:70）
- `borderColor` **color** `#334155`，group=`边框`（:71）
- `blurOnLoad` boolean `false`，group=`高级`（:73）
- `lazyLoad` boolean `true`，group=`高级`（:74）

**硬编码：** `ImageContent.vue` 占位/错误文字 `#9ca3af`(:49)、`#b45309`(:41)；图片 object-fit 无颜色。少，可不进面板。

---

### 4. edge-cutting（@mini-canvas/plugin-edge-cutting）—— Alt 刀光切边
**归类：edge**

**Config = ✅ 有**，独立文件 `edgeCuttingConfig.ts:13 export const Config`，随插件导出（edgeCuttingPlugin.ts:33）。字段：
- `enabled` boolean `true`，group=`连线切割`（:14）
- `tolerancePx` number `8`，group=`连线切割`（:22）
- `sampleStepPx` number `6`，group=`连线切割`（:33）
- `pathColor` **color** `#38bdf8`，group=`连线切割`（:44）—— 切割轨迹色
- `bladeColor` **color** `#38bdf8`，group=`连线切割`（:51）—— 刀锋色
- `showCutPath` boolean `true`，group=`连线切割`（:58）

运行时从 settings 实时读（edgeCuttingConfigFrom, :72），CSS 变量 `--edge-cutting-path-color/blade-color` 在 `edgeCuttingOverlay.ts:54/64`，回退默认同 `#38bdf8`。白描边 `#ffffff`(:80/95)、白辉光 rgba(:85)。**颜色已是 Config 项，无需再补。**

---

### 5. canvas-commands（@mini-canvas/plugin-canvas-commands）—— 建/删/撤销
**归类：ui/general（纯逻辑，无外观可配置）**

- **Config = ❌ 无**（canvasCommandsPlugin.ts 只有 command:delete/create-node/undo/redo）。
- 无颜色/视觉常量。不进设置面板。

---

### 6. multi-select（@mini-canvas/plugin-multi-select）—— Shift 框选 / 全选
**归类：ui（选中交互视觉，常被当"节点选择框主题"）**

- **Config = ❌ 无**（multiSelectPlugin.ts 无 ConfigSchema）。
- **硬编码颜色：**
  - 框选虚框 `BoxSelectLayer.vue:88`：`border:1.5px dashed #3b82f6; background:rgba(59,130,246,0.06)`（蓝）。
  - 群组框 `SelectionFrame.vue:298` 外框 `rgba(148,163,184,0.72)`（石板灰虚线）；内框 `rgba(96,165,250,0.42)` 边 + `rgba(96,165,250,0.045)` 填充（:308-309）；拖拽态加深（:313-322）。
- 框选命中/多选手势为逻辑，无更多视觉。

---

### 7. align-guide（@mini-canvas/plugin-align-guide）—— 拖拽吸附参考线
**归类：ui（对齐参考线，属"交互辅助线颜色"主题面）**

- **Config = ❌ 无**（alignGuidePlugin.ts 无 ConfigSchema；吸附阈值 `SNAP_THRESHOLD` 在 alignGuideEngine.ts）。
- **硬编码颜色：** `AlignGuideOverlay.vue:105 .align-guide-line { background: rgba(99,102,241,0.6) }` —— 参考线紫/靛蓝 60% 透明，**硬编码、无 CSS 变量、不可调**。

---

### 8. auto-layout（@mini-canvas/plugin-auto-layout）—— Ctrl+L 自动布局 / F 聚焦
**归类：layout**

**Config = ✅ 有**，`autoLayoutPlugin.ts:56 export const Config`，字段：
- `direction` select `LR`，group=`布局/方向`（:58，options LR/TB/RL/BT）
- `intraSpacingX` number `60`，`布局/间距`（:71）
- `intraSpacingY` number `80`，`布局/间距`（:72）
- `interSpacingX` number `120`，`布局/间距`（:73）
- `interSpacingY` number `120`，`布局/间距`（:74）
- `debug` boolean `false`，`布局/诊断`（:75）
- `focusHeightRatio` number `0.5`，group=`聚焦`（:77）
- `minZoom` number `0.1`，group=`聚焦`（:78）
- `maxZoom` number `4`，group=`聚焦`（:79）

无颜色。**建议归 layout（你的一级里就是 layout）。注意它自带的 group=`布局/方向`、`布局/间距`、`布局/诊断`、`聚焦` 已是中文二级体系。**

---

### 9. align-arrange（@mini-canvas/plugin-align-arrange）—— 对齐/等距
**归类：layout（纯逻辑命令，无外观）**

- **Config = ❌ 无**（alignArrangePlugin.ts 只注册 11 条 command，group=`align-arrange` 是命令分组不是 Config；无 ConfigSchema）。
- 无颜色。紧凑间距常量 `COMPACT_GAP = 20`(:51)、回退尺寸 FALLBACK_W/H(:48-49) 非视觉主题。
- 不进设置面板。

---

### 10. group（@mini-canvas/plugin-group）—— 分组
**归类：node（分组容器外观）—— 注意其颜色是"每节点 data"，不是全局主题项**

- **Config = ❌ 无**（groupPlugin.ts 无 ConfigSchema）。
- **颜色数据：** `groupEngine.ts:125 GROUP_COLOR_SWATCHES`（预设 7 色）：
  - slate `#334155`、blue `#0ea5e9`、red `#ef4444`、orange `#f97316`、yellow `#eab308`、green `#22c55e`、violet `#6366f1`，外加 custom。
  - `DEFAULT_GROUP_BACKGROUND_COLOR = #334155`（:136）。
  - 新建组时把默认色写进**该组节点的 `data.backgroundColor`**（groupPlugin.ts:149），`GroupContent.vue:19` 读回经 `resolveGroupBackgroundColor` 再塞给 CSS 变量 `--group-color`（GroupContent.vue:31），GroupContent 内 `color-mix(in srgb, var(--group-color,#334155) …)` 出半透明底/边（:55-56）。
  - 老版的"改分组颜色下拉按钮"在 v2 **被砍掉**（groupPlugin.ts:13 注释），故现在没有改颜色 UI。
- **注意**：分组颜色是**绑定到每个 group 节点数据**的，不是全局设置项——若想让"分组配色"进设置面板，得另想是"全局调色板预设"还是"节点属性编辑"，当前二者都不存在。

---

### 11. context-menu（@mini-canvas/plugin-context-menu）—— 右键菜单
**归类：ui/general（右键菜单外观属全局 UI chrome）**

- **Config = ❌ 无**（contextMenuPlugin.ts 无 ConfigSchema；`group:'节点'/'连线'` 是命令分组）。
- **硬编码颜色（ContextMenu.vue，全 CSS）：**
  - 菜单底 `rgba(255,255,255,0.92)` + 毛玻璃 blur（:132），阴影 rgba(0,0,0,.1)
  - 文字 `#374151`(:136)、label `#111827`(:224)、hover `rgba(0,0,0,.05)`(:166)
  - **danger(删除项) `#ef4444`**（:173/175/179-181）
  - 图标托灰 `#6b7280`(:192) / `rgba(0,0,0,.04)`(:193)；kbd 键帽白底 `#ffffff`(:284)
- 删除命令的菜单危险色是"右键删除"里用户会注意到的主题面，现硬编码红。

---

### 12. clipboard（@mini-canvas/plugin-clipboard）—— 复制粘贴
**归类：ui/general（纯逻辑，无外观）**

- **Config = ❌ 无**（clipboardPlugin.ts 无 ConfigSchema，`group:'clipboard'` 是命令分组）。
- 无颜色。不进面板。

---

### 13. canvas-export（@mini-canvas/plugin-canvas-export）—— Ctrl+E 导出 PNG
**归类：export**

**Config = ✅ 有**，`canvasExportPlugin.ts:40 export const Config`，字段：
- `exportSelectedRectPadding` number `4`，group=`导出`（:41）

**硬编码颜色：** 导出底 `backgroundColor:'#ffffff'` 与 `fillStyle:'#ffffff'`（:80、:133）——导出 PNG 的底白，硬编码。若要做"导出透明/底色"可补项（现在没有）。

---

### 14. node-find（@mini-canvas/plugin-node-find）—— Ctrl+F 搜索
**归类：ui/general（搜索浮层与类型筛选视觉）**

- **Config = ❌ 无**（nodeFindPlugin.ts 无 ConfigSchema）。
- **硬编码：**
  - 节点类型筛选色板 `nodeFindFilter.ts:8-16`（每类型 {label,bg,fg}）：image violet `#ede9fe/#6d28d9`、panorama cyan `#cffafe/#0e7490`、video pink `#fce7f3/#be185d`、image-compare amber `#fef3c7/#b45309`、group blue `#dbeafe/#1d4ed8`、text green `#dcfce7/#15803d`、temp gray `#e5e7eb/#4b5563`、TYPE_FALLBACK `#f3f4f6/#6b7280`。
  - 浮层 `NodeFindOverlay.vue:128/133/181/188/197` 文字/`var(--type-fg,#6b7280)` 等。
- 若要"筛选 chip 配色"进主题，需把 nodeFindFilter 色板参数化。

---

### 15. mini-map（@mini-canvas/plugin-mini-map）—— Ctrl+M 小地图
**归类：minimap**

**Config = ✅ 有**，独立 `miniMapConfig.ts:12 export const Config`，字段：
- `miniMapWidth` number `240`，group=`小地图 mini-map`（:13）
- `miniMapHeight` number `160`，group=`小地图 mini-map`（:14）
- `miniMapSensitivityX` number `1`，group=`小地图 mini-map`（:15）
- `miniMapSensitivityY` number `1`，group=`小地图 mini-map`（:16）
- `miniMapVisible` boolean `true`，group=`小地图 mini-map`（:17）

**硬编码颜色（MiniMapOverlay.vue）：**
- `NODE_COLOR = '#cbd5e1'`(:47) —— 缩略节点色
- `VIEWER_BORDER = '#3b82f6'`(:48) —— 视口框蓝
- 面板底 `#f8fafc`(:300) 边框 `#e2e8f0`(:301)；视口矩形 `2px solid #3b82f6`(:315)
- **小地图"边框色/节点色"是硬编码，Config 里没有颜色项** → 值得为小地图补"节点颜色 + 视口框颜色"。

---

### 16. shortcut-manager（@mini-canvas/plugin-shortcut-manager）—— Ctrl+/ 快捷键帮助
**归类：ui/general（面板视觉；键位 remap 属"行为可配置"但不是外观）**

- **Config = ❌ 无**（shortcutManagerPlugin.ts 无 ConfigSchema）。它暴露"键位重映射/导入导出/恢复默认"（走 `shortcut-remap` 服务 + `save type='shortcut'` 持久化，:43-51），属于**行为配置**，不进设置面板的外观 schema。
- **硬编码颜色（面板 CSS）：** ShortcutHelpPanel.vue / RemapPanel.vue / ShortcutKeys.vue 大量灰阶 + 主题青 `#0891b2`/深青 hover `#0e7490`/amber `#b45309`（见 grep 结果 RemapPanel.vue:351/369/406/445 等，ShortcutHelpPanel.vue:670/679/695），全 CSS 硬编码。

---

## 总结一段话

demo 宿主一共加载 **16 个插件**；其中需要"颜色/外观/开关"进设置面板的，按源码统计：

- **已有 Config（6 个）**：`theme-default`（27 项，最全：连线/端口/吸附带/调试）、`node-image`（6 项）、`edge-cutting`（6 项，含 2 个颜色）、`auto-layout`（9 项）、`canvas-export`（1 项）、`mini-map`（5 项）——这 6 个已能被 ⚙ 面板读出渲染，颜色类字段（edgeColor/edgeGlowColor/borderColor/pathColor/bladeColor）也已就位。
- **硬编码外观、无 Config、属"待补"（8 个，共约 14+ 处颜色/变量面）**：`theme-default` 的**节点壳**（`--canvas-node-*` 20 个 CSS 变量 + 画布背景 DOT/BG）、`multi-select`（框选 `#3b82f6` + 群组框 slate/blue）、`align-guide`（参考线 `rgba(99,102,241,.6)`）、`context-menu`（菜单面 + danger 红 `#ef4444`）、`node-find`（类型筛选色板 8 组 + 浮层）、`mini-map` 的**小地图边框/节点色**（NODE_COLOR/VIEWER_BORDER，Config 里漏了颜色项）、`canvas-export` 的**导出底白**、`node-text` 的编辑框边框蓝。
- **纯逻辑/命令、无外观可配（4 个）**：`canvas-commands`、`align-arrange`、`clipboard`、`shortcut-manager`（键位 remap 是行为配置，未走外观 schema）。

即：真正要进设置面板的配置/颜色面集中在 **6 个已配插件 + 上面 8 处硬编码面**；其中**颜色类缺口**主要在 `theme-default`（节点壳变量、画布背景）、`multi-select`、`align-guide`、`context-menu`、`node-find`、`mini-map`、`node-text`——这些是目前完全无法在设置面板里调、只能改源码硬编码值的地方。
