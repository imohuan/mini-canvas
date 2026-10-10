# 案例 5 · 提供服务给别人用（Service 式）

想让别的插件（或宿主）调用你的能力？两种方式：简单场景用 `ctx.inject('名字', 实现)`
上架一个对象；要类型安全、生命周期清晰就用 `Service` 子类。消费者用 `ctx.get('名字')`
拿 —— **缺了返回 undefined 不抛错**；要"缺了就不装"的硬依赖，写模块级 `inject = [...]`。

## 这个案例能做到什么

装上后你会看到：画布左下角一个"随机建方块"按钮 —— 点一下，画布上出现一个随机位置的
text 节点（前提：已装 node-text 插件）。这个"建方块"能力同时上架成服务 `block-spawner`：
别的插件或宿主代码 `ctx.get('block-spawner')` 就能拿到同一个按钮背后的方法，程序化建节点。

## 完整代码

目录就这几个文件：

    my-block-spawner/
    ├── package.json            # 插件清单
    └── src/index.ts            # 插件入口：Service 子类上架服务 + overlay 按钮

```json
// 文件：my-block-spawner/package.json
{
  "name": "my-block-spawner",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "随机建方块",
    "description": "画布角落按钮：随机位置建一个 text 节点；能力同时上架为服务",
    "pluginName": "block-spawner",
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
    "@mini-canvas/canvas-base": "workspace:*",   // Service 基类在这层
    "@mini-canvas/canvas-data": "workspace:*"    // DocService 类型在这层（declare module 要用）
  },
  "peerDependencies": {
    "@mini-canvas/canvas-render": "workspace:*",
    "vue": "^3.5.34"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vue": "^3.5.34"
  }
}
```

```ts
// 文件：my-block-spawner/src/index.ts
import { Service, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import { markRaw } from 'vue'
import type { DocService } from '@mini-canvas/canvas-data'
import SpawnerButton from './SpawnerButton.vue'

// ① 服务形状：别的插件/宿主能调用的方法清单。写清楚注释，消费方才知道每个方法干嘛
export interface BlockSpawnerService {
  /** 在 flow 坐标处建一个 text 节点，内容固定"方块"；返回节点 id（text 类型未注册返回 ''） */
  spawnBlock(at: { x: number; y: number }): string
  /** 随机位置建一个；同上 */
  spawnRandom(): string
}

// ② 类型增强（declare module）：让 `ctx.get('block-spawner')` 有完整类型提示，
//    甚至可以 `ctx.blockSpawner` 直访。声明合并发生在编译期，不产生任何运行时代码
declare module '@mini-canvas/canvas-data' {
  interface Context {
    blockSpawner: BlockSpawnerService
  }
}

// ③ Service 子类：构造时 `super(ctx, 'block-spawner')` 就把 this 上架成服务 —— 不用手写 ctx.inject
class BlockSpawnerServiceImpl extends Service implements BlockSpawnerService {
  constructor(ctx: Context) {
    super(ctx, 'block-spawner')
  }

  // ④ 惰性取依赖：每次用的时候 ctx.get，不缓存到字段里。
  //    插件/服务会被卸载重装，缓存引用 = 可能拿到已回收的旧实例
  private get doc(): DocService {
    return this.ctx.get('doc')
  }

  spawnBlock(at: { x: number; y: number }): string {
    // ⑤ 建节点走 doc.transaction：一次事务 = 一条历史记录，用户 Ctrl+Z 一次就撤掉
    return this.doc.transaction('spawn-block', (tx) => tx.createNode('text', at, { text: '方块' }))
  }

  spawnRandom(): string {
    const x = Math.round(Math.random() * 400)
    const y = Math.round(Math.random() * 300)
    return this.spawnBlock({ x, y })
  }
}

export const name = 'block-spawner'

// ⑥ 硬依赖：缺 doc（画布数据服务）插件就不该启动 —— 内核保证 apply 执行前 doc 已就绪，
//    缺提供方则本插件停留 PENDING 不跑（不会拿到 undefined 再炸）
export const inject = ['doc'] as string[]

export function apply(ctx: Context): void {
  // ⑦ 构造即上架：new 的一瞬间 'block-spawner' 服务就在 ctx 服务表里了。
  //    Service 基类内部用 ctx.provide（effect 语义）—— 卸载自动回收，不用手写撤销
  const svc = new BlockSpawnerServiceImpl(ctx)

  // ⑧ overlay 放一个按钮：按钮调的就是上面的服务方法（同一条实现，不是复制的逻辑）
  ctx.slots.register('overlay', {
    id: 'block-spawner-button',
    order: 96,
    component: markRaw(SpawnerButton),
    meta: { title: '随机建方块' },
  })
  // （svc 变量在这里其实没别的用处 —— Service 构造已经完成上架，
  //  按钮组件和消费方都是各自 ctx.get('block-spawner') 拿。显式 new 是为了把"谁上架"写在明处）
  void svc
}

export const blockSpawnerPlugin: PluginModule = { name, inject, apply }
```

