
# SettingsHost / SlotHost / settingsSource

**一句话定位**：**`SettingsHost` 是「设置面板的宿主」—— 它提供窗口外壳（遮罩 / 居中 / 标题栏 / ✕ / Esc），里面画什么由主题槽的赢家决定；`SlotHost` 是「通用槽宿主」—— 给一个槽名，就把插件放进去的东西按顺序渲染出来；`settingsSourceFrom` 是把内核配置数据源适配成面板接口的一行函数。**

**它属于哪一档**：**渲染层提供的 UI 宿主**。源码：`packages/canvas-render/src/components/SettingsHost.vue`、`SettingsShell.vue`、`SlotHost.vue`、`settingsSource.ts`、`settingsPanelTypes.ts`、`contracts/settingsField.ts`。

## 它是什么

两个「宿主」都是同一套思路的两个实例：**宿主负责「长在哪儿」，插件负责「长什么样」**。

| 小组件 | 一句话 |
| --- | --- |
| `SettingsHost` | 打开设置面板：外壳固定（遮罩 / 居中 / 标题栏 / ✕ / Esc / 浮动窗 / 悬浮球），**中间那块内容**读 `themeRegistry.winner('settingsPanel')` 决定 |
| `SlotHost` | 通用槽：`<SlotHost slot="overlay" />` 一行，该槽里所有 occupant 按 `order` 依次渲染 |
| `settingsSourceFrom(ctx)` | 把 `ctx.get('settings')`（内核 `SettingsStore`）适配成面板只需要的最小接口 |

## 为什么需要它

### 设置面板：为什么外壳归宿主

设置的界面皮肤（`settingsPanel`）是**可替换槽**：谁 `order` 小谁赢。如果连遮罩、居中、✕、Esc、浮动窗都由「皮」自己实现，那么「关闭」这件事就有 N 份实现。历史缺陷就出在这：两个皮对 `closeOnMask` 的默认值不一致，用户点遮罩在其中一个皮上关不掉。

现在职责切得很干净：

```
SettingsHost  = 只提供最外层 Dialog（遮罩 / 居中 / 标题栏 / ✕ / Esc / 点遮罩关闭 / 浮动窗 / resize / 悬浮球），不提供任何中间容器
槽里的皮       = 只画中间层（左导航 + 右侧设置项），声明 props.settings 即可
```

于是「关闭」只有一份实现：**皮的 ✕ 由外壳画**，点遮罩 / Esc 也由外壳统一处理。

### SlotHost：为什么不在宿主里手抄一遍

在抽成组件之前，「渲染一个槽」要在宿主里手抄一整套：`ctx.slots.occupants(slot)` → 维护响应式列表 → 订阅插件热装/热卸重读 → `markRaw` 组件 → 逐个 `<component :is>`。`CanvasSurface` 里的 `overlay` 就是这套的硬编码实例。

抽成 `SlotHost` 之后，加一个新槽就是宿主多写一行 —— 这是「插件能独立发布、宿主不用为每个插件改代码」的关键。

## 怎么用

### 一、SlotHost：宿主侧一行渲染一个槽

```ts
// 组件 props（逐字来自 packages/canvas-render/src/components/SlotHost.vue）
defineProps<{
  slot: string        // 要渲染的槽名（插件经 ctx.slots.register(同名, …) 往里填）
  itemClass?: string  // 可选：给每个 occupant 的根元素额外加的 class
}>()
```

它内部做三件事：**初始读一次** `ctx.slots.occupants(slot)` → 订阅 `ctx:plugin-installed` / `ctx:plugin-uninstalled` → 再订阅底层 `slots` 容器的 `subscribe`（覆盖「运行期不经过插件装卸也改了槽」的情况）；`slot` prop 变化时也会重读。

渲染出来的每个 occupant 根元素会带两个调试属性：`data-slot-id` 与 `data-slot-order`。

```vue
<!-- 文件：某宿主组件（例如 packages/ui/src/App.vue）
     格式：Vue 单文件组件模板
     位置：CanvasHost 的 #ui 插槽内（必须在渲染子树内，SlotHost 要 useCanvasRender 拿 ctx） -->
<template>
  <!-- ① 小地图：插件注册在 mini-map 槽，位置由宿主挑 -->
  <div class="mini-map-anchor" style="pointer-events: none">
    <div style="pointer-events: auto">
      <SlotHost slot="mini-map" />
    </div>
  </div>

  <!-- ② Agent 面板的内容区 -->
  <SlotHost slot="agent-conversation" />
</template>
```

