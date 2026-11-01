# canvas-core-v2 M4 最小 demo 计划（tracer bullet：能跑的全链）

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 状态：**执行中**
依据：API 契约定稿（canvas-core-v2-api.md）+ ADR-0001 + M1 内核(已完成,28 测试绿)。

## 目标
用 M1 内核做一条**最薄全链**：建内核 → 装 text 插件 → 创建节点 → 编辑 → 保存 → "刷新"(新内核) → 恢复。验证 ctx API 顺不顺手，兑现"能跑"。

## 形态决策（重要）
本环境 headless（win32 bash，无浏览器截图确认）。为**现在就验证可跑**，M4 用**可复跑的 headless 全链**（vitest + 一个可运行脚本）落地，不铺浏览器 DOM：
- Save 层与 NodeStore 是**真服务**，接可插拔 StorageAdapter（本地 localStorage / 内存），即用户要的"本地/云端各管一套、可插拔"的最小实体。
- text 插件是真 v2 插件：`setup(ctx)` 用 `ctx.get('nodeStore')` 建节点、注册类型，不写 uninstall。
- "刷新恢复" = 建第二个全新 Context，复用同一 StorageAdapter，验证文本还在。

## 产出文件
```
packages/canvas-core-v2/src/
  services/
    storage/
      types.ts         ← StorageAdapter 接口 + SaveType
      memoryAdapter.ts ← 内存实现(测试用)
      SaveService.ts   ← ctx 服务: set/get/remove + 防抖入队 + flush
    nodeStore.ts       ← ctx 服务: addNode/getNodes/updateNodeData + 自增 id(createNodeId)
  plugins/
    nodeText.ts        ← text 插件: 注册类型 + 依赖 nodeStore
  demo/
    host.ts            ← bootCanvas(): 建内核 + 注入 Save/NodeStore + 装 text + start
    demo.test.ts       ← 全链断言: 建→编辑→save→reload→恢复
  index.ts             ← 追加导出(services/plugins/demo 的 public 面)
```

## 关键 API（demo 反推，先按契约写）
- `ctx.inject('save', saveService)` / `ctx.get('save')`
- 插件内：`ctx.get('nodeStore').addNode('text', data)` → 返回短 id `'1'`
- 编辑：`ctx.get('nodeStore').updateNodeData(id, { text })`
- 保存：`ctx.get('save').set('project:demo:graph', nodes, 'canvas')` + flush
- 恢复：新内核读同 storage → getNodes 填回

## 验证
1. `node vitest run` 全绿（含 demo.test）。
2. demo 脚本：跑完打印"建/编辑/保存/恢复成功"。
3. tsc 干净。

## 范围外（留后续任务）
浏览器可视渲染、NodeRenderer slot、Registry、VueFlow 接线、真实 localStorage 前端 —— 均另开任务。本 M4 专注"内核+插件+save 闭环"这一条最薄纵切。

## 风险
- 从 M1 纯内核跨到"服务层"，需在 types.ts 里给 Services 扩展（declare module），验证 ctx.get 类型化可用。
- nodeStore 自增 id 需跨"刷新"仍递增？——id 只在单画布内唯一，恢复时按存储顺序重建即可，不强求跨会话连续。
