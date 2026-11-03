# v2 默认皮：调试叠加 + 诊断日志 + 连线/配置问题收尾 计划

> 范围（用户已拍板 A = 改 v2 `plugin-theme-default` / `canvas-render`）：
> 1. 把 v1 的「端口调试 handleDebug」「吸附调试 connectionSnapDebugVisible」（v1 `packages/canvas-core/src/Canvas.vue:562-563`）
>    两个开关 + **用 SVG 画区域**的调试叠加，照 v1 语义移植到 v2 默认皮。
> 2. 当前是调试阶段：在 v2 连接/渲染/边配置链路加**统一前缀日志**，方便用户快速搜索定位
>    （「拖拽连接线无法正常显示」「很多配置没实现」这两个未决问题的定位手段）。
> 3. 顺手核实并修 v2 里「已声明但没真正生效」的配置 / 连接线显示问题（用日志 + 浏览器实测定位，不空改）。

---

## 0. 说人话（目标）

v2 默认皮目前**没有** v1 那套端口/吸附调试开关，也没有调试区可视化。用户希望：
- 在 v2 的设置里加「调试」组两个开关（端口调试 / 吸附调试），打开后**用 SVG 把区域画出来**（端口半圆 zone、圆心、吸附带、body 区），替代 v1 用 clip-path div 拼的效果（v1 效果差）。
- 加大量带统一前缀的日志，让用户搜前缀就能看链路走到哪。

---

## 1. 现状核实（已读源码）

### v1 参考（要移植的语义）
- `Canvas.vue:562-563` 注册两个开关：`handleDebug`(端口调试)、`connectionSnapDebugVisible`(吸附调试)，group=「调试」。
- v1 `BaseNode.vue`：
  - `debugHandle = handleDebug || data.debugHandle(s)` → 传给 MovingHandle `:debug`。
  - `shouldShowTargetZones = showTargetHandle && (connectionSnapDebugVisible || showTargetZones)`，
    `showTargetZones = isConnecting && active.sourceNodeId!==self && showTargetHandle`。
  - 吸附带矩形：宽=`handleRadius*(outer+inner)`、高=`handleRadius*heightRatio`、`left=-handleRadius*outer`、`top=50%-高/2`，
    叠 body 反馈区（v1 用 div，效果一般）。
- v1 `MovingHandle.vue`：`:debug` 时用 svg(viewBox=radius²) 画半圆弧 + center/rest/mouse 三点。
  「效果不好」主因：zone 是 clip-path 半圆 HTML 元素，svg 是 `preserveAspectRatio="none"` 拉伸、半圆手绘路径与真实 zone 对不齐。

### v2 现状（改的地方）
- `plugin-theme-default/src/index.ts`：`Config` 只有 连线(7)/连线动效与箭头(4)/端口(5) 三组，**无「调试」组**；
  `DEFAULT_THEME_EDGE`/`DEFAULT_THEME_HANDLE` 已导出，`EDGE_SETTING_KEYS`/`HANDLE_SETTING_KEYS` 已导出供 demo 窄更新。
- 配置→运行时路径：App.vue 读 theme Config → `cfg.edge/cfg.handle`(reactive) → `:edge-visual/:handle-visual` 传 CanvasHost
  → CanvasHost provide `EDGE_VISUAL_KEY`/`CANVAS_PARAMS_KEY` → BaseNode/MovingHandle 经 `useCanvasRender()` 消费。
  **新增布尔开关要进这条链**。
- `canvas-render`：
  - `CanvasParams`(canvasParamKey.ts)：只有 5 个端口尺寸字段。
  - `DEFAULT_HANDLE_VISUAL`(canvasHostCore.ts) / `DEFAULT_EDGE_VISUAL`：引擎默认（合同测试锁 `#3b82f6` 等）。
  - `connectionState`(connectionContext)：`isConnecting/activeConnection/hoverNode/suppressHandles`，ConnectionLineHost 每帧写。
  - `connection/geometry.ts`：snapZones/bodyZones/anchor 纯函数（Node 可测）——调试 SVG 的数据源。
  - `ConnectionLineHost.vue`：每帧 resolveFeedback → end + hover；**日志没写**。
  - `CanvasHost.vue`：onConnectStart/onConnect/onConnectEnd/checkConnection —— **日志没写**。
  - `ConnectionLine.vue`(theme) 画拖线。
- BaseNode/MovingHandle 组件已齐（v2），MovingHandle 已有 debug arc svg 雏形（与 v1 同源问题）。

---

## 2. 设计决策（最小干净改动）

