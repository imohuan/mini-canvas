# 插件作者的最终形态 —— 从建插件到注册一切的完整伪代码

日期：2026-09-27
配套文档：docs/tmp/canvas-base-data-render-theme-audit-2026-09-26.md

## 0. 先回答你的问题

你问：按上一份文档推荐的方式，最终实现效果是不是那样的？

答案：**方向是那样的，但要分成两层看**。

- **注册这一层，今天已经基本长成目标样子**：ctx.nodes / ctx.theme / ctx.commands / ctx.slots / ctx.settings / ctx.registryOf / ctx.tools / needs 能力包，都是现成可用的真 API。下面第 3、4 节的代码，字段名和调用形状与当前源码一致，改掉数据来源就能直接跑。
- **上下文这一层，还差三件事**：canvas-base 不是唯一入口、服务类型要自己 cast、VueFlow 还没变成 ctx.render 里的稳定能力。所以下面代码里凡是标了「目标 API」的部分，是建议新增的写法，现在还不能编译。

一句话概括最终效果：

> 插件作者只学一套东西 —— 一个 ctx、几个注册方法、一组 needs 能力名；组件不 import 主题、不 import VueFlow、不 import 数据层内部结构。

## 1. 最终形态总览

插件作者要认识的东西收敛成五样：

    ① 插件骨架      name / inject / Config / apply(ctx)
    ② 注册方法      ctx.nodes / ctx.theme / ctx.commands / ctx.slots / ctx.settings / ctx.tools
    ③ 服务读取      ctx.get('doc') / ctx.get('selection') / ctx.get('viewport')（集中类型）
    ④ 组件能力      ctx.nodes.attach(..., { needs: ['node','zoom'] }) + useCapability('node')
    ⑤ 渲染能力      ctx.render.flow（可选，逻辑插件完全不用）

一个插件内部的依赖关系长这样：

    plugin.ts（逻辑）
      ├── 注册节点类型  ──→ ctx.nodes.register
      ├── 挂区域组件    ──→ ctx.nodes.attach(type, { region, needs })
      ├── 注册命令/快捷键 ──→ ctx.commands.register({ keys })
      ├── 注册插槽      ──→ ctx.slots.register
      ├── 注册工具      ──→ ctx.tools.register
      ├── 声明配置      ──→ export const Config
      └── 上架服务      ──→ class XxxService extends Service

    Content.vue（组件）
      ├── 能力包        ──→ const node = useCapability('node')
      ├── 普通服务兜底   ──→ useCanvasRender().ctx.get('doc')
      └── 设计系统件     ──→ useUiComponent('button')

    Toolbar.vue（区域组件）
      └── 能力包        ──→ useCapability('zoom')

## 2. 插件骨架

### 2.1 今天就能跑的原样写法

    // src/myNodePlugin.ts
    import { Service, type PluginModule, type Context, type InferConfig } from '@mini-canvas/canvas-base'
    import type { DocService } from '@mini-canvas/canvas-data'
    import { Config } from './myConfig'

    export const name = 'my-node'
    export const inject = ['doc'] as string[]

    export function apply(ctx: Context, config?: InferConfig<typeof Config>) {
      // 注册的东西全在这里；插件卸载时自动回收
    }

    export { Config }
    export const myNodePlugin: PluginModule = { name, inject, Config, apply }

### 2.2 目标写法（建议新增）

    import type { CanvasPlugin, CanvasPluginContext } from '@mini-canvas/canvas-base'

    export const plugin: CanvasPlugin = {
      name: 'my-node',
      inject: ['doc'],
      Config: { /* ... */ },
      apply(ctx: CanvasPluginContext) {
        // ctx 上的所有服务都是集中类型，不需要自己写 ctx.get<DocService>('doc')
      },
    }

差别只有类型来源和 ctx 的名字，注册方法完全一样。

## 3. 完整案例：一个「图片生成节点」插件

