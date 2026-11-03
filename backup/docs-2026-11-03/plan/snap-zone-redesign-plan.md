# 吸附带 SnapZone 几何/渲染 重设计

> 任务：把 v2 吸附带从「单边竖矩形（handleRadius×ratios）」改为「节点两侧可配带」，支持形状（rect/arc）、
> 高度占比、宽度、横向偏移。命中统一用 rect；shape 只影响 SVG 渲染。BaseNode 调试叠加同步画两侧带。
>
> 用户诉求（来自参考图释文字 + 当前 目标.png 缺带观察）：
> - 绿矩形 = 吸附区域，默认在**节点两侧**、高度占节点高 **80%**。
> - 可设**形状**：rect（矩形）/ arc（半椭圆弧，圆心在端口锚点）
> - 可设**高度占比**（默认 0.8）、**宽度**（默认 ~handleRadius 量级）、**偏移**（>0 外移 / <0 内移）

---

## 0. 一句话结论

- 几何（computeSnapZones）= 唯一真相：两侧各产生一个 `SnapZone`（左缘 target 口、右缘 source 口），
  共用同一份 `SnapZoneConfig { heightRatio, width, offset, shape }`。命中/吸附算法都用矩形 hitTest。
- 视觉：theme-default debug SVG 按 shape 渲染（rect → `<rect>`；arc → `<ellipse>` 取半圆）。
- 默认值与现在保持兼容（仅扩大为两侧），让现有单测只需小调整而不是重写。

---

## 1. 文件改动

### 1.1 `packages/canvas-render/src/connection/geometry.ts`
- 新增 `SnapZoneConfig` 接口：
  ```ts
  interface SnapZoneConfig {
    /** 带高 = 节点高 × heightRatio（默认 0.8） */
    heightRatio: number
    /** 带宽（默认 = handleRadius，与原 outer+inner 一致） */
    width: number
    /** 锚点横向偏移：>0 向节点外、<0 向节点内（默认 0） */
    offset: number
    /** 视觉形状（不影响命中）：rect | arc */
    shape: 'rect' | 'arc'
  }
  ```
- 新增 `DEFAULT_SNAP_ZONE_CONFIG = { heightRatio: 0.8, width: undefined, offset: 0, shape: 'rect' }`，
  `width` 缺省时 fallback 到 `handleRadius`（= 原 outer+inner 之和量级），保留旧等价几何。
- 保留旧 `SnapRatios` 与 `DEFAULT_SNAP_RATIOS` 作为**兼容导出**（测试在用），但 `computeSnapZones` 改用新 config：
  - 旧形参 `ratios?: SnapRatios` → 新形参 `config?: SnapZoneConfig`。
  - 每个 `NodeRect` 生成 **2 个** `SnapZone`（forward/reverse 各取一侧）：
    - **forward（拖 source→target）**：用左缘 target 锚点；带横跨 [anchorX − (width−offset), anchorX + offset]
      （offset=0 时即 [anchorX−width, anchorX]）。
    - **reverse（拖 target→source）**：用右缘 source 锚点；带横跨 [anchorX − offset, anchorX + (width−offset)]
      （offset=0 时即 [anchorX, anchorX+width]）。
    - 带高 = `min(height, nodeHeight × heightRatio)`；上下居中于节点高。
- 同步更新 `SnapZone` 增字段 `side: 'target'|'source'` 与 `shape: 'rect'|'arc'`（视觉信息，方便 SVG 渲染分支）。
- 导出 `SnapZoneSide`、`SnapZoneConfig`、`DEFAULT_SNAP_ZONE_CONFIG`。

### 1.2 `packages/canvas-render/src/connection/resolveFeedback.ts`
- 形参 `ratios?: SnapRatios` → `config?: SnapZoneConfig`，透传给 `computeSnapZones`。
- `DEFAULT_SNAP_RATIOS` → `DEFAULT_SNAP_ZONE_CONFIG`。
- `closestZone` 仍然按 anchorX/Y 距离最近（不变）。

### 1.3 `packages/canvas-render/src/index.ts`
- 导出 `SnapZoneConfig`、`DEFAULT_SNAP_ZONE_CONFIG`、`SnapZoneSide`。
- 保留 `SnapRatios`/`DEFAULT_SNAP_RATIOS`（deprecated 注释）。

### 1.4 `packages/canvas-render/src/host/CanvasHost.vue`
- L470 `ratios: DEFAULT_SNAP_RATIOS` → `config: DEFAULT_SNAP_ZONE_CONFIG`（传给 `resolveFeedback`）。
- 不引入新的注入字段——snap 配置先用默认值；如果将来需要在设置面板可调，再扩 CanvasParams。

### 1.5 `packages/plugins/plugin-theme-default/src/composables/useNodeDebugOverlay.ts`
- 入参新增 `snapConfig: Ref<SnapZoneConfig>`（与 `handleRadius` 同级 reactive ref）。
- 返回值改：
  - `leftBand: SnapBandRect`（左缘 target 侧，对应 forward）
  - `rightBand: SnapBandRect`（右缘 source 侧，对应 reverse）
  - `anchorY`（公用，居中于节点高）
  - `shape` 直接透传（让 BaseNode 决定 rect 还是 arc SVG）。
