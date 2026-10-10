# 案例 7 · 给节点加底部动作（node/bar 式）

## 这个案例能做到什么

**装上这个插件，每种节点的下方多出一个「归档」按钮**。不用改 bottom-bar 插件一行代码，也不用改任何节点插件 —— 你自己的插件把动作「放」到底栏的注册表里，底栏自动把它画出来。

装上后你会看到：选中任意节点，节点下方出现一条底栏，里面有「归档」按钮；点它，节点标题变成「已归档」，历史记录里多一条可撤销的操作。**就算 bottom-bar 没装或还没装**，你的插件也照常启动，等它装好后动作自动出现。

这页同时是**插件之间怎么协作**的样板：怎么「不硬依赖」另一个插件（它不在也能活），怎么「等它装好再补注册」，以及为什么注册时必须用**自己插件的 ctx**。这三个问题是所有跨插件协作的通题 —— 仓库里节点插件往底栏放按钮，用的就是同一套写法。

## 完整代码

```
my-archive-action/
├── package.json       # 插件身份证
└── src/archivePlugin.ts  # 往底栏注册一个动作
```

```json
// 文件：my-archive-action/package.json
{
  "name": "@my/archive-action",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "归档动作",
    "description": "往节点底栏注册一个「归档」按钮（跨插件协作演示）",
    "pluginName": "archive-action",
    "installable": true
  },
  "main": "./src/archivePlugin.ts",
  "types": "./src/archivePlugin.ts",
  "exports": {
    ".": { "types": "./src/archivePlugin.ts", "default": "./src/archivePlugin.ts" },
    "./*": "./src/*"
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*",
    "@mini-canvas/canvas-data": "workspace:*",
    "@mini-canvas/plugin-bottom-bar": "workspace:*"  // ① 只 import 它的注册函数（类型），不写进 inject
  }
}
```

```ts
// 文件：my-archive-action/src/archivePlugin.ts
import type { Context } from '@mini-canvas/canvas-base'
// registerBarAction 是 bottom-bar 包导出的「注册糖」：一条函数调用，动作落进底栏的注册表。
import { registerBarAction } from '@mini-canvas/plugin-bottom-bar'

export const name = 'archive-action'

/**
 * ① 刻意不写 inject: ['nodeBar']。
 *    nodeBar 不是宿主必装的服务（有的宿主就不想要底栏）。硬依赖写进去，缺了它
 *    本插件就永远 PENDING 不启动 —— 但「归档」没底栏也能干活（这里给个命令兜底）。
 *    所以：注册函数照常 import（package.json 里加依赖），服务依赖留给 tryGet 探测。
 */
export function apply(ctx: Context): void {
  // 归档的真正实现：把标题改成「已归档」——走 doc 的统一写口（进历史、可撤销）。
  function archive(nodeId: string): boolean {
    const doc = ctx.doc
    const node = doc.getNode(nodeId)
    if (!node) return false
    doc.updateNode(nodeId, { data: { label: '已归档' } })
    return true
  }

  // ② 注册动作包成一个函数，方便「现在试一次 + 装好后再试一次」两处调用。
  //    返回 true = 注册成功（底栏在场）；false = 底栏还没装。
  const registerBar = (): boolean => {
    if (!ctx.tryGet('nodeBar')) return false
    // ③ 注意第一个参数是 ctx —— 本插件自己的上下文。这样这条动作的「归属」
    //    记在本插件名下：本插件卸载时，动作跟着自动从底栏摘除，不留死条目。
    registerBarAction(ctx, {
      id: 'archive.node',           // 动作唯一名（重复注册 = 替换，可热更新）
      types: undefined,             // 不挑节点类型：所有节点都显示这个按钮
      title: '归档',
      description: '把节点标题改成「已归档」',
      apply: 'self',                // ④ 结果我自己已经写进节点了，底栏别再找写入器写一遍
      order: 300,                   // 排序：越小越靠前（真实插件的复制=90、删除=100）
      run: (_input, runCtx) => {
        const ok = archive(runCtx.nodeId)
        return ok ? { ok: true } : { ok: false, error: '节点不存在了' }
      },
    })
    return true
  }

  // ⑤ 两条腿走路（关键！）：
  if (registerBar()) {
    // a) bottom-bar 已经装好 → 现在就注册。
    void 0
  } else {
    // b) 还没装 → 听「有插件装好了」的事件，每次响都再试一遍；成功就退订。
    //    装配顺序谁先谁后是宿主的事，插件不能赌顺序 —— 仓库真实插件就是这么写的。
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerBar()) off.dispose()
    })
  }

  // ⑥ 兜底命令：没底栏的用户也能归档（快捷键/右键菜单调命令即可）。
  ctx.commands.register({
    id: 'archive.node',
    title: '归档当前节点',
    run: (_cmd, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      return Boolean(nodeId) && archive(nodeId as string)
    },
  })
}
```

## 每一步在干什么