### 2.1 新增「调试」两个布尔：放哪、怎么进组件
把两个开关作为布尔加进**新 provide 的 `CanvasDebug`**（不塞进端口尺寸 CanvasParams，语义更清楚），但为省事用最贴近现有链路的做法：

- **contracts**：新 `contracts/debugContext.ts` 定义 `CanvasDebug { handleDebug: boolean; connectionSnapDebugVisible: boolean }` + `DEBUG_KEY`。
- **canvasHostCore.ts**：`DEFAULT_DEBUG_VISUAL`（false/false）。
- **CanvasHost.vue**：新 prop `debugVisual?: Partial<CanvasDebug>`（缺省 internal DEFAULT reactive）；CanvasSurface 经 renderContext provide `debug`。
- **renderContext.ts** `CanvasRenderContext` 加 `debug` 字段；CanvasSurface 组装 provide 同引用。
- **plugin-theme-default/index.ts**：Config 加「调试」组两项 + `DEFAULT_THEME_DEBUG` 导出 + `DEBUG_SETTING_KEYS`；App.vue `cfg.debug` + `:debug-visual="cfg.debug"`。
- **BaseNode.vue**：`useCanvasRender()` 解构 `debug`；`debugHandle = debug.handleDebug`（不引 data 上的 per-node 开关，v2 用全局即可，需要再加）；把 debug 传给 MovingHandle；`connectionSnapDebugVisible` 驱动吸附带叠加。

> 这样走跟 handleVisual/edgeVisual 完全一致的「插件 Config → demo cfg → CanvasHost prop → provide → 组件」链路，最少侵入、可实时开关。

### 2.2 用 SVG 画调试区域（替代 v1 clip-path div）
在 **BaseNode** 内放一张 `viewBox="0 0 cardWidth cardHeight"` 的 `<svg>`（`overflow:visible`、`pointer-events:none`），按画布/卡内坐标系画：
- **body 反馈区**：卡内整矩形描边（`connectionSnapDebugVisible` 且拖线中、本节点是目标）。
- **吸附带**：一条竖矩形（宽 outer+inner、高 height×handleRadius，锚点在卡左缘 target / 卡右缘 source，向左/右扩）。
- **MovingHandle 半圆 zone**：真实 Zone 几何（左缘/右缘半径=handleRadius 半圆，含 overlap 裁剪）用 SVG `<path>` 画出来 + center 圆心 + rest/鼠标点。**与 v1 不同的是用与 MovingHandle 内部一致的本地 SVG，且不用 preserveAspectRatio:none 拉伸**（修掉「效果不好」的对不齐根因）。

数据全部来自现有 geometry.ts 常量（ratios）+ handleParams；不新造几何。SVG 坐标系直接对画布 flow→node 本地。

### 2.3 日志（用户调试阶段要的）
统一加一个 `createLogger(scope)`，前缀固定 `[v2:<scope>]`，scope 值：`conn-line`、`canvas-host`、`base-node`、`moving-handle`、`edge`、`config`。默认全开（调试阶段），将来可收敛到一个常量/开关。给下面关键点打日志：
- CanvasHost：onConnectStart/onConnectEnd/onConnect/checkConnection（命中已提交边放行、validate result、addEdge）、syncFromStore、applyTheme。
- ConnectionLineHost：拖线开始/结束、每帧 resolveFeedback 的 source/point/snap/body/hover 简况（可 60fps 太多 → 状态变化才打：hoverNode 变时）。
- BaseNode/MovingHandle：handle 显隐、debug 开关值、MovingHandle mouse/zone 计算关键值。
- ConnectionLine/CustomEdge：是否渲染、颜色/虚线/动画取值。
- config：App.vue bindThemeSettings 初始灌入 + 每次 set 窄更新到哪个 key。

日志值一律只打小对象/数字，不打印大数组/整节点，避免刷屏。加统一开关变量放 `theme-default` 或 `canvas-render` 一处。

### 2.4 「配置没实现 / 拖线连线显示」收尾
先用日志 + 浏览器实测把这两个问题定位到具体点，再修（不在本计划拍死改哪，避免瞎猜）。

---

## 3. 交付文件清单

### canvas-render（能力层）
```
src/contracts/debugContext.ts      // 新：CanvasDebug + DEBUG_KEY
src/host/canvasHostCore.ts         // 改：DEFAULT_DEBUG_VISUAL + CanvasHost/assemble 不用改类型
src/host/CanvasHost.vue            // 改：+debugVisual prop、provide debug、生命周期/校验加日志
src/host/CanvasSurface.vue         // 改：renderContext 带 debug + provide
src/contracts/renderContext.ts     // 改：+debug 字段
src/contracts/connectionContext.ts // 不改（如需挪可后续）
src/host/ConnectionLineHost.vue    // 改：+日志(状态变化时)
src/connection/...                 // 不改（纯函数已有单测）
src/index.ts                       // 改：导出 debugContext 类型/KEY（如需）
```

