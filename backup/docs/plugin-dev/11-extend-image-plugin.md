# 11 · 往图片插件加功能（顶栏插槽 / 下拉菜单 / 底栏专属面板 / 全屏工作台）

> 这是一篇**专题指南**：以「图片节点」为例，讲清给画布加新功能时最常见的四类接线——
> ① 往图片顶部工具栏加按钮；② 下拉菜单与二级菜单；③ 点按钮后，底部状态栏切换成这个功能专属的 UI；
> ④ 功能全屏接管顶栏 + 底栏。全部只走插件上下文（ctx）与仓库现成组件，不引第三方库。
>
> 前置阅读：`docs/plugin-dev/index.md`（第 1–7 篇）、`docs/插件开发规范.md`（协作边界、数据规范）。

---

## 0. 先分清三条「栏」

| 名字 | 实现在哪 | 什么时候出现 | 怎么扩展 |
|---|---|---|---|
| 图片节点**上控制栏** | `packages/plugins/plugin-node-image/src/ImageTopToolbar.vue`，挂在 image 类型的 `out:top` 区域（见同包 `nodeImagePlugin.ts` 的 `segments`） | 恰好单独选中一个图片节点（多选 / 框选 / 拖动 / 抓手时由壳统一收起） | 本文 §2 的 `image.topToolbar` 插槽 |
| **节点底栏**（生成 / 动作面板） | `packages/plugins/plugin-bottom-bar`：`NodeBottomBar.vue`（内容）+ `NodeBottomBarOverlay.vue`（画布级浮层，Teleport 到 body，贴在卡片正下方） | 单选节点，且该节点类型注册过动作 | `registerBarAction`（§4） |
| 应用外壳**顶栏 / 底栏** | `packages/ui/src/components/CanvasShell.vue` 的 `#top-left` / `#top-right`，底部居中是 `DockArea`（`shell.dock` 槽） | 常驻 | `shell.dock` / `shell.status` 槽已可插（见 `plugin-shell-slots-demo`）；外壳顶栏当前没有插件槽，需要时另开一个槽 |

你截图里那排「元素编辑 / 高清 / 多角度 / 宫格切分」是**图片编辑工作台的顶栏**。在本项目里，
没进全屏时它对应「图片节点上控制栏」；进入全屏工作台后，顶栏和底栏都由工作台自己画（§5）。

---

## 1. 心智模型：一切通过 ctx，注册即回收

插件 `apply(ctx)` 拿到的 `ctx` 是唯一的能力台。要记住四句话：

1. **读能力用服务**：`ctx.get('doc')`（读写节点/边/事务/撤销）、`ctx.get('resources')`（存/取图片字节）、
   `ctx.get('nodeBar')`（底栏动作表）、`ctx.get('group')`（打组/解组）……可选依赖用 `ctx.tryGet`。
2. **放 UI 用注册**：`ctx.slots.register(槽名, 条目)`、`ctx.nodes.attach(类型, { region, component })`、
   `ctx.theme.add(槽, 组件)`。插件卸载时这些条目**自动消失**，不用手写清理。
3. **通用件按名取**：按钮、下拉、提示气泡这些设计系统件，不要 import 主题包，
   用 `useUiComponent('button')` / `useUiComponent('dropdown')` 从 ui 目录取（§3）。
   这样换主题时你的按钮跟着换，你一行不用改。
4. **UI 状态不写进节点 data**：会落盘、会污染撤销栈。用本插件内的模块级响应式会话
   （先例：`plugin-node-image/src/cropSession.ts`、`plugin-node-video/src/videoSession.ts`、
   `plugin-bottom-bar/src/mediaPreview.ts`）。

组件里拿 ctx：画布树内 `useCanvasRender().ctx`；外壳（抽屉/顶栏）用 `useCanvasContext().ctx`。
命令、事件、设置分别走 `ctx.commands.register` / `ctx.on` / 模块级 `Config` 导出。

命名规范（`docs/插件开发规范.md` §六）：插件名小写短横线；插槽条目 id 用 `插件名/条目名`；
命令用 `插件名:动作`；槽名用点号分层（`shell.dock`、`image.topToolbar`）。

---

