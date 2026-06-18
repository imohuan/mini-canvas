# 功能实现流程说明（大白话版）

> 本文不关心代码，只讲**思路和方法**。每个功能怎么做、为什么这么做、踩过什么坑、怎么避开。

---

## 一、自定义端口和吸附逻辑

### 要实现什么？

让节点上的连接点（端口）不是紧贴在节点边缘，而是**往外偏移一段距离**。鼠标悬停或选中节点时才显示端口。连线还是连到节点边缘，但视觉上的端口在更外面。

```
节点边缘──────────────●  ← 视觉上的端口（在外面）
           │          │
           │  节点内容 │
           │          │
节点边缘──────────────●  ← 视觉上的端口（在外面）
```

### 旧项目是怎么做的？为什么不行？

旧项目搞了两个东西：
1. 一个"功能端口"——VueFlow 原生的 Handle，渲染在节点边缘上，但设为不可见。它负责真正的连线交互。
2. 一个"视觉端口"——自己画的圆圈+加号，放在功能端口外面。用户看到的是它，但点它的时候，要通过 JavaScript 伪造一个鼠标事件"转发"给功能端口。

问题出在哪？**转发鼠标事件是个脆弱的 hack。** 不同浏览器、不同事件处理顺序、不同缩放比例下，都可能出问题。而且端口的位置计算（应该在节点外侧多远）硬编码在组件里，改不了。

### 新方案怎么做？

**思路：基于 VueFlow 的 Handle 做扩展，不旁路它。**

VueFlow 的 Handle 组件本身支持自定义渲染，它暴露了一个 slot。我们可以：

1. **把 Handle 放在节点边缘外一段距离**（通过 CSS translate 偏移），它就是真正的交互入口，不需要再搞一个"功能端口"。
2. **Handle 的渲染内容自定义**——不是默认的圆点，而是我们想要的"圆圈+加号"。
3. **连线端点位置由 VueFlow 的 `getHandlePosition` 自动计算**，不需要我们手动算。
4. **显示/隐藏逻辑**用 Vue 的 `v-show`，绑定到节点的 hover 和 select 状态。

**具体流程：**

```
用户悬浮到节点上
  → 节点组件设置 isHovered = true
  → Handle 组件收到 prop: visible = isHovered || isSelected
  → Handle 通过 v-show 显示（带 transition 动画）
  → 用户看到端口从节点边缘"弹出来"

用户点击端口开始拖拽
  → VueFlow 的 useHandle 接管，走标准连接流程
  → startConnection → 搜索附近可连接端口 → 预览连线 → 松开后建立连接

用户移开鼠标
  → isHovered = false, isSelected = false
  → Handle 通过 v-show 隐藏
```

**偏移距离在哪里控制？**
- 在 Handle 组件上通过 CSS `translate` 控制
- 默认偏移 8px，可以通过插件选项配置
- 偏移只影响视觉，不影响连线端点（连线还是从 Handle 的实际位置出发）

**和旧方案的关键区别：**
- 没有"功能端口"和"视觉端口"的分离——Handle 自己既是功能入口也是视觉元素
- 没有事件转发 hack
- 偏移可配置
- 利用 VueFlow 自带的位置计算

---

## 二、端口拖拽连接——进入节点自动吸附

### 要实现什么？

从端口（Handle）拖出一条连线，**不需要精确对准目标端口**。把线拖进目标节点内部 → 节点出现 3D 倾斜 + 模糊的视觉反馈 → 松开鼠标，连接就建立好了。

**三个硬性规则：**

| 规则 | 说明 |
|------|------|
| **端口方向强制** | 左端口（target/输入）只能接收，右端口（source/输出）只能发出。禁止 source→source、target→target |
| **连接唯一性** | 两个节点同一对端口之间只能有一条线。不允许重复 |
| **空白区域松手弹菜单** | 线松在空白区域（不在任何节点上）→ 创建临时虚拟线→弹出菜单选择节点类型→替换为正式节点 |

