# 画布性能监测自动化流程 (Runbook)

> 目标：用 Chrome DevTools MCP 操控浏览器 + 项目内置性能面板，自动判定画布是否卡顿，
> 并在卡顿时定位根因（哪类节点 / 哪种样式 / 哪段脚本）。
> 适用范围：mini-canvas 画布（`http://localhost:5173/#/`，服务由 Vite 常驻，无需手动启动）。

## 0. 前置条件

- Chrome DevTools MCP 已连接，可用工具：`new_page` / `navigate_page` / `evaluate_script` /
  `performance_start_trace` / `performance_stop_trace` / `performance_analyze_insight` /
  `list_console_messages` / `take_screenshot`。
- 项目内置性能监测能力（已存在，无需改动）：
  - `packages/canvas-core/src/composables/useCanvasPerformance.ts`：rAF 采 FPS/帧耗时 + `PerformanceObserver` 抓 long task。
  - `packages/canvas-core/src/components/Performance/CanvasPerformancePanel.vue`：左上角卡顿雷达面板。
  - `performanceMetrics.ts` 阈值：`≥55 流畅 / 45–54 波动 / 30–44 偏卡 / <30 FPS 或单帧 ≥100ms 明显卡顿`。

## 1. 阶段 0：准备

1. `new_page` 打开 `http://localhost:5173/#/`（若已开则 `navigate_page` reload 清状态）。
2. 用 `evaluate_script` 点亮左上角性能面板（reload 后开关会复位）：
   ```js
   const sw = [...document.querySelectorAll('button[role=switch]')]
     .find(b => (b.closest('div')?.previousElementSibling?.textContent || '') === '启用性能面板');
   if (sw && sw.getAttribute('aria-checked') !== 'true') sw.click();
   ```
3. 抓取 VueFlow 实例备用（后续所有脚本化操作都走它）：
   ```js
   const node = document.querySelector('.vue-flow__node');
   let cur = node && node.__vueParentComponent;
   while (cur) { if (cur.setupState && cur.setupState.vueFlowInstance) { window.__vf = cur.setupState.vueFlowInstance; break; } cur = cur.parent; }
   return !!window.__vf;
   ```

## 2. 阶段 1：常态监控探针（低成本，每次都跑）

往页面注入一个纯同步探针，复刻面板判断逻辑，返回结构化快照。此步不耗性能，可反复轮询。

```js
() => {
  const panel = document.querySelector('.canvas-performance-panel');
  const fpsText = panel ? panel.innerText : '';
  const vf = window.__vf;
  const nodes = vf ? vf.getNodes.value : [];
  const mem = performance.memory ? performance.memory.usedJSHeapSize : null;
  return {
    fps: vf ? Math.round(1000 / Math.max(vf.viewport.value.__lastFrameMs || 16, 1)) : null,
    nodeCount: nodes.length,
    zoom: vf ? vf.viewport.value.zoom : null,
    memBytes: mem,
    panelText: fpsText.slice(0, 120),
  };
}
```

> 注：若面板文本解析不稳，可直接读 `window.__vf` 的组合数据 + 自行接 `useCanvasPerformance` 的
> `summary`/`longTasks`（需从组件实例取，见阶段 4 的深挖方式）。

## 3. 阶段 2：触发场景（可复现，别用手抖鼠标）

Vue Flow 的 d3-zoom **不吃**合成的 `wheel` 事件，缩放/平移必须用 `setViewport` 脚本化 tween。

```js
// 缩放压力测试：1.0 → 0.1 匀速 60 步
() => {
  const vf = window.__vf; let step = 0;
  const iv = setInterval(() => {
    step++;
    const z = 1 + (0.1 - 1) * (step / 60);
    vf.setViewport({ x: 100, y: 60, zoom: z });
    if (step >= 60) clearInterval(iv);
  }, 16);
  return 'zoom-stress-started';
}
```

