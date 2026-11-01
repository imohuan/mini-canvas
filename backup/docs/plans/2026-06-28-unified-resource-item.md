# Unified ResourceItem Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `resources` + `variables` 两套 prop 合并为单一 `ResourceItem[]`，每个 item 自带 `renderItem` 渲染逻辑，彻底消除 ProseMirror editor 中的双轨代码。

**Architecture:** `ResourceItem` 新增 `category`、`icon`、`renderItem` 字段。`VariableItem` 删除。ProseMirror schema 的 `resource`/`variable` 两个 node 合并为统一 `resource` node，靠 `category` 分流渲染。`MentionMenu` 动态按 `category` 分组，用 `item.renderItem()` 自定义渲染。`useEditor` 砍掉一半双轨逻辑。

**Tech Stack:** Vue 3, ProseMirror, TypeScript

**影响文件：**
- Create: `packages/prosemirror-editor-bundle/src/context.ts` (provide/inject for category groups)
- Modify: `packages/prosemirror-editor-bundle/src/types.ts`
- Modify: `packages/prosemirror-editor-bundle/src/index.vue` (props/emits)
- Modify: `packages/prosemirror-editor-bundle/src/useEditor.ts` (core logic, ~40% removed)
- Modify: `packages/prosemirror-editor-bundle/src/MentionMenu.vue` (render + grouping)
- Modify: `packages/prosemirror-editor-bundle/demo/App.vue`
- Delete: (no files to delete, dead code cleaned inline)

---

### Task 1: 重写 types.ts — 统一 ResourceItem

**Files:**
- Modify: `packages/prosemirror-editor-bundle/src/types.ts`

**Step 1: 删除 VariableItem，重写 ResourceItem**

```ts
import type { VNode } from 'vue'

export interface ResourceItem {
  id: string
  name: string
  category: string                  // 自由分类: 'image', 'video', 'variable', 'style', ...
  icon?: string                     // SVG 字符串或图标名，MentionMenu 默认渲染用
  renderItem?: (item: ResourceItem) => VNode  // 自定义渲染（接收自身），返回 VNode，不传则用 icon+name 默认
  url?: string                      // 媒体资源 URL
  thumbnail_url?: string
  mediaType?: 'image' | 'video' | 'audio'
  value?: string                    // 变量替换值
}

// VariableItem 删除，MenuPosition/PreviewPosition 保持不变
export interface MenuPosition { /* 不变 */ }
export interface PreviewPosition { /* 不变 */ }
```

**Step 2: 确认 types.ts 无编译错误**

Run: `npx tsc --noEmit -p packages/prosemirror-editor-bundle/tsconfig.json`

---

### Task 2: 合并 ProseMirror Schema Node

**Files:**
- Modify: `packages/prosemirror-editor-bundle/src/useEditor.ts` (schema 定义部分)

**Step 1: 删除 `variable` node 定义，扩展 `resource` node attrs**

```ts
// 删除: ATOM_NODE_TYPES = ["resource", "variable"]
// 删除: ATOM_NODE_CLASSES = ["resource-node", "variable-node"]
// 替换为:
const ATOM_NODE_CLASS = "resource-node"

// 删除 variable node schema 定义，扩展 resource node:
resource: {
  attrs: { id: {}, name: {}, category: { default: 'resource' }, url: { default: '' }, thumbnail_url: { default: '' }, value: { default: '' } },
  group: "inline",
  inline: true,
  selectable: true,
  draggable: true,
  atom: true,
  toDOM: (node) => {
    const { id, name, url, thumbnail_url, value, category } = node.attrs
    if (url) {
      // 媒体资源：缩略图 + label
      const thumbnailUrl = thumbnail_url || getThumbnailUrlFromAssetUrl(url)
      const imgSrc = thumbnailUrl || url
      return [
        "span", { class: "resource-node", "data-id": id, "data-url": url, "data-name": name, "data-category": category },
        ["img", { src: imgSrc, draggable: "false", class: "object-cover" }],
        ["span", { class: "label" }, name],
      ]
    }
    // 变量/文本型：图标 + 文本
    return [
      "span", { class: "resource-node resource-node-text", "data-id": id, "data-name": name, "data-value": value, "data-category": category },
      ["span", { class: "label" }, `@${name}`],
    ]
  },
  parseDOM: [{
    tag: "span.resource-node",
    getAttrs: (dom) => {
      const el = dom as HTMLElement
      return {
        id: el.getAttribute("data-id") || "",
        name: el.getAttribute("data-name") || "",
        category: el.getAttribute("data-category") || "resource",
        url: el.getAttribute("data-url") || "",
        thumbnail_url: getThumbnailUrlFromAssetUrl(el.getAttribute("data-url") || ""),
        value: el.getAttribute("data-value") || "",
      }
    },
  }],
},
```