```
    拖拽线从这里出发...
    ●──────────────────╮
    Node A              │ 
                        │ ← 线进入 Node B 的区域
         ┌──────────┐  │
         │  ╱ ╲     │←─╯ 节点在 3D 倾斜（跟随鼠标角度）+ 模糊模糊
         │ Node B   │    
         └──────────┘
         松开鼠标 → 连接建立
```

### 旧项目是怎么做的？

核心在 `useCanvasConnection.ts` + 节点组件的配合：

**第一步：连接开始时，广播状态**

```
handleConnectStart(event)
  → isConnecting = true
  → connectingSourceNodeId = event.nodeId
```

所有节点组件通过 `props.isConnecting` 和 `props.connectingSourceNodeId` 感知到"正在有人拖线"。

**第二步：线进入目标节点内部时，触发 3D + 模糊效果**

旧代码在 `VideoGenerationNode/index.vue` 中实现（`ImageInputNode` 同理）：

```typescript
// 是否显示3D效果：连接中 + 鼠标在本节点上 + 不是自己连自己
const show3DEffect = computed(() => 
  props.isConnecting &&        // 有人正在拖线
  isHovered.value &&            // 鼠标在当前节点上（@mouseenter 触发）
  props.connectingSourceNodeId !== props.id  // 不是自己
)

// 3D 透视变换：鼠标在节点内的相对位置决定倾斜角度
const perspective3D = computed(() => {
  if (!show3DEffect.value) return ''
  const rotateX = (mousePosition.value.y - 0.5) * 14  // 上下倾斜
  const rotateY = (mousePosition.value.x - 0.5) * -14 // 左右倾斜
  return `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`
})

// 鼠标位置：在节点内移动时实时更新
function handleMouseMove(event: MouseEvent) {
  const rect = nodeRef.value.getBoundingClientRect()
  mousePosition.value = {
    x: (event.clientX - rect.left) / rect.width,  // 0~1
    y: (event.clientY - rect.top) / rect.height,  // 0~1
  }
}
```

**视觉效果解释：**

- `perspective(800px)` 创建一个 800px 远的透视点
- `rotateX` 跟随鼠标上下位置：鼠标在上面 → 节点向后仰，鼠标在下面 → 节点向前倾
- `rotateY` 跟随鼠标左右位置：鼠标在左边 → 节点向左转，鼠标在右边 → 节点向右转
- 倍数 14 控制倾斜角度（约 ±7°）
- 同时节点加 `filter: blur(2px)` 模糊效果（旧代码中 `is-connecting-hover` class 触发）

**为什么这样做？** 用户拖线进入节点时，3D 倾斜让节点"活过来"了——你知道鼠标正在和这个节点交互。模糊效果暗示"这个节点可以接受连接"。这是游戏级别的微交互，但体验提升明显。

**第三步：松开鼠标 → 判断是否建立连接**

```
handleConnectEnd(mouseEvent)
  → findNearestValidTarget(mouseX, mouseY):
      1. 遍历所有节点（排除源节点）
      2. 检查鼠标是否在节点的"模糊区域"内（节点边界往外扩展 80px）
      3. 检查节点类型是否合法（allowedTargetNodeTypes）
      4. 计算鼠标到节点中心的欧几里德距离
      5. 取距离最近的合法节点
  → 如果找到：创建连接线（source → target）
  → 如果没找到 且 鼠标不在任何节点上：
      创建临时目标节点 + 弹出连接菜单（见下文）
```

**80px 的作用：** 它是"容错范围"。鼠标不必精确落在节点内部才连接——在节点边缘外 80px 内松手也能连上。但视觉反馈（3D + 模糊）只在鼠标**进入节点边界**时触发。80px 是保底的。

### 在插件化架构中如何实现？

这个功能拆成三个部分：

