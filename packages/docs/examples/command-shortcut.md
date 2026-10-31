# 案例 3 · 命令与快捷键（mod+m 式）

想让某个动作能被快捷键、菜单、面板同时触发？用 `ctx.commands.register` 注册一条命令
（带 `keys` 快捷键），把"能不能执行"放进一个**响应式服务状态**里 —— 命令、面板、宿主
读同一个对象，谁改都立刻一致。真实参照是小地图插件：`mod+m` 切换显隐，设置面板开关、
状态栏按钮、快捷键三条路都写同一个 `visible`。

## 这个案例能做到什么

装上后你会看到：画布右上角一个小徽标，写着"已放大/已缩小"；按 `Ctrl+M`（Mac 上
`Cmd+M`）在两种状态间切换，徽标跟着变 —— 因为徽标和命令读的是同一个响应式对象。
再往设置面板加一个开关也读这个对象的话，徽标、开关、快捷键三处永远同步（小地图就是这样做的：
快捷键、⚙ 面板开关、状态栏按钮三个入口共用一个 `visible`）。

## 完整代码

目录就这几个文件：

    my-zoom-toggle/
    ├── package.json            # 插件清单
    └── src/
        ├── index.ts            # 插件入口：上架服务状态 + 与 settings 双向同步 + 注册命令
        └── ZoomBadge.vue       # 读服务状态的小徽标（纯展示）

```json
// 文件：my-zoom-toggle/package.json
// 插件清单：元信息段照抄 mini-map 的写法
{
  "name": "my-zoom-toggle",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "缩放切换",
    "description": "Ctrl/Cmd+M 切换画布放大/缩小状态",
    "pluginName": "my-zoom-toggle",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": "./src/*"
  },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*"   // 命令/服务注册都在这层
  },
  "peerDependencies": {
    "@mini-canvas/canvas-render": "workspace:*", // ZoomBadge.vue 要 useCanvasRender
    "vue": "^3.5.34"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vue": "^3.5.34"
  }
}
```

```ts
// 文件：my-zoom-toggle/src/index.ts
// 插件入口：上架一个响应式服务状态 + 注册一条带快捷键的命令
import { reactive } from 'vue'  // reactive：把普通对象变成响应式，读它的组件自动更新
import type { Context, PluginModule } from '@mini-canvas/canvas-base'

// ① 服务状态形状：一个字段 zoomed。命令、徽标、（将来的）面板都读它 —— 单一事实源
export interface ZoomServiceState {
  zoomed: boolean
}

export const name = 'my-zoom-toggle'
export const inject = [] as string[]  // 只动自己的状态，不读写画布数据，无需硬依赖

// ② 上架服务：全画布任何地方 ctx.get('my-zoom') 都拿到同一个 reactive 对象。
//    服务名可以带连字符（'file-drop'/'mini-map' 都是这么命名的）
function provideZoomState(ctx: Context): ZoomServiceState {
  const state: ZoomServiceState = reactive({ zoomed: false })
  ctx.inject('my-zoom', state)
  return state
}

// ③ 可选：与 ⚙ 设置面板双向同步（小地图同款做法）。
//    settings 服务是可选的（没装配设置面板的宿主也能用快捷键），所以 tryGet 探测而不是写进 inject
function syncWithSettings(ctx: Context, state: ZoomServiceState): void {
  const settings = ctx.tryGet<{
    get(k: string): unknown
    set(k: string, v: string | number | boolean): boolean
    onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
  }>('settings')
  if (!settings) return

  // 方向一（面板 → 状态）：装配时先读一次已保存的值；之后面板 set → onChange 写回状态
  // （get 对未登记键返回 undefined 不抛错；typeof 校验同时挡掉这种情况）
  const saved = settings.get('myZoomed')
  if (typeof saved === 'boolean') state.zoomed = saved
  const off = settings.onChange((key, v) => {
    if (key === 'myZoomed' && typeof v === 'boolean') state.zoomed = v
  })
  // 手动清理：settings 是宿主级服务、活得比插件久，监听不随插件 scope 自动回收
  ctx.effect(() => () => off.dispose())

  // 方向二（状态 → 面板）的发送端，在命令 run 里调：命令切换 → 写回 settings → 面板开关跟着变。
  // set 对未登记键会抛错，包 try/catch（想正经登记键用案例 4 的 Config schema）
  ;(state as { _sync?: (v: boolean) => void })._sync = (v: boolean) => {
    try { if (settings.get('myZoomed') !== v) settings.set('myZoomed', v) } catch { /* 未登记键 */ }
  }
}

// ④ 注册命令：id 全局唯一；keys 是快捷键；run 是按下/调用时执行的函数
function registerToggleCommand(ctx: Context, state: ZoomServiceState): void {
  ctx.commands.register({
    id: 'my-zoom:toggle',        // 习惯用 "插件名:动作"，天然防撞名
    title: '切换画布缩放',         // 菜单/快捷键帮助面板会显示
    keys: ['mod+m'],             // mod = Ctrl（Windows）或 Cmd（Mac），内核统一处理
    order: 80,                   // 同键冲突时 order 小的赢；不是抢手键可以不写
    run: () => {
      state.zoomed = !state.zoomed  // ⑤ 只改服务状态，不直接改 UI —— UI 自己会跟着变
      // 双向同步的另一半：把新值推回 settings（面板开关跟着变；随 save.settings 持久化）
      ;(state as { _sync?: (v: boolean) => void })._sync?.(state.zoomed)
    },
  })
}

// ⑥ 装配：先上架服务、再同步 settings、最后注册命令
export function apply(ctx: Context): void {
  const state = provideZoomState(ctx)
  syncWithSettings(ctx, state)
  registerToggleCommand(ctx, state)
}

// 兼容旧装配的出口（宿主 :plugins=[...] 用，与裸导出等价）
export const zoomTogglePlugin: PluginModule = { name, inject, apply }
```

