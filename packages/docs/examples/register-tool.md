# 案例 6 · 注册生成工具（ctx.tools 式）

## 这个案例能做到什么

**装上这个插件，画布上就多了一批「生成工具」**：文本节点（或任何认 text 产物的节点）的面板里，模型下拉会多出你的模型；用户点「生成」，你的函数被调用，结果自动写回节点。

装上后你会看到：节点面板的模型列表里出现「回声模型」（下面示例注册的工具名）；选它、点生成，节点里出现一段重复你提示词的文字。**本示例不用后台**：工具函数直接在浏览器里回显文字，照抄就能跑 —— 仓库真实的工具插件则把请求发给生成后台（见文末出处表）。

## 完整代码

```
my-echo-tool/
├── package.json      # 插件身份证
└── src/echoTools.ts  # 工具本体：声明 + 注册
```

```json
// 文件：my-echo-tool/package.json
{
  "name": "@my/echo-tool",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "miniCanvas": {
    "title": "回声工具",
    "description": "把用户输入的提示词原样重复一遍（演示 ctx.tools.register）",
    "pluginName": "echo-tool",
    "installable": true
  },
  "main": "./src/echoTools.ts",
  "types": "./src/echoTools.ts",
  "exports": {
    ".": { "types": "./src/echoTools.ts", "default": "./src/echoTools.ts" },
    "./*": "./src/*"
  },
  "dependencies": {
    "@mini-canvas/canvas-base": "workspace:*"   // 工具插件的类型都从这里拿
  }
}
```

```ts
// 文件：my-echo-tool/src/echoTools.ts
// 一个纯 ts 文件就能当插件：不需要 Vue、不需要 DOM，node 测试也能跑。
import type { Context, ToolDef } from '@mini-canvas/canvas-base'

export const name = 'echo-tool'

/**
 * ① 硬依赖 ['tools']：工具注册表是内核自带的常驻服务，永远在。
 *    写上它有两个好处：一是内核知道「我只在工具这件事上工作」，二是
 *    读代码的人一眼看到这个插件在干嘛。
 */
export const inject = ['tools'] as string[]

/**
 * ② 建一个工具。ToolDef 就是「一张工具说明书」：
 *    名字、显示名、吃什么、吐什么、参数长什么样、run 怎么执行。
 */
export function createEchoTool(): ToolDef {
  return {
    // ③ 全局唯一名。建议「功能:型号」这种写法，例如 text.generate:xxx。
    //    同名工具重复注册会抛错（防手滑覆盖别人）。
    name: 'echo.demo',
    title: '回声模型',                        // 模型下拉里显示的名字
    description: '把提示词原样重复一遍（演示用）', // 悬停提示
    group: '演示',                            // 分组名，UI 据此归类
    produces: 'text',                         // ④ 我产出 text：吃 text 的输入口/面板就认它
    accepts: ['text'],                        // 我接收 text 素材（上游文本会送进 run）

    // ⑤ params：声明式参数。UI 会照这张表自动画控件 —— 你不用写一行 UI 代码。
    params: [
      {
        key: 'repeat',          // 值存在 input.params.repeat
        label: '重复次数',
        type: 'number',         // number 控件；配 min/max/step 时渲染成滑块/数字输入
        default: 1,
        min: 1,
        max: 5,
        step: 1,
      },
    ],

    // ⑥ run = 工具真正干活的地方。input 里有用户填的三样：prompt（输入框内容）、
    //    params（参数）、resources（上游连进来的素材）。runCtx 里有发起节点的
    //    id（runCtx.nodeId）和画布 id（runCtx.canvasId），调用方给什么这里收什么。
    async run(input, runCtx) {
      const times = typeof input.params?.repeat === 'number' ? input.params.repeat : 1
      const text = input.prompt ?? ''
      const echo = Array.from({ length: times }, () => text).join('\n')
      return {
        ok: true,
        // ⑦ 文本产物放进 result.text —— 面板/底栏按 produces: 'text' 读这个字段。
        text: echo || '（没有输入）',
        // runCtx.nodeId 是「谁发起的调用」，后台工具拿它把结果写回对应节点。
        // 本示例直接返回文本，写回的动作由面板完成。
        taskId: runCtx.nodeId,
      }
    },
  }
}

/**
 * ⑧ apply：注册进 ctx.tools。注册这一下就自动登记了「撤销」——
 *    插件卸载时工具从表里消失，不用自己写清理代码。
 */
export function apply(ctx: Context): void {
  ctx.tools.register(createEchoTool())
}
```