**Part 1: 连接状态广播 → ConnectionStatePlugin（或 CustomHandlePlugin）**

```
onConnectStart → 设置全局连接状态 { isConnecting, sourceNodeId }
onConnectEnd → 清除连接状态
```

节点组件通过 inject 或 store 读取这个状态。

**Part 2: 3D + 模糊视觉反馈 → 节点组件自身（或通用 mixin/hook）**

每个节点组件（或节点的 wrapper）监听：
- `isConnecting` 状态
- 自身 `mouseenter/mousemove/mouseleave`
- 组合判断是否显示 3D 效果

可以抽成一个通用 composable `useConnectFeedback(mouseRef, nodeId)`：

```typescript
function useConnectFeedback(nodeId: string) {
  const connectionState = useConnectionState() // 来自 store / inject
  const isHovered = ref(false)
  const mousePos = ref({ x: 0.5, y: 0.5 })
  
  const showEffect = computed(() =>
    connectionState.isConnecting.value &&
    isHovered.value &&
    connectionState.sourceNodeId.value !== nodeId
  )
  
  const transform = computed(() => {
    if (!showEffect.value) return ''
    return `perspective(800px) rotateX(${(mousePos.y - 0.5) * 14}deg) rotateY(${(mousePos.x - 0.5) * -14}deg)`
  })
  
  return { showEffect, transform, mousePos, onMouseEnter, onMouseMove, onMouseLeave }
}
```

**Part 3: 松手后连接判断 → CustomHandlePlugin**

```
onConnectEnd → findNearestValidTarget → addEdges
```

`allowedTargetNodeTypes` 和 `fuzzyThreshold` 作为插件选项。

### 端口方向强制与重复边禁止

这是两条硬性规则，VueFlow 已经提供了内置机制来完成：

**端口方向：用 `isValidConnection` prop 集中验证**

在 `<VueFlow :isValidConnection="validateConnection">` 注册一个验证函数。VueFlow 在拖拽过程中（实时给视觉反馈）和边创建时（决定是否创建）都会调用它：

```typescript
function validateConnection(connection: Connection): boolean {
  // 规则1：sourceHandle 必须是 'source'（右端口发出）
  //        targetHandle 必须是 'target'（左端口接收）
  if (connection.sourceHandle !== 'source') return false
  if (connection.targetHandle !== 'target') return false

  // 规则2：不能自己连自己
  if (connection.source === connection.target) return false

  return true
}
```

一处定义，全局生效。不需要像旧代码那样在 `onConnect`、`findNearestValidTarget` 等多个地方重复检查。

**重复边禁止：VueFlow 的 `connectionExists()` 自动处理**

VueFlow 在 `addEdgeToStore()` → `createGraphEdges()` 流程中会自动调用 `connectionExists()` 检测重复边：

```
addEdges([connection])
  → createGraphEdges()
    → addEdgeToStore()
      → connectionExists(edge, existingEdges)  // 检查 source+target+handles 是否已存在
        → 重复 → return false（静默跳过）
        → 不重复 → 继续创建
```

**不需要**像旧代码那样写 `getEdges.value.find(...)` 手动检查。但有一个注意点：只有 `Connection` 类型（不带 id 字段）会走这个流程，已经带 id 的 `Edge` 对象会被绕过。

### 统一连接函数

把这些规则封装成一个函数，方便所有场景调用（拖拽连接、菜单选择后连接、编程式连接）：

