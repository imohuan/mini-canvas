# 渲染层通用插槽宿主 SlotHost —— 计划

日期 2026-09-05 · 分支 feat/cordis-plugin-system · 作者 code-developer · 状态：待实现后更新

## 一、用户需求
overlay 槽的渲染逻辑(读 ctx.slots.occupants + 订阅插件装卸重读 + markRaw + <component :is> 按 order 渲染)
目前在 CanvasSurface 里硬编码、且每次想加新槽位(如 toolbar/dock)都要重抄这套。抽成一个可复用组件 `SlotHost`，
以后渲染"任意一个槽"就一行 `<SlotHost slot="名字"/>`，插件侧照旧 `ctx.slots.register('名字', {component, order})`。

## 二、设计
新 `packages/canvas-render/src/components/SlotHost.vue`：
- prop `slot: string`（要渲染的槽名）。
- setup：`const { ctx } = useCanvasRender()` → 读 `ctx.slots.occupants(slot)` 进响应式 `list`；
  订阅 `ctx.on('ctx:plugin-installed')` / `ctx.on('ctx:plugin-uninstalled')` 重读（每次整体替换 list 触发 Vue 更新）；
  occupant 的 component `markRaw`（防 Vue 代理组件）。
- 模板：一个根容器 + `v-for` 逐个 `<component :is>`，occupant 可按 itemClass/attrs 由使用方定；
  容器不做任何定位/pointer-events（那是具体槽(如 overlay)的布局职责，由使用方套 CSS）。

## 三、落地与验证
1. 新建 SlotHost.vue + 从 canvas-render/src/index.ts 导出。
2. CanvasSurface 的 overlay 渲染改为 `<SlotHost slot="overlay"/>`，删掉 CanvasHost 里 uiOverlay/syncUiOverlay 那段
   硬编码与相关 props（消灭重复，证明可复用）。
3. 补 vue-tsc(canvas-render) 校验；跑 canvas-render 单测 + 插件 tsc；visual 等价靠 CanvasDemo overlay 两个角标仍渲染。
4. 独立 commit。

## 注意
- SlotHost 只在 CanvasHost 渲染子树内用（useCanvasRender 拿 ctx）；组件树外/独立宿主场景不在本步范围。
- overlay 的"盖满画布/pointer-events"布局仍是 overlay 这个槽的专属 CSS，归使用方(CanvasSurface)或具体槽定义，SlotHost 不背。
