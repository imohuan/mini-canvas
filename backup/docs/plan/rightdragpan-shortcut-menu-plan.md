# 画布右键菜单 → 快捷键触发 + 右键拖拽配置 计划

## 任务概述
用户想把**画布空白区域的右键"添加节点"菜单**做成一个可配置项：
- 配置**开启**：右键不再弹出"添加节点"菜单，改为**右键按住拖拽 = 平移画布**；添加节点菜单改用**快捷键呼出**（默认 `shift+a`）。
- 配置**关闭**（默认）：保持现状——右键弹"添加节点"菜单。

要求配置项用 `Canvas.vue:510` 那种 `registerCore(...)` 注册方式（进设置面板），快捷键走现有 `ShortcutManager`。

## 关键机制（已侦察确认）
- 画布空白右键 = `Canvas.vue` 的 `onPaneContextMenu` → `manager.eventBus.emit('paneContextMenu', {clientX, clientY})` → `ContextMenuPlugin.ts:285`(off1) 打开 mode="pane" 的"添加节点"菜单。
- VueFlow `pan-on-drag` 支持 `boolean | number[]`，数组元素是鼠标键位（0=左 / 1=中 / 2=右）；含 `2` 即允许右键拖拽平移。
- 设置项 `registerCore` 注册到 `panelRegistry`，值写入 `canvas.state.core`（持久化走 `useCanvasStore.ts` 的 serializer）。
- 快捷键用 `ShortcutManager.getInstance().register(...)`（`Canvas.vue` 已如此注册 VueFlow 系统键）。
- CanvasMenu 用 `position.x/y` 做 fixed 屏幕定位；菜单插件内部会 `toFlowPosition` 得到节点落点。快捷键无鼠标坐标，需在 `Canvas.vue` 维护一个"最后鼠标屏幕坐标"。

## 改动文件
1. `packages/canvas-core/src/composables/useCanvasStore.ts`
   - `core` 增加默认字段 `panOnRightDrag: false`；serializer 的 read/write 补齐该字段。
2. `packages/canvas-core/src/Canvas.vue`
   - 用 `registerCore` 注册开关 `panOnRightDrag`（group「交互/视口」），默认 false。
   - 计算并响应式切换 VueFlow 的 `:pan-on-drag`：开启时在当前值基础上并入右键 `2`（如左键平移保留则变 `[0,2]`），关闭时还原。
   - `onPaneContextMenu`：开启时不 `emit('paneContextMenu')`（只 `preventDefault`），关闭时维持原样。
   - 新增鼠标屏幕坐标跟踪（`pointermove`），供快捷键用。
   - 通过 `ShortcutManager` 注册快捷键（默认 `shift+a`，command「添加节点」），handler 在开启模式下用当前鼠标坐标 `emit('paneContextMenu', {clientX,clientY})` 呼出添加节点菜单；关闭模式不触发。`onUnmounted` 注销。

## 步骤
1. store 加字段 + serializer。
2. Canvas.vue registerCore 加开关；实现 pan-on-drag 计算绑定。
3. Canvas.vue 拦截 pane 右键逻辑。
4. Canvas.vue 注册 shift+a 快捷键 + 鼠标坐标跟踪 + 卸载清理。
5. 运行 canvas-core type-check / build 验证。
6. commit。

## 验证
- `pnpm --filter <canvas-core> build` 或 `vue-tsc` type-check 通过。
- 手动/代码走查：开启后右键空白拖拽可平移且不弹菜单、`shift+a` 呼出添加节点菜单；关闭后恢复右键菜单。

## 风险 / 假设（需你确认）
- **A（最大歧义）**："右键变成拖拽"是否**保留现有左键空白拖拽平移**？本计划默认保留，右键是**新增**平移通道。
- **B**：shift+a 快捷键**始终注册、始终生效**（无论开关），任何时刻都能呼出添加节点菜单（用户已确认）。
- **C**：仅针对**画布空白(pane)**右键菜单；节点/连线的右键菜单不受影响。