```js
// 拖拽压力测试：给 N 个节点施加连续位置变更
() => {
  const vf = window.__vf; const ids = vf.getNodes.value.slice(0, 20).map(n => n.id);
  let step = 0;
  const iv = setInterval(() => {
    step++;
    ids.forEach((id, i) => vf.updateNode(id, { position: { x: 100 + step * 3 + i * 40, y: 100 + i * 60 } }));
    if (step >= 60) clearInterval(iv);
  }, 16);
  return 'drag-stress-started';
}
```

> **坑**：`setViewport` / `updateNode` 带过渡动画，读完数据要 `setTimeout(..., 300)` 等动画落定，
> 否则拿到的是动画前一帧的假值。

## 4. 阶段 3：判定是否卡顿

拿阶段 1 探针的 FPS / 帧耗时，对照阈值：
- `≥55 FPS` 且最大帧耗时 `<100ms` → **通过**，记录快照，结束。
- `45–54` → 波动，记下来，可选深挖。
- `<45` 或单帧 `≥100ms` 或长任务数 >0 → **卡顿**，进阶段 4。

## 5. 阶段 4：深挖根因（只有卡了才做）

### 5.1 深度 trace（看火焰图 / 调用栈）
1. `performance_start_trace`（reload 关、autoStop 关、自己控制区间）。
2. 重跑阶段 2 的同一个场景。
3. `performance_stop_trace`。
4. `performance_analyze_insight` 读 Insight（直接指出长任务、布局抖动 Layout Thrash、绘制耗时等）。

> trace 文件有 MCP 工作区根限制，存不进项目目录就别强存，`analyze_insight` 看摘要即可。

### 5.2 抓控制台报错 / 警告
`list_console_messages`（types: error, warn）——节点类型缺失、插件异常等常在此暴露。

### 5.3 DOM 特征定位（判断是哪类节点/样式作妖）
在卡顿那一刻用 `evaluate_script` 数特征：

```js
() => {
  return {
    willChangeNodes: document.querySelectorAll('[style*="will-change"]').length,
    textInlineTransform: [...document.querySelectorAll('.text-node-content')].filter(e => e.style.transform).length,
    visibleNodes: document.querySelectorAll('.vue-flow__node:not([style*="display: none"])').length,
    lowDetailCards: document.querySelectorAll('.custom-node-card.is-low-detail').length,
  };
}
```

常见根因映射：
- `textInlineTransform` 高 → 文本节点每帧重算 `transform: scale(1/zoom)` + fontSize（文本重排重绘）。
- `willChangeNodes` 高 → 大量 GPU 合成层，显存/合成开销大。
- `visibleNodes` 远超视口合理值 → `onlyRenderVisibleElements` 可能未生效。
- 内存持续涨 → 节点/图片未释放，疑似内存泄漏（配合 `performance.memory` 看趋势）。

## 6. 阶段 5：出报告

汇总阶段 1 / 3 / 4 数据，给出：
- **是否卡**：对照阈值的结论。
- **卡在哪个场景**：缩放到 X 倍 / 拖 N 个节点 / 某特定操作。
- **根因**：长任务来自 XX 样式重排 / 内存涨到 XX / 某组件每帧重算 transform。
- **建议改法**：对应到具体文件与机制（如节点 LOD、去 will-change、开 onlyRenderVisibleElements）。

## 7. 已知坑（实测）

- 合成 `wheel` 事件驱动不了 Vue Flow 真实缩放 → 用 `setViewport` 脚本化。
- `setViewport` 带过渡 → 读数据前 `setTimeout ~300ms`。
- `evaluate_script` 对含 `setInterval` / `PerformanceObserver` 嵌套的复杂函数会偶发报错，
  探针写成「单次同步读 + 返回 JSON」，长任务采集交给页面内 `PerformanceObserver` 存全局变量再读。
- trace 文件路径受 MCP 工作区根限制，优先用 `analyze_insight` 摘要。

## 8. 一句话流程

```
开页面 → 点亮性能面板 → 注入探针 → 脚本化跑场景(setViewport/updateNode)
→ 读快照判定阈值 → 卡了才 trace+控制台+DOM特征 → 出根因报告
```
