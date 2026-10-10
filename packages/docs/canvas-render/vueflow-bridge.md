
# vueFlowBridge 与 coalesce

**一句话定位**：**`vueFlowBridge` 是「渲染类插件从本包拿 VueFlow 原语」的唯一出口；`coalesce` 是「把一帧内几百次提交压成一帧一次」的合帧工具。**

**它属于哪一档**：**渲染层（canvas-render）的两个工具箱**。源码：`packages/canvas-render/src/vueFlowBridge.ts`、`packages/canvas-render/src/utils/coalesce.ts`。

## 它是什么

两件事分开看。

**`vueFlowBridge`：一扇窗。** `@vue-flow/core` 是内核（canvas-render）的依赖，但真正需要用它的是**渲染类插件**：主题插件要 `Handle`（端口）、`Position`（方向常量）、`getBezierPath`（贝塞尔路径）、`useVueFlow`（拿内部 store）、`useConnection`（读拖线现场）。bridge 把插件真正会用到的成员**精选**导出来，插件 import 本包即可。

**`coalesce`：一个节拍器。** 颜色选择器、滑块这类控件每动一下就会提交一次值；如果每次提交都立刻触发一次重绘，拖动时会卡。合帧器把同一个 key 在一帧内的多次提交合并成**一帧一次**（取最后一次的值）。

## 为什么需要它

### 为什么不让每个插件自己 import `@vue-flow/core`

**双实例问题**。项目里 `@vue-flow/core` 同时是 `canvas-render` 的 peerDependency / devDependency，也是 `canvas-render` 的运行时依赖。如果每个插件各自 `import '@vue-flow/core'`，一旦依赖树里出现两份副本（版本区间不同、或打包器去重规则不一致），就会出现：

- 插件 import 到的 `useVueFlow()` 是**第二份实例**，读不到宿主那份内部状态（`getNodes` 为空、`updateNode` 无效果）；
- 现象极具迷惑性：**代码没错、运行不报错、就是不生效**。

从 bridge 统一 import，指向的仍是 `canvas-render` 里那**同一份模块实例**（re-export 不产生新副本），从结构上杜绝这一类 bug。

### 为什么不干脆 `export *`

源码注释写得很明确：**只精选插件真正会用到的成员，不整库转发** —— 否则本包会变成第三方库的「泄漏门面」：VueFlow 升一个大版本，把它的整张 API 面都变成你必须兼容的契约。

需要完整 VueFlow 的场景（例如宿主自己 mount 一个 `<VueFlow>` 做预览页）仍然直接 `import '@vue-flow/core'` —— 那条路不受这套边界约束。

### coalesce 解决什么

具体场景（真实代码）：默认设置皮里的 `SettingsSchemaField.vue` 用 `createCoalescer` 提交设置值 —— 滑块的连续拖动每帧都在写 `settings.set`，合帧之后一帧只写一次，**实时但每帧不重算全图**。

还有一个**必须存在的兜底**：页面切到后台 / 标签页不可见 / 无头环境时，`requestAnimationFrame` 会暂停。如果只靠 rAF 合帧，那些提交就会**永远不落地**（用户看到「设置项拖了没反应」）。所以 `createCoalescer` 每 push 一次还会挂一个最大等待计时器（默认 120ms）：rAF 正常时先到先 flush（行为不变，仍是每帧一次）；rAF 被暂停时由计时器保底提交，值不会丢。

## 怎么用

### 一、vueFlowBridge 导出了什么（源码逐字核过）

**运行时原语**（4 个 + 1 个）：

| 导出 | 从哪来 | 干什么 |
| --- | --- | --- |
| `Handle` | `@vue-flow/core` | 端口组件（节点两端的小圆点就是它渲染的） |
| `Position` | `@vue-flow/core` | 端口方向常量（`Left` / `Right` / `Top` / `Bottom`） |
| `getBezierPath` | `@vue-flow/core` | 算贝塞尔路径字符串（自定义边用） |
| `useVueFlow` | `@vue-flow/core` | 拿 VueFlow 实例 / 内部 store（读选中、缩放、删边、订阅事件） |
| `useConnection` | `@vue-flow/core` | 只读「拖线现场」的最轻口（`startHandle` / `endHandle` / `status` / `position`） |