真实插件通常不止一个模型，而且多半要走后台。下面两段是仓库真实插件的「进阶写法」，同样可以照抄。

### 进阶 1 · 后台任务形态：先提交，再轮询

很多生成 API 的节奏是「提交任务 → 拿 taskId → 轮询进度」。内核把这套节奏收口成两种返回形态：直接返回 `ToolResult` 是同步完成；返回一个**轮询函数**，内核就替你定时调用、转发进度，直到某次返回 `status: 'done'`。真实插件的 `run` 就是这个形状（简化自 `textGenerationTools.ts`）：

```ts
// 文件：my-echo-tool/src/echoTools.ts（进阶变体）
// 把 echo 的 run 换成下面这样，就从「本地回显」升级成「走后台任务」。
import type { ToolResult, ToolPollFn } from '@mini-canvas/canvas-base'
// baseUrl 从插件的 Config 拿（见进阶 2）；这里示意为已解析好的字符串。

async run(input, runCtx): Promise<ToolResult | ToolPollFn> {
  // ① 提交任务。真实插件 POST {baseUrl}/api/tasks，字段对齐后台约定：
  //    kind（产物类型）、promptText（提示词）、targetNodeId / canvasId（发起方）。
  const submit = await fetch(baseUrl + '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'text',
      promptText: input.prompt,
      targetNodeId: runCtx.nodeId,
      canvasId: runCtx.canvasId,
    }),
  })
  const data = (await submit.json()) as { ok?: boolean; taskId?: string; error?: string }
  // ② 提交失败 = 同步失败：立刻给终态 { ok: false, error }。
  //    不抛异常、也不返回 running —— 让 UI 马上看到明确的失败原因。
  if (!submit.ok || !data.ok || !data.taskId) {
    return { ok: false, error: data.error ?? '提交生成任务失败' }
  }
  const taskId = data.taskId
  // ③ 返回轮询函数（异步形态）：内核定时调用它，每次给 UI 一帧状态。
  return async (): Promise<ToolPollState> => {
    const res = await fetch(baseUrl + '/api/tasks/' + encodeURIComponent(taskId))
    const state = (await res.json()) as {
      task?: { status?: string; progress?: number; message?: string; error?: string; result?: { text?: string } }
    }
    const task = state.task
    if (task?.status === 'error') {
      return { status: 'done', result: { ok: false, error: task.error ?? '后台生成失败', taskId } }
    }
    if (task?.status === 'done') {
      return { status: 'done', result: { ok: true, text: task.result?.text ?? '', taskId } }
    }
    // pending / processing / 未知状态 → 还在跑，继续等。
    return { status: 'running', progress: task?.progress, message: task?.message ?? '生成中…', taskId }
  }
}
```

这段里的关键纪律来自真实插件：**查询层任何失败都收敛成终态失败**（返回 `{ status: 'done', result: { ok: false, … } }`），绝不因为一次网络抖动就永远返回 running —— 否则内核会一直轮询到整体超时，用户只能干等。

### 进阶 2 · 模块级 Config：把地址做成可配置项

`apply(ctx)` 可以收第二个参数（装配 config），配套在模块级导出 `Config` schema，设置面板就自动多出这两项：

