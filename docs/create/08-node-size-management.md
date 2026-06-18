# 节点尺寸管理详解

> 对照 VueFlow 源码和 mini-canvas 实现，拆解节点宽高如何设置、测量、自适应，以及两种核心策略。

---

## 一、VueFlow 的尺寸管理机制（源码层面）

### 1.1 三层数据

| 层次 | 字段 | 类型 | 读写 | 说明 |
|------|------|------|------|------|
| **输入 A** | `node.style` | `{ width?: string, height?: string, ... }` | 写（用户设置） | 直接打进 NodeWrapper wrapper div 的 inline style |
| **输入 B** | `node.width` / `node.height` | `number \| string \| (node) => number \| string` | 写（用户设置） | 被 `getStyle` computed 转成 px；仅当 `node.style.width` 不存在时才起效 |
| **输出** | `node.dimensions` | `{ width: number, height: number }` | 只读（VueFlow 测量） | ResizeObserver 测量 wrapper div 实际渲染尺寸的结果 |

### 1.2 `getStyle` computed — 如何生成 wrapper div 的 inline style

`NodeWrapper.ts:152-167`:

```typescript
const getStyle = computed(() => {
  // 1. 先读 node.style
  const styles = (node.style instanceof Function ? node.style(node) : node.style) || {}

  // 2. 如果 node.style 没设 width/height，回退到 node.width/node.height
  const width = node.width instanceof Function ? node.width(node) : node.width
  const height = node.height instanceof Function ? node.height(node) : node.height

  if (!styles.width && width) {
    styles.width = typeof width === 'string' ? width : `${width}px`
  }
  if (!styles.height && height) {
    styles.height = typeof height === 'string' ? height : `${height}px`
  }

  return styles
})
```

**优先级**: `node.style.width` > `node.width`

### 1.3 wrapper div 的渲染

`NodeWrapper.ts:278-284`:

```typescript
h('div', {
  style: {
    visibility: isInit.value ? 'visible' : 'hidden',
    zIndex: ...,
    transform: `translate(${computedPosition.x}px,${computedPosition.y}px)`,
    pointerEvents: ...,
    ...getStyle.value,  // ← width/height 在这儿
  },
  // ...
}, [h(NodeComponent, props)])
```

### 1.4 传给子组件（NodeComponent）的 props — **不包含 `style`**

`NodeWrapper.ts:300`:

```typescript
// NodeWrapper 传给子组件的 props 列表：
{
  id: node.id,
  type: node.type,
  data: node.data,
  selected: node.selected,
  position: node.computedPosition,
  dimensions: node.dimensions,  // ← 有！ResizeObserver 测量结果
  // style 不在这里！
  // width 不在这里！
  // height 不在这里！
}
```

**结论**: 子组件（你的自定义节点）拿不到 `node.style`/`node.width`/`node.height` 通过 props。只能通过 `props.dimensions`（只读测量值）或 `useVueFlow().findNode(id)` 主动查询 `node.style`。

### 1.5 `dimensions` 的测量流程 — ResizeObserver

`NodeRenderer.vue:25-38` + `store/actions.ts:128-182`:

```
NodeRenderer onMounted
  ↓
new ResizeObserver(entries → updateNodeDimensions(updates))
  ↓
每个 NodeWrapper 的 wrapper div 被 observe
  ↓
wrapper div 尺寸变化
  ↓
updateNodeDimensions:
  getDimensions(nodeElement)           → getBoundingClientRect() 读取实际 DOM 尺寸
  node.dimensions = { width, height }  → 写入响应式属性
  node.handleBounds = getHandleBounds() → 重新计算端口位置
```

**dimensions 是「测出来的」，不是「设进去的」。它是只读输出。**

---

## 二、mini-canvas 的两种尺寸策略

### 2.1 策略 A：BaseNode 系列（text / image / video / stage）— "内容驱动"

适用于内容节点：有实际 DOM 内容（图片、文本等）。

**DOM 结构**:

