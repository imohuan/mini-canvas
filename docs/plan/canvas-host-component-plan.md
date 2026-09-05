# CanvasHost 渲染宿主组件 —— 收编 VueFlow 装配

日期：2026-09-05 · 状态：**待用户审核后实现**
作者：code-developer

## 一、需求（用户确认）
用户三问三答后明确要做：
1. `canvas-core-v2/src/components/` 命名不合适（装的是注入令牌/契约，不是组件）→ **改名 `contracts/`**。
2. 主项目应把 VueFlow **收进内部**，最终只导出一个 `CanvasHost` 渲染组件；调用方不再手写装配 → **新增 `<CanvasHost>`**。
3. 现有 API（装配流程）对调用方太复杂 → 靠收编根治。

目标形态：调用方一行搞定
```vue
<CanvasHost
  :plugins="[themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]"
  :adapter="new LocalStorageAdapter()"
  :seed="seedFn"
/>
```

## 二、为什么现在不够（诊断）
- `createMiniCanvasHost` 是**逻辑门面**（已实现）：建内核、注入服务、冷启动插件。但它**不渲染**。
- 渲染装配全堆在 `CanvasDemo.vue`（~340 行）：provide 全套令牌(HOST/NODE_REGISTRY/NODE_WRITE/CANVAS_PARAMS/EDGE_*)、
  自建 VueFlow、从 themeRegistry 取壳/边/背景塞给 VueFlow、store↔flow 双向同步、接拖拽/删除/连边/键盘事件、落盘、生命周期绑定。
- `plugin-theme-default/demo-web/App.vue` 又**重写了一套残缺版**（连拖拽落盘/删除/校验都没接）→ 同一逻辑散落多份、API 观感差、易漏。

**根因**：缺"渲染宿主层"。`createMiniCanvasHost`(逻辑) 与 `CanvasDemo`(渲染) 之间没有官方接缝，宿主只能复制 CanvasDemo。

## 三、目标架构
在 `src/host/` 新增 `CanvasHost.vue`（官方渲染宿主组件），职责 = 把 CanvasDemo 的装配逻辑收编并藏起来：
- props：`plugins`、`adapter`、`seed`(默认图函数)、外观参数可选。
- 内部 `createMiniCanvasHost` 建宿主 + 冷启动插件。
- provide 全套令牌（HOST/NODE_REGISTRY_KEY/NODE_WRITE_KEY/CANVAS_PARAMS_KEY/EDGE_VISUAL_KEY/EDGE_SELECTION_KEY）。
- 内部装配一个 `<VueFlow>`：themeRegistry 壳/边/背景 + nodeStore 节点 + 事件(拖拽/点击/连边/右键/键盘)。
- **对外暴露 `host` 句柄**（defineExpose），父级可选读 nodeStore/ctx 或注入工具栏插槽做业务操作。
- 可选插槽：`toolbar`(顶部操作条，收掉 demo 的 +文本/+图片/删除/撤销重做按钮)、`context-menu`。

**新增一个轻量机制 —— nodeStore 变更订阅**（关键决策，见下）：宿主订阅后，任何改 store 的路径
(命令/插件 service/拖拽 position)都会触发自动重灌渲染态，宿主无需每个操作后手动 sync。

### 关键决策 1：nodeStore 加"变更订阅"
- 现状：内核 nodeStore 无变更通知，CanvasDemo 靠"命令执行后手动 syncFromStore()"——这是散落接线的主因。
- 方案：给 `NodeStore` 加最小订阅 `subscribe(listener)`（+ 各类变更发生时 notify），纯逻辑、可单测、Node 环境零 Vue。
- 变更点：addNode / removeNode / updateNodeData / replaceAll / restore(history undo/redo 走 replaceAll)。
- `CanvasHost` 订阅 → 每次变更自动 `store→flow` 重灌 + 触发 VueFlow 更新。业务代码(命令/插件 service)一行不用改。
- 历史 undo/redo：`history.restore` 已注入= `nodeStore.replaceAll` → 自动被订阅捕获。✓
- 兼容：订阅是"加能力"，不破坏既有测试；undo/redo 现在也天然被捕获。

### 关键决策 2：`components/` → `contracts/` 改名
- 现 `src/components/` 全是注入令牌/契约(HOST_KEY/NODE_REGISTRY_KEY/NODE_WRITE_KEY/CANVAS_PARAMS_KEY/EDGE_*_KEY)、非 Vue 组件。
- 更名 `src/contracts/`；内部 import 路径全改；`src/index.ts` 的 `export *` 指向改掉；测试不改(它们 import 内核总入口)。
- 不搬文件内容，只动目录 + import 路径。