**职责边界**：`SlotHost` 只管「读一个槽并按 order 渲染」。它**不做**定位、**不做** `pointer-events`、**不做**容器样式 —— 那些是「这个槽长什么样」的问题，归使用方。比如 `overlay` 那层是 `CanvasSurface` 用 `.csurface-overlay` 套的（`position:absolute; inset:0; pointer-events:none; z-index:20`，item 再用 `item-class` 恢复成 `auto`）。

### 二、槽名总览（对着源码核过）

槽名就是**字符串约定**，不是枚举：拼错一个字母不会报错，只是「放进去的东西永远不显示」。下面是当前仓库里真的有人在用 / 在渲染的槽：

| 槽名 | 谁往里放（真实文件） | 谁渲染它 |
| --- | --- | --- |
| `overlay` | `plugin-align-guide`（对齐线）、`plugin-multi-select`（框选层 + 选择框）、`plugin-group`（分组控制栏）、`plugin-shortcut-manager`（快捷键面板）、`plugin-style-library`（样式库）、`plugin-cursor-effect`（光标特效）、`plugin-bottom-bar`（节点底栏浮层 + 预览浮层 + 任务浮层） | **`CanvasSurface.vue`** 里固定一行 `<SlotHost slot="overlay" item-class="csurface-overlay-item" />` |
| `mini-map` | `plugin-mini-map` | 宿主自选：`packages/ui/src/App.vue` 里 `<SlotHost slot="mini-map" />` |
| `agent-conversation` | `plugin-agent`（消息流 + 输入区） | `packages/ui/src/components/areas/AgentPanel.vue` |
| `settingsNav` | `plugin-cursor-effect`、`plugin-agent`、`plugin-showcase`、`plugin-cloud-client/manager`（插件管理）、`packages/ui/src/hotReloadPlugin.ts` | 设置面板皮：默认皮 `plugin-theme-default` 的 `PluginSettingsContent.vue`（`packages/ui/src/components/settings/AppSettingsPanel.vue` 明确不消费它） |
| `settingsTab` | 当前生产代码里没有插件注册它（保留给「自定义二级页签」） | 默认设置皮按「一级名匹配 id 首段」归并渲染 |
| `settingsGroup/<分组名>` | 同上那批插件（每个整页内容一条，如 `settingsGroup/Agent`、`settingsGroup/光标`） | 默认设置皮 / `AppSettingsPanel.vue` 按当前分组读 `occupants('settingsGroup/' + groupKey)` |

想让插件往某个槽放东西，插件那侧写：

```ts
// 片段：插件往槽里放一个组件（id 相同 = 替换那一格，不同 = 叠加一层；order 越小越靠前）
const id = ctx.slots.register('overlay', {
  id: 'my-plugin/badge',
  order: 60,
  component: MyOverlay,
  meta: { title: '我的浮层' },
})
// 不用写清理：register 的撤销随本插件作用域自动回收（卸载即摘）
```

### 三、SettingsHost：可替换设置面板宿主

```ts
// props（逐字来自 SettingsHost.vue）
defineProps<{
  emptyHint?: string   // 空槽（没插件注册设置面板）时是否显示占位；默认 false = 空
}>()
```

它做四件小事：

1. 用 `useCanvasRender()` 拿 `ctx`，再经 `settingsSourceFrom(ctx)` 拿到面板数据源（**稳定引用**，渲染时现取）；
2. 读 `ctx.get('themeRegistry').winner('settingsPanel')` 得到当前赢家组件；
3. 订阅 `ctx:plugin-installed` / `ctx:plugin-uninstalled` 与 `themeRegistry.subscribe` —— 插件装卸 / 运行期换 occupant 时重读赢家；
4. 渲染 `<SettingsShell>` 包住赢家：`<component :is="winner" :settings="source" />`。外壳的关闭事件 → `ctx.emit('settings:ui-close')` → 宿主自己收起面板（`<SettingsHost v-if>` 卸载本组件）。

