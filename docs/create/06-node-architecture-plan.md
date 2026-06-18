# 节点架构重构计划

> 状态：设计完成 → 开始实施
> 目标：节点类型可插拔（registerNodeType 真正生效）、工具栏按节点类型分离、BaseNode 骨架复用

---

## 当前问题

| # | 问题 | 现状 |
|---|------|------|
| 1 | 所有节点用同一个 `type: 'custom'` | 文本/图片/视频/导演台全走 CustomNode.vue，只靠 data.nodeType 元数据区分 |
| 2 | 工具栏硬编码在 CustomNode 里 | TopToolbar 始终 5 个按钮（全景/多角度/打光/换角色/调整比例），不管什么节点类型 |
| 3 | registerNodeType 是死的 | 插件调用后写入 PluginContext 局部 Map，该 Map 永远不传给 VueFlow 的 `:node-types` |
| 4 | 没有 nodes/ 目录 | 没有按节点类型组织的组件结构 |

## 目标架构

```
components/
├── Decoration/                          ← 纯样式基础组件（不绑定业务）
│   ├── BaseNode.vue                     ← 🆕 节点骨架：卡片+端口+选中态+悬停+3D倾斜
│   ├── NodeToolbar.vue                  ← 工具栏容器（定位+Teleport）【不变】
│   ├── ToolbarButton.vue                ← 🆕 统一样式的工具栏按钮
│   └── MovingHandle.vue                 ← 连接端口球【不变】
│
├── nodes/                               ← 🆕 每种节点类型独立目录
│   ├── text/
│   │   ├── TextNode.vue                 ← 文本编辑卡片
│   │   ├── TextTopToolbar.vue           ← 文本节点特有按钮
│   │   └── TextBottomToolbar.vue
│   ├── image/
│   │   ├── ImageNode.vue               ← 图片渲染卡片
│   │   ├── ImageTopToolbar.vue
│   │   └── ImageBottomToolbar.vue
│   ├── video/
│   │   ├── VideoNode.vue
│   │   ├── VideoTopToolbar.vue
│   │   └── VideoBottomToolbar.vue
│   └── stage/
│       ├── StageNode.vue                ← 导演台节点
│       ├── StageTopToolbar.vue
│       └── StageBottomToolbar.vue
│
├── CustomNode.vue                       ← 重构：改用 BaseNode + 按 data.nodeType 路由子节点
├── CustomEdge.vue
└── TempTargetNode.vue
```

### BaseNode.vue 设计

提取 CustomNode 的全部骨架逻辑（不包含内容渲染）：

```vue
<BaseNode>
  <slot name="top-toolbar" />         ← 每种节点注入自己的 TopToolbar
  ┌──────────────────────────────┐
  │  <slot name="content" />      │  ← 每种节点注入自己的内容
  │  (默认: SVG 占位图标)        │
  └──────────────────────────────┘
  <slot name="bottom-toolbar" />      ← 每种节点注入自己的 BottomToolbar
</BaseNode>
```

**BaseNode 负责：**
- 节点根容器（`.custom-node-root` + selected/hovered 类）
- 卡片容器（`.custom-node-card`，含边框、阴影、选中高亮）
- 左侧 MovingHandle（target 端口）
- 右侧 MovingHandle（source 端口）
- 悬停效果（hover 时显示端口 + 3D 倾斜反馈）
- 连接拖拽反馈（目标区域高亮 + 3D 漂浮效果）
- 调试模式的可视化叠加层

**BaseNode 不负责：**
- 节点具体内容（SVG/图片/文本 — 由 slot 决定）
- 工具栏按钮（由各节点类型的 TopToolbar/BottomToolbar 决定）
- 浮动标题 — 改为可选 slot

### ToolbarButton.vue

位于 `Decoration/ToolbarButton.vue`，提供统一样式：

```vue
<ToolbarButton @click="handleClick">
  <svg>...</svg>
  <span>按钮文字</span>
</ToolbarButton>
```

替代当前 TopToolbar/BottomToolbar 中散落的 `<button>` 内联样式。

### CustomNode.vue 重构后

作为路由节点：根据 `data.nodeType` 决定渲染哪个子节点组件：

```vue
<BaseNode>
  <template #content>
    <component :is="nodeComponent" v-bind="nodeProps" />
  </template>
  <template #top-toolbar>
    <component :is="topToolbarComponent" v-bind="nodeProps" />
  </template>
  <template #bottom-toolbar>
    <component :is="bottomToolbarComponent" v-bind="nodeProps" />
  </template>
</BaseNode>
```

其中 `nodeComponent`/`topToolbarComponent`/`bottomToolbarComponent` 由 `data.nodeType` 映射表决定。

### registerNodeType 打通

#### 问题根因

PluginContext 的 `registerNodeType` 写入局部 `Map<string, Component>`，该 Map 在 `createPluginContext` 闭包内，外界不可访问。

#### 解决方案

**Step 1:** 在 `useCanvasStore` 中新增集中式节点类型注册表：

```ts
// useCanvasStore.ts
const customNodeTypes = ref<Record<string, Component>>({})

function registerCustomNodeType(name: string, component: Component) {
  customNodeTypes.value[name] = component
}
```

**Step 2:** Canvas.vue 将 customNodeTypes 合并到 nodeTypes：

```ts
const mergedNodeTypes = computed(() => ({
  ...canvas.nodeTypes,
  ...canvas.customNodeTypes,
}))
// VueFlow :node-types="mergedNodeTypes"
```

**Step 3:** PluginContext.registerNodeType 委托给 store：

```ts
// PluginContext.ts
registerNodeType(name: string, component: Component): void {
  canvasStore.registerCustomNodeType(name, component)
}
```