下面这个插件把所有注册操作用一遍，你可以把它当作模板。

### 3.1 第一步：声明配置（模块级 Config，今天就能用）

    // src/myConfig.ts
    import type { ConfigSchema } from '@mini-canvas/canvas-base'

    export const Config: ConfigSchema = {
      cardWidth: {
        type: 'number',
        default: 320,
        min: 160,
        max: 800,
        step: 10,
        label: '卡片宽度',
        group: '节点/我的节点',
        description: '节点卡片默认宽度，设置面板自动生成滑块。',
      },
      showBadge: {
        type: 'boolean',
        default: true,
        label: '显示角标',
        group: '节点/我的节点',
      },
      style: {
        type: 'select',
        default: 'realistic',
        label: '风格',
        group: '节点/我的节点',
        options: [
          { value: 'realistic', label: '写实' },
          { value: 'anime', label: '动漫' },
        ],
      },
    }

内核会在装配时校验 + 补默认，然后 apply(ctx, config) 收到完整 config；同时自动登记进设置面板的单一数据源。**插件不需要自己写 settings.define**。

### 3.2 第二步：注册节点类型

    // src/myNodePlugin.ts（apply 内）
    import Content from './Content.vue'
    import Toolbar from './Toolbar.vue'
    import ProgressBar from './ProgressBar.vue'
    import GeneratePanel from './GeneratePanel.vue'

    ctx.nodes.register({
      type: 'my-image',
      label: '我的图片',
      description: '根据提示词生成图片',
      icon: '<svg>...</svg>',          // 字符串或 Vue 组件都行
      size: { w: 320, h: 240 },
      resizable: true,                  // 显示右下角拖拽手柄
      frameless: false,                 // true = 图片铺满、去掉卡片边框
      transparent: false,               // true = 容器型节点，卡片底透明

      // 连接约束（可选；不声明 = 默认可进可出、不限条数）
      inputs: [{ port: 'target', acceptsTypes: ['image', 'text'] }],
      outputs: [{ port: 'source', contentType: 'image' }],

      // 内容组件（区域词 in = 卡片内部）
      in: Content,

      // 其它区域组件（区域词是十个闭合词，见第 3.3 节）
      segments: {
        'out:bottom': GeneratePanel,
      },

      // 建节点实现（右键菜单「新建节点」/ MCP 建节点时调用）
      create(position) {
        return ctx.get('doc').transaction('add-my-image', tx =>
          tx.createNode('my-image', position, { prompt: '' }),
        )
      },
    })

注册后同时生效四件事：

1. 数据表里多了 type = my-image（尺寸、连接约束、类型能力）。
2. 展示表里挂上了内容组件。
3. 节点工厂里多了 create，菜单可以新建。
4. 全部随插件卸载自动注销。

### 3.3 第三步：往节点的十个区域挂组件

节点上只有十个合法区域词。位置决定贴在哪，名字由你定：

    in            卡片内部（内容组件）
    title         标题位
    out:top       卡片上边外侧
    out:bottom    卡片下边外侧
    out:left      卡片左侧
    out:right     卡片右侧
    on:top        骑在上边框线上（进度条）
    on:bottom     骑在下边框线上
    over:inset    卡片内部覆盖层（不超出卡片）
    over:outset   盖住整张卡且允许超出

挂一个工具栏按钮：

    ctx.nodes.attach('my-image', {
      id: 'my-toolbar',
      region: 'out:top',
      order: 10,
      component: Toolbar,
      // 声明这个组件要用哪些通用能力；组件里 useCapability('node') 取到
      needs: ['node', 'zoom', 'selected'],
      // 注册时写死的 props（可选）
      props: { variant: 'compact' },
    })

挂到所有节点类型（通配）：

    ctx.nodes.attach('*', {
      id: 'my-badge',
      region: 'out:right',
      component: Badge,
    })

