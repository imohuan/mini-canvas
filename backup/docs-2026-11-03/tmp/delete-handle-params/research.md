# 删除 handleRadius / handleOverlap UI 参数 —— v2 链追踪研究

日期：2026-09-06 ｜ 分支：`feat/cordis-plugin-system`（HEAD=`cb79ffb` 端口区域 portZone 重构已落）
只读调查 + 本文档；未改任何源码。

---

## 0. 结论速览（TL;DR）

**只删 UI 面板两项（Config 字段 + DEFAULT_THEME_HANDLE 键 + HANDLE_SETTING_KEYS）是安全的**，
不会报参数缺失、不会布局错乱 —— 前提是保留它们在渲染链上的"兜底"语义（见 §4 最小清单）。
关键事实：

- `handleRadius` 在**当前已生效的 v2 渲染里，几何上只剩两处真兜底**：(a) 吸附带 `SnapZoneConfig.width===0`
  时当带宽；(b) MovingHandle `zoneWidth/zoneHeight` 缺省时兜底。但 BaseNode **总显式传** `:zone-width/:zone-height`，
  所以 (b) 实际永远不触发；(a) 才是真正需要正视的路径。
- `handleOverlap` **没有任何几何定位消费**：CSS 变量 `--moving-handle-overlap` 定义但从未被任何 `var()` 引用（死变量）。
  它只影响"圆球按钮"的 tuck 距离（归位/跟随时 `restOffset - overlap` 让球收进卡内）。删 UI 项 = MovingHandle 落到
  `buttonSize/2` 兜底，因默认 `overlap=16=32/2`，视觉零差异。
- MovingHandle 里 `radius` prop 实际不再参与 zone 定位（zone 由 `portZoneWidth/portZoneHeight` + 显式传入决定）。

---

## 1. 两参数在 UI 的注册与消费（plugin-theme-default）

### 1.1 注册源：`plugin-theme-default/src/index.ts`
- `DEFAULT_THEME_HANDLE`（L48-59）：含 `handleRadius:86`、`handleOverlap:16`，以及新加的
  `portZoneWidth/portZoneHeightRatio/portZoneOffset/portZoneShape/portZoneArcRatio`。
- `HANDLE_SETTING_KEYS`（L81-83）= `Object.keys(DEFAULT_THEME_HANDLE)` —— **它同时驱动"哪些 settings 键路由进 cfg.handle"**
  与 cfg.handle 的初始对象键。删两参 → 此数组自然变小。
- `Config: ConfigSchema`（L100-312）：`handleRadius`（L192-201，group='端口'，label='端口吸附半径'）、
  `handleOverlap`（L232-241，group='端口'，label='覆盖距离'）。每个字段带 group/label/description。

### 1.2 如何进 UI 面板（demo/localhost:5288 = `@mini-canvas/ui`）
链路：插件 `Config` schema → 内核 `Context.declareConfigIntoStore`（canvas-core-v2/core/Context.ts L270）把每个
标量字段 `store.define(field.group, …)` + `store.set` 登记进内置 `SettingsStore`（scope=插件名，group=字段 group）→
`<SettingsHost/>` 渲染 `settingsPanel` 槽赢家（= plugin-theme-default 注册的 `PluginSettingsDialog`）→ 面板按
`props.settings.groups()/groupOf()` 分组列控件（`SettingsSchemaField` 渲染），改动走 `settings.set(key, value)`。

> **UI 面板消费的字段集合 = Config schema 的字段集合**。删 Config 里两个字段 ⇒ 面板"端口"组不再显示这两项，
> settings store 也不再有这两 key。这是"删 UI 面板项"的真正落点。

### 1.3 demo 面板到底用的是不是这套 Config
**是。** 端口确认：
- `packages/ui/vite.config.ts` `server.port: 5288` → localhost:5288 跑的就是 `@mini-canvas/ui`。
- `packages/ui/src/App.vue`：装配 `themeDefaultPlugin`；`cfg = reactive({ handle:{...DEFAULT_THEME_HANDLE}, … })`；
  `<CanvasHost :handle-visual="cfg.handle" …>`；`<SettingsHost v-if="settingsOpen"/>` 渲染 PluginSettingsDialog（读 ctx.settings = Config schema 登记的结果）。
- `App.vue bindThemeSettings()`（L91-136）：用 `HANDLE_SETTING_KEYS` 判断"settings 变化属 handle 组 → 窄更新 cfg.handle[key]"。
  因此**HANDLE_SETTING_KEYS / Config / DEFAULT_THEME_HANDLE 三者键必须始终一致**，删就得三处一起删。