**底栏的协作模型**：bottom-bar 上架两个服务 —— `nodeBar`（读：列出动作、查写入器）和 `nodeTask`（跑：执行动作、写进度）。它还在内核里开了两张「注册场」：`node/bar`（动作表）和 `node/bar-applier`（结果写入器表）。别的插件往这两张场里放条目，底栏渲染时按节点类型筛出来画成按钮。**协作全靠场，谁也不 import 谁的内部代码。**

**① 为什么不硬依赖**：仓库把插件协作分成两种 —— `inject` 是硬依赖（缺了就不启动，用于「没它我没意义」），`tryGet` 是软探测（缺了返回 `undefined`，各自照常活着）。往底栏放按钮属于后者：bottom-bar 不装，你的节点功能一个不少。真实插件注释里专门写了这条规矩：「nodeBar 是插件服务，不是宿主恒在服务，故不进 inject」。

**③ 为什么传自己的 ctx**：这是**归属规则**，是本案例最重要的一条。`registerBarAction(ctx, …)` 把条目落进调用方 ctx 的插件作用域。底栏的服务实例是共享的，如果你传了别人的 ctx（或图省事用全局 ctx），条目就挂在别人名下 —— 你卸载时**摘不掉自己的动作**，底栏上留一个点了就报错的死按钮。所以注册糖必须收一个 ctx 参数，而且你只能传自己的。

**「写入器」补充**：一个内容类型（text/image/…）只允许一个写入器，重复注册同一个 kind 会直接抛错 —— 这是防止两个插件抢着写同一种节点。你若做一个新内容类型的节点插件，记得配一个写入器；若只是给现成类型加按钮，就不用碰它。

**④ apply: 'self' 与写入器**：动作有两种结局。生成类动作（调模型出图出文）走默认的 `'applier'`：结果交给「写入器」写回节点，每个内容类型一个写入器（`registerBarApplier(ctx, 'text', fn)`）；而「复制/删除/归档」这种即时动作，自己已经改完节点，声明 `apply: 'self'` 告诉底栏「别再写一遍」。真实插件两种都用：文本插件的「复制/删除」是 self，「AI 生成」走写入器。

**⑤ 等待模式为什么必要**：宿主按列表顺序装插件，顺序由宿主决定。如果 bottom-bar 排在你后面，你 `apply` 时 `tryGet('nodeBar')` 就是 `undefined`，动作没注册上，而且**不会有人回头通知你**。所以插件自己订阅 `ctx:plugin-installed`（每装好一个插件响一次），每次响都重试注册，成功就退订。注意：事件响了很多次也没关系，`registerBar` 里 `tryGet` 挡住了 —— 底栏不在就安静返回 false。

**⑦ 动作里的输入框与参数**：动作还能声明 `needsPrompt: true`（底栏显示大输入框）和 `fields`（复用工具的 `ToolParamDef`，底栏自动画参数控件）。最省事的路径是 `publishToolActions(ctx, { types: ['text'], produces: 'text', … })` —— 把 `ctx.tools` 里匹配的工具**整批**发布成底栏按钮，工具增减时它自动同步。这条链路真实插件每天都在用（见出处表第一行）。

### 省事进阶：把工具整批发布成底栏按钮

如果你装了案例 6 那样的生成工具，`publishToolActions` 一条调用就能让它们全部出现在底栏上 —— 不用为每个模型手写动作。真实文本节点插件的完整用法（节选自 `nodeTextPlugin.ts`，可对照抄）：

```ts
// 文件：my-archive-action/src/archivePlugin.ts（追加变体）
import { publishToolActions, registerBarApplier } from '@mini-canvas/plugin-bottom-bar'

// 放进上面 registerBar() 的 tryGet 之后、registerBarAction 之前即可：
publishToolActions(ctx, {
  types: ['text'],          // 发布给哪种节点（底栏按节点类型筛动作）
  produces: 'text',         // 只发布产出 text 的工具（案例 6 的 echo.demo 就会被挑中）
  needsPrompt: true,        // 底栏显示大输入框
  promptBinding: 'text',    // 输入框 = data.text：编辑即写回节点，生成结果也写回它
})
// 工具生成的文本怎么落进节点？给 text 类型配一个「写入器」：
registerBarApplier(ctx, 'text', (nodeId, result) => {
  // result.text 就是工具 run 返回的 { ok, text }；走 doc.updateNode 写回，是作品、可撤销。
  ctx.doc.updateNode(nodeId, { data: { text: typeof result.text === 'string' ? result.text : '' } })
})
```

发布糖在内部做的事（`toolActions.ts`）：扫一遍 `ctx.tools.list({ produces })`，把每个工具包成一条动作（`id = 'tool:' + 工具名`）注册进 `node/bar` 场；然后订阅 `ctx:plugin-installed` 和 `ctx:plugin-uninstalled` —— 有新工具装上就补一条，工具随插件卸载就摘掉对应动作。所以「加一个模型 = 装一个工具插件」，底栏自动跟上，谁也不用改代码。