**类型**：

| 导出 | 用途 |
| --- | --- |
| `EdgeProps` / `NodeProps` | 自定义边 / 自定义节点壳收到的引擎 props（起点终点坐标、选中、动画等都在里面） |
| `ConnectionLineProps` | 拖线临时线组件收到的 props |
| `OnConnectStartParams` | `connect-start` 事件的参数形状 |
| `Connection` / `ConnectionMode` / `ConnectionStatus` / `ConnectionLineType` | 连接的形状与两种模式 / 状态 / 线型枚举 |
| `HandleElement` / `ConnectingHandle` | 端口元素 / 正在连的端口 |
| `ValidConnectionFunc` | `is-valid-connection` 回调的类型 |

```ts
// 文件：某渲染类插件（例如自定义节点壳）里的 import
// 格式：TypeScript / Vue 单文件组件的 script 段
// 位置：插件源码 —— 一切都从 canvas-render 走，不直接 import @vue-flow/core
import { Handle, Position, type NodeProps } from '@mini-canvas/canvas-render'

const props = defineProps<NodeProps>()   // ① 引擎给的 props（id / type / data / selected …）
```

真实对照（谁在用 bridge）：`packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue`（`Handle` / `Position` / `NodeProps`）、`.../node/MovingHandle.vue`、`.../edge/CustomEdge.vue`。

### 二、`createCoalescer` 的签名与用法

```ts
// 源码：packages/canvas-render/src/utils/coalesce.ts
export type CoalesceScheduler = (flush: () => void) => unknown

export function rafScheduler(flush: () => void): unknown          // 默认调度：requestAnimationFrame；无 rAF 时回落 setTimeout(0)
export function manualScheduler(queue: Array<() => void>): CoalesceScheduler  // 手动调度：测试用，把 N 次合并成 1 次

export function createCoalescer(
  apply: (pairs: Array<[string, unknown]>) => void,   // 帧尾一次性把暂存的 (key, value) 全部交给它
  scheduler: CoalesceScheduler = rafScheduler,
  maxWaitMs = 120,                                    // rAF 保底等待；传 Infinity 可完全禁用保底
): {
  push(key: string, value: unknown): void   // 暂存该 key 的最新值（同 key 覆盖，帧内只留最后一次）
  flush(): boolean                          // 手动立即冲刷（不排队）；返回是否真的冲刷了东西
  dispose(): void                            // 取消待处理的帧与计时器（组件卸载时必须调）
}
```

```ts
// 文件：某设置项组件的 script 段（真实写法见 packages/plugins/plugin-theme-default/src/components/settings/SettingsSchemaField.vue）
// 格式：Vue 单文件组件 script setup
// 位置：插件里的设置控件 —— 连续拖动值不要每次都写 store
import { onBeforeUnmount } from 'vue'
import { createCoalescer } from '@mini-canvas/canvas-render'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'

const props = defineProps<{ settings: SettingsPanelSource; fieldKey: string }>()

// ① 建合帧器：一帧内的多次 push 合并成一次批量 apply
const coalescer = createCoalescer((pairs) => {
  for (const [k, v] of pairs) props.settings.set(k, v as string | number | boolean)
})
onBeforeUnmount(() => coalescer.dispose())   // ② 组件卸载必须回收（否则残留待办会继续跑）

function onInput(value: number) {
  coalescer.push(props.fieldKey, value)      // ③ 拖动中每帧调用都安全：同 key 只留最后一次
}

function onCommit(value: number) {
  coalescer.push(props.fieldKey, value)
  coalescer.flush()                          // ④ 松手：立刻冲刷，值马上落地（不等下一帧）
}
```

### 三、测试里怎么用（可预测地推进合帧）

`manualScheduler` 让「什么时候 flush」由测试自己控制，于是合帧行为可以被断言（真实测试：`packages/canvas-render/src/utils/__tests__/coalesce.test.ts`）：