```vue
<!-- 文件：你的应用外壳（真实对照 packages/ui/src/App.vue）
     格式：Vue 单文件组件
     位置：CanvasHost 的 #ui 插槽内；开关由宿主自己的状态决定 -->
<script setup lang="ts">
import { CanvasHost, SettingsHost } from '@mini-canvas/canvas-render'
import { APP_PLUGINS } from './assembly'
import { ref } from 'vue'

const settingsOpen = ref(false)
</script>

<template>
  <CanvasHost :plugins="APP_PLUGINS">
    <template #ui>
      <!-- ① 打开时挂载：外壳 + 赢家内容都在这一个组件里 -->
      <SettingsHost v-if="settingsOpen" />
      <button @click="settingsOpen = true">打开设置</button>
    </template>
  </CanvasHost>
</template>
```

**关闭通道的完整链路**（调试时按这条查）：

```
用户按 ✕ / Esc / 点遮罩
  → SettingsShell emit('close')
     → SettingsHost 里 onShellClose()
        → ctx.emit('settings:ui-close')
           → 宿主监听后 settingsOpen = false（<SettingsHost v-if> 卸载）
```

### 四、SettingsShell：外壳自己怎么用（换皮时用得上）

```ts
// props / emits（逐字来自 SettingsShell.vue）
defineProps<{
  title?: string        // 标题栏主标题，默认 '设置'
  eyebrow?: string      // 标题栏上方的小字，默认 '偏好'
  closeOnMask?: boolean // 是否允许点遮罩 / 按 Esc 关闭，默认 true
}>()
defineEmits<{ (e: 'close'): void }>()
```

外壳管的东西（源码注释里逐条列了）：遮罩 / 居中 / 盒子尺寸 / 标题栏 / ✕ / Esc / 点遮罩关闭 / 转浮动窗口 / 顶部拖拽 / 右下角 resize / 最小化成悬浮球。**不提供任何中间容器**。

### 五、settingsSourceFrom 与 SettingsPanelSource

```ts
// 源码：packages/canvas-render/src/components/settingsSource.ts
export function settingsSourceFrom(ctx: Context): SettingsPanelSource
```

它做的就是把 `ctx.get('settings')` 按类型收口成面板要的最小接口；**缺服务会抛明确错误**（不是静默 undefined）：

```
[settingsSource] ctx 缺少 settings 服务：请确认宿主已注入(内置恒在,通常不会缺)
```

面板消费的最小接口（`settingsPanelTypes.ts`）：

```ts
interface SettingsPanelSource {
  groups(): string[]                      // 已声明（装配）的分组名
  groupOf(group: string): SettingEntry[]  // 某分组下的全部条目（key / value / schema）
  set(key: string, value: string | number | boolean): boolean   // 改一项的值
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

type { SettingSchema, SettingEntry }   // 从 @mini-canvas/kernel 重导出
```

**关键事实**：内核的 `SettingsStore` **不是响应式的**（plain class）。所以面板侧的刷新方式是：**订阅 `onChange` + 用本地版本号驱动重渲染**。`SettingsHost` 明确**不用 `:key` 重挂赢家组件**（否则输入框每敲一个键就重挂一次，焦点会丢）。

### 六、SETTINGS_FIELD_RENDERER：字段级控件下发令牌

```ts
// 源码：packages/canvas-render/src/contracts/settingsField.ts
export const SETTINGS_FIELD_RENDERER: InjectionKey<Component | undefined>
export function injectSettingsFieldRenderer(): Component | undefined
```

用途：默认设置皮会把「标准字段控件」（颜色/数字/开关/下拉/文本 + 描述）provide 出来。于是**插件自己注册的 `settingsGroup/<key>` 内容组件**（自定义预览 UI 之类）不必反向依赖 `plugin-theme-default`，直接 `inject` 到这个渲染器，就能把某个字段的标准控件摆进自己的页面。

依赖方向很讲究：**canvas-render 只导类型 / 令牌 / 辅助函数（不持有 .vue 组件）**，实际组件由主题皮在运行时 provide。