**Step 2: 更新 isAtomNode helper**

```ts
// 删除:
// const ATOM_NODE_TYPES = ["resource", "variable"] as const
// const ATOM_NODE_CLASSES = ["resource-node", "variable-node"] as const
// function isAtomNode(nodeType: string): boolean { return ATOM_NODE_TYPES.includes(nodeType as any) }

// 替换为:
function isAtomNode(nodeType: string): boolean {
  return nodeType === "resource"
}
```

**Step 3: 更新 createSelectionDecorationPlugin 中的 node 查询**

```ts
// 旧:
// const className = node.type.name === "resource" ? "resource-node-selected" : "variable-node-selected"

// 新:
// 统一用 "resource-node-selected"
```

**Step 4: 更新 bindResourceEvents 中的 selector**

```ts
// 旧: const selector = ATOM_NODE_CLASSES.map(cls => `.${cls}`).join(", ")
// 新: const selector = ".resource-node"
```

---

### Task 3: 重写 useEditor.ts 核心逻辑

**Files:**
- Modify: `packages/prosemirror-editor-bundle/src/useEditor.ts`

这是最大改动。核心目标：删除所有 dual-path 代码。

**Step 1: 更新函数签名**

```ts
// import 修改：
// import type { MenuPosition, ResourceItem } from "./types"   // 删除 VariableItem

export function useEditor(
  editorRef: Ref<HTMLElement | null>,
  props: {
    modelValue?: Ref<string | undefined>
    resources?: Ref<ResourceItem[] | undefined>   // 只有这一个
    // 删除 variables
  },
  emit: {
    (e: "update:modelValue", value: string): void
    (e: "resource-insert", resource: ResourceItem): void
    // 删除 variable-insert
  },
) {
```

**Step 2: 合并 filtered 状态**

```ts
// 删除: filteredVariables, menuType
// 新增:
const filteredItems = ref<ResourceItem[]>([])
// 按 category 分组（computed）
const groupedItems = computed(() => {
  const map = new Map<string, ResourceItem[]>()
  for (const item of filteredItems.value) {
    const key = item.category || 'default'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return map  // Map<category, ResourceItem[]>
})
```

**Step 3: 简化 showMenu**

```ts
function showMenu(coords: { left: number; top: number; bottom: number; right: number }) {
  // 删除 type 参数，不再需要 "resource" | "variable"
  menuVisible.value = true
  activeIndex.value = 0
  // ... 定位逻辑不变
}
```

**Step 4: 简化 moveUp/moveDown**

```ts
function moveUp() {
  if (!menuVisible.value) return false
  const total = filteredItems.value.length
  if (total === 0) return false
  activeIndex.value = (activeIndex.value - 1 + total) % total
  return true
}

function moveDown() {
  if (!menuVisible.value) return false
  const total = filteredItems.value.length
  if (total === 0) return false
  activeIndex.value = (activeIndex.value + 1) % total
  return true
}
```

**Step 5: 简化 insertSelectedItem**

