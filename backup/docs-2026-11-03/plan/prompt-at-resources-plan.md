# 提示词 @资源：按输入端口连接的上游资源扩展可引用类型计划

## 任务概述
图片节点（ImageNode）的底部输入区用 `ProseMirrorEditor`，用户输入提示词时可通过 `@` 引用「当前节点输入端口连接的上游资源」。

当前实现（`useUpstreamImages`）只提取**有 `imageUrl` 的上游节点**（图片、全景图），
而 ImageNode 的 `acceptsInputs: ['image', 'text']` 允许**图片 + 文本**两类上游节点接入。
导致连入的**文本节点资源**不会出现在 `@` 菜单里。

需求：`@` 菜单里的资源 = 当前节点输入端口（target handle）实际连接的所有上游节点资源
（图片 + 文本），并且能按类型正确渲染、序列化、反序列化。

## 现状分析
- `ImageBottomToolbar.vue` 用 `useUpstreamImages(props.id)` 取上游 → 映射 `ResourceItem[]`
  （只走 `renderEditor` 图片缩略图分支、`onClick` 图片预览）。
- `useUpstreamImages.ts`：按 `targetHandle === 'target'` 过滤边，取上游节点 `data.imageUrl`，
  无 url 的节点被过滤掉。**该函数还被 ImageCompareNode / PanoramaNode 复用**，返回
  `{url,name,width,height}`，不能改其结构（否则破坏另外两个节点）。
- `prosemirror-editor-bundle` 的 `ResourceItem` 原生支持：
  - `mediaType?: 'image' | 'video' | 'audio'`
  - `value?: string`（文本内容）
  - 无 `url` 时 `@` 渲染走 `resource-node-text` 分支（展示 `@name`，`data-value` 存文本），
    `parseDOM`/`serialize` 均正确处理 `value` 字段。
- ImageNodePlugin：`acceptsInputs: ['image', 'text']`，即输入端口可接图片与文本。

## 实施步骤
### 1. 新增 `useUpstreamResources` 组合式函数
文件：`packages/canvas-core/src/composables/useUpstreamResources.ts`

新增（不改 `useUpstreamImages`，避免影响 ImageCompare / Panorama）：
- 复用 `useVueFlow().getEdges/findNode`，按 `targetHandle === 'target'` 取上游节点。
- 按上游 `data.nodeType` 分派：
  - `image` / `panorama`（有 `imageUrl`）→ `{ url, name, mediaType:'image', ... }`
  - `text`（有 `data.text`）→ `{ name, value: data.text, ... }`（无 url）
- 返回 `ComputedRef<UpstreamResource[]>`，`UpstreamResource` 为通用结构，含 `kind`（image/text）
  与渲染所需字段（name/url/value）。

### 2. 改 `ImageBottomToolbar.vue`
- 引入 `useUpstreamResources`，替换 `useUpstreamImages`。
- `connectedImages` → `connectedResources`：把上游资源映射成 `ResourceItem[]`：
  - 图片类：沿用现有 `renderEditor`（缩略图）、`onClick`（图片预览）、`mediaType:'image'`。
  - 文本类：`renderEditor` 走文本标签渲染（或交给 editor 默认 `resource-node-text` 分支，
    只需提供 `name` + `value`，不设 url）。
- `resolveResource`：按 name 匹配（editor 反序列化 `@name` 时用），兼容文本资源。
- 变量名 `connectedImages` 同步改名（如 `connectedResources`），`@` 菜单逻辑不变。

### 3. 导出（可选）
`packages/canvas-core/src/index.ts` 导出 `useUpstreamResources`（如需外部复用）。

## 验证方案
1. `pnpm build` 通过（vue-tsc 类型检查 + vite build）。
2. 手动验证：
   - 图片节点 → 连入一个图片节点 + 一个文本节点 → 底部输入框 `@` → 菜单应同时出现
     图片与文本两类资源。
   - 选中文本资源 → 编辑器内渲染为 `@文本名`，保存后 `promptDoc` 含 `data-value`，
     重新加载能反序列化回文本资源节点。
   - 图片资源仍可点击放大预览。
3. 回归：ImageCompare / Panorama 节点图片上游功能不受影响。

## 风险
- `useUpstreamResources` 若实现不当可能破坏 ImageCompare/Panorama——故采用**新增函数**而非改旧函数。
- 文本资源在 `@` 菜单的缩略图位置无图，需保证 `mention-menu-item` 在无 `url` 时
  不报错（现有模板已有 `v-else-if="item.icon"` 分支，安全）。
- `resolveResource` 需对文本与图片统一按 `name` 匹配，避免反序列化遗漏。