```vue
<!-- 片段：插件自定义设置内容组件里复用标准字段控件
     格式：Vue 单文件组件
     位置：注册进 settingsGroup/<分组名> 的那个组件 -->
<script setup lang="ts">
import { injectSettingsFieldRenderer } from '@mini-canvas/canvas-render'

const Field = injectSettingsFieldRenderer()   // ① 不在设置面板子树内时是 undefined
</script>

<template>
  <!-- ② 有就用标准控件，没有就退化（别硬渲染） -->
  <component :is="Field" v-if="Field" group="常规/我的插件" field-key="myKey" :settings="settings" />
  <p v-else>请从设置面板里打开本页</p>
</template>
```

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/ui/src/App.vue` | `<SettingsHost v-if="s.settingsOpen" />` 与 `<SlotHost slot="mini-map" />` 都放在 `#ui` 插槽里 |
| `packages/ui/src/components/settings/AppSettingsPanel.vue` | 成品应用自己的设置皮（`order -1` 顶替默认皮）：消费 `settingsGroup/<key>`，**不消费** `settingsNav` / `settingsTab` |
| `packages/plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue` | 默认设置皮：读 `settingsNav` / `settingsTab` / `settingsGroup/<key>` 三种槽 |
| `packages/plugins/plugin-theme-default/src/index.ts` | `ctx.theme.register("settingsPanel", PluginSettingsContent, …)` 注册默认赢家 |
| `packages/ui/src/settingsPanelPlugin.ts` | 换皮插件：`ctx.theme.register('settingsPanel', AppSettingsPanel, { id: name, order: -1 })` |
| `packages/canvas-render/src/host/CanvasSurface.vue` | overlay 槽的唯一渲染点 |
| `packages/canvas-render/src/components/__tests__/settingsSource.test.ts` | `settingsSourceFrom` 的行为测试 |

## 完整例子

一个**真能跑**的插件组合：往 `overlay` 挂一个小浮层，再给自己的插件加一个设置页（`settingsNav` + `settingsGroup/<名>`），全部按真实写法。

### 目录长这样

```
plugin-panel-demo/
├── package.json                 # 插件清单
└── src/
    ├── index.ts                 # 插件入口：注册 overlay 浮层 + 设置导航 + 设置页正文
    ├── DemoOverlay.vue          # 挂在 overlay 槽的小浮层（显示当前缩放）
    ├── DemoNavItem.vue          # 挂在 settingsNav 槽的导航项按钮
    └── DemoSettingsPage.vue     # 挂在 settingsGroup/我的演示 的设置页正文
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/canvas-render/settings-slot-host/`。

### 文件一：清单

```json
// 文件：plugin-panel-demo/package.json
// 格式：JSON（npm 包清单）
// 位置：插件包根目录
{
  "name": "plugin-panel-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "面板演示",
    "description": "演示 overlay 浮层 + 设置页导航/正文三处槽位",
    "pluginName": "panel-demo",
    "installable": true
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "dependencies": { "@mini-canvas/canvas-base": "workspace:*" },
  "peerDependencies": { "@mini-canvas/canvas-render": "workspace:*", "vue": "^3.5.34" }
}
```

### 文件二：浮层组件

```vue
<!-- 文件：plugin-panel-demo/src/DemoOverlay.vue
     格式：Vue 单文件组件（挂在 overlay 槽，被 SlotHost 渲染）
     位置：插件包内部；它只知道「我在 overlay 槽里」 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { flow } = useCanvasRender()
// ① 缩放值：flow.viewport 是响应式 Ref，缩放一变这里自动重算
const zoomPercent = computed(() => Math.round((flow.viewport.value?.zoom ?? 1) * 100))
</script>

<template>
  <!-- ② overlay 那层铺满画布且 pointer-events:none，所以「摆在哪、要不要接鼠标」由自己负责 -->
  <div class="demo-badge">{{ zoomPercent }}%</div>
</template>

<style scoped>
.demo-badge {
  position: absolute; right: 12px; top: 12px; padding: 2px 8px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 12px;
  pointer-events: none;   /* 小角标不接鼠标，别抢画布交互 */
}
</style>
```

### 文件三：设置页正文

```vue
<!-- 文件：plugin-panel-demo/src/DemoSettingsPage.vue
     格式：Vue 单文件组件（挂在 settingsGroup/我的演示 槽）
     位置：插件包内部；它拿到的是统一设置数据源，不自己读内核 -->
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender, type SettingsPanelSource } from '@mini-canvas/canvas-render'

// ① 设置面板宿主会把数据源当 prop 传进来（名字固定叫 settings）
const props = defineProps<{ settings: SettingsPanelSource }>()
const { ctx } = useCanvasRender()

// ② 读自己那一项的值；面板宿主负责在配置变化时让它重渲染
const noteSize = computed(() => {
  const entry = props.settings.groupOf('我的演示').find((e) => e.key === 'demoText')
  return String(entry?.value ?? '')
})

function setDemoText(v: string) {
  props.settings.set('demoText', v)   // ③ 写回内核配置（持久化由 settingsPersist 桥负责）
}
</script>

<template>
  <section>
    <label>
      我的设置项
      <input :value="noteSize" @input="setDemoText(($event.target as HTMLInputElement).value)" />
    </label>
  </section>
</template>
```