挂进度条到边框线上：

    ctx.nodes.attach('my-image', {
      id: 'my-progress',
      region: 'on:bottom',
      component: ProgressBar,
    })

往多选框（选择集）挂组件 —— 形状和节点区域一样，只是没有 type：

    ctx.selectionRegion.attach({
      id: 'my-selection-actions',
      region: 'out:top',
      component: SelectionActions,
      needs: ['selection'],
    })

每个 attach 返回 Disposable；不接返回值就是纯声明 + 自动回收。想手动撤销：const d = ctx.nodes.attach(...); d.dispose()。

### 3.4 第四步：内容组件里取能力

    <!-- src/Content.vue -->
    <script setup lang="ts">
    import { useCapability, useUiComponent } from '@mini-canvas/canvas-render'

    const props = defineProps<{ id: string; data: Record<string, unknown> }>()

    // 能力包：只拿到 needs 里声明过的
    const node = useCapability('node')         // { id, type, data, label(), setLabel(), update() }
    const zoom = useCapability('zoom')         // { zoom, viewport(), zoomIn(), fitView() }
    const selected = useCapability('selected') // { selected, solo }

    // 设计系统件：按名取，换主题时自动跟着换
    const Button = useUiComponent('button')
    const Select = useUiComponent('select')

    function onEdit(text: string) {
      node.update({ prompt: text })   // 走唯一写入口：进历史 + 落盘
    }
    </script>

    <template>
      <div class="my-card">
        <img :src="data.url" />
        <component :is="Button" @click="onEdit('hello')">改一下</component>
      </div>
    </template>

五条规则：

1. 组件专属数据走 props；通用能力走 useCapability。
2. needs 里没声明的能力拿不到，dev 下会 warn 告诉你漏了什么。
3. 写回只走 node.update / setLabel，不要自己改 store。
4. 设计系统件走 useUiComponent，不要 import 主题包的组件。
5. 纯计算函数直接 import，不要注册进任何场。

### 3.4.1 另一半：组件是从哪里来的（注册端）

3.4 讲的 useUiComponent 只是**取**。组件要能被取到，必须先有人**放**。放的人在主题插件里，用注册场写一条：

    // 主题插件 apply(ctx) 内（真实 API，见 plugin-theme-default/src/index.ts:655-661）
    import ToolbarButton from './components/ui/NodeToolbarButton.vue'
    import MySelect from './components/ui/Select.vue'

    const ui = ctx.registryOf('ui')
    ui.add('button', ToolbarButton, { id: 'default' })
    ui.add('select', MySelect, { id: 'default' })

四个要点：

1. **键 = 组件名**，值是 opaque 组件句柄。常用名有 button / dropdown / select / slider / toolParamField / color（UI_NAMES 是推荐表，不是封闭枚举，可以自定名字）。
2. **id 默认 = 当前插件名**；同一个键下同 id 重复 add = 替换该格，不同 id = 叠加。
3. **order 小者赢**（top）。换主题 = 另一个插件 add 同一个键、给更小的 order；老主题不用被卸载也自动让位。
4. **注册随插件 scope 自动回收**。主题卸载后目录里那条消失，useUiComponent 返回的 ref 当场变 undefined 并 warn（消费方可以就地降级）。

同一个机制也是别的组件的来源。一张表看清「组件从哪注册、消费方怎么取」：

