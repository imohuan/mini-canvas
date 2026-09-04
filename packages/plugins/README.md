# 插件开发指南 —— mini-canvas v2（dsh 范式）

> 本指南讲"新增一个节点插件"怎么走。它证明了一条已跑通的架构链路：
> **插件 = 一个独立 workspace 包（放在 `packages/plugins/`），UI(content .vue) 和逻辑(setup) 放一起，
> 宿主按清单加载、零硬编码。**
> 样板：`packages/plugins/plugin-node-text`、`plugin-node-image`（vite demo 直接可见、可拖可连可删可编辑、刷新不丢）。

## 一、插件包的骨架长什么样

```
packages/plugins/plugin-node-<你的类型>/
  package.json            # name:@mini-canvas/plugin-node-xxx
                          #   dependencies: @mini-canvas/canvas-core-v2: workspace:*
                          #   peerDependencies: vue ^3.5
  tsconfig.json           # moduleResolution: Bundler + DOM lib + src 下放 env.d.ts(*.vue shim)
  src/
    index.ts              # export { nodeXxxPlugin } ...
    nodeXxxPlugin.ts      # ★插件主体：name/inject/setup 一段式 + registerNodeType 注册(逻辑+UI 一体)
    XxxContent.vue        # ★UI：content 组件，随插件包走，不再放宿主 demo
    env.d.ts              # declare module '*.vue'
```

## 二、插件主体怎么写（dsh 四件套落 Vue）

```ts
// nodeTextPlugin.ts —— 样板（plugin-node-text 实况）
import type { PluginModule } from '@mini-canvas/canvas-core-v2'
import { registerNodeType } from '@mini-canvas/canvas-core-v2'
import TextContent from './TextContent.vue'   // UI 在同包，一次 registerNodeType 一起注册

export const nodeTextPlugin: PluginModule = {
  name: 'text',          // 插件唯一名（服务注入/依赖用）
  deps: [],              // 真会 ctx.get 的服务名；缺则 loader 等它（当前内核扁平装载，deps 作文档/拓扑）
  setup(ctx) {           // 一段式，无 install/uninstall；副作用靠 ctx.on/effect/inject 自动回收
    // ★一次自描述：数据(type/label/尺寸/连接约束) + UI(content 组件) 一起落表
    registerNodeType(ctx, {
      type: 'text',
      label: '文本',
      defaultSize: { w: 300, h: 200 },
      segments: { content: TextContent },       // content 是 .vue 组件句柄(opaque)
      // inputs: [{ accepts: ['image'], limit: 'single' }],   // 声明式连接约束(可选)
    })
    // ……其余插件逻辑：ctx.get('nodeStore')/ctx.inject('text', service) 等
  },
}
```

要点：
- **内核不 import 插件、不 import 任何 content .vue**；content 是 opaque 句柄，由插件经
  `registerNodeType` 交出去，内核渲染壳(BaseNode)只负责槽位。依赖方向恒为 插件→内核。
- `registerNodeType` 一次写两处：`nodeStore`(数据) + `nodeRegistry`(展示)，宿主不再手 seed content。
- content 组件要调插件服务，经内核注入令牌 `HOST_KEY` 拿宿主句柄再 `host.ctx.get('text')`，
  **不反向依赖 demo-web**（令牌已上收到内核 `components/contentBridge.ts`）。

## 三、宿主怎么加载（manifest 即 plugins 数组）

宿主(demo-web / 任何消费方)把想启用的插件列进 `bootCanvas({ plugins })`：
```ts
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'   // 或由内核装配点内置
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
const host = await bootCanvas({
  adapter: new LocalStorageAdapter(),
  plugins: [nodeImagePlugin, /* 更多… */],
  nodeRegistry: registry,   // 宿主同步 provide 的展示注册表，插件往里注册 content
})
```
宿主零硬编码某个具体插件的 UI 组件；加/减插件只改这份数组。渲染时 `nodeTypes` 统一指到 BaseNode 壳，
壳经 `nodeRegistry` 按 type 解析 content——插件自带的 UI 就这样出现在画布上。

## 四、新增一个节点插件的 checklist

1. 复制 `plugin-node-text` 目录为 `plugin-node-<type>`，改 `package.json` 的 name。
2. 写 `<Type>Content.vue`（展示/编辑该类型内容；需要服务就 `inject(HOST_KEY)` 后 `ctx.get('你的服务')`）。
3. 写 `<Type>NodePlugin.ts`：`registerNodeType` 注册 + 可选 `ctx.inject('<type>', service)` + 建节点逻辑。
4. 宿主 demo 的 `plugins` 数组里加它（若想 demo 里看到）。
5. `pnpm install` 认到新包；`pnpm -r run typecheck` 干净。
6. 跑 `cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run` 全绿；
   起 `pnpm dev` 目验能看到、能操作。

## 五、红线 / 契约
- 不碰 `src/`(老版宿主)；不把 M6 复杂件(裁剪/蒙版/backend)带进当前节点。
- 内核公开接口(registerNodeType/ctx)按 `docs/plan/canvas-core-v2-api.md` + ADR 走；要改先改文档。
- 依赖方向恒 插件→内核，禁止内核反向 import 插件。