### plugin-theme-default（UI 层）
```
src/index.ts                       // 改：DEFAULT_THEME_DEBUG + Config「调试」组 + DEBUG_SETTING_KEYS + import 保留
src/composables/useCanvasDebug.ts  // 新：读 debugContext + 回落默认
src/components/node/BaseNode.vue   // 改：+debug 解构、吸附带/body SVG 叠加、传 debug 给 MovingHandle、日志
src/components/node/MovingHandle.vue // 改：:debug 时用精确 SVG 画 zone/center/rest/mouse（修对齐）、日志
src/components/edge/CustomEdge.vue // 改：+edge 渲染日志（值打印）
src/components/edge/ConnectionLine.vue // 改：+拖线渲染日志（可选）
src/log.ts (或 utils/log.ts)       // 新：createLogger 统一前缀
```

### demo 接线
```
packages/ui/src/App.vue            // 改：cfg.debug + :debug-visual + bindThemeSettings 覆盖 DEBUG_SETTING_KEYS + config 日志
```

### 测试 / 文档
```
packages/canvas-render/src/host/__tests__/canvasHostCore.test.ts // 补 DEFAULT_DEBUG_VISUAL case
packages/plugins/plugin-theme-default/src/__tests__/...         // 若有纯逻辑可加
docs/plan/plugin-theme-default-visual-plan.md / 本计划 doc       // 执行完补记录
docs/tmp/...                                                    // 调查文档不删
```

---

## 4. 实施步骤（原子提交序）

1. **D1 日志基础设施**：`canvas-render` 或 `plugin-theme-default` 加统一 `createLogger`(前缀 `[v2:<scope>]`)。commit。
2. **D2 调试上下文链路**：debugContext.ts → DEFAULT_DEBUG_VISUAL → renderContext 字段 → CanvasHost prop+provide → CanvasSurface。跑 canvas-render test + vue-tsc 绿。commit。
3. **D3 theme-default「调试」组**：DEFAULT_THEME_DEBUG + Config 两项(group 调试) + DEBUG_SETTING_KEYS；App.vue `cfg.debug` + `:debug-visual` + bind 覆盖。commit。
4. **D4 BaseNode 调试叠加（SVG）**：`useCanvasDebug` + BaseNode 内吸附带/body SVG + 传 debug 给 MovingHandle + 开关日志。commit。
5. **D5 MovingHandle debug 精确 SVG**：zone/center/rest/mouse 用与内部一致几何画（修 v1 式对不齐）。commit。
6. **D6 链路日志铺点**：CanvasHost(onConnect*/checkConnection/syncFromStore/applyTheme)、ConnectionLineHost(hover 变化时)、CustomEdge/ConnectionLine(渲染取值)、App.vue(config)。commit。
7. **D7 问题定位与收尾**：起 dev + 浏览器实测，用日志定位「拖线连线不显示」「配置不生效」两个具体点并修复（不在本计划预设改法）。commit。
8. **验证**：两包 test + vue-tsc 全绿；浏览器实测 开关实时生效、SVG 区域对位、日志前缀可搜。写计划完成记录。

---

## 5. 测试与验证
- canvas-render / plugin-theme-default 各 `pnpm test` + vue-tsc 0 错（命令：`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p <包>/tsconfig.json`）。
- vitest 入口：`node node_modules/.pnpm/vitest@3.2.7_*/node_modules/vitest/vitest.mjs run --root <包>`。
- dev server：`packages/ui`（5289，v2 app，已在跑）。
- 浏览器：开「调试」两开关 → 端口半圆/圆心 与 吸附带/body 叠加以 SVG 清晰显示、拖线时跟随、缩放时不变形；
  console 里 `[v2:...]` 前缀日志按需出现可搜。

## 6. 风险 / 注意
- SVG viewBox 与卡内坐标系要随 cardWidth/Height 变（resize 时）；吸附带左缘/右缘锚点受反向(拖 source→找 target)影响，只对 target 口画吸附带（v1 语义）。
- 日志别打整节点/整边对象（刷屏 + 卡死）；只在状态变化/关键动作打。
- 不动 engine `DEFAULT_EDGE_VISUAL`/`DEFAULT_HANDLE_VISUAL` 现有合同值（测试锁）；新 DEBUG 是全新 default，不冲突。
- 先 D1 日志、D7 定位修复是「调试阶段」用户要的主线；debug SVG(D2-D5) 是明确功能。两线都做完。