注意归属还是老规矩：`publishToolActions(ctx, …)` 的条目落**调用方** scope（上面传的是节点插件自己的 ctx），工具动作随节点插件卸载而摘除，不挂在 bottom-bar 名下。

**⑧ order 与「卸载自动摘除」**：`order` 越小越靠前（没写的排最后）；同 id 再注册一次 = 替换（热更新就靠它）。归属规则保证每个动作都记在注册方名下，卸载时内核按 scope 清场 —— 你不写任何清理代码，这是整个系统的默认承诺。

**进度与取消是现成的**：生成类动作（返回轮询函数的）不用自己写进度条 —— 底栏的执行服务把进度写进节点的运行态（`doc.updateNodeRuntime`，不进撤销栈），覆盖层自动显示进度与「取消」按钮。取消走 `AbortSignal`：动作的 `runCtx.signal` 被 abort 后，轮询自然中断；如果任务已经提交到服务端，还可以实现可选的 `onCancel(taskId, ctx)` 钩子去服务端真正取消（不然服务端那个任务还在排队烧钱）。刷新页面后，底栏会把还在 running 的节点接回来继续轮询（`restoreAll`），这也是真实插件专门修过时机的部分 —— 冷启动时画布数据比插件事件来得晚，必须等文档真有内容了再续查。

**info()：按钮上的只读读数**。动作还能声明 `info(data)`（返回一个字符串，空串就不显示）—— 底栏把它渲染在动作旁当「读数」，比如文本节点的「12 字 · 3 行」。它只拿到节点 data，底栏不认识业务含义；你读到什么写什么，纯展示、不写节点。

## 仓库里的真实出处

| 这篇里的做法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| tryGet 探测 + 等待事件 + registerBarAction 全链路 | `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts`（`registerBar` 函数） | `if (!ctx.tryGet('nodeBar')) return false`；失败则 `ctx.on('ctx:plugin-installed', …)` 重试，成功后 `off.dispose()` |
| publishToolActions 批量发布工具动作 | 同上 | `publishToolActions(ctx, { types: ['text'], produces: 'text', needsPrompt: true, promptBinding: 'text' })` |
| 即时动作 apply: 'self' | 同上（`text.duplicate` / `text.delete` 两条动作） | 复制/删除动作直接调服务方法，`apply: 'self'`，order 90/100 |
| 注册糖的实现（归属=调用方 scope） | `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts`（底部「注册糖」一节） | `registerBarAction = (ctx, action) => ctx.registryOf<BarAction>(BAR_FIELD).add(action.id, action, { id: action.id })`；文件头注释写明「写走调用方作用域」 |
| 底栏读场渲染动作列表 | 同上 `NodeBarService.list(filter)` | 扫 `node/bar` 场、按 types 过滤、按 order 升序 |
| 写入器（结果写回节点） | 同上 `registerBarApplier` + nodeTextPlugin 里的 applier | `registerBarApplier(ctx, 'text', fn)`：把 result.text 经 `ctx.doc.updateNode` 写回，同 kind 重复注册抛错 |
| publishToolActions 的自动同步 | `packages/plugins/plugin-bottom-bar/src/toolActions.ts` | 把工具映射成动作注册，订阅 `ctx:plugin-installed/uninstalled` 增量增删 |
| 动作类型（BarAction 全字段） | `packages/plugins/plugin-bottom-bar/src/barTypes.ts` | `id/types/title/order/needsPrompt/fields/apply/run` 等字段定义，与内核工具共用同一套词表 |

## 常见坑

1. **把 'nodeBar' 写进 inject**。一旦写进去，宿主没装 bottom-bar 时你的插件永远不启动，节点功能全灭。正确姿势：依赖只加在 package.json（为了 import 注册函数），服务探测用 `ctx.tryGet('nodeBar')` + 等待事件。
2. **注册时传错 ctx**。传全局 ctx、传别的插件的 ctx，条目就归了别人 —— 你卸载后动作还挂在底栏上，点了指向已经死掉的代码。注册糖收 ctx 参数就是为了这条：**只传 apply 拿到的那个 ctx**。
3. **只在 apply 里注册一次，赌装配顺序**。bottom-bar 排你后面的话，动作永远不出现，而且没有任何报错 —— 这是「没注册上」而不是「注册失败」，最难查。必须像真实插件那样：现在试一次 + 听 `ctx:plugin-installed` 再试，成功退订。
4. **即时动作忘记 `apply: 'self'`**。不写默认是 `'applier'`：底栏会把你动作的返回值再交给写入器写一遍节点。你没注册过写入器时它找不到（无事发生），别人注册过时你的节点会被写入器改掉 —— 结果和预期完全对不上。自己写完节点的动作，一律声明 self。
5. **写入器重复注册同一个 kind**。一个内容类型只允许一个写入器，重复注册直接抛错 —— 后注册的那个插件会装载失败（apply 中途抛错，插件进 FAILED 态）。给现成类型（text/image/…）加按钮时不要碰写入器，那是「新内容类型」才需要配的东西。