- 几何（卡内本地）：
  - 高 = `min(cardHeight, cardHeight × heightRatio)` = `cardHeight × heightRatio`（取 0~1）
  - 宽 = `width`
  - leftBand: `x = -width + offset`（即从卡片内 width 跨出 -width；offset>0 向内缩）
  - rightBand: `x = cardWidth − offset`（offset=0 时 x=cardWidth 带整体出卡在右；可由 SVG overflow:visible 显示）
  - y = `(cardHeight − bandHeight) / 2`

### 1.6 `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue`
- 解构新 `useNodeDebugOverlay` 返回 `{ leftBand, rightBand, anchorY, shape }`。
- 模板：把单个 band `<rect>` 换成两个 band，shape=arc 时用 `<ellipse>`：
  - target 侧：`x = leftBand.x, y = leftBand.y, width = leftBand.width, height = leftBand.height`，
    shape=arc → `<ellipse cx="0" cy="anchorY" rx="half-h" ry="half-w" ...>`（半椭圆，圆心在锚点）
  - source 侧对称。
  - 注意 SVG `<rect>`/`<ellipse>` 渲染顺序：先 body rect，再两侧 band。
- 加一条 anchor 短线（已存在，左缘锚点）；考虑右缘也加一条短线（在 source 侧 band 上）便于对称。

### 1.7 测试
- `packages/canvas-render/src/connection/__tests__/connection.test.ts`：
  - `computeSnapZones` 测试更新：每个节点返回 **2 个 zone**（左右各一）；断言 side/anchorX/宽度/高度比。
  - 旧的「forward 锚点左缘 / reverse 锚点右缘」测试保留（语义不变，只是 zone 数变 2）。
  - `closestZone` 在 reverse 模式下命中右缘带的 case 加一条断言。
  - `resolveFeedback` 沿用原语义（候选 hover 仍按最近锚点），更新断言数为新行为。

---

## 2. 实施步骤（原子提交序）

1. **S1 geometry 新模型 + 兼容旧导出**：写 `SnapZoneConfig/DEFAULT_SNAP_ZONE_CONFIG/SnapZoneSide`，`computeSnapZones` 改新签名（接收 config），保留 `SnapRatios/DEFAULT_SNAP_RATIOS` deprecated 导出。**测试会失败但暂不调整**（下一步统一）。commit：`refactor(canvas-render): 吸附带几何改 SnapZoneConfig 模型（heightRatio/width/offset/shape）`
2. **S2 resolveFeedback 适配新 config**：形参 `ratios` → `config`，默认 `DEFAULT_SNAP_ZONE_CONFIG`。CanvasHost 调用点同步。commit：`refactor(canvas-render): resolveFeedback 改用 SnapZoneConfig 默认值`
3. **S3 canvas-render index 重导出 + 更新 connection.test.ts**：测试改为断言新行为（每节点 2 zone、左右各一、heightRatio×nodeHeight、offset 效果）。跑 `node node_modules/.pnpm/vitest@3.2.7_*/node_modules/vitest/vitest.mjs run --root packages/canvas-render` 必绿。commit：`test(canvas-render): 吸附带几何改为 SnapZoneConfig 单测`
4. **S4 theme-default useNodeDebugOverlay 改**：返回 leftBand/rightBand/shape，新增 snapConfig 入参；BASE 默认 config 走 `DEFAULT_SNAP_ZONE_CONFIG`。commit：`refactor(theme-default): useNodeDebugOverlay 返回两侧带 + shape`
5. **S5 BaseNode 模板 SVG 画两侧带 + 形状分支**：rect 用 `<rect>`，arc 用 `<ellipse>`（半圆贴在锚点）；加右缘 anchor 短线。commit：`feat(theme-default): 吸附调试 SVG 画两侧带，支持 rect/arc`
6. **S6 验证**：`pnpm test` 两包全绿；vue-tsc 0 错；浏览器起 dev（端口 5289），chrome-devtools 看页面渲染：
   - 节点两侧出现绿矩形（默认 rect + heightRatio 0.8）
   - 切 shape=arc：两侧变为半椭圆弧（绘制实现：每个 ellipse cx=anchor、cy=anchorY、rx=width/2、ry=height/2）
   - offset 变化：带整体向内/外偏移

---

## 3. 风险 / 注意点

- **测试兼容性**：旧 `SnapRatios` 保留 deprecated 导出，旧 `computeSnapZones(ratios)` 调用方如果外部还在用会编不过 → 一次性切到新签名（外部已知调用点 = `resolveFeedback` + `useNodeDebugOverlay` + `CanvasHost`，都在本次改动范围内）。
- **hitTest 形状**：arc 形状仅影响视觉，命中仍用矩形 `x..x+width × y..y+height`。形状=arc 时的"半椭圆真实命中"差异暂时忽略（与 v1 一致：v1 的半圆 HTML zone 也是按矩形算命中）。
- **双带对称性**：forward 拖线时 `useNodeDebugOverlay` 画左缘带；reverse 拖线时画右缘带。当前是常显（不依赖拖线），所以两侧都画。
- **SVG overflow**：右缘带 x 可能在 cardWidth 之外，要 `overflow:visible`（已设）。

---

## 4. 不在本任务范围

- 不引入 snap config 的设置面板 UI 开关（先固化默认值；用户后续要 UI 可调再加 settings 字段）。
- 不改 BaseNode 的其它几何（端口、3D 倾斜等）。
- 不动 `CanvasParams`（端口尺寸）字段集。