---

## Task 拆解（2-5 分钟微任务）

### Task 1: 创建 `Decoration/BaseNode.vue`（节点骨架）

**提取自 CustomNode.vue 的内容：**
1. 全部 script 逻辑（props、isHovered、mousePosition、cardTransform、feedbackMousePosition 等）
2. 全部 template（根 div、卡片、MovingHandle × 2、调试叠加层）
3. 全部 style（custom-node-card 等）
4. **移除：** TopToolbar、BottomToolbar、浮动标题、SVG 占位图标
5. **替换为：** 3 个 slot（top-toolbar、content、bottom-toolbar）

**验收标准：**
- BaseNode 渲染后外观与当前 CustomNode 一致（测试时用临时内容填 slot）
- slot 未填充时有合理默认值（content 默认显示 SVG 图标）

### Task 2: 创建 `Decoration/ToolbarButton.vue`（统一按钮）

**内容：**
- 接受 `variant?: 'default' | 'primary'` prop
- 内置 SVG icon + text slot
- 统一样式（hover、gap、padding、border-radius）
- 从 TopToolbar.vue 的 `.canvas-top-toolbar__button` 提取样式

**验收标准：**
- 按钮 hover 效果与当前一致
- variant='primary' 显示紫色

### Task 3: 重构 CustomNode.vue 使用 BaseNode

**改动：**
- CustomNode.vue 改为使用 `<BaseNode>` + 三个 slot
- 暂时保留浮动标题和 SVG 占位图标作为默认 content slot
- 暂时保留 TopToolbar/BottomToolbar 引用作为默认 toolbar slot
- **外观不变，行为不变**

**验收标准：**
- `pnpm dev` 后节点外观与之前完全一致
- 端口、选中、hover、3D 倾斜全部正常

### Task 4: 创建 nodes/text/ 目录（首个节点类型）

**文件：**
- `nodes/text/TextNode.vue` — 文本编辑卡片（textarea + 样式）
- `nodes/text/TextTopToolbar.vue` — 文本工具栏（加粗/字号/颜色/对齐按钮，复用 ToolbarButton）
- `nodes/text/TextBottomToolbar.vue` — 文本底部栏（复制/删除按钮）
- `nodes/text/index.ts` — 导出

**验收标准：**
- TextNode 可独立渲染
- TextTopToolbar 显示加粗/字号/颜色/对齐 4 个按钮

### Task 5: 打通 registerNodeType

**文件：**
- `useCanvasStore.ts` — 新增 customNodeTypes + registerCustomNodeType + mergedNodeTypes computed
- `Canvas.vue` — 使用 mergedNodeTypes 代替 canvas.nodeTypes
- `PluginContext.ts` — registerNodeType 委托给 canvasStore.registerCustomNodeType

**验收标准：**
- 插件调用 `context.registerNodeType('myNode', MyComponent)` 后
- VueFlow 实际渲染 MyComponent 作为节点

### Task 6: CustomNode 支持按 data.nodeType 路由

**改动：**
- CustomNode.vue 新增 `nodeTypeMap` 映射表
- 根据 `data.nodeType` 自动选择子节点组件和工具栏组件
- 默认回退到通用模板（当前 SVG 图标 + 通用工具栏）

**映射表：**
```ts
const nodeTypeMap = {
  text: { node: TextNode, topToolbar: TextTopToolbar, bottomToolbar: TextBottomToolbar },
  image: { node: ImageNode, topToolbar: ImageTopToolbar, bottomToolbar: ImageBottomToolbar },
  // 未注册的 nodeType → 回退默认
}
```

**验收标准：**
- 创建 `data.nodeType: 'text'` 的节点 → 渲染 TextNode + TextTopToolbar
- 创建 `data.nodeType: 'image'` 的节点 → 渲染 ImageNode + ImageTopToolbar
- 创建未知 nodeType → 渲染默认模板

### Task 7: 创建 nodes/image/ 目录

**文件：**
- `nodes/image/ImageNode.vue` — 图片渲染卡片
- `nodes/image/ImageTopToolbar.vue` — 替换图片/裁剪/滤镜按钮
- `nodes/image/ImageBottomToolbar.vue` — 旋转/下载按钮
- `nodes/image/index.ts`

### Task 8: 创建 nodes/video/ 目录

**文件：**
- `nodes/video/VideoNode.vue` + toolbar 文件

### Task 9: 创建 nodes/stage/ 目录

**文件：**
- `nodes/stage/StageNode.vue` + toolbar 文件

### Task 10: 回归验证 + 文档更新

- 全量验证：文本节点创建+编辑、图片节点创建+渲染、视频节点、导演台节点
- 工具栏按节点类型正确切换
- registerNodeType 打通后加载插件自定义节点类型
- 更新 04-implementation-plan.md

---

## 依赖关系

```
Task 1 (BaseNode)
  ↓
Task 3 (CustomNode 重构)  ← 关键：外观不能变
  ↓
Task 2 (ToolbarButton) + Task 4 (TextNode)
  ↓
Task 5 (registerNodeType) + Task 6 (nodeType 路由)
  ↓
Task 7 (ImageNode)  ←→  Task 8 (VideoNode)  ←→  Task 9 (StageNode)  [可并行]
  ↓
Task 10 (回归验证)
```

## 风险点

| 风险 | 缓解 |
|------|------|
| BaseNode 提取不完整，端口/hover/3D 行为丢失 | Task 3 重构后逐项验证，CustomNode 先保留原样作为参考 |
| registerNodeType 打通后 VueFlow 不响应 | 用 `computed` 合并 nodeTypes，验证响应式正确 |
| 各类节点的卡片尺寸不一致 | BaseNode 暴露 `size` prop |
