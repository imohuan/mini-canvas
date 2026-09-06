# 渲染上下文：内层 CanvasSurface 晚挂载 provide 裸 ctx —— 设计 + 已实现

日期 2026-09-05 · 分支 feat/cordis-plugin-system · 作者 code-developer · 状态：**已实现**

## 一、用户需求（对话收敛）
之前 renderContext 里 `host` 是 Ref，消费组件(如 TextContent)取 ctx 要 `host.value?.ctx`(判空+value)，
API 很绕。用户要求：**渲染组件直接拿到裸 ctx**（`ctx.get('nodeStore')` / `ctx.text`），不导出 Ref、
不要 value、不要判空。方向是"处理放更外/内层 + 仿 VueFlow 的晚挂载 provide"。

> 说明：早期讨论过"仿 VueFlow storage 按 id 注册表兜底"方案，后收敛为更本质的
> 「内层 CanvasSurface 晚挂载 → provide 裸 ctx」。本计划按落地的后者记录。

## 二、根因
CanvasHost 在自身 setup 就要 provide（那时 ctx 还没建好，异步 boot），只能给 Ref 盒子 →
消费方一律 .value + 判空。VueFlow 的解法是提供方组件(其子树消费方)在"值就绪后"才 setup。

## 三、实现（仿 VueFlow：提供方晚挂载）
1. 新 `CanvasSurface.vue`（渲染子树宿主）：
   - 收 props：已就绪 host + registry/nodeWrite/handleParams/edgeVisual/edgeSelection +
     渲染态(nodes/edges/nodeTypes/edgeTypes/backgroundComp/uiOverlay/nodeEpoch) + 交互回调(转发给 VueFlow)。
   - **boot 完成(booting=false)后才由 CanvasHost 以 v-else 挂载** → 其 setup 时 host 已就绪。
   - provide RENDER_CONTEXT_KEY(裸 ctx/host，零 Ref) + 旧 6 个 *_KEY(HOST_KEY 包成稳定 ref 兼容)。
2. `renderContext.ts`：CanvasRenderContext.host 从 `Ref<...|undefined>` 改裸 `CanvasHostHandle`，
   **新增裸 `ctx: Context`**（内核上下文）。useCanvasRender() 不变。
3. `CanvasHost.vue`：provide 点移到 CanvasSurface，自身只"准备装配数据 + boot + 订阅 + defineExpose"；
   模板 v-else 渲染 `<CanvasSurface .../>`。
4. `TextContent.vue`：`const { ctx } = useCanvasRender()` → 直接用 `ctx.text`（删 host/判空）。

## 四、改后用法（内容组件作者）
```ts
import { useCanvasRender } from '@mini-canvas/canvas-render'
const { ctx, registry, handleParams, edgeVisual } = useCanvasRender()
ctx.get('nodeStore')                 // 裸内核上下文，零 value 零判空
ctx.text.editText(id, '新文本')      // 插件 declare module 增强的服务直访
```

## 五、验证
- vue-tsc：canvas-render(含 .vue) / theme-default / node-text 全过（真的检查 .vue 内部类型）。
- plain tsc：三包全过。vitest：canvas-render 39 / canvas-core-v2 214 全绿。
- 遗留：仅组件树外的"外部驱动"场景(CanvasHost 外 useCanvasRender)仍异步需判空——不在本步范围，
  若以后要做再走 storage/id 方案。

## 改动文件
- packages/canvas-render/src/host/CanvasSurface.vue（新）
- packages/canvas-render/src/host/CanvasHost.vue
- packages/canvas-render/src/contracts/renderContext.ts
- packages/canvas-render/src/index.ts
- packages/plugins/plugin-node-text/src/TextContent.vue