### 文件四：插件入口

```ts
// 文件：plugin-panel-demo/src/index.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import DemoOverlay from './DemoOverlay.vue'
import DemoSettingsPage from './DemoSettingsPage.vue'
import DemoNavItem from './DemoNavItem.vue'

export const name = 'panel-demo'
export const inject = [] as string[]   // 本插件只放 UI，不读按名取的服务

export function apply(ctx: Context): void {
  // ① 画布浮层：overlay 槽由 CanvasSurface 渲染（order 决定同槽内先后，越小越靠前）
  ctx.slots.register('overlay', {
    id: 'panel-demo/badge',
    order: 10,
    component: DemoOverlay,
    meta: { title: '缩放角标' },
  })

  // ② 设置面板左导航：一条导航项
  ctx.slots.register('settingsNav', {
    id: 'panel-demo/nav',
    order: 50,
    component: DemoNavItem,
  })

  // ③ 设置页正文：进键形如 settingsGroup/<一级名>，与②的名称一致
  ctx.slots.register('settingsGroup/我的演示', {
    id: 'panel-demo/page',
    component: DemoSettingsPage,
  })

  // ④ 连设置项的声明一起给出（这样面板里就有 demoText 这一项了）
  ctx.settings.define('我的演示', {
    demoText: { type: 'string', default: '你好', label: '演示文本' },
  })
}


/** 兼容旧装配的 PluginModule 出口 */
export const panelDemoPlugin: PluginModule = { name, inject, apply }
```

### 怎么验证它真的挂上了

1. 把插件加进装配清单（如 `APP_PLUGINS`），或在控制台热装：`MiniCanvas.installPlugin(panelDemoPlugin)`。
2. 画布右上角出现缩放角标；缩放画布时数字跟着变。
3. 打开设置面板：左导航里应出现插件注册的导航项，点进去能看到自己那一页。
4. 控制台核对槽内容：

```ts
const slots = window.MiniCanvas.getContext().get('slots')
slots.list('overlay').map((e) => ({ id: e.id, order: e.order }))
// → 除了本插件那条，还有对齐线 / 多选框 / 底栏等一堆 occupant
```

5. 卸载插件（`MiniCanvas.uninstallPlugin('panel-demo')`）后，角标与设置页都应立刻消失（注册随作用域自动回收）。

## 常见坑

1. **槽名不是枚举，拼错不报错**。`ctx.slots.register('overlay', …)` 里写成 `'overlayy'` 不会抛，只是**永远不显示**（没有宿主渲染那个槽）。放之前先确认宿主有没有渲染它。
2. **`order` 方向是「越小越靠前」**。单赢家槽（如 `settingsPanel`）取 `order` 最小者；想顶替别人不要删别人，放一条更小的就行 —— 别人还在，卸载你之后会自动回退。
3. **`id` 相同是替换、不同是叠加**。想热重载干净生效就固定 `id`；两次注册用不同 `id`（或都不给）会在槽里冒出两条，用户看到两个一模一样的浮层。
4. **`SlotHost` 必须在渲染子树内**。它用 `useCanvasRender()` 取 `ctx`，放在外面会抛错。宿主自己的工具栏 / 面板要放进 `<template #ui>`。
5. **`settings` 不响应式，别硬读一次就当最新**。面板侧的刷新模式是「订阅 `onChange` + 版本号重渲染」；`SettingsHost` 刻意不给赢家加 `:key`，因为重挂会让输入框**每敲一个字符就丢焦点**。
6. **空槽渲染出来是「什么都没有」**。`SettingsHost` 默认不显示占位（想显示要传 `emptyHint`）；`SlotHost` 则是彻底渲染成空 —— 排查「界面上没东西」先去看槽里到底有没有 occupant（`ctx.get('slots').list(槽名)`）。
