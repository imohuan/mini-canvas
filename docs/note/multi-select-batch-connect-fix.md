# 多选框批量连接修复记录

## 背景

本次修改围绕多选框组件展开。多选框被当作一个“节点式装饰层”，需要具备选区展示、顶部操作入口和右侧批量连接端点。

核心目标：

- 选区框顶部留出更大空间，确保节点标题也被虚线选区框包含。
- 选区顶部展示工具栏，包含“已选 N 个节点”和“打组”入口。
- “打组”当前只展示入口，不实现真实分组。
- 多选框不再复用 `MovingHandle.vue` 作为连接端点。
- 删除左侧端点，只保留右侧端点。
- 右侧端点固定在选区框右侧垂直居中，并保持常显。
- 从右侧端点拖拽时，为选区内所有可输出节点批量创建连接线。

## 修改范围

主要涉及文件：

- `mini-canvas/src/canvas/core/plugins/multi-select/SelectionFrame.vue`
- `mini-canvas/src/canvas/core/components/Decoration/TopToolbar.vue`
- `mini-canvas/src/canvas/core/components/Decoration/MovingHandle.vue`
- `mini-canvas/src/canvas/core/Canvas.vue`
- `mini-canvas/src/canvas/core/useCanvasStore.ts`
- `mini-canvas/src/canvas/core/components/TempTargetNode.vue`

## 多选框 UI 逻辑

### 选区框

选区框顶部 padding 被加大，避免节点标题露在虚线框外。

当前选区框表现：

- 横向留白：`16px`
- 顶部留白：`34px`
- 底部留白：`16px`

### 顶部工具栏

顶部工具栏作为多选框的一部分内联展示。

展示内容：

- 已选节点数量
- “打组”按钮

当前“打组”按钮只作为入口展示，不触发真实分组状态变更。

### 右侧端点

多选框连接端点改为组件内本地按钮，不再使用 `MovingHandle.vue`。

当前端点规则：

- 删除左侧端点。
- 只保留右侧端点。
- 固定在选区框右侧垂直居中。
- UI 对齐 `MovingHandle.vue` 中的圆形加号按钮风格。
- 按钮一直显示，不依赖 hover。
- `mousedown` 后进入批量连接拖拽流程。

## 批量连接逻辑

### 拖拽开始

从多选框右侧端点按下后：

1. 收集当前选区内所有可输出节点。
2. 创建一个临时汇聚节点。
3. 为每个选区内可输出节点创建一条临时边，连接到临时汇聚节点。
4. 注册全局拖拽事件。
5. 进入批量连接状态。

临时节点和临时边都带有临时标记：

- 临时节点：`type: 'tempTarget'`
- 临时节点数据：`data.isTemp: true`
- 临时边数据：`data.isTemp: true`

### 拖拽移动

拖拽过程中，临时汇聚节点跟随鼠标位置。

之前出现过“拖拽像被固定住”的现象，原因是只更新了 store 中的节点位置，没有同步 VueFlow 内部节点状态。

修复方式：

- 更新 `canvas.nodes` 中临时节点位置。
- 同时调用 VueFlow 实例更新内部节点位置。

这样临时边的终点会稳定跟随鼠标。

### 拖拽结束

松手时：

1. 根据鼠标位置查找最近的有效目标节点。
2. 批量创建真实连接线。
3. 清理所有临时节点、临时边和事件监听。
4. 重置连接状态。

右侧端点拖出时的真实连接方向：

```text
选区内节点 source -> 目标节点 target
```

### 命中规则修复

批量连接命中目标时，不再依赖普通单线连接的全局连接状态。

修复后的边界：

- 可以传入批量连接专用 source 节点。
- 批量右侧拖出时，会排除整个选区内的节点。
- 不会误连到选区内部节点。
- 目标节点必须具备 `targetPosition`。

## 状态清理逻辑

批量连接新增统一清理边界，避免异常中断后残留临时产物。