```ts
// 文件：src/__tests__/coalesce.test.ts（节选）
// 格式：TypeScript 测试模块（vitest）
// 位置：验证「同 key 只留最后一次」「不同 key 一起提交」「dispose 后不再提交」
import { expect, it } from 'vitest'
import { createCoalescer, manualScheduler } from '@mini-canvas/canvas-render'

it('一帧内多次 push 合并成一次 apply', () => {
  const applied: Array<Array<[string, unknown]>> = []
  const queue: Array<() => void> = []
  const c = createCoalescer((pairs) => applied.push(pairs), manualScheduler(queue))

  c.push('a', 1)          // ① 三次 push，同一个 key
  c.push('a', 2)
  c.push('a', 3)
  expect(applied).toHaveLength(0)   // ② 还没到帧尾：一次都没提交

  queue.forEach((f) => f())         // ③ 手动推进一帧
  expect(applied).toEqual([[['a', 3]]])   // ④ 只提交了最后那次的值
})
```

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/canvas-render/src/index.ts` | `export * from './vueFlowBridge'`（精选出口在这里汇总）+ 导出 `createCoalescer` / `rafScheduler` / `manualScheduler` / `CoalesceScheduler` |
| `packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue` | 从本包 import `Position` / `NodeProps` 等（端口方向、引擎 props 类型） |
| `packages/plugins/plugin-theme-default/src/components/node/MovingHandle.vue` | 浮动端口的实现（`Handle` / `Position`） |
| `packages/plugins/plugin-theme-default/src/components/edge/CustomEdge.vue` | 自定义边（`getBezierPath` 系列几何在插件本地的 `edgeGeometry.ts`，props 类型从本包来） |
| `packages/plugins/plugin-theme-default/src/components/settings/SettingsSchemaField.vue` | `createCoalescer` 的真实生产用法（滑块 / 颜色拖动合帧提交） |
| `packages/canvas-render/src/utils/__tests__/coalesce.test.ts` | 合帧器的行为测试（用 `manualScheduler` 同步推进） |

## 完整例子

一个**可运行的小实验**：一个自带合帧的「缩放记录器」插件 —— 它订阅视口变化，把高频的缩放值合帧后写进内核配置，并在设置里显示当前值。

### 目录长这样

```
plugin-zoom-logger/
├── package.json            # 插件清单
└── src/
    ├── index.ts            # 插件入口：合帧器 + 视口订阅 + 一条命令
    └── ZoomReadout.vue     # overlay 槽上的小角标：显示「已记录的缩放」
```

（这一篇的例子是单文件插件，正文就是全部内容，照抄即可。）

### 文件一：清单

```json
// 文件：plugin-zoom-logger/package.json
// 格式：JSON（npm 包清单）
// 位置：插件包根目录
{
  "name": "plugin-zoom-logger",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "缩放记录器",
    "description": "演示 coalesce：视口高频变化合帧后写设置",
    "pluginName": "zoom-logger",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "dependencies": { "@mini-canvas/canvas-base": "workspace:*" },
  "peerDependencies": { "@mini-canvas/canvas-render": "workspace:*", "vue": "^3.5.34" }
}
```

### 文件二：插件入口

```ts
// 文件：plugin-zoom-logger/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { createCoalescer, RenderEvents } from '@mini-canvas/canvas-render'
import ZoomReadout from './ZoomReadout.vue'

export const name = 'zoom-logger'
export const inject = ['viewport', 'settings'] as string[]   // ① 硬依赖：视口服务 + 配置源