## 2. 往图片顶部工具栏加按钮（`image.topToolbar` 插槽）

### 现状

`ImageTopToolbar.vue` 是写死的四个入口：上传、裁剪、扩展，外加编辑态的确认/取消。
别的插件想往里加按钮，目前没有口子。

### 基础改造（待落地，见 §7 清单第 1 项）

把 `ImageTopToolbar.vue` 改成**插槽顺序组件**（`SlotComposer` + `SlotAnchor`）结构：
内置按钮变成带 id 的锚点，整排按钮的顺序由 `image.topToolbar` 槽统一排。
`SlotComposer` 是最近新增的组件（`packages/canvas-render/src/components/SlotComposer.vue`），
支持 `order` 与 `before` / `after` 精确插位，底栏 / 状态条已经在用同一套。

改造后的结构（示意）：

```vue
<template>
  <div v-if="visible && !editing" class="ntp-root it-root nodrag nopan">
    <SlotComposer slot="image.topToolbar"
                  :shared-props="{ nodeId: props.id, data: props.data }">
      <SlotAnchor id="host/upload" :order="100"><!-- 上传按钮（原样保留） --></SlotAnchor>
      <SlotAnchor id="host/crop"   :order="200"><!-- 裁剪按钮 --></SlotAnchor>
      <SlotAnchor id="host/expand" :order="300"><!-- 扩展按钮 --></SlotAnchor>
    </SlotComposer>
  </div>
  <!-- 编辑态（裁剪/扩展中）仍只显示确认/取消，与现在一致 -->
</template>
```

要点：

- `ImageTopToolbar.vue` **不在**红线保护名单里（六件保护名单只含 theme-default 的
  `BaseNode` / `MovingHandle` / `BaseTitle` / `CustomEdge` / `ConnectionLine` / `DefaultBackground`），可以改。
- 容器样式用全局类 `.ntp-root`（`packages/canvas-render/src/styles/ui-theme.css`），
  不要自己再画一遍工具栏底板。
- 编辑态（`isEditing(props.id)`）时隐藏插件条目，和现有按钮行为对齐——裁剪中不该出现宫格按钮。

### 其他插件怎么加按钮

```ts
// 你的插件 apply(ctx) 里
import { markRaw } from 'vue'

ctx.slots.register('image.topToolbar', {
  id: 'grid-split/entry',          // 插件名/条目名
  order: 250,                      // 或用 before: 'host/expand' 精确插位
  component: markRaw(GridSplitEntry),
  meta: { title: '宫格切分' },
})
```

条目组件会收到共享 props（`nodeId` / `data`）。组件内部自己判断「这个节点有没有图」，
没图就不渲染按钮（与裁剪入口同一条规矩：不渲染一个点了没反应的死按钮）。

插件卸载时条目自动摘除；重装（热重载）同 id 自动替换。

---

## 3. 下拉菜单与二级菜单

### 3.1 两个基础组件（主题库提供，插件直接用）

按你的口径，这类工具栏 UI 由主题库（`plugin-theme-default`）做成**默认件**注册进 ui 目录，
其他插件按名取，不自己实现：

| 组件 | ui 目录名 | 状态 |
|---|---|---|
| 普通按钮 | `button` | **已有**（`NodeToolbarButton`：`title` / `icon` / `variant: ghost\|primary\|danger` / `disabled` / `active`，插槽放文字） |
| 下拉按钮 | `toolbarDropdown` | **本方案新增**（§7 清单第 2 项）：触发按钮 + 菜单面板二合一 |

`toolbarDropdown` 的建议契约（实现组合目录里已有的 `button` + `dropdown`，观感自动跟主题走）：

```ts
interface ToolbarMenuItem {
  key: string
  label: string
  icon?: unknown            // svg 字符串或组件
  description?: string      // hover 小字说明
  danger?: boolean
  disabled?: boolean
  children?: ToolbarMenuItem[]   // 有 children = 二级菜单
}
// props: title, icon?, items: ToolbarMenuItem[], placement?, menuWidth?
// emits: pick(key)
```

业务插件里：

```ts
const DropdownBtn = useUiComponent('toolbarDropdown')
const Btn = useUiComponent('button')
```