```vue
<!-- 文件：my-zoom-toggle/src/ZoomBadge.vue -->
<!-- 读服务状态的徽标：演示"状态一变 UI 就变"，宿主不用写任何同步代码 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { ctx } = useCanvasRender()

// tryGet：没装本插件时返回 undefined，徽标直接不渲染（不报错）
const state = ctx.tryGet<{ zoomed: boolean }>('my-zoom')
const label = computed(() => (state?.zoomed ? '已放大' : '已缩小'))
</script>

<template>
  <div v-if="state" class="badge">{{ label }}（Ctrl/Cmd+M 切换）</div>
</template>

<style scoped>
.badge { position: absolute; right: 12px; top: 12px; padding: 2px 8px;
  border-radius: 6px; background: rgb(0 0 0 / 0.55); color: #fff; font-size: 12px; }
</style>
```

## 每一步在干什么

**① 服务状态只有一个字段。** 状态越少越容易保证一致。往里加字段（比如"徽标可见性"）也行，
但每个字段都要有唯一主人 —— 命令改它、别的读它，别在两处各存一份。小地图的服务状态就一个
`visible`，所有消费方（命令、面板、宿主状态栏按钮）都读它。

**② `ctx.inject('my-zoom', state)` 上架服务。** `state` 用 `reactive` 包住：它是同一个对象
被所有消费方引用，命令改 `zoomed`，读它的 computed/模板立即重算。不包 reactive = 徽标看不到变化
（普通 JS 对象改属性不触发 Vue 更新）。卸载时服务自动从服务表摘除，不用你撤销。

**③ 与 settings 双向同步（可选，小地图同款）。** 三条路（快捷键、面板开关、状态栏按钮）要一致，
得让"改状态"只有一个入口、其余都同步到它。小地图的做法：`settings.onChange` 收面板的改动写回
状态；命令 run 里调 `syncVisibleToSettings` 把改动推回面板。注意两点：settings 服务是**可选的**
（没装配设置面板的宿主照样能用快捷键），所以 `tryGet` 探测、不写进 inject；settings 服务活得比
插件久，它的 `onChange` 句柄要自己 `ctx.effect` 包着清（只有插件自己注册的东西才随 scope 自动回收）。
示例里未登记的键 `set` 会抛错（`get` 只返回 undefined），包了 try/catch —— 想正经登记键用
案例 4 的 Config schema。

**④ `commands.register` 带 `keys`。** 快捷键不是插件自己 `addEventListener('keydown')` ——
渲染层 CanvasHost 统一绑 keydown、调 `findCommandByKeys` 按命令列表分发（见真实出处表）。
插件零 DOM 代码，卸载时命令随 scope 自动注销，按键自动失效。语法：`mod` = `ctrl` 或 `meta`
任一（跨平台）；主键大小写不敏感；`when` 条件不满足的命令让位；同键冲突时 `order` 小的赢。

**⑤ run 只改状态。** 命令是"动作"，UI 是"状态的样子"。run 里直接改 DOM 会和 Vue 的响应式
打架，卸载时还会残留。run 的返回值会原样传回 `execute(id, ...)` 调用方 —— 想返回结果就注释清楚。

**⑥ apply 顺序：先服务、再同步、后命令。** 语义上"先有状态、再有同步、后有动作"。内核不强求
顺序，但保持这个习惯，读代码的人不用猜。