export function apply(ctx: Context): void {
  // ② 声明一项配置，用来存「最后一次记录的缩放」
  ctx.settings.define('缩放记录器', {
    zoomLoggerLast: { type: 'number', default: 1, min: 0.05, max: 4, step: 0.01, label: '最后一次缩放' },
  })

  // ③ 合帧器：一帧内多次写完，实际只 set 一次（值取最后一次）
  const flushZoom = createCoalescer((pairs) => {
    for (const [key, value] of pairs) ctx.settings.set(key, value as number)
  })
  // 卸载时回收：插件作用域一停，待办的帧与计时器都要清掉
  ctx.effect(() => () => flushZoom.dispose())

  // ④ 视口移动事件由渲染宿主广播（画布每次平移/缩放都会发），这里合帧后再落设置
  ctx.effect(() => {
    const off = ctx.on(RenderEvents.MoveEnd, (payload) => {
      const zoom = (payload as { viewport?: { zoom?: number } } | undefined)?.viewport?.zoom ?? 1
      flushZoom.push('zoomLoggerLast', zoom)   // 高频路径：push 即可，帧尾统一提交
    })
    return () => off.dispose()
  })

  // ⑤ 往 overlay 槽挂一个小角标，让人看得到记录值
  ctx.slots.register('overlay', {
    id: 'zoom-logger/readout',
    order: 30,
    component: ZoomReadout,
  })

  // ⑥ 命令：手动立即写一次（演示 flush 的用法）
  ctx.commands.register({
    id: 'zoom-logger:commit',
    title: '立刻记录当前缩放',
    run() {
      const vp = ctx.get<{ getViewport(): { zoom: number } }>('viewport')
      flushZoom.push('zoomLoggerLast', vp.getViewport().zoom)
      flushZoom.flush()   // 不等帧尾，马上落地
      return true
    },
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const zoomLoggerPlugin: PluginModule = { name, inject, apply }
```

### 文件三：小角标组件

```vue
<!-- 文件：plugin-zoom-logger/src/ZoomReadout.vue
     格式：Vue 单文件组件（挂在 overlay 槽）
     位置：插件包内部；只读配置 + 只读视口 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { ctx, flow } = useCanvasRender()

// ① 内核配置不是响应式的：订阅 onChange + 版本号驱动重渲染
const tick = ref(0)
let off: { dispose(): void } | undefined
onMounted(() => {
  const settings = ctx.get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')
  off = settings.onChange(() => void (tick.value += 1))
})
onBeforeUnmount(() => off?.dispose())

const recorded = computed(() => {
  void tick.value
  const settings = ctx.get<{ get(key: string): unknown }>('settings')
  return Number(settings.get('zoomLoggerLast') ?? 1)
})
const live = computed(() => flow.viewport.value?.zoom ?? 1)   // ② 实时视口（响应式）
</script>

<template>
  <div class="zl-badge">记录 {{ Math.round(recorded * 100) }}% · 实时 {{ Math.round(live * 100) }}%</div>
</template>

<style scoped>
.zl-badge {
  position: absolute; right: 12px; bottom: 12px; padding: 2px 8px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 12px; pointer-events: none;
}
</style>
```

### 怎么验证

1. 装配后画布右下角出现小角标，形如「记录 100% · 实时 100%」。
2. 滚轮缩放画布：**实时**数字立刻跟手；**记录**数字在移动结束后更新（合帧 + 事件驱动）。
3. 打开设置面板的「缩放记录器」分组：`zoomLoggerLast` 应该就是记录值。
4. 执行命令 `zoom-logger:commit`（控制台：`MiniCanvas.getContext().get('command').execute('zoom-logger:commit')`）：记录值**立刻**变成实时值（这条走 `flush()`，不等帧尾）。

## 常见坑

1. **插件不要直接 `import '@vue-flow/core'`**。要用 `Handle` / `Position` / `getBezierPath` / `useVueFlow` / `useConnection` 或那批类型，全从 `@mini-canvas/canvas-render` 取。自己 import 的代价是「多一份 VueFlow 实例」——现象是「不报错、就是不生效」。
2. **bridge 是精选出口，不是整库转发**。想用的成员不在导出清单里时，先想清楚：它是不是本该走渲染上下文（`useCanvasRender()`）？确实需要更多 VueFlow 能力时，应该往 bridge 里加一条（并说明理由），而不是在插件里偷偷 import。
3. **`dispose()` 必须调**。合帧器会挂着一个 rAF 和一个计时器；组件卸载 / 插件卸载时不 `dispose`，待办回调会在卸载后继续跑（轻则白写一次，重则碰到已经销毁的引用）。
4. **`maxWaitMs` 的兜底不是可选项**。默认 120ms 的意义是：标签页切到后台 / 无头环境里 rAF 会停，只靠 rAF 的合帧会让提交**永远不落地**（用户看到「拖了没反应」）。除非你明确知道不需要，否则别改成 `Infinity`。
5. **合帧是「同 key 只留最后一次」，不是「每次排队」**。想保留每一次的值（例如记录轨迹）不能用它 —— 它明确会丢掉中间值。
6. **`flush()` 是同步的、返回 boolean**。真用来「松手立刻提交」时，写法是 `push(...)` 再 `flush()`：先暂存再冲刷，保证这次的值一定被提交（而不是只冲刷之前攒的）。