### 3.2 自己组合目录 dropdown（自定义面板类下拉）

「宫格切分」里的**自定义宫格**不是菜单行，是自定义面板（鼠标划过高亮、点确定才收）。
这类需求不要等组件支持，直接用目录里的 `dropdown` 自绘面板：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const Drop = useUiComponent('dropdown')
const Btn = useUiComponent('button')
const open = ref(false)
const rows = ref(3)
const cols = ref(4)
```

```vue
<template>
  <component :is="Drop" v-model="open" placement="bottom-start" menu-width="260px">
    <template #trigger>
      <component :is="Btn" title="宫格切分" :icon="ICON_GRID" :active="open" />
    </template>
    <template #default="{ close }">
      <!-- 菜单行：点了就执行 -->
      <button class="my-row" @click="pick('2x2'); close()">4 宫格 (2×2)</button>
      <button class="my-row" @click="pick('3x3'); close()">9 宫格 (3×3)</button>
      <!-- 自定义面板：不自动关，等用户点「确定」才 close() -->
      <GridHoverPicker v-model:rows="rows" v-model:cols="cols" @confirm="confirm(); close()" />
    </template>
  </component>
</template>
```

主题的 `dropdown` 自带：Teleport 到 body、同屏互斥（开一个关其他）、点外部 / Esc 关闭、
视口翻转防溢出。你只管往插槽里放内容。

### 3.3 二级菜单的三条现成参考

| 参考 | 文件 | 学什么 |
|---|---|---|
| ui 包二级菜单组件 | `packages/ui/src/components/AxSubMenu.vue` | hover 展开 / 延迟收起 / Teleport / 浮层链（`data-floating-chain`），避免「嵌套菜单点不动」 |
| **右键菜单（重点参考）** | `packages/plugins/plugin-context-menu/`：`menuBuilder.ts`（数据）、`ContextMenu.vue`（渲染）、`menuPlacement.ts`（定位） | 数据上**斜杠路径即层级**（`group: '宫格切分/自定义'` → 二级）；定位是纯函数（实测尺寸 + 距边 8px 夹紧，二级右侧放不下翻左侧）；Teleport + `role="menu"` + Esc/点外关闭 |
| 成品应用的下拉 | `packages/ui/src/components/AxDropdown.vue`（注册时顶替了主题默认 dropdown） | `nestedIn` + 浮层链：子面板打开时**父面板不关** |

取舍：

- 固定的几级菜单 → 喂 `toolbarDropdown` 的 `items` 树，组件内部处理二级展开与浮层链（§7 落地项）。
- 自定义交互面板（宫格 hover、色板、滑杆组）→ 目录 `dropdown` 的 default 插槽自绘（§3.2）。
- 右键菜单里加功能 → 注册命令并声明 `areas`（`menuBuilder` 自动收进菜单），路径写斜杠产生层级：

```ts
ctx.commands.register({
  id: 'grid-split:open',
  title: '宫格切分',
  areas: ['node'],
  group: '图片工具/宫格切分',   // 斜杠 = 二级菜单
  order: 10,
  run: (_c, payload) => { /* … */ },
})
```

---

## 4. 点按钮后，底部状态栏变成功能专属 UI

### 机制：底栏动作的 `panel`（已存在，直接用）

`BarAction`（`packages/plugins/plugin-bottom-bar/src/barTypes.ts`）支持 `panel` 字段：
**选中这个动作时，底栏的输入区被这个组件整个替换**。你截图里的「720全景」「剪辑」pill 就是它。
已验证案例：`video:clip` 动作 + `VideoClipPanel.vue` 时间轴。

```ts
import { registerBarAction } from '@mini-canvas/plugin-bottom-bar'