---

## 2. 参数如何进入 canvas-render（provide/inject 链）

文字数据流图：

```
plugin-theme-default/index.ts
  Config + DEFAULT_THEME_HANDLE(handleRadius,handleOverlap,portZone*)  [UI schema 源]
        │  App.vue cfg.handle = {...DEFAULT_THEME_HANDLE}  (reactive，含两参)
        ▼
packages/ui/App.vue  <CanvasHost :handle-visual="cfg.handle">
        ▼  CanvasHost props.handleVisual
canvas-render/src/host/CanvasHost.vue L160  handleToProvide = props.handleVisual ?? reactive({...DEFAULT_HANDLE_VISUAL})
        ▼  L784 :handle-params="handleToProvide"
CanvasSurface.vue L98  provide(CANVAS_PARAMS_KEY, props.handleParams)
        ▼  同一响应式对象引用被 provide
消费方 useCanvasRender() → renderContext.ts L46 handleParams: CanvasParams
        ▼
plugin-theme-default BaseNode.vue  读 handleParams.handleRadius / handleOverlap / portZone*
```

关键文件与字段：

| 文件 | 角色 | 两参出现位置 |
|---|---|---|
| `canvas-render/contracts/canvasParamKey.ts` | `CanvasParams` 接口类型 + InjectionKey | `handleRadius:number`(注释86)、`handleOverlap:number`(注释16) |
| `canvas-render/host/canvasHostCore.ts` | `DEFAULT_HANDLE_VISUAL: CanvasParams`(L107-118) 含两参 | 仅**定义导出**，无其它消费 |
| `canvas-render/host/CanvasHost.vue` | 取 handleVisual prop；`handleToProvide`；resolve 时取 handleRadius | L156/L160/L467 `handleToProvide.handleRadius \|\| 86` 喂 `resolveFeedback` |
| `canvas-render/host/CanvasSurface.vue` | provide(CANVAS_PARAMS_KEY) | L98 provide；L156 `:handle-radius="handleParams.handleRadius"` 喂 ConnectionLineHost |
| `canvas-render/contracts/renderContext.ts` | `useCanvasRender()` 上下文 | 聚合 handleParams 引用 |
| `canvas-render/index.ts` | 导出 | re-export CanvasParams 类型 |
| `plugin-theme-default BaseNode.vue` | 消费 handleParams | L443-447 / L486-490 绑给 MovingHandle；L211 handleR |

**provide 的是"宿主注入的同一响应式引用"**（renderContext L19 注释），改属性即实时生效，无整图重建。

---

## 3. 消费端逐一追踪

### 3.1 BaseNode.vue（plugin-theme-default）
- `handleParams` 来自 `useCanvasRender()`。
- **两参直接消费**：
  - target MovingHandle `:radius="handleParams.handleRadius"`（L443）
  - target MovingHandle `:overlap="handleParams.handleOverlap"`（L447）
  - source MovingHandle `:radius="handleParams.handleRadius"`（L486）
  - source MovingHandle `:overlap="handleParams.handleOverlap"`（L490）
- **handleRadius 派生消费**（不是 handleOverlap）：
  - `handleR = Number(handleParams.handleRadius) || 86`（L211）→ 用作 debugOverlay 的 handleRadius（L220），
    且 `portZoneWidth = handleParams.portZoneWidth>0 ? … : handleR`（L212，portZoneWidth 缺省时回落 handleR）。
  - `portZoneHeight/portZoneOffset/portZoneShape/portZoneArcRatio` 全由独立 portZone* 参数（非 radius/overlap）。
- 每次渲染 MovingHandle 时**总是显式** `:zone-width/:zone-height/:zone-offset/:zone-shape/:zone-arc-ratio`，
  与 `:radius/:overlap` 并存。

### 3.2 MovingHandle.vue（plugin-theme-default）
props：`radius?`、`overlap?`、`zoneWidth?`、`zoneHeight?`、`zoneOffset?`、`zoneShape?`、`zoneArcRatio?`。

computed（L64-73）：
- `radius = props.radius ?? 76`
- `overlap = props.overlap ?? buttonSize/2`  ← **handleOverlap 落到这里**
- `zoneWidth  = props.zoneWidth ?? radius`  ← **radius 唯一几何用途是 zoneWidth 缺省兜底**
- `zoneHeight = props.zoneHeight ?? radius` ← **同上**
- `zoneOffset/zoneShape/zoneArcRatio` 独立。