```typescript
function createConnection(
  sourceNodeId: string,
  targetNodeId: string,
  sourceHandle = 'source',
  targetHandle = 'target'
): { success: boolean; edge?: Edge; error?: string } {
  // 1. 自连接检查
  if (sourceNodeId === targetNodeId) {
    return { success: false, error: '不能连接自己' }
  }
  // 2. 方向检查
  if (sourceHandle !== 'source' || targetHandle !== 'target') {
    return { success: false, error: '连接方向错误：只能左端口连右端口' }
  }
  // 3. 重复检查（调用 VueFlow 的 getEdges + 手动快检，因为去重交给 VueFlow）
  //    但这里先做一次 index 级别的检查，避免创建无效的 Connection 对象
  const dupCheck = getEdges.value.some(
    e => e.source === sourceNodeId && e.target === targetNodeId
        && e.sourceHandle === sourceHandle && e.targetHandle === targetHandle
  )
  if (dupCheck) {
    return { success: false, error: '连接已存在，同一对端口只能有一条线' }
  }
  // 4. 创建边对象
  const edge: Edge = {
    source: sourceNodeId,
    target: targetNodeId,
    sourceHandle,
    targetHandle,
    id: `edge-${sourceNodeId}-${targetNodeId}-${Date.now()}`,
    type: 'flowing',
    data: { edgeType: currentEdgeType, edgeLineWidth: currentEdgeLineWidth },
  }
  addEdges([edge])
  return { success: true, edge }
}
```

**为什么在 `createConnection` 里还要做一次手动去重？** 因为如果直接调用 `addEdges([edge])`（Edge 类型），VueFlow 会跳过 `connectionExists()`。手动快检作为防灾。然后 `addEdges` 内部会再做一次（如果走 Connection 路径的话），双保险。



如果松开鼠标时，不在任何节点附近（超过 80px 且不在任何节点上）：
- 在鼠标位置创建一个 1×1px 不可见的临时目标节点
- 画一条临时连线（给用户视觉反馈：线连到了鼠标松开的位置）
- 弹出"选择节点类型"菜单
- 用户选择后：删除临时数据 → 创建正式节点 → 创建正式连线

这个机制让"想连到一个还没创建的节点"成为可能。

---

## 三、多选/框选/加减选

### 要实现什么？

- **框选：** 在画布空白处按住鼠标拖出一个矩形，矩形内的所有节点被选中
- **加选：** 按住 Shift 点击节点，追加到选中集合
- **减选：** 按住 Shift 点击已选中的节点，取消选中
- **选中框：** 选中 2+ 节点时，外面显示一个虚线边框包裹它们
- **批量拖拽：** 在选中框的空白区域按住拖拽，所有选中节点一起移动
- **快捷键：** Ctrl+A 全选，Delete/Backspace 删除选中，Escape 取消选中

### 旧项目踩过的坑（这是血泪教训）

**坑 1：框选结束后选中状态消失了**

这是最头疼的问题。原因：VueFlow 自己有一套选中逻辑，我们又在外面搞了一套，两者互相打架。

流程是这样的：
```
松开鼠标 → 我们的代码: 把框内节点设为选中
         → VueFlow 的 pane-click 事件: 认为用户点了空白区域，清空所有选中
         → 结果: 选中被清空，用户看到框选"失效"
```

旧项目的解决方案是"多重保险"——`stopPropagation` + `preventDefault` + 延迟重选 + 标志位保护。但这只是补丁，不是根本解决。

**新方案的根本解决：完全接管选中逻辑。**

具体做法：
1. 设置 VueFlow 的 `elements-selectable="false"`，彻底禁用 VueFlow 的选中
2. 我们自己的 MultiSelectPlugin 管理一个 `selectedNodeIds: Set<string>`
3. 节点是否"看起来被选中"（蓝色边框等），由我们自己控制 CSS class，不依赖 VueFlow 的 `node.selected`
4. 这样 VueFlow 的 `pane-click` 不管做什么，都不会影响我们的选中状态

**坑 2：框选过程中的节点闪烁**

旧实现中，每次 `mousemove` 都调用了 `addSelectedNodes()` 和 `removeSelectedElements()`，即使框内的节点没有变化。这导致 VueFlow 频繁更新 DOM，产生闪烁。

**解决方案：缓存 + 比较**
- 保存"上一帧框内的节点列表"
- 每次 `mousemove` 先算新列表，和上一帧比较
- 如果完全一样，跳过，什么都不做
- 只有变化时才更新选中