```ts
// 文件：my-echo-tool/src/echoTools.ts（追加）
import type { ConfigSchema, InferConfig } from '@mini-canvas/canvas-base'

export const Config = {
  // ① 键名带本插件前缀 echo…：设置面板是全局同一张表，先声明者独占键名，
  //    baseUrl 这种通用名会跟别的插件撞车（真实插件因此用 textGenBaseUrl）。
  echoBaseUrl: {
    type: 'string',
    default: 'http://127.0.0.1:6800',
    label: '生成后台地址',
    group: '常规/回声工具',
    description: '改完需重新装载插件生效。',
  },
  echoTimeoutMs: {
    type: 'number', default: 30000, min: 1000, max: 600000, step: 1000,
    label: '单次请求超时（毫秒）', group: '常规/回声工具',
  },
} satisfies ConfigSchema

/** apply 收到的 config 类型自动与 schema 对齐 */
export type EchoToolConfig = InferConfig<typeof Config>

export function apply(ctx: Context, config?: EchoToolConfig): void {
  const baseUrl = config?.echoBaseUrl ?? 'http://127.0.0.1:6800'
  const timeoutMs = config?.echoTimeoutMs ?? 30000
  ctx.tools.register(createEchoTool({ baseUrl, timeoutMs }))   // createEchoTool 收同样的 options
}
```

「先写建单个工具的函数，再 `map` 批量建、循环注册」的多模型写法见文末出处表的 `registerTextGenerationTools`。

## 每一步在干什么

**②③ ToolDef 是「说明书」而不是「界面」**：工具作者只声明「我叫什么、吃什么、吐什么、有什么参数、怎么跑」。界面（节点面板、底栏）读这张说明书自己画控件。好处是「加一个模型不用改任何 UI 代码」—— 装一个插件，下拉里自动多一项。这也是仓库设计这层注册表的初衷（`packages/kernel/src/toolRegistry.ts` 文件头写得很直白）。

**④ produces / accepts 是配对的暗号**：`produces: 'text'` 表示「我的结果是文本」，于是产出 text 的工具会被「吃 text」的节点面板挑出来（`ctx.tools.list({ produces: 'text' })`）；`accepts: ['text']` 表示「我吃文本素材」，面板据此过滤上游。两边的词表共用 `ToolResourceKind`（'image' | 'text' | 'video' | 'audio'），别自己发明新词。

**⑤ params 是给 UI 的**：面板按它渲染下拉/滑块/开关，并把用户选的值塞进 `input.params`。工具不用关心「值长什么样」—— 只在 run 里读。真实插件里还有 `kind: 'ratio'` 这类「语义类型」，让主题包把下拉画成更漂亮的比例卡片；不认识的 kind 会回落普通控件，不会炸。

**⑥ run 的返回值有两种**：直接 `return { ok, text }` 是同步完成；如果调用要走后台，先提交任务，然后 `return` 一个**轮询函数**（每次返回 `{ status: 'running', message }` 或 `{ status: 'done', result }`），内核负责定时调它、把进度转发给 UI。真实插件的 run 就是第二种形态。

**⑦ 绝不做假结果**：真实插件的红线 —— 请求失败就返回 `{ ok: false, error: '…' }`，让界面如实显示失败。假 success 会让用户以为生成成功、内容却没写进节点，排查起来要命。

**produces 的「产物字段」约定**：工具产出哪种内容，结果就写哪个字段 —— text 工具写 `result.text`，图片工具写 `result.urls`。消费方（面板、底栏、写入器）按 `produces` 决定读哪个：真实文本工具的 poll 结束时把 `task.result.text` 透传进 `ToolResult.text`；文本节点的写入器读 `result.text` 写回 `data.text`。两边的词表都来自 `packages/kernel/src/toolRegistry.ts`（`ToolResult` / `ToolResourceKind`），别自己发明第三套。

**accepts 与上游素材**：面板把连进节点的上游（文本内容、图片地址）按 `ToolResource` 形状收集起来（`{ id, kind, name, url?/value? }`），再按工具声明的 `accepts` 过滤 —— 工具没声明 accepts 就全收（与 list 的「缺省即全收」同一套语义）。run 里拿到的 `input.resources` 就是过滤后的素材；多模态模型用 `supportsInput` 把「能读图」声明进 accepts，纯文本模型就不用改任何代码。