**overlap 的三处使用**（全在 JS 定位按钮，不参与 zone 定位）：
1. `resetPosition`（L165）`nextX = direction*(restOffset - overlap)` —— 圆球归位落点 tuck 进卡内。
2. `restorePosition`（L176）同式。
3. `updatePosition`（L217）`commitPosition(direction*(ballX - overlap), ballY)` —— 跟随落点也 tuck。
4. `anchorStyle`（L104）`'--moving-handle-overlap': overlap px` —— **在 v2 的 MovingHandle 里该 CSS 变量只有定义、无任何 `var()` 消费（死变量，已 grep 核实）**。
   注意区分：**v1** 的 `canvas-core/components/Decoration/MovingHandle.vue`（L332-340）**有消费**（`clip-path: inset(0 0 0 var(--moving-handle-overlap))` 做半圆裁掉卡内缘遮罩）。
   而 **v2 的 MovingHandle 不再做这种 clip-path 遮罩**（zone 透明、半圆弧由 debug SVG 另画），因此 v2 里这个变量确实没被用。删 v2 handleOverlap 不影响任何 v1 逻辑（v1 自有一套）。

**zone 定位实际用谁？**
- zone 盒样式 `zoneStyle = { width: zoneWidth, height: zoneHeight }`（L107）。
- CSS：`.moving-handle-zone--source{ left: calc(var(--port-zone-offset) * -1) }`、
  `.moving-handle-zone--target{ left: calc(var(--port-zone-width) * -1 + var(--port-zone-offset)) }`（L348/352）。
  **zone 完全由 `--port-zone-width / --port-zone-offset`（源自 portZone*）驱动，不用 overlap，也不用 radius。**
- debug svg 定位同 zone（L440/443），同用 portZone CSS 变量。

→ **结论（任务点4）：MovingHandle 内部 `overlap` 默认确是 `buttonSize/2`；zone 定位用 `portZoneWidth/zoneOffset` 而非 overlap。**
`handleOverlap` 只喂给 BaseNode 的 `:overlap`，仅控制按钮 tuck，**不做任何 zone/吸附几何定位** → 删 UI 项安全。

**radius 在 MovingHandle 几何中已失效**：BaseNode 总显式传 zoneWidth/zoneHeight，radius 兜底永不触发；
radius 不再参与半圆/zone 定位（半圆弧 debug path 用的是 `zoneWidth/zoneHeight` 画 rx/ry，L145-146）。

### 3.3 useNodeDebugOverlay.ts（吸附调试叠加，纯计算）
- 入参 `handleRadius: Ref<number>`（来自 BaseNode 的 handleR）。
- `width = snapZone.width>0 ? width : handleRadius`（L47-50）—— handleRadius 作为**吸附带宽度兜底**。
- `computeSideBandRect(rect, side, handleRadius, config)` 再把 handleRadius 传给 geometry。
- **这里 handleRadius 不是"半圆半径"语义，而是"吸附带 debug 宽度兜底"**，且是跟随 snapZone 的，与 portZone* 无关。

---

## 4. canvas-render 侧：兜底宽 + geometry/resolveFeedback 的 handleRadius

### 4.1 geometry.ts
- `SnapZoneConfig.width?: number`（L46，注释"缺省用 handleRadius 兜底"）。
- `bandRectForSide`（L120-127）`width = cfg.width && cfg.width>0 ? cfg.width : handleRadius` —— **唯一真兜底路径**：
  当吸附带 `width` 未设/为 0 时，带宽度回落到 handleRadius。
- `computeSideBandRect` / `computeSnapZones` / `computeSnapZoneSides` 三个导出都接收 `handleRadius` 并透传给 bandRectForSide。
- 命中检测 `closestZone/hitTest` 用的是上面算出的 rect，本身不直接读 handleRadius。

### 4.2 resolveFeedback.ts
- `resolveFeedback(input)` 入参含 `handleRadius:number`（L35），L70 原样透传给 `computeSnapZones(nodeRects, dir, handleRadius, config)`。
- 即 resolveFeedback 不消费 handleRadius 语义，只是把它当成"吸附带宽兜底"转发。

### 4.3 CanvasHost.vue resolveAtClient（L467）
- `handleRadius: handleToProvide.handleRadius || 86` 喂 resolveFeedback。若 cfg.handle 删了 handleRadius → undefined → `|| 86` 兜底 86。

