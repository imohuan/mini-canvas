# 案例 2 · 往画布叠 UI（slots 式）

想在画布上多一层浮层、给设置面板加一页？用 `ctx.slots.register`：把一个 Vue 组件
"登记"到某个槽里，宿主渲染那个槽时就会把你的组件画上去。插件卸载时登记自动作废，
你不用写任何清理代码。

## 这个案例能做到什么

装上后你会看到：画布上多一个左下角小浮层（一行字 + 一个"清零"按钮），每点一下画布，
计数 +1；同时 ⚙ 设置面板左侧多出"计数"一项，点进去是本插件自己画的一整页。

本篇一次讲全三个槽：`overlay`（画布浮层，cursor-effect 同款）、`settings.nav` +
`settingsGroup/<id>`（设置面板一整页，也是 cursor-effect 的做法）；最后提一句 `mini-map`
专用槽 —— 宿主想把你放在哪就 `<SlotHost slot="你的槽名" />` 放哪，注册方式完全一样。

## 完整代码

目录就这几个文件：

    my-count-overlay/
    ├── package.json            # 插件清单，声明 miniCanvas 元信息
    └── src/
        ├── index.ts            # 插件入口：往三个槽各登记一个组件
        ├── CountOverlay.vue    # 画布上的浮层
        ├── CountSettingsNav.vue    # 设置面板左侧导航项
        └── CountSettingsPage.vue   # 设置面板"计数"整页

```json
// 文件：my-count-overlay/package.json
// 插件清单：名字、入口、miniCanvas 元信息照抄 mini-map 的写法
{
  "name": "my-count-overlay",        // npm 包名（本地包随意，发 npm 要带 scope）
  "version": "0.0.0",
  "private": true,                    // 仓库内私有包
  "type": "module",                   // 用 ESModule，import 写法与源码一致
  "miniCanvas": {                     // 画布专属元信息：「插件管理」读这里显示/安装
    "title": "画布计数",               // 插件列表里显示的名字
    "description": "点画布计数 +1 的示例浮层", // 一句话说明
    "pluginName": "my-count-overlay",  // 插件名，全画布唯一
    "installable": true                // 允许经「插件管理」安装
  },
  "main": "./src/index.ts",           // 包入口指向源码（workspace 内直接跑 TS）
  "types": "./src/index.ts",
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": "./src/*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"       // 最少脚本：类型检查
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*"  // 插件作者薄入口（kernel + 类型重导出）
  },
  "peerDependencies": {
    "@mini-canvas/canvas-render": "workspace:*", // overlay 组件要用 useCanvasRender
    "vue": "^3.5.34"                              // 组件是 Vue 组件
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vue": "^3.5.34"
  }
}
```

```ts
// 文件：my-count-overlay/src/index.ts
// 插件入口：裸导出 name / inject / apply，往三个槽各登记一个组件
import { markRaw } from 'vue'   // markRaw：告诉 Vue "这是组件定义，别做成响应式"，注册槽必须包
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import CountOverlay from './CountOverlay.vue'          // 画布浮层组件
import CountSettingsNav from './CountSettingsNav.vue'  // 设置面板左导航项
import CountSettingsPage from './CountSettingsPage.vue' // 设置面板"计数"整页

// ① 插件名：全画布唯一，卸载/重装都按这个名字找插件
export const name = 'my-count-overlay'

// ② 硬依赖列表：空数组 = 谁都不依赖。插槽宿主（overlay/settings.nav/settingsGroup）
//    由渲染层/默认皮恒在装配，不需要写进 inject
export const inject = [] as string[]

// ③ 装配函数：内核装载插件时调一次，你在这里"登记"所有东西
export function apply(ctx: Context): void {
  // ④ overlay 槽：画布容器里盖满画布的那层（CanvasSurface 内置）
  //    order 越小越靠外层/优先级越高；id 是同槽内的唯一标识
  ctx.slots.register('overlay', {
    id: 'count-demo/overlay',          // 槽内唯一 id：插件名/条目名（卸载时按它摘除）
    order: 90,                         // 越小越靠前/越外层；写 90 = 放在常用浮层后面
    component: markRaw(CountOverlay),  // 组件本体；markRaw 包住，避免 Vue 把组件定义变响应式
    meta: { title: '画布计数' },        // 可选说明信息，面板/调试工具会读
  })

  // ⑤ settings.nav 槽：设置面板左侧一级导航。meta.group 要用你自定义的分组名，
  //    默认皮按 id 匹配激活态、把 group 传给你的组件
  ctx.slots.register('settings.nav', {
    id: 'count-demo/nav',
    order: 7,
    component: markRaw(CountSettingsNav),
    meta: { title: '计数', group: '计数' },
  })

  // ⑥ settingsGroup/<分组名> 槽：命中导航后右侧的正文。
  //    槽名是动态拼接的 —— 这就是"一页"怎么挂上去的
  //    meta.mode='replace' = 这一页完全由你的组件接管（缺省也是 replace，写了更醒目）
  ctx.slots.register('settingsGroup/' + '计数', {
    id: 'count-demo/page',
    order: 7,
    component: markRaw(CountSettingsPage),
    meta: { mode: 'replace' },
  })
}

// ⑦ 兼容旧装配的出口：宿主用 :plugins=[...] 数组装配时用这个对象，与裸导出等价
export const countOverlayPlugin: PluginModule = { name, inject, apply }
```