```vue
<!-- 文件：my-block-spawner/src/SpawnerButton.vue -->
<!-- overlay 按钮：消费本插件自己上架的服务（同一进程内 ctx.get 永远拿同一个实例） -->
<script setup lang="ts">
import { useCanvasRender } from '@mini-canvas/canvas-render'

const { ctx } = useCanvasRender()

// tryGet：服务没上架（比如热卸中）返回 undefined，按钮变灰但不崩
const svc = ctx.tryGet<{ spawnRandom(): string }>('block-spawner')

function onClick(): void {
  svc?.spawnRandom()
}
</script>

<template>
  <button class="spawner" :disabled="!svc" @click="onClick">随机建方块</button>
</template>

<style scoped>
.spawner { position: absolute; left: 16px; bottom: 52px; padding: 4px 12px;
  border: 0; border-radius: 8px; background: rgb(17 24 39 / 0.85); color: #fff;
  font-size: 13px; cursor: pointer; pointer-events: auto; }
</style>
```

**消费端怎么用**（写在任何插件或宿主代码里）：

```ts
// 文件：另一个插件或宿主代码（示意，不是本示例的文件）
import type { BlockSpawnerService } from 'my-block-spawner' // 只 import 类型，不产生运行时依赖

// 可选消费：ctx.get 缺服务返回 undefined 不抛错 —— 先判空再用
export function apply(ctx: Context): void {
  const spawner = ctx.get<BlockSpawnerService | undefined>('block-spawner')
  if (spawner) spawner.spawnRandom()

  // 有类型增强时更顺：ctx.blockSpawner 也有完整类型（运行时仍是 get，缺了 undefined）
  ctx.blockSpawner?.spawnBlock({ x: 100, y: 100 })
}
```

## 每一步在干什么

**① 定义服务接口。** 服务是"给别人用的能力"，接口就是合同：方法要少而清楚，注释写明返回值和
边界情况（`spawnBlock` 注释里写了"text 类型未注册返回 ''"—— 消费方看注释就知道要处理空串）。

**② `declare module` 类型增强。** 让全仓库用这个服务的人都有类型提示，甚至 `ctx.blockSpawner`
直访。不加声明也能用（`ctx.get<...>('名字')` 手写泛型），但每个消费点都要重写一遍类型。
声明合并发生在编译期，不产生任何运行时代码。

**③ Service 子类：`super(ctx, 'block-spawner')` 一行完成上架。** 基类构造函数内部调
`ctx.provide(name, this)`，随插件 scope 自动回收（卸载即摘除），不用手写 `ctx.inject` + 撤销配对。

**④ 依赖惰性取，不缓存。** `private get doc()` 每次访问都现取 —— 服务和被依赖方都可能卸载重装，
缓存到字段里的引用是脏的（拿到已回收的旧实例，操作它 = 静默不生效或报错）。现取永远拿现时实例。
node-text 和 file-drop 两个真实插件都用 getter 惰性取。

**⑤ `doc.transaction` 建节点。** 一次事务 = 一条历史记录，用户 Ctrl+Z 一次撤掉整个动作。
别绕过 doc 直接改 nodeStore —— 老的 nodeStore/edgeStore/history 服务已并入 doc，单独入口不存在了；
走 transaction 还能保证"提交落盘"自动发生。

**⑥ `inject = ['doc']` 硬依赖。** 内核保证 apply 执行前 doc 已就绪；缺提供方则本插件停留
PENDING 不跑（而不是 apply 里拿到 undefined 再炸）。判断标准："缺它就没意义"的依赖写 inject；
"有更好、没有也能工作"的用 `ctx.tryGet` 可选探测。

**⑦ `new ServiceImpl(ctx)` 构造即上架。** apply 里显式 new 一次，"谁上架的服务"写在明处。
变量本身后续用不上（`void svc` 是消掉未用告警）—— 真正消费方都是各自 `ctx.get` 拿同一个实例。

**⑧ UI 和服务共用一条实现。** overlay 按钮调 `svc.spawnRandom`，别的插件也调同一个方法。
逻辑只有一份，改 bug 改一处。file-drop 插件自己内部（drop 监听）也调自己服务的 `addFiles`，
和这个结构一模一样。

**消费端怎么找真实例子。** 本仓库消费 file-drop 服务的地方在装配测试：
`packages/ui/src/__tests__/nodePluginsAssembly.test.ts:148`，用 `ctx.get<{ canHandle(…);
addFiles(…) }>('file-drop')` 拿服务、断言"装上了且三类文件都能接住"。这就是"别人怎么用你"的
真实样子：拿接口、调方法、不关心内部实现。