**坑 3：选择框不跟随画布移动**

选择框如果放在 VueFlow 的默认 slot 里，它不会自动应用视口变换（缩放/平移）。

**解决方案：**
- 选择框通过 `mountOverlay('viewport')` 渲染到 VueFlow 的 viewport 层
- 这样它会自动跟随画布的缩放和平移

**坑 4：选择框上的滚轮不缩放画布**

因为选择框拦截了滚轮事件，画布收不到。

**解决方案：**
- 在选择框上监听 `wheel` 事件
- 手动转发到 VueFlow 的 viewport 容器：`viewportEl.dispatchEvent(new WheelEvent(...))`

### 完整交互流程

```
用户在空白区域按下鼠标左键
  → 记录起点坐标 (startX, startY)
  → 创建选择框元素（绝对定位，虚线边框）
  → 如果没按 Shift：清空当前选中

用户拖动鼠标
  → 更新选择框的宽高 (endX - startX, endY - startY)
  → 计算框内节点（画布坐标转换）
  → 比较和上一帧是否相同，相同则跳过
  → 更新选中状态

用户松开鼠标
  → 删除选择框元素
  → 最终确认选中节点列表
  → 如果选中 0 个：什么都没发生
  → 如果选中 1 个：节点被选中，不显示 SelectionFrame
  → 如果选中 2+ 个：显示 SelectionFrame（虚线边框包裹）
```

---

## 四、SelectionFrame 和打组（Group）

### 4.1 SelectionFrame（多选外边框）

选中 2+ 个节点后，外面出现一个虚线矩形框，显示"这些节点是一组的"。在这个框上可以：
- **拖拽空白区域**：移动所有选中节点
- **滚轮**：缩放画布（转发事件）
- **右侧显示端口**：可以一次性连接所有选中节点

**计算选中框位置：**
```
遍历所有选中的节点 →
  找到最左的 x 坐标（minX）
  找到最上的 y 坐标（minY）
  找到最右的 x + width（maxX）
  找到最下的 y + height（maxY）
边框 = (minX - padding, minY - padding, maxX + padding, maxY + padding)
```

**批量拖拽流程：**
```
用户在选择框空白区域按下鼠标
  → 记录鼠标位置（屏幕坐标）
  → 记录所有选中节点的当前位置（画布坐标）

用户拖动鼠标
  → 计算屏幕偏移: dx = currentX - startX, dy = currentY - startY
  → 转换为画布偏移: canvasDx = dx / zoom, canvasDy = dy / zoom
  → 更新所有节点: node.position.x = startPos.x + canvasDx
  → 选择框位置随节点移动自动更新
```

### 4.2 打组（Group）

选中 2+ 个节点后，工具栏出现"打组"按钮。点击后：

**思路：利用 VueFlow 的父子节点机制。**

VueFlow 的节点有一个 `parentNode` 属性。如果一个节点设置了 `parentNode = 'group-1'`，那么：
- 它的 `computedPosition` = 自身 position + 父节点 position
- 拖拽父节点时，所有子节点自动跟随
- 删除父节点时，可配置是否级联删除子节点

**打组流程：**
```
1. 创建一个 GroupNode（半透明矩形 + 标题栏 + 折叠按钮）
2. GroupNode 的位置 = 选中区域的左上角
3. GroupNode 的尺寸 = 包裹所有选中节点 + padding
4. 每个选中节点的 parentNode = GroupNode 的 id
5. 将子节点的 position 调整为相对于 GroupNode 的位置
   （因为 computedPosition = node.position + parent.position）
```

**解组流程：**
```
1. 获取 GroupNode 的所有子节点
2. 将子节点的 position 改回绝对坐标（node.position + groupNode.position）
3. 设置子节点的 parentNode = undefined
4. 删除 GroupNode
5. 恢复子节点到正常画布层级
```