```vue
<!-- 文件：my-count-overlay/src/CountOverlay.vue -->
<!-- 画布浮层组件：SlotHost 渲染它时不需要任何 props，自己取 ctx -->
<script setup lang="ts">
import { ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render' // 渲染上下文：拿 ctx 靠它

// 组件必须渲染在 <CanvasHost> 子树内（overlay 槽天然满足），否则这里会抛清晰错误
const { ctx } = useCanvasRender()

const count = ref(0)

// ⑧ ctx.effect(...) 立即执行并记住返回的清理函数，插件卸载时自动调用
//    —— 你不用自己管卸载，但要保证"注册了什么就清理什么"配对
ctx.effect(() => {
  function onClick(e: MouseEvent): void {
    // 只统计点到画布主体（.vue-flow）的点击，浮层/面板上的点击不算
    const el = e.target as HTMLElement | null
    if (el?.closest('.vue-flow')) count.value += 1
  }
  window.addEventListener('click', onClick, true) // 捕获阶段：比画布内部 stopPropagation 更早
  return () => window.removeEventListener('click', onClick, true) // ⑧ 的清理：与 add 配对
})
</script>

<template>
  <!-- 位置/外观都在这个根元素上写：SlotHost 不包任何容器，你写啥样就是啥样 -->
  <div class="my-count-overlay">
    <span>点了 {{ count }} 次</span>
    <button @click="count = 0">清零</button>
  </div>
</template>

<style scoped>
.my-count-overlay {
  position: absolute;       /* overlay 容器是盖满画布的 absolute 层，你在里面再摆自己的位置 */
  left: 16px;
  bottom: 16px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgb(255 255 255 / 0.9);
  font-size: 13px;
  pointer-events: auto;     /* 必写：overlay 容器是 pointer-events:none，不写这个按钮点不了 */
}
</style>
```

```vue
<!-- 文件：my-count-overlay/src/CountSettingsNav.vue -->
<!-- 设置面板左侧导航项：面板会传 { group, active, onSelect }，点击时调 onSelect(group) -->
<script setup lang="ts">
defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>()
</script>

<template>
  <button class="nav" :class="{ active }" @click="onSelect && onSelect(group)">
    <span>计数</span>
  </button>
</template>

<style scoped>
.nav { display: flex; align-items: center; width: 100%; min-height: 44px;
  padding: 6px 10px; border: 0; border-radius: 10px; background: transparent;
  font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
.nav.active { background: rgb(8 145 178 / 0.12); color: #0e7490; }
</style>
```

