# canvas-render 开发手册 · vueFlowBridge 与 coalesce（合帧）

> 来源：`packages/canvas-render/src/vueFlowBridge.ts`、`utils/coalesce.ts`、
> 测试 `utils/__tests__/coalesce.test.ts`。

## 一句话

两个工具，一个解决"插件该怎么用 VueFlow"，一个解决"高频连续值别每帧都重算"。

---

## vueFlowBridge —— 内核精选的 VueFlow 出口

### 它解决什么

渲染类插件（主题：节点壳 / 连线 / 背景）需要碰 VueFlow 的少数原语——端口 Handle、方向常量、路径工具、画布实例组合式 + 类型。如果让每个插件自己 `import '@vue-flow/core'`，会多一层依赖，还容易搞出"**多份 @vue-flow 实例**"这种双实例 Bug（两处依赖各自装了一份，provide 对不上）。

所以 render 层把这些成员精选导出一处，插件只需 `import '@mini-canvas/canvas-render'`。

### 导出了什么

```ts
// 运行时原语（re-export，仍指向同一模块实例，不产生新副本）
export { Handle, Position, getBezierPath, useVueFlow } from '@vue-flow/core'
// 类型
export type { EdgeProps, NodeProps } from '@vue-flow/core'
```

- **Handle**：端口组件。
- **Position**：方向常量（Left/Right 等）。
- **getBezierPath**：贝塞尔路径工具。
- **useVueFlow**：实例组合式（拿画布 store：读选中、缩放、删边、订阅事件）。BaseNode 用它读 `viewport.zoom` 做 LOD。
- **EdgeProps / NodeProps**：自定义节点壳 / 自定义边收到的引擎 props 类型（起点终点坐标、选中、动画等）。

> 它 **不 `export *` 整库**——只精选插件真正会用到的成员，避免把第三方库变成内核的"泄漏门面"。
> 需要完整 VueFlow（宿主 demo 预览页自 mount `<VueFlow>`）时仍直接 import `@vue-flow/core`，不走这里。

### 插件里怎么用

```ts
// plugin-theme-default/src/BaseNode.vue
import { useVueFlow, Position } from '@mini-canvas/canvas-render'
const vf = useVueFlow()
const zoom = computed(() => Math.max(vf.viewport.value?.zoom || 1, 0.01))
```

```ts
// 自定义边 / 自定义壳：收到 EdgeProps / NodeProps
import type { EdgeProps } from '@mini-canvas/canvas-render'
const props = defineProps<EdgeProps>()
```

---

## coalesce —— 高频值"合帧"工具

### 它解决什么

颜色/滑块的 `@input` 每动一格就调一次 `settings.set`，若每次 set 都立即触发一次重绘，高频拖动就会每帧重算全图。合帧器把**同一帧内的多次提交合并成一帧一次**（每 key 只保留最后一次），实时但不每帧算全图。目标是对齐内核性能约束③。

### 类型与调度器

```ts
type CoalesceScheduler = (flush: () => void) => unknown

rafScheduler(flush)        // 默认：requestAnimationFrame；无 rAF(SSR/测试)回落 setTimeout 0
manualScheduler(queue)     // 手动：调用方手动 flush（测试用，把 N 次提交合成 1 次）
```

### createCoalescer

```ts
export function createCoalescer(
  apply: (pairs: Array<[string, unknown]>) => void,
  scheduler: CoalesceScheduler = rafScheduler,
): {
  push(key: string, value: unknown): void
  flush(): boolean          // 手动立即冲刷（不排队）；返回是否冲刷了东西
  dispose(): void           // 取消未跑的定时器、清空
}
```

- `push(key, value)`：把该 key 的最新值暂存；到帧尾一次性把暂存的全部 `[key, value]` 交给 `apply`。**帧内同 key 只保留最后一次**。
- 浏览器默认用 rAF；Node 测试可用 `manualScheduler` 把多次 push 合成一次 flush。

### 用法示例

```ts
import { createCoalescer } from '@mini-canvas/canvas-render'

// 每次颜色变化我们只希望"一帧应用一次"落到 settings.set
const coalescer = createCoalescer((pairs) => {
  for (const [key, value] of pairs) settings.set(key, value)
})

// 滑块拖动：每 tick 调 push，同一帧内同一 key 只留最后一次
onInput(e) { coalescer.push('edgeColor', e.target.value) }
// rAF 到帧尾 → apply 一次收到最新 [['edgeColor', '#xx']]

// 页面离开前手动冲刷，避免最后一帧未落
onUnmounted(() => { coalescer.flush(); coalescer.dispose() })
```

测试用手动调度器把多次提交合成一次：
```ts
const queue: Array<() => void> = []
const c = createCoalescer(apply, manualScheduler(queue))
c.push('a', 1); c.push('a', 2)      // 同 key 只留最后
c.push('b', 3)
queue[0]!()                          // 手动 flush 一次 → apply([['a',2],['b',3]])
```

---

## 坑

1. **合帧只改变"应用时机"，不改"入库时机"**：SettingsStore 的 set 仍是同步入库、同步广播；真正合帧应用由消费方（主题）用 createCoalescer 做，避免每帧全图重建。
2. **dispose 要记得调**：若用 setTimeout 兜底（无 rAF 环境），不 dispose 会留下未跑回调。
3. **vueFlowBridge 只精选成员**：别指望它导出整个 @vue-flow/core；要完整 VueFlow（自己 mount）走直接 import。
4. **跨包类型增强**：BaseNode 里 `useVueFlow` 从 `@mini-canvas/canvas-render` 拿，别从两个不同来源 import @vue-flow，否则双实例。