```
NodeWrapper wrapper div          ← getStyle.value 通常为 {}（没设 node.style）
  └── BaseNode (.custom-node-root)
       └── .custom-node-card     ← :style="{ width: cardWidth+'px', height: cardHeight+'px' }"
            └── ImageNode/TextNode/...   ← w-full h-full，填充卡片
```

**初始化数据流（以图片节点为例）**:

```
1. ImageTopToolbar.uploadImage()
   → Image.onload 读取 naturalWidth × naturalHeight
   → fitCardSize(naturalW, naturalH)
       max 420×300, min 120×80, 等比缩放
   → updateNode(id, {
       data: {
         imageUrl, imageWidth, imageHeight,       // 原始尺寸
         cardWidth: 258, cardHeight: 200,          // 卡片尺寸
         resizable: true
       }
     })

2. BaseNode 初始化：
   cardWidth = ref(props.data.cardWidth || 256)    // 读到 258
   cardHeight = ref(props.data.cardHeight || 256)   // 读到 200

3. 模板渲染：
   <div class="custom-node-card"
     :style="{ width: '258px', height: '200px' }">  ← 设置卡片实际尺寸
     <ImageNode />  ← w-full h-full, 图片填充
   </div>

4. ResizeObserver 测量：
   wrapper div 无固定尺寸，由内部 .custom-node-card 撑开
   → getBoundingClientRect() → 258×200
   → node.dimensions = { width: 258, height: 200 }
```

**Resize 流程（BaseNode.vue:61-97）**:

```
拖拽右下角 resize handle
  ↓
onResizePointerMove:
  cardWidth.value = nextWidth    // 实时更新 ref → 实时渲染（拖动过程视觉反馈）
  cardHeight.value = nextHeight
  ↓
onResizePointerUp:
  vf.updateNode(id, {
    data: { cardWidth, cardHeight }   // 持久化到 node.data
  })
  ↓
watch(props.data.cardWidth):          // 外部修改 data 时同步回 ref
  if (!isResizing) cardWidth.value = newVal
```

**关键设计决策**:

- **为什么不用 `node.style`**: 因为使用 `node.style.width` 需要调用 `vf.updateNode()` 才能更新 wrapper div，这有 Vue 响应式延迟（~16ms）。用本地 `cardWidth` ref 直接绑 inline style，拖动时零延迟视觉反馈。
- **为什么 wrapper div 没固定尺寸也可行**: `.custom-node-card` 内部有实际 DOM 内容，能自然"撑开" wrapper，ResizeObserver 能测到正确值。
- **`node.style` 始终为空**: 这个策略下 `node.style` 不设宽高，wrapper div 的尺寸完全由内容决定。

### 2.2 策略 B：GroupNode — "wrapper 驱动"

适用于容器节点：内部没有能撑开尺寸的 DOM 内容。

**DOM 结构**:

```
NodeWrapper wrapper div          ← getStyle.value 包含 { width: '451px', height: '710px' }
                                    来源：GroupPlugin.createGroup() 传入 node.style
  └── GroupNode                 ← CSS: width: 100%; height: 100%
       ├── .group-node__body    ← flex: 1; pointer-events: none（透明穿透层）
       └── .group-node__selection ← 选中边框和 resize 控制点
```

**初始化数据流**:

```
1. GroupPlugin.createGroup(nodeIds):
   遍历选中节点 → 计算 bbox
   groupW = maxX - minX + 60
   groupH = maxY - minY + 70
   
2. addNodes([{
   type: 'group',
   style: { width: '451px', height: '710px' },  ← 写入 node.style
   position: { x: groupX, y: groupY },
 }])

3. NodeWrapper.getStyle() → 读取 node.style → wrapper div: style="width:451px;height:710px"

4. GroupNode CSS: width:100%; height:100% → 占满 wrapper

5. ResizeObserver 测量 → node.dimensions = { width: 451, height: 710 }
```

**Resize 流程（GroupNode.vue）**:

```
拖拽四角 resize handle
  ↓
onResizePointerMove:
  计算 nextWidth, nextHeight, nextX, nextY
  syncChildPositions(state, parentDeltaX, parentDeltaY)  // 同步子节点位置
  vf.updateNode(id, {
    position: { x: nextX, y: nextY },
    style: { width: `${nextWidth}px`, height: `${nextHeight}px` }
  })
  ↓
NodeWrapper.getStyle() 响应式更新 → wrapper div 更新
  → GroupNode width:100% 自适应
```

**为什么 GroupNode 必须用 `node.style`**:

- `GroupNode` 内部没有能撑开尺寸的 DOM 内容（`.group-node__body` 是 `pointer-events: none` 的透明层）
- 子节点渲染在 VueFlow 的 `NodeRenderer` 里，不在 `GroupNode` 的 DOM 子树中
- 必须通过 `node.style` 显式指定 wrapper div 尺寸 → `GroupNode` 100% 填充
- 如果用 `props.dimensions` 设尺寸 → 循环依赖（初始为 0×0，测量结果永远是 0×0）

### 2.3 历史问题：GroupNode 曾被锁死在 MIN 尺寸

**问题代码（已修复）**:

```typescript
// GroupNode.vue 旧版本
const groupWidth = ref(readInitialSize('width', MIN_WIDTH))   // 160
const groupHeight = ref(readInitialSize('height', MIN_HEIGHT)) // 120

// readInitialSize → normalizeSize(props.style?.width, ...)
// 但 NodeWrapper 不传 style prop！props.style 永远 undefined
// normalizeSize(undefined, undefined, 160) → 返回 160

const groupStyle = computed(() => ({
  width: `${groupWidth.value}px`,   // 永远 160px！
  height: `${groupHeight.value}px`,  // 永远 120px！
}))

// CSS 本已设 width:100%; height:100%
// 但 :style="groupStyle" inline style 优先级更高 → 覆盖为 160×120
```

**修复**: 移除 `groupStyle` computed 和 `:style` 绑定，让 CSS `width:100%;height:100%` 正常生效。

---

## 三、两种策略对比总表

| 维度 | 策略 A：BaseNode 系列 | 策略 B：GroupNode |
|------|----------------------|-------------------|
| **适用场景** | 有实际 DOM 内容的节点 | 容器型节点（子节点不在 DOM 内） |
| **尺寸输入源** | `node.data.cardWidth/cardHeight` | `node.style.width/height` |
| **输入写入方式** | `vf.updateNode({ data: { cardWidth, cardHeight } })` | `addNodes({ style: { width, height } })` |
| **wrapper div 尺寸来源** | 内部 `.custom-node-card` 撑开 | `getStyle` computed 读 `node.style` |
| **子组件如何填充** | `w-full h-full`（Tailwind） | CSS `width: 100%; height: 100%` |
| **Resize 拖拽实现** | 本地 `cardWidth` ref（零延迟） + pointerup 持久化 | 直接 `vf.updateNode({ style })` |
| **Resize 最小尺寸** | 120×80 | 160×120 |
| **`node.style`** | 空（不设宽高） | 有值（宽高字符串） |
| **`node.dimensions`** | 测出来（读 DOM） | 测出来（读 DOM，值 ≈ node.style） |
| **自适应能力** | 图片上传时 `fitCardSize()` 计算 | 创建时 bbox 计算；resize 手动拖拽 |

---

## 四、自定义节点的尺寸实现清单

如果你要新增一个节点类型，按以下步骤设置尺寸：

### 4.1 内容型节点（有 DOM 内容）

1. 创建 NodeComponent（如 `FooNode.vue`）- 内容用 `w-full h-full`
2. 上传/创建时计算合适尺寸 → `updateNode({ data: { cardWidth, cardHeight } })`
3. `BaseNode` 自动将 `cardWidth/cardHeight` 应用到 `.custom-node-card`
4. 如需 resize → `updateNode({ data: { resizable: true } })`

### 4.2 容器型节点（无 DOM 内容）

1. 创建 NodeComponent - CSS `width:100%; height:100%`
2. 创建时计算 wrapper 尺寸 → `addNodes({ type, style: { width, height } })`
3. 不要自己绑定 inline style 覆盖宽高
4. Resize 时 → `vf.updateNode({ style: { width, height } })`