### 4.4 CanvasSurface.vue / ConnectionLineHost.vue（L156）
- `:handle-radius="handleParams.handleRadius"` 传给 ConnectionLineHost。
- **ConnectionLineHost.vue 里 handleRadius 只是声明 prop，脚本/模板从不读它**（已核实，L25 注释"仅类型一致保留"）→ **死 prop**。
  删掉该绑定 + 该 prop 零风险。

### 4.5 "删掉 handleRadius 会不会让吸附带 width 兜底失效"？
关键区分两套宽：
- **吸附带宽**：由 `SnapZoneConfig.width` 决定；UI（Config 里 `width`，group='吸附带'，默认 **0** = 用 handleRadius 兜底）。
- **端口交互区宽（portZoneWidth）**：MovingHandle zone，由 portZone* 驱动，与吸附带 `width` 是**两套独立系统**。

若直接删 handleRadius 而**不把吸附带宽兜底改走 portZoneWidth/明确 width**，则：
- `cfg.snapZone.width` 仍默认 0 → 吸附带宽度 = `resolveAtClient` 的 `handleToProvide.handleRadius||86` → 删参后变 86（恰好=原默认，不崩），
  但**无法再通过 UI 调吸附带交互范围**（吸附判定范围被锁死在兜底 86）。
- 若要吸附带真正由 portZoneWidth 驱动，需把兜底从 handleRadius 换成 `portZoneWidth`，并把 `cfg.snapZone.width` 默认设成跟随。

→ 删除两 UI 参本身不报错，但**吸附带交互范围将失去 UI 调节手段**（只剩固定 86/或改 default 的 cfg.snapZone.width）。

---

## 5. 各文件改动类型建议

### A. 只删 UI 面板两项（推荐、最小、安全）
| 文件 | 改动 |
|---|---|
| `plugin-theme-default/src/index.ts` | ① `DEFAULT_THEME_HANDLE` 删 `handleRadius`/`handleOverlap` 两键；② `Config` schema 删 `handleRadius`(L192-201)/`handleOverlap`(L232-241) 两块。→ `HANDLE_SETTING_KEYS`、`cfg.handle`、面板、settings store 自动同步消失。 |
| `plugin-theme-default BaseNode.vue` | 删两个 MovingHandle 的 `:radius=` 与 `:overlap=` 绑定（L443/447/486/490）→ MovingHandle 落 `radius??76` / `overlap??buttonSize/2`，因为总显式传 zone*，无影响。可同时删 `handleR`? **否**，L211 handleR 仍被 useNodeDebugOverlay 当吸附带兜底宽用。 |
| `canvas-render/contracts/canvasParamKey.ts` | 删 `CanvasParams` 两字段（可选但应删，保持类型与运行一致）。 |
| `canvas-render/host/canvasHostCore.ts` | `DEFAULT_HANDLE_VISUAL` 删两键（保持与 canvasParamKey 一致）。 |
| `canvas-render/host/CanvasHost.vue` | L467 `handleToProvide.handleRadius||86` → 改成明确宽来源（见 §6），否则删字段后此处恒 86 兜底。 |
| `canvas-render/host/CanvasSurface.vue` | 删 L156 `:handle-radius=` 绑定。 |
| `canvas-render/host/ConnectionLineHost.vue` | 删死 prop `handleRadius`（L25 声明）。 |

### B. 该留、不改
- `MovingHandle.vue`：`radius?`/`overlap?` prop 保留（有默认兜底，兼容 preview/其它宿主不传 zone 的场景）；删字段后它自然走兜底，无需改。
- `useNodeDebugOverlay.ts`：保留 handleRadius 兜底参数（或见 §6 改走 portZoneWidth）。
- `geometry.ts` / `resolveFeedback.ts`：签名保留 handleRadius（作为带宽兜底参数），除非 §6 换源。
- `canvas-render/index.ts`：保留 re-export。

### C. 需同步改的测试
- `canvas-render/host/__tests__/canvasHostCore.test.ts`：L90-92 断言 `handleRadius=86` / `handleButtonSize=32` /
  **`Object.keys(DEFAULT_HANDLE_VISUAL).toHaveLength(5)`** —— 注意此 L92 断言在 portZone 提交后已**陈旧**（现在 10 字段），
  删字段时一并改成与实际一致（少两个 = 8）。这是潜在"红测试"，别误当成你删参导致的回归。

---

## 6. 若要"彻底把半圆/吸附区宽度从 handleRadius 换成 portZone*"，需动的点