```vue
<!-- 文件：my-count-overlay/src/CountSettingsPage.vue -->
<!-- 设置面板"计数"整页（mode: replace = 这一页全归你画）。settings 服务的最小用法 -->
<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { ctx } = useCanvasRender()

// ⑨ tryGet：可选服务探测，缺了返回 undefined 不抛错（页面还能显示，只是存不了值）
const settings = ctx.tryGet<{ get(k: string): unknown; set(k: string, v: string | number | boolean): boolean }>('settings')

const lastAt = ref((settings?.get('myCountLastAt') as string) ?? '')
// get 对未登记的键返回 undefined（不抛错），?? 兜成空串

// ⑩ 面板写值：set 同步写回 store，随 settingsPersist 自动持久化。
//    注意：未登记键 set 会抛错（get 只返回 undefined），所以 set 要 try/catch 兜底
function saveTime(): void {
  const now = new Date().toLocaleTimeString()
  lastAt.value = now
  try { settings?.set('myCountLastAt', now) } catch { /* 未登记键：跳过 */ }
}

// 组件级监听要自己清（onBeforeUnmount）；插件级注册则用 ctx.effect，卸载自动回收
// （这里用 onChange 演示"设置变了立刻读回"；ctx.settings 糖的第一参是作用域，空串 = 只收全局广播）
const off = settings?.onChange('', (key, v) => {
  if (key === 'myCountLastAt') lastAt.value = String(v)
})
onBeforeUnmount(() => off?.dispose())
</script>

<template>
  <div class="page">
    <p>这一页完全由本插件自己画（mode: replace）。</p>
    <button @click="saveTime">记下此刻</button>
    <p v-if="lastAt">上次记录：{{ lastAt }}</p>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 12px; padding: 16px; font-size: 13px; }
</style>
```

## 每一步在干什么

**① name / inject / apply 裸导出。** 内核认这三样：name 是全画布唯一标识，inject 是硬依赖清单
（空数组 = 谁都不依赖），apply 是装配函数。注意别把渲染槽写成依赖 —— `overlay`/`settings.nav`
这些是"槽名"不是服务名，写进 inject 插件会因缺这个"服务"永远等着（PENDING 不跑）。

**② `slots.register('overlay')` 放画布浮层。** overlay 槽由渲染层 CanvasSurface 内置渲染，
插件只管往里放组件。`order` 越小越靠前（越靠外层）；不写 order 排最后。`id` 是同槽内唯一标识，
插件卸载时内核按它摘除你的条目。光标特效插件用 45，示例用 90 —— 数值本身无所谓，相对大小才重要。

**③ `slots.register('settings.nav')` 放左导航项。** `meta.group` 是"你要接管的分组名"（示例用"计数"）。
默认皮读 `settings.nav` 槽的全部条目，把 `group`、`active`（是否选中）、`onSelect`
（点击回调）传给你的组件 —— 你在组件里 `defineProps` 接住这三个，点击时调 `onSelect(group)`。

**④ `slots.register('settingsGroup/计数')` 放正文页。** 槽名拼了导航 id，命中导航后默认皮把
右侧内容区交给你的组件。`meta.mode` 缺省就是 `replace`（整组接管）；想"默认控件上面/下面"
添一块自己的 UI，用 `prepend`/`append`，schema 控件还在。

**⑤ PluginModule 出口。** 宿主按数组装配时用这个对象（`:plugins="[countOverlayPlugin]"`），
与裸导出等价。忘了也能跑（裸导出仍在），但写上是仓库惯例。

**⑥ `ctx.effect` 包 window 监听。** effect 立即执行、记住返回的清理函数、插件卸载时自动调用。
不清理 = 卸载后 window 上还挂着死监听：内存泄漏 + 组件卸了计数还在涨。只统计 `el?.closest('.vue-flow')`
里的点击，是为了不把面板/浮层上的点击也算进"画布点击"。

**⑦ `tryGet('settings')` + `set`。** 设置面板自绘页直接读写内核 settings 服务。注意：
没登记过的键 `get` 返回 undefined、`set` 会抛错（"not defined. Define it first"），所以 set 用
try/catch 兜底。想正经登记自己的键（带默认值、有类型约束、自动持久化），用案例 4 的 Config schema。

**专用槽是怎么回事（mini-map 同款）。** `overlay` 是渲染层"认识"的通用槽；你也可以发明自己的
槽名，比如小地图插件就注册在 `mini-map` 槽。区别只在消费端：宿主想在哪个位置显示它，就在哪个
位置写 `<SlotHost slot="mini-map" />`（成品 UI 写在 App.vue 里，紧跟状态栏按钮）。插件侧的
注册代码一行不用变。想做一个"宿主自选位置"的部件，就学这个模式。

