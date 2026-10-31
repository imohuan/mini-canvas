# 插件开发指南 —— mini-canvas v2（dsh 范式）

> 本指南讲"新增一个节点插件"怎么走。它证明了一条已跑通的架构链路：
> **插件 = 一个独立 workspace 包（放在 `packages/plugins/`），UI(.vue 区域组件) 和逻辑(apply) 放一起，
> 宿主按清单加载、零硬编码。**
> 样板：`packages/plugins/plugin-node-text`、`plugin-node-image`（`packages/ui` 里直接可见、可拖可连可删可编辑、刷新不丢）。

## 一、插件包的骨架长什么样

```
packages/plugins/plugin-node-<你的类型>/
  package.json            # name:@mini-canvas/plugin-node-xxx
                          #   dependencies: @mini-canvas/canvas-base: workspace:*（= kernel + canvas-data 的薄入口）
                          #   peerDependencies: vue ^3.5
  tsconfig.json           # moduleResolution: Bundler + DOM lib + src 下放 env.d.ts(*.vue shim)
  src/
    index.ts              # export { nodeXxxPlugin } ...
    nodeXxxPlugin.ts      # ★插件主体：name/inject/apply 一段式 + ctx.nodes.register(逻辑+UI 一体)
    XxxContent.vue        # ★UI：in 区域组件，随插件包走，不再放宿主
    env.d.ts              # declare module '*.vue'
```

## 二、插件主体怎么写（dsh 四件套落 Vue）

```ts
// nodeTextPlugin.ts —— 样板（plugin-node-text 实况）
import type { PluginModule } from '@mini-canvas/kernel'
import { registerNodeType } from '@mini-canvas/canvas-data'
import TextContent from './TextContent.vue'   // UI 在同包，一次 registerNodeType 一起注册

export const nodeTextPlugin: PluginModule = {
  name: 'text',          // 插件唯一名（服务注入/依赖用）
  deps: [],              // 真会 ctx.get 的服务名；缺则 loader 等它（当前内核扁平装载，deps 作文档/拓扑）
  setup(ctx) {           // 一段式，无 install/uninstall；副作用靠 ctx.on/effect/inject 自动回收
    // ★一次自描述：数据(type/label/尺寸/连接约束) + UI(in 区域组件) 一起落表
    registerNodeType(ctx, {
      type: 'text',
      label: '文本',
      defaultSize: { w: 300, h: 200 },
      segments: { in: TextContent },       // in 是 .vue 组件句柄(opaque)，落在卡片内部
      // inputs: [{ accepts: ['image'], limit: 'single' }],   // 声明式连接约束(可选)
    })
    // ……其余插件逻辑：ctx.get('doc')/ctx.inject('text', service) 等
  },
}
```

要点：
- **内核不 import 插件、不 import 任何 .vue**；组件是 opaque 句柄，由插件经
  `registerNodeType` 交出去，内核渲染壳(BaseNode)只负责槽位。依赖方向恒为 插件→内核。
- `registerNodeType` 一次写两处：`doc`(数据；5c 起旧的 `nodeStore` 服务名已下线) +
  `nodeRegistry`(展示)，宿主不再手 seed 段组件。
- 段组件在渲染子树内，用 `useCanvasRender()` 拿 `ctx`（`ctx.get('doc')` / `ctx.get('text')` 等），
  **不反向依赖宿主**，也不需要自建注入令牌。

> **位置名只有十个区域词**（设计文档 §五）：`in` / `title` / `out:top` / `out:bottom` /
> `out:left` / `out:right` / `on:top` / `on:bottom` / `over:inset` / `over:outset`。
> 老五段名（`content` / `top-toolbar` / `bottom-toolbar` / `overlay`）**已在步骤 9 下线**：
> 写它们是编译期类型错误，运行时也会抛错并列出十个合法词。

## 三、宿主怎么加载（manifest 即 plugins 数组）

宿主(任何消费方)把想启用的插件列进 `<CanvasHost :plugins="…">` 的数组（或
`createMiniCanvasHost({ coldPlugins })` / 给一份 `manifest`，见 `packages/ui/src/assembly.ts`）：
```ts
import { CanvasHost } from '@mini-canvas/canvas-render'
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { APP_PLUGINS } from './assembly'
```
```html
<CanvasHost :plugins="APP_PLUGINS" :adapter="new LocalStorageAdapter()" />
```
宿主零硬编码某个具体插件的 UI 组件；加/减插件只改这份数组。渲染时 `nodeTypes` 统一指到 BaseNode 壳，
壳经 `nodeRegistry` 按 type 解析各区域组件——插件自带的 UI 就这样出现在画布上。

## 四、新增一个节点插件的 checklist

1. 复制 `plugin-node-text` 目录为 `plugin-node-<type>`，改 `package.json` 的 name。
2. 写 `<Type>Content.vue`（展示/编辑该类型内容；需要服务就 `useCanvasRender()` 拿 `ctx` 后 `ctx.get('你的服务')`）。
3. 写 `<Type>NodePlugin.ts`：`registerNodeType` 注册 + 可选 `ctx.inject('<type>', service)` + 建节点逻辑。
4. 宿主 `packages/ui/src/assembly.ts` 的 `APP_PLUGINS` 数组里加它（若想在成品应用里看到）。
5. `pnpm install` 认到新包；`pnpm -C packages/plugins/<你的包> typecheck` 干净。
6. `pnpm -C packages/plugins/<你的包> test` 全绿；
   起 `pnpm -C packages/ui dev` 目验能看到、能操作。