清理内容：

- 删除临时边。
- 删除临时节点。
- 清空批量连接状态。
- 重置普通连接状态。
- 清空 hover 反馈状态。
- 移除 document/window 事件监听。

覆盖场景：

- 鼠标正常松开。
- 窗口失焦。
- pointer cancel。
- 组件卸载。
- 批量连接流程中出现异常。

## 持久化逻辑

之前节点和边没有独立进入本地持久化，刷新后可能丢失新增节点或连接线。

本次修改将真实节点和真实边分别持久化：

- `canvas-nodes`
- `canvas-edges`

同时增加过滤规则，避免临时拖拽产物进入本地存储。

过滤规则：

- 节点：排除 `type === 'tempTarget'`。
- 节点：排除 `data.isTemp === true`。
- 边：排除 `data.isTemp === true`。

结果：

- 真实节点刷新后保留。
- 真实连接线刷新后保留。
- 批量拖拽过程中的临时节点和临时边不会被保存。

## 遇到的问题和处理

### 1. 批量连接拖拽终点不跟随鼠标

现象：

- 从多选框右侧端点拖拽时，线的终点像被固定住。

原因：

- 临时节点的位置只更新到了业务 store。
- VueFlow 内部仍保留旧的节点位置。

处理：

- 拖拽移动时同时更新业务 store 和 VueFlow 内部节点状态。

结果：

- 临时汇聚节点和临时边可以稳定跟随鼠标。

### 2. 批量连接命中可能失败

现象：

- 批量连接松手时，目标命中可能依赖普通连接的全局状态。
- 批量连接状态与普通单线连接状态混用，存在失败路径。

原因：

- 普通连接逻辑依赖 `connectionState.sourceNodeId` 和 source handle。
- 批量连接需要独立传入 source 语义。

处理：

- 命中目标时允许传入批量连接 source。
- 对批量右侧拖出增加选区整体排除列表。

结果：

- 批量连接不再依赖普通连接的全局 source 状态。
- 不会误连选区内部节点。

### 3. 临时节点和临时边可能残留

现象：

- 如果 mouseup 没触发、窗口失焦或组件卸载，临时节点/边和事件监听可能残留。

处理：

- 增加统一清理入口。
- 在 mouseup 的 finally 中清理。
- 在 window blur、pointer cancel、组件卸载时清理。

结果：

- 批量连接中断后不会残留临时产物。

### 4. 新增节点和边刷新后可能丢失

现象：

- 新增节点和边未纳入独立本地持久化，刷新后可能丢失。

处理：

- 使用独立 localStorage key 保存真实节点和真实边。
- 写入和读取时过滤临时产物。

结果：

- 真实画布状态可持久保存。
- 临时拖拽状态不会污染持久化数据。

### 5. 构建中的 `INVALID_ANNOTATION` 提示

执行命令：

```bash
pnpm build
```

构建结果：

- `vue-tsc -b` 通过。
- `vite build` 通过。
- 构建产物成功生成。

出现提示：

```text
[INVALID_ANNOTATION] A comment "/* #__PURE__ */" in "node_modules/.pnpm/@vueuse+core@14.3.0_vue@3.5.38_typescript@6.0.3_/node_modules/@vueuse/core/dist/index.js" contains an annotation that Rolldown cannot interpret due to the position of the comment.
```

影响判断：

- 该提示来自依赖包 `@vueuse/core` 的构建产物。
- 当前不影响构建成功。
- 不是本次业务代码引入的阻塞错误。

## 验证结果

已执行：

```bash
pnpm build
```

结果：

- 构建成功。
- 类型检查通过。
- 仍存在来自依赖包的 `INVALID_ANNOTATION` 非阻塞提示。

局部诊断检查范围：

- `Canvas.vue`
- `SelectionFrame.vue`
- `useCanvasStore.ts`

结果：

- 未发现本次修改引入的诊断错误。