**为什么用 VueFlow 的 parentNode 而不是自己写？**
- VueFlow 的拖拽系统原生支持父子节点位置计算
- 不需要手动维护子节点位置同步
- `computedPosition` 自动处理好所有坐标转换

**折叠行为：**
- 折叠时：设置子节点的 `hidden = true`
- 展开时：设置子节点的 `hidden = false`
- GroupNode 自身缩小到标题栏大小

**嵌套编组：**
- 一个 GroupNode 可以包含另一个 GroupNode
- 需要限制最大嵌套深度（默认 3 层）以避免复杂度爆炸
- 打组时检查：如果选中节点中已有 GroupNode，子 GroupNode 的深度不能超过限制

---

## 五、辅助线模式

### 要实现什么？

拖拽节点时，自动显示和其他节点的对齐参考线。当节点的边/中心/另一边与另一个节点的边/中心对齐时，显示一条淡色的线，并把节点"吸过去"。

### 旧项目的对齐算法（这部分设计没问题，直接复用）

它的核心思路是把对齐分成 **11 种模式**：

**垂直对齐（5 种）：**
- 左对左：拖拽节点的左边 = 另一个节点的左边
- 中对中：拖拽节点的水平中心 = 另一个节点的水平中心
- 右对右：拖拽节点的右边 = 另一个节点的右边
- 左对右：拖拽节点的左边 = 另一个节点的右边
- 右对左：拖拽节点的右边 = 另一个节点的左边

**水平对齐（4 种）：**
- 上对上、下对下、上对下、下对上（同理）

**边缘对中心（2 种）：**
- 垂直中心对边：拖拽节点的中心Y对齐另一个节点的上/下边
- 水平中心对边：拖拽节点的中心X对齐另一个节点的左/右边

### 算法流程

```
拖拽节点时（onNodeDrag 事件触发）：

1. 获取拖拽节点的边界框（x, y, width, height, centerX, centerY, right, bottom）
2. 遍历画布上所有其他节点：
   a. 获取每个节点的边界框
   b. 根据启用的对齐模式，计算拖拽节点和对方节点的对齐点
   c. 如果两个对齐点的距离 < 阈值（默认 8px），记录"这里可以对齐"
3. 在所有"可以对齐"的记录中，选垂直方向上最近的一条、水平方向上最近的一条
4. 如果找到了对齐线：
   a. 显示参考线（淡色水平/垂直线）
   b. 自动吸附：调整拖拽节点的位置，使对齐点重合

释放节点时（onNodeDragStop）：
  → 清除所有参考线
```

### 吸附怎么做？

吸附就是"修改拖拽节点的位置，让它的某个边/中心对准参考线"。

```
找到了垂直参考线 x = 100
拖拽节点的左边在 x = 98，中心在 x = 130，右边在 x = 162
计算这三个点离参考线的距离：
  左边: |98 - 100| = 2
  中心: |130 - 100| = 30
  右边: |162 - 100| = 62
最近的边是左边（差距 2px < 8px 阈值）
→ 吸附：设置节点的 x = 100
```

### 参考线渲染

参考线是覆盖在整个画布上的淡色线，通过 `mountOverlay('viewport')` 渲染，随画布缩放和平移。

### 和旧实现的区别

旧实现直接修改 `dragNode.position.x = ...` 来做吸附。这在 `onNodeDrag` 回调中是可以的（因为还在 VueFlow 的拖拽流程中），但存在和 d3-drag 的自身计算冲突的可能。

新方案更安全：在 `onNodeDrag` 回调中返回修改后的位置，让 VueFlow 统一处理。

---

## 六、复制粘贴

### 要实现什么？

- Ctrl+C：复制当前选中的所有节点（以及它们之间的连线）
- Ctrl+V：在鼠标位置粘贴（保持节点之间的相对位置关系）
- 多次粘贴自动偏移，不会叠在一起
- 粘贴后新节点自动被选中