portZoneWidth 目前**只驱动 MovingHandle zone 的交互盒**，吸附判定带（geometry 的 snap zone）是另一套（SnapZoneConfig.width）。
若要吸附带宽也由 portZone 驱动，需打通：
1. `BaseNode.vue`：吸附带 debug 兜底 `useNodeDebugOverlay.handleRadius` → 改成传 `portZoneWidth` 或 snapZone 显式宽。
2. `CanvasHost.vue` L467 `resolveAtClient` 的 `handleRadius||86` → 喂 `handleToProvide.portZoneWidth`（或 cfg.snapZone 显式 width）。
3. `geometry.ts bandRectForSide` L123 的兜底源：把参数从 handleRadius 语义换成"有效带宽"，由上层决定来源；
   resolveFeedback/computeSideBandRect/computeSnapZones 的 handleRadius 入参可改名为语义化（如 defaultBandWidth）。
4. `plugin-theme-default index.ts`：`DEFAULT_THEME_SNAP_ZONE.width` 默认 0（用 handleRadius 兜底）的注释/默认，
   改成跟随 portZoneWidth，或给吸附带设一个 UI 显式默认宽（去掉对 handleRadius 的依赖）。
5. `useNodeDebugOverlay.ts`：handleRadius 兜底宽改传 portZoneWidth（与吸附带 debug 一致）。

> 注意：吸附带命中判定（geometry）与端口交互区（MovingHandle zone）目前**宽度可不同步**，二者各自独立。
> "彻底换成 portZone* 驱动"= 让吸附带宽=portZoneWidth 由单一来源，需在上层统一喂同一值，别只改一处造成 debug/判定/zone 三者对不上。

---

## 7. v1（packages/canvas-core）勿误伤清单 —— 一律不改

v1 有自己独立的 handle 系统（旧 outer/inner×handleRadius SnapRatios 模型 + store.core），**与 v2 完全解耦**，删除改动不要碰：
- `canvas-core/src/Canvas.vue`：`registerCore('handleRadius',…)`(L532)、`registerCore('handleOverlap',…)`(L536)。
- `canvas-core/src/components/Decoration/BaseNode.vue`：L576-587/L612-614 用 `canvas.state.core.handleRadius/handleOverlap`
  算旧吸附带尺寸 + 绑给 v1 MovingHandle `:radius/:overlap`。
- `canvas-core/src/components/Decoration/MovingHandle.vue`：v1 移动端口，`--moving-handle-overlap` 在此**有真实消费**
  （L332-340 `clip-path` 遮罩半圆裁卡内缘），v1 自有一套 overlap 逻辑，勿动。
- `canvas-core/src/composables/useCanvasConnection.ts`：L316-318/366-368/752-755 旧 SnapRatios 计算。
- `canvas-core/src/composables/useCanvasStore.ts`：L40/44/165/169 core 默认 `handleRadius:86`、`handleOverlap:16`。
- `canvas-core/src/plugins/PluginContext.ts`：L343/347 config.radius/overlap 写 state。
- 另有 `packages/canvas-core-v2`（= canvas 数据/领域层，非渲染）不消费这两参，无需动。

> 顶层 `packages/canvas-render` 才是 v2 渲染链（§2-4）；plugin-theme-default 是 v2 默认皮。删除只发生在 v2 链。

---

## 8. 直接结论（回答任务问题）

1. **只删 UI 面板两项（Config + DEFAULT_THEME_HANDLE 键 + HANDLE_SETTING_KEYS + BaseNode `:radius/:overlap` 绑定）：
   安全**。不会参数缺失报错（CanvasHost 有 `||86`；MovingHandle overlap 落 `buttonSize/2`；zone 已全由 portZone* 驱动），
   不会布局错乱（默认 overlap=16=buttonSize/2，视觉零差）。
2. **handleOverlap 确实无几何定位消费** —— 只是圆球按钮 tuck 的 JS 偏移 + 一个从未被引用的死 CSS 变量。删它 100% 安全。
3. **handleRadius 删 UI 项安全，但要注意**：它仍是 `SnapZoneConfig.width=0` 时吸附带的兜底宽（geometry L123），
   由 CanvasHost `||86` / debugOverlay 兜底。若只是"从 UI 面板消失"，吸附带交互范围将固定在兜底 86、失去 UI 调节。
   若想让吸附带也跟随 portZone*（见 §6），需另把兜底源换成 portZoneWidth。
4. **真正建议的最小安全删除清单** = §5 的 A 表全部 + §5 的 C（陈旧测试断言顺手改对）。§6 是可选的"彻底 portZone 驱动"增强。