## 五、红线 / 契约
- 不碰 `src/`(老版宿主)；不把 M6 复杂件(裁剪/蒙版/backend)带进当前节点。
- 内核公开接口(registerNodeType/ctx)按 `docs/design/core-layers-and-registry.md` + ADR 走；要改先改文档。
- 依赖方向恒 插件→内核，禁止内核反向 import 插件。

## 六、给节点加上/下控制栏（插槽怎么写）

节点的上/下控制栏是**壳提供的插槽**，位置由壳算，插件只管内容：

```ts
ctx.nodes.register({
  type: 'image', label: '图片', size: { w: 320, h: 240 },
  in: ImageContent,
  segments: {
    'out:top': ImageTopToolbar,      // 浮在卡片上缘之外
    'out:bottom': ImageGeneratePanel, // 浮在卡片下缘之外
  },
})
```

三条约定（照做就不会踩坑）：

1. **区域组件里不要写定位**。贴边距离（设置面板「布局/控制栏」的两项偏移）、水平居中、
   `scale(1/zoom)` 反缩放全部由壳 `BaseNode` 的定位层（`.v2-slot--top/--bottom`）负责。
   插件组件写成普通流式内容（只排自己的内部布局 + 自己的材质/宽度）。
2. **同一区域可以叠多个**。别的插件可以往任意 type 的任意区域挂东西，不必改那个插件：
   `ctx.nodes.contribute('image', 'out:top', MyButton)`（带 `id`/`order`，卸载自动摘除）。
3. **按钮用现成的**。`NodeToolbarButton`（从 `@mini-canvas/plugin-theme-default` 导出）已按
   UI 规范做好图标按钮的尺寸/hover/focus/禁用/激活态；纯图标时 `title` 即无障碍名称。
   自己画也行，但按钮数值请照 `docs/design/ui-style-guide.md` §3.3。

区域组件只收到 `{ id, data }`；"我该不该出现"由组件自己判断
（通常用 `useSoleNodeSelected(id)` —— 恰好选中一个且是我才显示，多选时全部收起；
壳另外会在框选手势进行中整体压掉上/下插槽）。

最小例子（一个只往区域挂件、不注册 type 的插件）：

```ts
export const name = 'image-extra-actions'
export function apply(ctx: Context) {
  ctx.nodes.contribute('image', 'out:top', MyButton, { order: 5 })
}
```

---

## 六a、底栏动作（plugin-bottom-bar）：可替换底部状态栏

text/image/video 节点的底部控制栏统一由 `@mini-canvas/plugin-bottom-bar` 渲染
（一个 `BottomBarHost` 挂在 `out:bottom`，读 `themeRegistry.winner('bottomBar')`）。
各节点插件不再自己挂 `out:bottom` 基座段。

**怎么往底栏加一个动作**（在你的插件 `apply(ctx)` 里）：

```ts
import { registerBarAction, registerBarApplier, publishToolActions } from '@mini-canvas/plugin-bottom-bar'

// 1) 注册一个动作（条目落在**你的插件**作用域：卸载自动摘除、同 id 替换）
registerBarAction(ctx, {
  id: 'video.generate:seedance',   // 唯一标识；同 id 重复注册 = 替换（热更）
  types: ['video'],                // 给哪些节点类型；省略 = 所有类型
  title: '生成视频',
  needsPrompt: true,               // 显示大输入框
  fields: [                        // 可视化配置：复用内核 ToolParamDef（下拉/数字/开关/自定义组件）
    { key: 'ratio', label: '比例', type: 'select', default: '16:9', options: [{ label: '16:9', value: '16:9' }] },
  ],
  run: (input, runCtx) => ({ ok: true, urls: ['…'] }),
  // 异步任务：return 一个轮询函数（内核 ToolPollFn 形态），可选声明 resume(taskId) 供刷新后续查
})
```

- **归属**：动作落 `ctx.registryOf('node/bar')`，用的是你插件自己的 ctx ——
  不要存在 `NodeBarService` 上（那是共享单例，条目会挂到 bottom-bar 名下）。
- **结果写回**：动作默认把结果交给「同类型写入器」（`registerBarApplier`，一个类型一个）；
  动作自己改节点（复制/删除/旋转/下载）就声明 `apply: 'self'`。
- **进度与状态**：`nodeTask` 每帧写 `data.runState`（`doc.updateNodeRuntime`：落盘但**不进撤销栈**），
  形状 `{ status, progress, message, taskId, actionId, startedAt }`；覆盖层挂 `over:inset`，
  按 `status === 'running'` 显隐。
- **消费入口**（组件里用 `ctx.get`，根 ctx 没有服务代理）：
  `ctx.get('nodeBar').list({ type })` 读动作；执行走 `ctx.get('canvas').runBarAction(nodeId, actionId, input)`。

**整体换皮**（像主题那样换掉整个底栏 UI）：

```ts
ctx.theme.add('bottomBar', MyBottomBar, { order: -1 })   // order 最小者赢
```

**把 ctx.tools 里的模型自动发布成动作**（保持「加一个模型 = 装一个工具插件」）：

```ts
publishToolActions(ctx, { types: ['image'], produces: 'image', needsPrompt: true })
```

完整示例：`packages/plugins/plugin-web2api-tools`（多平台预置动作 + 参数下拉 + 异步轮询
+ 刷新续查 + 结果写入器），以及 `packages/ui/e2e/web2api-bottom-bar.mjs`（浏览器里
现场注册一条假动作，演示覆盖层与落盘，不进成品清单）。