```ts
function insertSelectedItem(item: ResourceItem) {
  if (!view) return
  const { from } = view.state.selection
  const nodeType = mySchema.nodes.resource
  if (!nodeType) return

  const tr = view.state.tr.replaceWith(
    from - 1 - mentionQuery.value.length,
    from,
    nodeType.create({
      id: item.id,
      name: item.name,
      category: item.category || 'resource',
      url: item.url || '',
      thumbnail_url: item.thumbnail_url || (item.url ? getThumbnailUrlFromAssetUrl(item.url, item.mediaType) : ''),
      value: item.value || '',
    }),
  )
  tr.insertText(" ")
  view.dispatch(tr)
  emit("resource-insert", item)
  hideMenu()
  view.focus()
}
```

**Step 6: 简化 dispatchTransaction 中的 @ 搜索**

```ts
// 搜索逻辑：单一的 allItems + 单一过滤
const allItems = unref(props.resources) || []
if (allItems.length > 0) {
  if (mentionQuery.value) {
    filteredItems.value = allItems.filter(
      item => item.name.toLowerCase().includes(mentionQuery.value.toLowerCase())
    )
  } else {
    filteredItems.value = allItems
  }
  if (filteredItems.value.length > 0) {
    showMenu({ left: coords.left, top: coords.top, bottom: coords.bottom, right: coords.right })
  }
}
```

**Step 7: 合并 watch 为单个**

```ts
// 删除两个 watch，合并为一个:
watch(
  () => unref(props.resources),
  (newResources) => {
    if (menuVisible.value && newResources) {
      if (mentionQuery.value) {
        filteredItems.value = newResources.filter(
          item => item.name.toLowerCase().includes(mentionQuery.value.toLowerCase())
        )
      } else {
        filteredItems.value = newResources
      }
    }
  },
  { deep: true },
)
```

**Step 8: 更新 return 对象**

```ts
return {
  menuVisible, menuPosition, activeIndex,
  filteredItems,           // 替换 filteredResources + filteredVariables
  groupedItems,            // 新增：用于 MentionMenu 分组渲染
  insertSelectedItem,
  handleMenuHover: (index: number) => { activeIndex.value = index },
  // 删除 handleMenuTypeSwitch
  previewVisible, previewUrl, previewTitle, previewType, previewPosition,
  fullscreenVisible, fullscreenUrl, fullscreenType, closeFullscreen,
  exportText, serializeDoc, deserializeDoc,
}
```

---

### Task 4: 重写 MentionMenu.vue

**Files:**
- Modify: `packages/prosemirror-editor-bundle/src/MentionMenu.vue`

**Step 1: 更新 props**

```ts
const props = defineProps<{
  visible: boolean
  items: ResourceItem[]                    // 所有项
  groupedItems: Map<string, ResourceItem[]>  // 按 category 分组
  categoryOrder: string[]                   // category 显示顺序
  position: MenuPosition
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [item: ResourceItem]
  hover: [index: number]
}>()
```

**Step 2: 重写模板 — 动态分组 + renderItem**

```vue
<template>
  <div v-show="visible" ref="menuRef" class="mention-menu" :style="dynamicStyle">
    <div ref="contentRef" class="menu-content">
      <template v-for="category in categoryOrder" :key="category">
        <div v-if="groupedItems.has(category) && groupedItems.get(category)!.length > 0" class="menu-category">
          <div class="category-title">{{ category }}</div>
          <div
            v-for="(item, itemIndex) in groupedItems.get(category)!"
            :key="item.id"
            :ref="(el) => setItemRef(el as HTMLElement, item)"
            class="menu-item"
            :class="{ active: getGlobalIndex(item) === activeIndex }"
            @mousedown.prevent="selectItem(item)"
          >
            <!-- 自定义渲染（传入 item 自身）或默认渲染 -->
            <component v-if="item.renderItem" :is="() => item.renderItem!(item)" />
            <template v-else>
              <span v-if="item.icon" class="item-icon" v-html="item.icon" />
              <span v-else class="item-icon-default">
                <!-- 默认分类图标 -->
              </span>
              <span class="text-sm">{{ item.name }}</span>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
```