| 组件类型 | 注册端（放） | 消费端（取） |
|---|---|---|
| 节点内容组件 | ctx.nodes.register({ in: Content }) | BaseNode 自动渲染，收到 props { id, data } |
| 节点区域组件 | ctx.nodes.attach(type, { region, component, needs }) | BaseNode 按区域渲染；组件 useCapability 取 needs |
| 选择集区域组件 | ctx.selectionRegion.attach({ region, component, needs }) | 多选框 SelectionFrame 渲染 |
| 整套主题皮 | ctx.theme.register(slot, Component, { id, order }) | 宿主按 winner(slot) 装配 |
| 设计系统件 | ctx.registryOf('ui').add(name, Component, { id, order }) | useUiComponent(name) |
| 画布级浮层 | ctx.slots.register(slot, { id, component }) | 宿主 SlotHost 按槽名渲染 |
| 能力实现（组件用的通用 hooks） | ctx.registryOf('capability').add(name, factory, { id, order }) | useCapability(name)；组件在 attach 的 needs 里声明 |
| 设置面板整套皮 | ctx.theme.register('settingsPanel', Panel, { id, order }) | SettingsHost 按 winner 渲染 |

所以「注册组件」不是一个单独 API，而是**按用途选对应注册场**：内容/区域走 nodes，换皮走 theme，设计系统件走 ui，浮层走 slots，能力走 capability。

### 3.5 第五步：注册命令和快捷键

快捷键就是命令上的 keys 字段，不另造 shortcut API：

    ctx.commands.register({
      id: 'my-image:generate',
      title: '生成图片',
      keys: ['mod+enter'],        // 渲染层统一分发，插件不自己绑 window
      group: '我的插件',
      order: 20,
      icon: '<svg>...</svg>',
      areas: ['node', 'toolbar'],
      // when 为 false 时，这次按键让位给同键的其它命令
      when: (c) => Boolean(c?.get?.('selection')),
      run: (c, payload) => {
        const { nodeId } = payload as { nodeId: string }
        return runGenerate(nodeId)
      },
    })

其它插件也可以按 id 调用：ctx.get('command').execute('my-image:generate', { nodeId })。

### 3.6 第六步：注册插槽（画布级浮层）

插槽是画布级的，不属于某一个节点。宿主用 SlotHost 组件渲染（slot 属性指定槽名）：

    ctx.slots.register('overlay', {
      id: 'my-panel',
      order: 40,
      component: MyFloatingPanel,
      meta: { title: '我的面板' },   // 元数据随条目存，读回用
    })

读取当前槽里有什么：

    const list = ctx.slots.occupants('overlay')  // [{ id, order, component, meta }]

### 3.7 第七步：注册生成工具

工具 = 一次外部能力调用（文生图 / 文生文）。节点只认识工具名，不认识 HTTP 和模型：

    ctx.tools.register({
      name: 'image.generate:my-model',
      title: '我的模型',
      group: '图片生成',
      produces: 'image',
      accepts: ['text', 'image'],
      params: [
        { key: 'ratio', label: '比例', type: 'select', default: '1:1',
          options: [{ label: '1:1', value: '1:1' }, { label: '16:9', value: '16:9' }] },
        { key: 'strength', label: '强度', type: 'number', default: 0.8, min: 0, max: 1, step: 0.05 },
      ],
      templates: [
        { id: 'photo', name: '照片风', prompt: '真实摄影，自然光' },
      ],
      async run(input, runCtx) {
        const res = await fetch('/api/generate', { method: 'POST', body: JSON.stringify(input) })
        const json = await res.json()
        return { ok: true, urls: [json.url] }
      },
    })

消费方：

    const tools = ctx.tools.list({ produces: 'image' })   // 列出能出图的工具
    const result = await ctx.tools.invoke('image.generate:my-model', input, { onProgress })

加一个新模型 = 装一个注册了新工具的插件，节点代码零改动。

### 3.8 第八步：对外提供服务（可选）

如果别的插件需要调用你的功能，才上架服务；否则用 ctx.state 存自己的数据。