### 关键决策 3：CanvasHost 放哪、如何被 demo import
- 放 `src/host/CanvasHost.vue`；`src/index.ts` `export { default as CanvasHost }`。
- CanvasHost.vue 本身 import VueFlow + vue（浏览器层），故它**不参与 Node 单测**(src/host/__tests__ 现有测试 import createMiniCanvasHost，纯逻辑仍可测)。
- 装配相关的纯逻辑(store→flow 映射、令牌注入准备)尽量抽成可测函数放 `src/host/canvasHostCore.ts`，保留 Node 单测面。

## 四、改动文件
1. `packages/canvas-core-v2/src/contracts/` ← 从 `components/` 迁入（6 文件 + __tests__/edgeGeometry）
2. `packages/canvas-core-v2/src/host/CanvasHost.vue`（新，收编装配）
3. `packages/canvas-core-v2/src/host/canvasHostCore.ts`（新，可测的映射/令牌准备逻辑）
4. `packages/canvas-core-v2/src/services/nodeStore.ts`（加 subscribe + notify）
5. `packages/canvas-core-v2/src/index.ts`（导出 CanvasHost、改 contracts 路径）
6. `packages/canvas-core-v2/demo-web/CanvasDemo.vue`（收薄：改消费 CanvasHost，保留工具栏面板做插槽演示）
7. `packages/plugins/plugin-theme-default/demo-web/App.vue`（收薄：用 CanvasHost 一行渲染，删掉手写装配）
8. 测试：nodeStore 订阅单测、canvasHostCore 单测

## 五、实施步骤（每步原子 commit + 测试）
1. **components→contracts 改名**：mv 目录 + 改 src/index.ts 与内部 import → 全量 typecheck + 测试绿。
2. **NodeStore 加变更订阅** `subscribe/notify` + 单测（add/remove/update/replace 触发、unsub 停收）→ commit。
3. **canvasHostCore.ts**：抽出 `nodesFromStore(store)`、`themeAssembly(theme)`(取壳/边/背景/edgeDefaultType)、默认 handle/edge 参数常量 → 单测 → commit。
4. **CanvasHost.vue**：实现组件(建 host + provide + 内部 VueFlow + 订阅自动刷新 + 事件 + 落盘 + 生命周期)。
   defineExpose host + 插槽(toolbar/context-menu)。→ typecheck。
5. **CanvasDemo.vue 收薄**：改走 CanvasHost + 保留 SettingsPanel(经插槽/直接改注入) → 手动起 dev 验证拖/删/连边/撤销/落盘回归。
6. **plugin-theme-default App.vue 收薄**：删手写装配，改 `<CanvasHost :plugins=... seed=...>` 一行 → 起 dev 验证。
7. 全量回归(typecheck + vitest) + commit。

## 六、验证命令
```bash
cd packages/canvas-core-v2
node ./node_modules/typescript/bin/tsc --noEmit   # typecheck
node ./node_modules/vitest/vitest.mjs run          # 单测全绿
pnpm --filter @mini-canvas/canvas-core-v2 dev      # CanvasDemo 回归
cd packages/plugins/plugin-theme-default && pnpm dev  # 主题预览 App 回归
```
（浏览器行为无法在此终端跑，手动/或交给用户或后续 MCP 浏览器端验证）

## 七、风险/注意
- 不改 101 个既有测试：nodeStore 加订阅是加能力；CanvasDemo 收薄后逻辑走 host 内部，须回归拖拽/删除/撤销不坏。
- `components/`→`contracts/` 只动 import 路径与导出，符号名(令牌)不变，语义零变化。
- CanvasHost.vue 含 VueFlow，Node 测试只测抽出的 canvasHostCore + nodeStore 订阅，不 mount DOM。
- history undo/redo 靠 nodeStore 订阅自动刷新——验证撤销后界面同步是关键回归点。
- 插件热装/热卸已有 ctx 事件：CanvasHost 订阅 ctx:plugin-* 事件重装配壳/边/背景（复用 CanvasDemo 现有逻辑）。
- 主题默认边 type：edgeDefaultType 槽位('custom')，CanvasHost 建边用 themeRegistry 取它，缺省 'custom'。

---
*待审核。确认方向后我按 Step 顺序执行，每步原子 commit。*