**Step 3: 实现 getGlobalIndex**

```ts
function getGlobalIndex(item: ResourceItem): number {
  // 在 categoryOrder 顺序下计算全局索引
  let count = 0
  for (const cat of props.categoryOrder) {
    const items = props.groupedItems.get(cat)
    if (!items) continue
    const idx = items.indexOf(item)
    if (idx !== -1) return count + idx
    count += items.length
  }
  return -1
}
```

**Step 4: 删除死代码**

- 删除 `menuType` prop
- 删除 `variable-icon` 硬编码 SVG
- 删除 `setMenuItemRef` type 参数
- 删除 `selectItem` 的 type 参数
- 删除 `hover` emit 的 type 参数
- 简化 `scrollToActiveItem`（不再需要 type key）

---

### Task 5: 更新 index.vue 入口组件

**Files:**
- Modify: `packages/prosemirror-editor-bundle/src/index.vue`

**Step 1: 更新 props/emits**

```vue
<script setup lang="ts">
import { ref, toRef, computed } from 'vue'
import type { ResourceItem } from './types.ts'

const props = defineProps<{
  modelValue?: string
  resources?: ResourceItem[]
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'resource-insert': [resource: ResourceItem]
}>()
```

**Step 2: 计算 categoryOrder**

```ts
// 从 resources 中提取 category 列表并保持稳定顺序
const categoryOrder = computed(() => {
  const seen = new Set<string>()
  const order: string[] = []
  for (const item of unref(props.resources) || []) {
    const cat = item.category || 'default'
    if (!seen.has(cat)) {
      seen.add(cat)
      order.push(cat)
    }
  }
  return order
})
```

**Step 3: 更新 MentionMenu 传参**

```vue
<MentionMenu
  :visible="menuVisible"
  :items="filteredItems"
  :grouped-items="groupedItems"
  :category-order="categoryOrder"
  :position="menuPosition"
  :active-index="activeIndex"
  @select="insertSelectedItem"
  @hover="handleMenuHover"
/>
```

**Step 4: 删除 `variables` prop 和 `@variable-insert` emit**

---

### Task 6: 更新 demo/App.vue

**Files:**
- Modify: `packages/prosemirror-editor-bundle/demo/App.vue`

将 `defaultVariables` + `defaultResources` 合并为单一 `defaultResources`，每个 item 带 `renderItem`：

```ts
import { h } from 'vue'

const defaultResources: ResourceItem[] = [
  // 变量类
  { id: 'v1', name: '用户名', category: '变量', value: '张三', icon: '<svg>...</svg>' },
  { id: 'v2', name: '年龄', category: '变量', value: '25岁', icon: '<svg>...</svg>' },
  // 图片资源类
  {
    id: 'r1', name: '示例图片1', category: '图片',
    url: 'https://picsum.photos/200/300', mediaType: 'image',
    renderItem: (self) => h('div', { class: 'flex items-center gap-2' }, [
      h('img', { src: 'https://picsum.photos/200/300', class: 'w-6 h-6 rounded object-cover', draggable: false }),
      h('span', { class: 'text-sm' }, '示例图片1'),
    ]),
  },
]
```

---

### Task 7: 全局清理 & 验证

**Files:**
- Modify: `packages/prosemirror-editor-bundle/dist/` (rebuild 后自动更新)

**Step 1: TypeScript 类型检查**

```bash
npx tsc --noEmit -p packages/prosemirror-editor-bundle/tsconfig.json
```

**Step 2: 构建**

```bash
npx vite build
```

**Step 3: 手动验证**
- 启动 demo，输入 `@` → 确认菜单出现
- 键盘上下操作高亮正常
- 点击/回车插入项目正常
- 悬停预览正常
- 全屏预览正常

---