**想手动触发命令？** `ctx.get('canvas').runCommand('my-zoom:toggle')` —— 快捷键、菜单、右键、
宿主按钮都走这一条路。内核预注册了 `command:delete`（数据层），渲染层分发的也是这套；你自己
的命令注册后自动进入同一个列表，快捷键帮助面板会把它列出来。

**CommandDef 常用字段速查**（全部见 `packages/kernel/src/command.ts:12`）：

| 字段 | 必填 | 作用 |
| --- | --- | --- |
| `id` | 是 | 全局唯一标识，撞名抛错 |
| `run(ctx, ...payload)` | 是 | 执行体；payload 来自 `execute(id, …)` 的后续参数 |
| `title` | 否 | 菜单/快捷键面板显示的名称 |
| `keys` | 否 | 快捷键（如 `['mod+m']`）；宿主统一绑键分发 |
| `when` | 否 | 使能条件；false 时 execute 空转、同键命令让位 |
| `order` | 否 | 同键冲突时越小越优先；不写视作最后 |
| `icon`/`group`/`areas` | 否 | 菜单/工具栏插件的展示元数据 |

一次按键从"按下"到"执行"的完整链路：

    用户按下 Ctrl+M
      → CanvasHost 的 window keydown 监听收到事件
        → findCommandByKeys(命令列表, 事件, ctx) 找命中的命令
          （keys 匹配 + when 满足 + order 最小）
            → execute(id) → 你的 run(ctx) 执行 → 改 state.zoomed
              → 徽标（读同一 reactive 对象）自动重渲染

你在插件里写的只有"注册命令"和"改状态"两件事，其余全是宿主的。

## 仓库里的真实出处

| 真实文件 | 对应示例 | 行为 |
| --- | --- | --- |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:36` | 步骤 ② | `const state = reactive({ visible: initial.miniMapVisible })` + `ctx.inject('mini-map', state)` —— 服务状态 = 单一事实源 |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:43` | 面板 → 状态同步 | `settings.onChange((key, v) => { if (key === 'miniMapVisible' …) state.visible = v })`：设置面板改开关也写回同一状态 |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:49` | 状态 → 面板同步 | `syncVisibleToSettings(v)`：命令切换后把新值写回 settings，面板开关跟着变（两个方向都通） |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:63` | 步骤 ④ | `ctx.commands.register({ id: 'mini-map:toggle', title: '切换小地图', keys: ['mod+m'], order: 80, icon: 'minimap', … })` |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:71` | 步骤 ⑤ | `run: () => { state.visible = !state.visible; syncVisibleToSettings(state.visible) }` |
| `packages/kernel/src/command.ts:12` | CommandDef 全字段 | `{ id, title?, run, keys?, when?, icon?, order?, … }` —— 快捷键只是命令上一个可选字段 |
| `packages/kernel/src/command.ts:162` | `mod` 语义 | `mod = ctrl 或 meta 任一（跨平台）`，主键大小写不敏感 |
| `packages/kernel/src/command.ts:207` | 同键冲突规则 | `when 不满足 = 让位`；`order 小的赢`（越小越优先） |
| `packages/canvas-render/src/host/CanvasHost.vue:941` | 快捷键分发端 | `findCommandByKeys(h.command.list(), e, h.ctx)` —— 渲染层统一分发，插件不自己绑 keydown |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:55` | 专用槽（配套） | 小地图本体注册在 `mini-map` 专用槽；`visible` 为 false 时组件自己隐藏 —— 显隐不靠卸载插件 |

## 常见坑

- **别自己 `window.addEventListener('keydown', …)`**。宿主统一分发命令快捷键；你自己绑会和宿主
  抢事件（输入框打字、别的插件命令都可能被你拦掉），卸载还得自己清理。正确做法：把按键写进命令的
  `keys`，分发交给宿主。
- **服务状态不用 reactive = UI 不更新**。命令改了 `state.zoomed`，但徽标读的是普通 JS 对象，
  Vue 不知道它变了。所有"多处共享"的状态都要 `reactive` 包住再 `ctx.inject`。
- **命令 id 撞名会响亮抛错**。内核 CommandRegistry 对重复 id 抛错，装配失败、插件进 FAILED。
  用 `插件名:动作` 命名（`my-zoom:toggle`）就不怕撞。
- **两个方向的同步都要写**。只写"面板改 → 状态变"不写"命令改 → 面板变"，用户按快捷键后
  面板开关和实际状态对不上。mini-map 两个方向都写了：`settings.onChange` 收面板的改动，
  `run` 里调 `syncVisibleToSettings` 把改动推回面板。