### 思路

**复制：**
```
1. 找出所有选中的节点
2. 深拷贝它们的完整数据（位置、类型、样式、自定义数据）
3. 找出两端都在选中节点集合内的连线
4. 深拷贝这些连线的数据
5. 存入剪贴板
```

**粘贴：**
```
1. 从剪贴板读取数据
2. 生成 ID 映射表（旧ID → 新ID）
3. 计算粘贴位置：
   - 如果有鼠标位置：节点组的左上角对齐到鼠标
   - 如果没有鼠标：默认偏移 (每次粘贴增加 50px)
4. 生成新节点：新ID + 新位置 + 标记为选中
5. 生成新连线：新ID + 将 source/target 映射到新节点ID
6. 添加到画布
```

### ID 映射是关键

复制时节点的 ID 是 "node-1"、"node-2"。粘贴后不能还用这些 ID——会和原节点冲突。

```
原节点: "node-1" → 新节点: "node-abc123"
原节点: "node-2" → 新节点: "node-def456"
原连线: "edge-1" (source: "node-1", target: "node-2")
  → 新连线: "edge-ghi789" (source: "node-abc123", target: "node-def456")
```

### 多次粘贴的偏移

第一次粘贴：偏移 50px
第二次粘贴：偏移 100px
第三次粘贴：偏移 150px

只要你复制的还是同一批数据，每次粘贴就继续偏移。新的复制会重置偏移计数器。

### 剪贴板存哪里？

- 存在 Plugin 的内存中（ref），不跨页面刷新
- 如果需要跨项目复制（A 项目复制到 B 项目），可以用 IndexedDB 或 sessionStorage 存

### 粘贴预览（可选增强）

有些用户期待在粘贴前看到"半透明预览"——节点跟随鼠标移动，点击确认位置。

实现思路：
1. Ctrl+V 时不直接粘贴，而是创建一组半透明的"预览节点"
2. 预览节点跟随鼠标移动
3. 点击确认位置，把预览节点变成正式节点
4. 按 Escape 取消粘贴

---

## 七、历史记录（撤销/重做）

### 要实现什么？

- Ctrl+Z：撤销上一步操作
- Ctrl+Shift+Z / Ctrl+Y：重做已撤销的操作
- 支持撤销：移动节点、添加/删除节点、添加/删除连线、粘贴、打组等

### 旧项目的问题

旧项目用的是"**全量快照**"——每次操作后，把整个画布的状态（所有节点、所有连线、视口位置）保存成一个 JSON。撤销时，用之前保存的快照替换当前画布。

**问题：**
1. **内存消耗大**：一个快照可能有几百 KB，50 个快照就几十 MB
2. **恢复慢**：要重新设置所有节点和连线，可能有闪烁
3. **不精确**：用户只想撤销一个节点的位置移动，但整个画布都被恢复了

### 新方案：命令模式

**核心思想：不记录"整个画布的样子"，只记录"做了什么改动"。**

```typescript
操作：用户删除了 3 个节点
记录：
  {
    做了什么: "删除了节点 A, B, C 和连线 X, Y",
    怎么撤销: "重新添加节点 A, B, C 和连线 X, Y 到原来的位置",
    怎么重做: "再次删除节点 A, B, C 和连线 X, Y"
  }
```

**撤销就是"执行逆操作"，重做就是"再执行一遍正操作"。**

### 各种操作的记录方式

| 操作 | 正操作 | 逆操作（撤销） |
|------|--------|----------------|
| 移动节点 (拖拽) | 记录新位置 | 恢复到旧位置 |
| 添加节点 | 记录节点的完整数据 | 删除节点 |
| 删除节点 | 记录删除的节点和连线 | 重新添加节点和连线 |
| 添加连线 | 记录连线的完整数据 | 删除连线 |
| 删除连线 | 记录删除的连线的完整数据 | 重新添加连线 |
| 粘贴 | 记录粘贴的所有节点ID | 删除粘贴的节点和连线 |
| 打组 | 记录 GroupNode + 子节点原始状态 | 解组（恢复到打组前） |