#### 3.8.1 提供方：三行把服务放上去

    import { Service, type Context } from '@mini-canvas/canvas-base'

    export interface MyImageServiceApi {
      generate(nodeId: string, prompt: string): Promise<{ urls: string[] }>
    }

    export class MyImageService extends Service implements MyImageServiceApi {
      constructor(ctx: Context) {
        super(ctx, 'myImage')     // ← 这一行就是「注册到 ctx」
        // super 内部执行 ctx.provide('myImage', this)：
        //   · 实例进内核服务表，ctx.get('myImage') 拿得到
        //   · 撤销句柄自动挂到本插件 fiber —— 插件卸载/热重载时服务自动消失，不用手写 unregister
      }

      async generate(nodeId: string, prompt: string) {
        const doc = this.ctx.get('doc')     // 服务内取别的服务：惰性取，不缓存
        const id = doc.transaction('my-image:generate', tx =>
          tx.createNode('my-image', { x: 0, y: 0 }, { prompt }))
        return { urls: [/* ... */] }
      }
    }

    // apply 里构造即上架
    export function apply(ctx: Context) {
      const service = new MyImageService(ctx)
      // 不用再写 ctx.inject('myImage', service) —— super 已经做了
    }

等价的手写形式（不想写类时用对象服务）：

    ctx.provide('myImage', { generate: async (id, p) => ({ urls: [] }) })
    // ctx.inject(name, impl) 与 ctx.provide 同义；二者都随插件 scope 自动回收

#### 3.8.2 消费方：声明依赖，然后取

别的插件要用这个服务，走标准 inject 硬依赖：

    // 另一个插件
    export const name = 'my-consumer'
    export const inject = ['myImage'] as string[]   // ← 硬依赖声明

    export function apply(ctx: Context) {
      // 首选：ctx.get 明确取
      const image = ctx.get<MyImageServiceApi>('myImage')
      await image.generate(nodeId, '画一只猫')

      // 等价：插件作用域里 ctx.myImage 也拿得到（插件 ctx 有服务解析代理）
      const image2 = ctx.myImage
    }

inject 的语义很重要，三个行为都不是可选的：

1. 依赖没就绪 → 本插件保持 PENDING，不执行 apply（不是拿到 undefined）。提供方加载后自动唤醒。
2. 提供方被热卸 → 依赖方自动回退 PENDING；提供方恢复后自动重载。
3. 没写 inject 却直接 get → 拿到 undefined（get 是可选探测，不是硬依赖）。

所以「我必须有它」就一定要写 inject。可选依赖才用 ctx.tryGet / ctx.get。

#### 3.8.3 一个真实的坑：组件里拿不到 ctx.myImage

ctx.myImage 这种属性直访只在**插件作用域**成立（内核给插件 ctx 套了服务解析 Proxy，见 Context.ts:1045-1056）。

组件里拿到的根 Context **没有这个 Proxy**。项目里已有真实教训（plugin-node-text/src/TextContent.vue:36 的注释写得很清楚）：

    // 组件里必须用 ctx.get，不能用 ctx.text —— declare module 只增强类型，运行时属性是 undefined
    const { ctx } = useCanvasRender()
    const textService = ctx.get<TextNodeService>('text')

类型和运行时是两回事，记住这句就不会踩：

> declare module 只让 TypeScript 相信；真正拿到实例靠 ctx.get 或 inject。

#### 3.8.4 让消费方有类型：两处声明

接口定义成一个导出类型（3.8.1 的 MyImageServiceApi），然后在**你插件的源码里**做声明合并：

    // myImagePlugin.ts 内（模块级，不在 apply 里）
    declare module '@mini-canvas/canvas-data' {
      interface Context {
        myImage: MyImageServiceApi
      }
    }

消费方只要能拿到这个类型，写 ctx.myImage 就有提示；服务名由字符串变成编译期可查。

#### 3.8.5 什么该上架服务、什么不该

| 情况 | 做法 |
|---|---|
| 别的插件/组件要按名字调用我的功能 | 上架服务（ctx.provide / Service 子类） |
| 只是我自己插件内部用的数据 | ctx.state，不占服务名 |
| 我注册的是一张「可被替换的表」 | 注册场 registryOf(kind)，不是服务 |
| 我注册的是一次外部能力调用（文生图） | ctx.tools.register，不是服务 |