registerBarAction(ctx, {
  id: 'image:grid-split',
  types: ['image'],
  title: '宫格切分',
  needsPrompt: false,        // 不渲染大输入框
  apply: 'self',             // 结果自己写（面板经命令提交），不走通用写入器
  panel: GridSplitPanel,     // 选中动作时，底栏渲染它（收 { id, data } props）
  onSelect: (id) => beginSession(id),    // 打开会话（模块级响应式，不写 data）
  onDeselect: (id) => endSession(id),
  run: () => ({ ok: true }), // 实际提交由面板调命令完成（对齐 video:clip 的做法）
})
```

这样面板渲染在底栏**自己的布局里**，天然不会和旧底栏重叠。

### 入口在顶栏按钮时怎么接（两种路，选一）

1. **推荐：把「选中动作」收进 nodeBar 服务**（§7 清单第 3 项）。
   现状 `currentAction`（当前选中的动作）是 `NodeBottomBar` 的内部状态，服务上只有读接口。
   给 `NodeBarService` 加一个窄接口 `select(nodeId, actionId)`，底栏的选中态改读服务——
   之后顶栏按钮和底栏 pill 都调同一句 `ctx.get('nodeBar').select(nodeId, 'image:grid-split')`，
   单一真源，两边永远同步。
2. **不经底栏**：顶栏按钮直接打开全屏工作台（§5），工作台自带底栏。

### 不重合的硬规则

**永远不要在旧底栏的坐标上再浮一层自己的栏。** 只有两种合法形态：

- 渲染**进**底栏（`panel` 机制，§4）；
- 全屏接管（§5），此时旧 UI 按会话主动隐藏。

底栏的显隐与压制条件集中在 `plugin-bottom-bar/src/bottomBarOverlay.ts` 的
`resolveBottomBarSuppressed`（框选 / 多选 / resize / 拖动 / 抓手工具，纯函数、可单测）。
功能模式需要额外压制时，加在这里，不要在组件里散着写。

---

## 5. 功能全屏接管（顶栏 + 底栏独占）

适合宫格切分工作台这类「整个屏幕都是我」的功能。

落地五步：

1. **会话状态**（本插件内的模块）：

   ```ts
   // gridSession.ts —— 与 cropSession 同一条思路
   import { reactive } from 'vue'
   const sessions = reactive(new Map<string, GridConfig>())
   export const isActive = (nodeId: string) => sessions.has(nodeId)
   export const beginSession = (nodeId: string, cfg: GridConfig) => sessions.set(nodeId, cfg)
   export const endSession = (nodeId: string) => sessions.delete(nodeId)
   ```

2. **注册画布级浮层**（不是节点区域——节点带 transform，内部 z-index 出不去）：

   ```ts
   ctx.slots.register('overlay', {
     id: 'grid-split/workbench',
     order: 50,
     component: markRaw(GridSplitWorkbench),  // 组件内部 Teleport to="body"
   })
   ```

3. **浮层自布局**：`position: fixed; inset: 0`，内部自己排「顶栏 / 画布 / 底栏」。
   顶栏放功能按钮，底栏放「退出 / 创建分镜组 / 发布到画布」。
   根元素加 `nodrag nopan nowheel`，防止画布手势穿透。
4. **层级只用 token**：z-index 写 `var(--layer-modal, 100000)`（全屏档）或 import `LAYERS`
   （`packages/canvas-render/src/contracts/layers.ts`），**不写裸数字**。
   普通浮层参考 `NodeBottomBarOverlay`（overlay 槽 + Teleport + 低档 z）。
5. **退出即恢复**：Esc / 退出按钮 / 节点被删时 `endSession`；浮层随会话 `v-if` 消失，
   旧的节点顶栏和底栏自动回来，不需要你手动恢复。

与旧 UI 的隔离：全屏浮层盖住一切即视觉隔离；若做「半屏接管」（只要底栏区域），
回到 §4 的 panel 机制，并在 `bottomBarOverlay.ts` 的压制条件里补会话判断。

选型速查：

| 场景 | 用法 |
|---|---|
| 底栏多一个功能 pill + 专属面板 | `registerBarAction` + `panel`（§4） |
| 顶栏多一个按钮，点了在底栏出面板 | nodeBar 加 select 接口后，按钮调 `select`（§4 路 1） |
| 顶栏多一个按钮，点了全屏工作台 | 顶栏插槽按钮 + `overlay` 槽全屏浮层（§2 + §5） |
| 右键菜单加功能 | 命令 + `areas` + 斜杠分组（§3.3） |

---

## 6. ctx 速查表

| 想干什么 | 写法 | 备注 |
|---|---|---|
| 读/写节点 | `ctx.get('doc')` → `getNode / updateNode / transaction / createNode / removeNodes` | 唯一写入口，自动历史 + 落盘 |
| 存切出来的图片 | `(await ctx.get('resources').put(blob))` → `resourceId`；显示时 `resolve(resourceId)` | 节点里**只存 resourceId**，不存 URL（规范 §2.2） |
| 建图片节点 | 区域组件内 `useCapability('media')` → `addNode('image', resourceId, pos, { meta })`；逻辑层 `ctx.registryOf('media/creator').top('image')?.value.addNode({ … })` | 图片插件自己写字段，调用方不拼 data |
| 打组 / 解组 | `ctx.get('group').createGroup(ids)` / `.ungroup(id)` | plugin-group 提供 |
| 底栏动作 | `registerBarAction(ctx, action)` / `registerBarApplier(ctx, kind, fn)` | 从 `@mini-canvas/plugin-bottom-bar` 导出；条目落**调用方** scope |
| 往插槽放 UI | `ctx.slots.register(槽名, { id, order?, before?, after?, component: markRaw(X) })` | 卸载自动回收；`before/after` 指同槽条目 id |
| 取设计系统件 | `useUiComponent('button' / 'dropdown' / 'toolbarDropdown' / …)` | 不 import 主题包；缺件时降级可见 |
| 注册命令 | `ctx.commands.register({ id: '插件名:动作', title, run })` | 按钮 / 快捷键 / 右键菜单共用同一实现 |
| 监听事件 / 自建清理 | `ctx.on(事件名, fn)` / `ctx.effect(() => 清理函数)` | 自建定时器、window 监听必须包 effect |
| 可配置项 | 模块级导出 `Config`（schema） | 自动登记进设置面板；key 带插件前缀 |
| 组件里拿 ctx | 画布树 `useCanvasRender().ctx`；外壳 `useCanvasContext().ctx` | 根 ctx 没有服务代理，一律 `ctx.get`，不写 `ctx.服务名` |

---

## 7. 基础扩展点改造清单（要先落地的基础项）

这三项是「基础实现里提供，其他插件直接用」的部分，按顺序落地：

1. **`image.topToolbar` 插槽**：改 `ImageTopToolbar.vue` 为 `SlotComposer` + `SlotAnchor`
   （`host/upload` / `host/crop` / `host/expand` 三个锚点），共享 props 下发 `nodeId` / `data`；
   编辑态隐藏插件条目。验收：底栏 / 状态条同款排序能力（`order` + `before/after`），
   插件注册即出现、卸载即消失，裁剪中不出现。
2. **主题库 `toolbarDropdown` 组件**：新增
   `packages/plugins/plugin-theme-default/src/components/ui/ToolbarDropdownButton.vue`，
   在 `src/index.ts` 的 ui 目录登记处（`ui.add("button", …)` 那一批，约 717–743 行）加
   `ui.add("toolbarDropdown", ToolbarDropdownButton, { id: "default" })`。
   内部组合目录 `button` + `dropdown`；支持 `items` 树（children = 二级，浮层链参考 AxDropdown /
   AxSubMenu / 右键菜单）。验收：宫格切分菜单（预设行 + 自定义面板）零自绘浮层。
3. **nodeBar 选中动作窄接口**（可选，顶栏驱动底栏面板时需要）：
   `NodeBarService` 加 `select(nodeId, actionId)` / `deselect(nodeId)`，`NodeBottomBar` 的
   `currentAction` 改为读服务态。验收：顶栏按钮与底栏 pill 点同一动作，面板开合同步。

---

## 8. 常见坑（每条都踩过）

1. **不许 import 别的插件**（含主题包、`@mini-canvas/ui`）。要什么按名取：服务 `ctx.get`、
   注册场 `ctx.registryOf`、设计件 `useUiComponent`（规范 §1.1）。
2. **节点内 z-index 出不去**：`.vue-flow__node` 带 transform，必然形成层叠上下文。
   浮层一律 `Teleport to="body"`，挂在画布 `overlay` 槽；z 只用 `--layer-*` 变量 / `LAYERS`。
3. **UI 状态不进 data**：进 data = 落盘 + 撤销栈污染。用模块级响应式会话（cropSession 先例）。
4. **浮层手势**：根元素 `nodrag nopan`（会拖动画布的加 `nowheel`），内部按钮 `@click.stop`。
5. **根 ctx 没有服务代理**：组件里 `ctx.服务名` 是 undefined（真 bug 复发过），一律 `ctx.get('服务名')`。
6. **降级要可见**：`ctx.tryGet` 拿不到可选服务时，给禁用态或文案，不要只 console.warn。
7. **插槽条目 id 规范**：`插件名/条目名`；`before/after` 的目标是**同槽条目 id**，写槽名不生效（会 warn）。
8. **红线**：六件核心保护文件不许改；v1（根 `src/`、`packages/canvas-core`）不碰。
   `ImageTopToolbar.vue` 不在保护名单，可改。
9. **每完成一组修改立即 commit**（仓库铁律）；实验结束就地提交，失败就 revert。

---

## 9. 验证清单（按场景）

```bash
pnpm -C packages/plugins/<你的插件> test        # 新插件自己的单测
pnpm -C packages/plugins/plugin-node-image test  # 改了 ImageTopToolbar 后
pnpm -C packages/plugins/plugin-theme-default test  # 加了 toolbarDropdown 后
pnpm -C packages/plugins/plugin-bottom-bar test  # 动了 nodeBar 服务后
pnpm -C packages/ui typecheck                    # vue-tsc
pnpm -C packages/ui build
pnpm -C packages/ui dev                          # 真机：http://localhost:5288
```

真机检查点：

- 顶栏按钮：出现位置符合 `order/before/after`；取消选中消失；裁剪编辑态不出现；卸载插件消失。
- 下拉：开一个关其他；Esc / 点外关闭；二级 hover 展开、能点到、不闪关（浮层链）。
- 底栏面板：选中动作面板替换输入区；onSelect/onDeselect 开合；拖动节点时底栏收起（压制条件）。
- 全屏工作台：盖住一切、内部顶栏底栏可点；Esc 退出后旧 UI 原样恢复；控制台无 Vue warn。

---

## 附：参考实现索引

| 主题 | 文件 |
|---|---|
| 图片顶栏（本方案改造对象） | `packages/plugins/plugin-node-image/src/ImageTopToolbar.vue`、`nodeImagePlugin.ts`（`segments['out:top']`） |
| 插槽顺序组件 | `packages/canvas-render/src/components/SlotComposer.vue`、`SlotAnchor.vue`；外壳用例 `plugin-shell-slots-demo` |
| 主题组件目录注册 | `packages/plugins/plugin-theme-default/src/index.ts`（`ui.add(…)` 一批）；取件 `packages/canvas-render/src/contracts/uiCatalog.ts` |
| 通用按钮 | `plugin-theme-default/src/components/ui/NodeToolbarButton.vue`（ui 目录名 `button`） |
| 下拉容器 | `plugin-theme-default/src/components/ui/Dropdown.vue`（目录名 `dropdown`；成品应用被 `packages/ui/src/components/AxDropdown.vue` 顶替） |
| 二级菜单 | `packages/ui/src/components/AxSubMenu.vue`；右键菜单三件套 `plugin-context-menu`（menuBuilder / ContextMenu / menuPlacement） |
| 底栏动作契约 | `plugin-bottom-bar/src/barTypes.ts`（`BarAction.panel`）、`nodeBarPlugin.ts`（`registerBarAction`）、`NodeBottomBar.vue`（渲染 `currentAction.panel`） |
| 底栏面板样例 | `plugin-node-video/src/VideoClipPanel.vue` + `nodeVideoPlugin.ts` 的 `video:clip` 动作 |
| 全屏浮层样例 | `plugin-node-image/src/cropSession.ts`（会话）+ `ImageFrameOverlay.vue`（over:inset）；画布级 `plugin-bottom-bar/src/NodeBottomBarOverlay.vue` |
| 插件骨架 | `packages/plugins/plugin-shell-slots-demo`（package.json / vite 双构建 / 插槽注册全套） |