### 关键优化：合并连续操作

用户在拖拽节点时，`onNodeDrag` 事件每秒触发几十次。如果每次都记录一条历史，那拖 1 秒就产生 60 条记录——太浪费了。

**解决方法：操作合并**

```
拖拽开始 (onNodeDragStart)
  → 标记 "开始一批操作"
  → 记录所有被拖拽节点的初始位置

拖拽中 (onNodeDrag)
  → 不记录历史

拖拽结束 (onNodeDragStop)
  → 标记 "操作结束"
  → 创建一条历史记录："移动了 N 个节点"
  → 记录 undo = 恢复到初始位置, redo = 恢复到最终位置
```

这样，1 秒的拖拽只产生 1 条历史记录。

### 撤销/重做流程

```
用户按 Ctrl+Z
  → 读取当前指针指向的历史记录
  → 执行记录的 undo() 函数
  → 因为操作在插件体系内（通过 PluginContext.actions），
     会触发正常的事件（onNodesChange 等）
  → 其他插件（自动保存等）正常响应
  → 移动指针到上一条

用户按 Ctrl+Shift+Z 或 Ctrl+Y
  → 读取指针下一条记录
  → 执行记录的 redo() 函数
  → 移动指针到下一条

用户执行新操作（在撤销了几步之后）
  → 删除指针之后的所有记录（分支历史被丢弃）
  → 新操作追加到历史末尾
```

### 内存管理

- 最多保留 100 条（可配置）
- 超过时删除最早的历史记录
- 每条记录包含被删除的完整节点数据（用于恢复），但这些都是原始对象的浅拷贝，内存可控

---

## 八、总结：插件如何协作

以一个典型的用户场景说明插件间如何配合：

```
用户: 框选 3 个节点 → 打组 → 移动组 → 复制组 → 粘贴 → 撤销

1. [MultiSelectPlugin] 用户按住鼠标拖出矩形
   → 框内 3 个节点被选中 → 显示 SelectionFrame
   → emit('selection:change', { nodes: [A, B, C] })

2. [NodeToolbarPlugin] 收到 selection:change 事件
   → 显示多选工具栏（含"打组"按钮）
   
3. [GroupPlugin] 用户点击"打组"
   → emit('history:beginBatch', '打组')
   → 创建 GroupNode, 设置 3 个节点的 parentNode
   → emit('history:endBatch')
   
4. [HistoryPlugin] 收到 beginBatch/endBatch
   → 创建一条历史记录："打组 (3 个节点)"

5. [GroupPlugin] 用户拖拽 GroupNode
   → 子节点自动跟随（VueFlow 原生支持）
   → emit('history:beginBatch', '移动组')

6. [AlignGuidePlugin] 拖拽过程中检测到对齐
   → 显示参考线 → 自动吸附

7. [HistoryPlugin] 拖拽结束
   → emit('history:endBatch') → 创建记录："移动组"

8. [ClipboardPlugin] 用户按 Ctrl+C
   → 深拷贝 3 个节点 + 1 个 GroupNode + 连线 → 存入剪贴板

9. [ClipboardPlugin] 用户按 Ctrl+V
   → emit('history:beginBatch', '粘贴')
   → 生成新 ID → 计算位置 → 添加到画布
   → emit('history:endBatch')

10. [HistoryPlugin] 用户按 Ctrl+Z
    → 执行粘贴的逆操作 → 删除粘贴的节点 → 恢复原状
```

**关键点：**
- 每个插件只关心自己的事情
- 通过事件总线通信，不直接调用对方的方法
- History 插件不需要知道"什么操作被撤销了"——它只执行逆操作函数
- 自动保存、UI 更新等"旁观插件"通过监听事件自动响应