顺带一提：设置面板还有第四个槽 `settings.tab`（二级页签），语义和 `settings.nav` 对称 ——
id 首段 = 当前一级名，面板同样传 `{ group, active, onSelect }`。想在一页里做自己的页签切换，
用它（见 `PluginSettingsContent.vue` 顶部注释的三套插槽说明）。

一条注册从"你写"到"用户看见"的完整链路（以 overlay 为例）：

    apply(ctx) 里 ctx.slots.register('overlay', …)
      → 内核存进 slot/overlay 注册场（随插件 scope 记账）
        → CanvasSurface 模板里的 <SlotHost slot="overlay" /> 读 occupants('overlay')
          → 按 order 排序逐个 <component :is> 渲染
            → 插件卸载 → scope 清理 → 注册场摘条目 → SlotHost 收到事件重读 → 组件消失

中间任何一环断了（槽名错、宿主没渲染这个槽、order 撞了）都表现为"看不见"，不报错 ——
这就是常见坑里让你先去宿主源码搜 `SlotHost slot=` 的原因。

## 仓库里的真实出处

| 真实文件 | 对应示例 | 行为 |
| --- | --- | --- |
| `packages/plugins/plugin-cursor-effect/src/index.ts:40` | 步骤 ④ | `ctx.slots.register('overlay', { id: 'cursor-effect-overlay', order: 45, component: markRaw(CursorEffectOverlay), meta })` |
| `packages/plugins/plugin-cursor-effect/src/index.ts` | 步骤 ⑤ | `settings.nav` 注册，id 为 `cursor-effect/nav`，meta.group = 光标，order 7 |
| `packages/plugins/plugin-cursor-effect/src/index.ts:54` | 步骤 ⑥ | `'settingsGroup/' + CURSOR_NAV_ID`，`meta: { mode: 'replace' }` 整页自绘 |
| `packages/canvas-render/src/host/CanvasSurface.vue:425` | overlay 消费端 | `<SlotHost slot="overlay" item-class="csurface-overlay-item" />` 渲染该槽全部条目 |
| `packages/canvas-render/src/components/SlotHost.vue:1` | 通用槽宿主 | 读 `ctx.slots.occupants(slot)` 按 order 逐个渲染，插件装卸时自动重读 |
| `packages/plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue` | settings.nav 消费端 | 读 `settings.nav` occupants，渲染时给组件传 `{ group, active, onSelect }` |
| `packages/plugins/plugin-cursor-effect/src/components/settings/CursorSettingsNav.vue:1` | 真实导航组件 | `defineProps<{ group: string; active?: boolean; onSelect?: (key: string) => void }>` —— 示例导航组件就是照它缩写的 |
| `packages/plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue:330` | settingsGroup 消费端 | 读 `'settingsGroup/' + sectionKey`；replace 模式接管整组内容 |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:55` | 专用槽 | `ctx.slots.register('mini-map', …)` —— 宿主想放哪就 `<SlotHost slot="mini-map" />` 放哪 |
| `packages/ui/src/App.vue:181` | 专用槽消费端 | 成品 UI 用 `<SlotHost slot="mini-map" />` 给小地图选位置 |

## 常见坑

- **槽名写错 = 什么都不显示**。`overlay`、`settings.nav`、`settingsGroup/<id>` 都是宿主"认名"渲染的，
  名字对不上（比如写成 `overlays`）组件永远不渲染，也不报错 —— 内核只是把它存进注册场。
  检查办法：去宿主源码搜 `SlotHost slot="…"` 看它渲染哪些名字。
- **忘了 markRaw**。组件定义直接塞进注册场会被 Vue 做成响应式代理，渲染时可能性能告警或重复挂载。
  所有 `component:` 都要 `markRaw(...)` 包一层 —— 仓库里的真实插件全这么做。
- **settingsGroup 槽名里的分组名要和 settings.nav 的 meta.group 完全一致**。左导航是"计数"，正文槽就要是
  `settingsGroup/计数`。差一个字 = 点了导航右边是空白。
- **overlay 组件里要用 pointer-events**。overlay 容器本身是 `pointer-events: none`（不挡画布），
  你的浮层想被点击，根元素要写 `pointer-events: auto`（示例的 `CountOverlay.vue` 样式里写了）。