判断口诀：

> 「会换实现的一个能手」是服务；「一堆按名字取的条目」是注册场。

同一个服务名重复注入会直接抛错（[core] Service "xxx" is already injected），这是防静默覆盖；所以服务名要带插件前缀，别叫 'cache' 这种通用名。

#### 3.8.6 私有状态（不上架）

自己的数据不要占服务名：

    const cache = ctx.state<Map<string, string>>(new Map())
    // 随插件 scope 回收：卸载后 value 清空，不再可达

### 3.9 第九步：订阅事件、声明副作用

    ctx.on('ctx:plugin-installed', ({ name }) => { /* ... */ })

    ctx.effect(() => {
      const timer = setInterval(poll, 1000)
      return () => clearInterval(timer)      // 插件卸载自动执行
    })

### 3.10 第十步：完整文件长什么样

    // src/myNodePlugin.ts
    import { type Context, type PluginModule } from '@mini-canvas/canvas-base'
    import Content from './Content.vue'
    import Toolbar from './Toolbar.vue'
    import ProgressBar from './ProgressBar.vue'
    import { Config } from './myConfig'

    export const name = 'my-node'
    export const inject = ['doc'] as string[]

    export function apply(ctx: Context) {
      // 节点类型
      ctx.nodes.register({
        type: 'my-image', label: '我的图片', size: { w: 320, h: 240 },
        inputs: [{ port: 'target', acceptsTypes: ['text'] }],
        outputs: [{ port: 'source', contentType: 'image' }],
        in: Content,
        create: (position) => ctx.get('doc').transaction('add-my-image',
          tx => tx.createNode('my-image', position, { prompt: '' })),
      })

      // 区域组件
      ctx.nodes.attach('my-image', { id: 'my-toolbar', region: 'out:top', component: Toolbar, needs: ['node','zoom'] })
      ctx.nodes.attach('my-image', { id: 'my-progress', region: 'on:bottom', component: ProgressBar })

      // 命令 + 快捷键
      ctx.commands.register({
        id: 'my-image:generate', title: '生成图片', keys: ['mod+enter'],
        run: () => { /* ... */ },
      })

      // 画布级浮层
      ctx.slots.register('overlay', { id: 'my-panel', component: MyPanel })

      // 生成工具
      ctx.tools.register({ name: 'image.generate:my-model', produces: 'image', run: async () => ({ ok: true }) })
    }

    export { Config }
    export const myNodePlugin: PluginModule = { name, inject, Config, apply }

## 4. 主题插件的最终形态

主题插件是**唯一**可以直接 import canvas-render 和 VueFlow 的插件类型。它只做注册：

    // packages/plugins/plugin-theme-default/src/index.ts（目标形态）
    import type { CanvasPlugin, CanvasPluginContext } from '@mini-canvas/canvas-base'
    import BaseNode from './components/node/BaseNode.vue'
    import CustomEdge from './components/edge/CustomEdge.vue'
    import Background from './components/background/DefaultBackground.vue'
    import ConnectionLine from './components/edge/ConnectionLine.vue'
    import SettingsPanel from './components/settings/PluginSettingsDialog.vue'
    import { Button, Select, Slider, ColorField } from './components/ui'

    export const plugin: CanvasPlugin = {
      name: 'theme-default',
      apply(ctx: CanvasPluginContext) {
        // 主题槽：一个槽多 occupant，order 小者赢
        ctx.theme.register('nodeShell', BaseNode, { id: 'default', order: 0 })
        ctx.theme.register('edge', CustomEdge, { id: 'default', order: 0 })
        ctx.theme.register('background', Background, { id: 'default', order: 0 })
        ctx.theme.register('connectionLine', ConnectionLine, { id: 'default', order: 0 })
        ctx.theme.register('settingsPanel', SettingsPanel, { id: 'default', order: 0 })
        ctx.theme.register('edgeDefaultType', 'custom')

        // 设计系统目录：业务插件按名取，换主题零改动
        ctx.registryOf('ui').add('button', Button, { id: 'default' })
        ctx.registryOf('ui').add('select', Select, { id: 'default' })
        ctx.registryOf('ui').add('slider', Slider, { id: 'default' })
        ctx.registryOf('ui').add('color', ColorField, { id: 'default' })
      },
    }