**工具与命令的区别**：`ctx.commands` 是画布内部动作 —— 删除、撤销、建节点，同步、无进度、不产出内容；`ctx.tools` 是外部能力调用 —— 可异步、带进度、有产物，通常还要吃进上游素材。想加「Ctrl+E 触发某某」用命令（案例 3），想加「调模型出图出文」用工具（本篇）。真实插件的注释明确区分过这两层，混着用会让快捷键背上网络请求、让面板背上状态机。

**重复登记撤销会误伤别人**：`ctx.tools.register` 内部已经把「从表里删掉这个工具」登记进本插件 scope。你若再手动登记一次（比如照着 `ctx.get('tools').register` 的返回句柄再 effect 一遍），卸载时会触发**两次**删除 —— 而工具表允许后来者用新条目顶替旧条目，第二次删除可能命中**别人顶替上来的同名工具**。真实插件的注释把这条写得很重：「重复登记会在同名工具已被别的插件顶替时误删他人的工具」，所以 `registerTextGenerationTools` 里只调 `registrar.register(def)`，不再叠加 effect。

**⑧ 回收不用你管**：`ctx.tools.register` 内部已经把撤销登记进本插件的 scope。所以真实插件在注释里强调「不再重复登记」—— 你要是再手动登记一次撤销，卸载时可能把**别人后来顶替上来的同名工具**误删掉。

## 仓库里的真实出处

| 这篇里的做法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| 插件壳（name/inject/apply + Config） | `packages/plugins/plugin-tool-text-generation/src/textGenerationPlugin.ts` | `inject = ['tools']`，apply 里调 `registerTextGenerationTools(ctx, options)` |
| ToolDef 全字段（produces/accepts/params/templates/run） | `packages/plugins/plugin-tool-text-generation/src/textGenerationTools.ts` | `createTextGenerationTool` 返回完整 ToolDef，`name = 'text.generate:' + modelId` |
| params 声明式 UI 的真实写法 | 同上（`paramsOf(cap)`，词表见 `packages/kernel/src/toolRegistry.ts` 的 `ToolParamDef`） | `type: 'select' / 'number' / …`，配 `options / min / max / step / unit` |
| run 先提交、后轮询的异步形态 | 同上 `run(input, runCtx)` | POST `/api/tasks` 拿 taskId，返回 ToolPollFn；失败收敛成 `{ ok:false, error }`，不返回假 running |
| 「批量注册多个模型」的复用入口 | 同上 `createTextGenerationTools` / `registerTextGenerationTools` | `models.map(cap => createTextGenerationTool(cap, options))` 后逐个 `registrar.register(def)` |
| 面板按声明画参数、组装 invoke 输入 | `packages/plugins/plugin-node-image/src/panelSource.ts` + `ImageGeneratePanel.vue` | `resolveToolParams` 算默认值；点发送时 `{ prompt, resources, params }` 传给 `tools.invoke` |
| package.json 的 miniCanvas 段 | `packages/plugins/plugin-tool-text-generation/package.json` | `title / description / pluginName / installable` |

## 常见坑

1. **工具名重了**。同名重复注册直接抛错（防静默覆盖）。给名字带前缀（`echo.demo`、`text.generate:模型`），别用 `generate` 这种大路名。
2. **produces 写错或没写**。节点面板靠 `produces` 挑工具；不写的话，面板的「能产出 text 的工具」清单里就没有你，用户在下拉里找不到 —— 工具其实注册成功了，只是没人认识它。
3. **在 run 里自己管 UI**。工具是「能力」，界面是面板的事。工具返回 `{ ok, text }`，写回节点由面板/底栏完成；你在 run 里改画布数据，就与「写回只有一个门」的纪律打架了。
4. **失败返回 ok: true**。内核和 UI 都把 `ok: false` 当「如实失败」处理（显示 error 文案）；假装成功会让结果为空、进度永远停不下来。真实插件的注释把这条写成红线：拿不到真结果就报错。