**服务会被换实现，所以"一张表"别做成服务。** 服务（ctx.inject / Service）适合"能手"——
会换实现的能力（比如 file-drop 换一套 readers 注入测试）。而"一张表"（往里面注册条目的东西，
比如节点类型表、命令表、槽）要用注册场（registry / field），不是服务 —— 写反了换实现时
整张表跟着换，别的插件注册的东西全丢。这是本仓库架构的一条铁律（案例速查里的"能手/一张表"口诀）。

**两种上架方式怎么选**：能力就是一个普通对象（无生命周期逻辑）→ `ctx.inject('名字', 对象)`
一步到位；能力有自己的状态、多个方法、依赖别的服务 → `Service` 子类更清晰（`this.ctx` 现取依赖、
类型收拢在一个类里）。仓库里两种都有真实用法。

**怎么测你的服务。** 照 file-drop 自己的装配测试抄：赽数据层内核 → `ctx.plugin(fileDropPlugin)`
→ `ctx.get<FileDropService>('file-drop')` → 断言方法行为（见
`packages/plugins/plugin-file-drop/src/__tests__/fileDropWiring.test.ts`，里面有"卸载插件后
监听全部摘掉""开关关掉时连监听都不挂"等真实断言）。服务是纯逻辑，node 里就能测，不用开浏览器。

## 仓库里的真实出处

| 真实文件 | 对应示例 | 行为 |
| --- | --- | --- |
| `packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:46` | 步骤 ① | `export interface FileDropService { addFiles(…): Promise<number>; addPastedText(…); canHandle(…) }` |
| `packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:55` | 步骤 ② | `declare module '@mini-canvas/canvas-data' { interface Context { fileDrop: FileDropService } }` |
| `packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:176` | 步骤 ③ | `export class FileDropServiceImpl extends Service implements FileDropService` |
| `packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:183` | 步骤 ③ | `super(ctx, 'file-drop')` —— 构造即上架 |
| `packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:188` | 步骤 ④ | `private get doc(): DocService { return this.ctx.get('doc') }` —— getter 惰性取 |
| `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts:65` | 步骤 ③ 另一例 | `export class TextService extends Service implements TextNodeService` + `super(ctx, 'text')` |
| `packages/kernel/src/Context.ts:655` | 服务名唯一性 | 同名服务重复注入抛错：`throw new Error('[core] Service … is already injected')` |
| `packages/plugins/plugin-mini-map/src/miniMapPlugin.ts:37` | 简单版上架 | `ctx.inject('mini-map', state)` —— 不用 Service 类，直接上架 reactive 对象 |
| `packages/kernel/src/service.ts:26` | Service 基类 | `ctx.provide(name, this)` 随 scope 自动回收（构造函数里上架） |
| `packages/kernel/src/Context.ts:687` | `ctx.get` 语义 | 缺服务返回 `undefined`（Map.get），不抛错 |
| `packages/ui/src/__tests__/nodePluginsAssembly.test.ts:148` | 真实消费端 | `ctx.get<{ canHandle(…); addFiles(…) }>('file-drop')` —— 成品 UI 装配测试拿 file-drop 服务验证"装上了且能用" |
| `packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:348` | 内部消费 | 插件自己的 drop 监听也调 `svc.addFiles(...)` —— UI 与监听共享同一服务实例 |

## 常见坑

- **`ctx.get` 缺服务返回 `undefined`，不抛错**。别指望它"取不到就报错提醒你"—— 它是安静的
  `Map.get`。想"缺了就别装"用模块级 `inject`（内核保证就绪或插件 PENDING）；想"有就用没就跳过"
  用 `ctx.tryGet` 后判空。用错了场景 = 服务没装、代码静默不跑，排查半天。
- **缓存服务引用 = 卸载后拿到脏实例**。 `const doc = ctx.get('doc')` 缓存到模块级变量，
  doc 重装后你拿的还是旧对象。正确姿势：方法里现取（getter 或局部 const），用完即丢。
- **服务名要全局唯一，且最好和插件名一致或相关**。服务表就是一张平坦的 Map；两个插件上架
  同名服务，后装的会响亮抛错（`[core] Service … is already injected`），装配失败。真实插件都用
  插件名相关的名字：`file-drop`、`text`、`mini-map`。
- **类型增强的模块名要对**。`declare module '@mini-canvas/canvas-data'` 增强的是 Context ——
  写成 `'@mini-canvas/kernel'` 或当前插件自己的包名，类型合并不生效（编译不报错，但消费者拿不到提示）。