换一套主题 = 装另一个主题插件，给更小的 order：

    ctx.theme.register('nodeShell', MyDarkNode, { id: 'dark', order: -10 })

默认主题被顶替后仍然在表里；卸载暗色主题即自动回退。

## 5. 宿主侧的最终形态

    import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
    import { myNodePlugin } from '@mini-canvas/plugin-my-node'
    import { plugin as themeDefault } from '@mini-canvas/plugin-theme-default'

    const { host, manager, api } = await createMiniCanvasHost({
      adapter: new LocalStorageAdapter(),
      coldPlugins: [themeDefault, myNodePlugin],
    })

    // 运行中热装 / 热卸 / 热重载
    manager.install(anotherPlugin)
    manager.uninstall('my-node')·g
    manager.reload('my-node', nextVersion)

宿主不需要知道插件内部注册了什么。插件注册的一切随 manager.uninstall 一起回收。

## 6. 今天就能写 vs 目标形态

| 操作 | 今天 | 目标 |
|---|---|---|
| 注册节点类型 | ctx.nodes.register(...) 可用 | 同左，但字段不再漏传 |
| 挂区域组件 | ctx.nodes.attach(...) 可用 | 同左，顺序只有一份事实 |
| 选择集区域 | ctx.selectionRegion.attach(...) 可用 | 同左 |
| 注册命令/快捷键 | ctx.commands.register({ keys }) 可用 | 同左 |
| 注册插槽 | ctx.slots.register(...) 可用 | 同左 |
| 注册工具 | ctx.tools.register(...) 可用 | 同左 |
| 声明配置 | 模块级 Config 可用 | 同左 |
| 能力包 | needs + useCapability 可用 | 同左 |
| UI 目录 | useUiComponent 可用 | 同左 |
| 服务 | ctx.get('doc') 可用 | 集中类型，不再手写泛型 |
| VueFlow | 需要直接 import canvas-render 或 useVueFlow | ctx.render.flow 稳定 facade |
| 主题替换 | 业务插件仍依赖 theme-default | 业务插件零改动 |
| 插件只依赖 canvas-base | 逻辑插件可以；组件插件不行 | 逻辑插件可以；组件插件加一个 render contract |

## 7. 要达到这个效果，还缺什么

按依赖顺序，只需要补四件事：

1. **修三个 P1 缺陷**：defineNode 字段透传、theme 注册场双写、node/region 的 order 双源。否则上面的伪代码在边界情况下行为不一致。
2. **在 canvas-base 补集中类型**：CanvasServices 映射、ctx.get 按名推导、CanvasPluginContext。
3. **在 canvas-render 补 ctx.render facade**：把 viewport / screenToFlow / flowToScreen / updateNodeVisual / updateNodeVisualSize / queryNodeEl 收成稳定接口；useVueFlow 退回内部使用。
4. **把主题共享组件挪出 theme-default**：MovingHandle、ConnectionLine、通用 UI 组件改成通过注册场或独立 adapters 包提供，然后删掉业务插件对 theme-default 的依赖。

做完这四件，本文第 3、4、5 节的伪代码就是真实可跑的形态，而不是目标草图。

## 8. 一句话记忆

    register 进注册场，
    need 走能力包，
    write 走 doc，
    look 走 ui 目录，
    flow 走 ctx.render。

插件作者只要记住这五个动词，不用认识 VueFlow、不用认识主题包、不用认识数据层内部。
