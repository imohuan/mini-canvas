# 模型工具：`defineTool` / `runToolCall`

**一句话定位**：**这是「给大模型调用的工具」那一套 —— 你声明一个工具（说明 + 参数 + 产物形状 + 执行体），注册进注册场 `ctx.registryOf('tool')`；调用时 `runToolCall` 负责校验参数、执行、校验产物、渲染结果，并把每一次调用广播出去。**

**它属于哪一档**：**内核自带（框架层）**。源码：`packages/kernel/src/modelTool.ts`；事件名登记也在这个文件里（模块加载时执行）。

## 它是什么

把「模型能调用的工具」想成**一份外卖菜单**：

- 每道菜写清：**叫什么**（工具名 = 场里的键）、**卖什么**（`description`，发给模型看）、
  **能选什么配菜**（`parameters`，会转成 JSON Schema 发给模型）、**端上来的样子**（`output.schema`）、
  **怎么做**（`execute`）、**怎么摆盘**（`output.render`）。
- 模型点菜 → `runToolCall` 当**后厨**：先核对点得对不对（参数校验），再做，再检查成品合不合规格（产物校验），最后摆盘成「可持久化的内容块」。
- 全程还**广播**三条事件：进表（`tools/registered`）、离表（`tools/unregistered`）、出餐（`tools/result`）。

按「数据 / 展示 / 能力 / 配置」分，它管的是**能力**，但**落点是注册场**（一张表），不是服务。

> ⚠️ **先记这条，能省很多弯路**：这套工具落在 **注册场 `ctx.registryOf('tool')`**，
> **不是**内核服务 `ctx.tools`。两个东西长得很像，见下节。

## 为什么需要它

「模型可调用工具」（function calling）有四个绕不开的活儿，内核把它们一次性补齐（源码注释里叫「四个缺口」）：

| 缺口 | 不补会怎样 | 补在哪 |
| --- | --- | --- |
| **没有事件** | 观察者插件没法记录「谁调了什么、结果是什么」，只能自己 inject 一堆服务 | `tools/registered` / `tools/unregistered` / `tools/result` |
| **没有声明糖** | 作者得手写一大坨 JSON Schema 字面量，容易写错 | `defineTool` 从 `parameters` 自动派生 |
| **调用没有身份、不能取消** | 两次并发调用分不清谁是谁；请求发出去了就收不回来 | `ToolCallContext` 的 `callId` + `signal` |
| **产物形状没约定、没法持久化** | 结果里塞了 `Date` / `Map` / 类实例，存下来读不回 | `output.schema` 校验 + `output.render` 出「text / json」两种块 |

### 两套 tools，别混（`ctx.tools` vs `ctx.registryOf('tool')`）

| | `ctx.tools`（**服务**） | `ctx.registryOf('tool')`（**注册场**，本篇） |
| --- | --- | --- |
| 是什么 | 一个服务（`ToolRegistry` 实例），内核自带、恒在 | 一张表（kind = `'tool'`） |
| 装什么 | **生成工具**：文生图 / 图生文这些「外部能力调用」，可异步、带进度、有产物 URL | **模型可调用工具**：function calling，参数有 JSON Schema，产物是可持久化内容块 |
| 谁在用 | 两个工具插件 + 节点面板（`ctx.tools.list({ produces: 'image' })` → `invoke`） | `defineTool` / `runToolCall` 这套；MCP / AI 工具链 |
| 判据 | 会换实现 → 服务 | 一张表 → 场 |

追根溯源：按判据「一张表是场」，模型工具本来就不该是服务 —— 于是 §7.3 定案：它走注册场，**不占服务名**。
源码里那句注释很直接：

> `ctx.tools`：一个**服务**（换实现 —— 本地/云端/假货 —— 要改行为）……
> 本模块：一张**表**，按规则 5（「一张表」是场，「一个能手」是服务）本就该是场 → 落在 `ctx.registryOf('tool')`，不占服务名。

> 所以：**`defineTool` 注册出来的工具，在 `ctx.tools.list()` 里找不到**；反过来也一样。两个工具名空间独立。

## 怎么用

### 一、`defineTool`：一个声明，产出一份 `ToolSpec`

```ts
export interface ToolDefineOptions {
  /** 工具名（声明性的：注册时的键才是权威；写上便于阅读与将来列给模型） */
  name?: string
  /** 一句话说明（发给模型看） */
  description: string
  /** 声明式参数（缺省 = 不收参数） */
  parameters?: ToolParamsSpec
  /** 产物声明 */
  output?: {
    schema?: ToolValueSchema
    render?(args: Record<string, unknown>, value: JsonValue): ToolContentBlock[]
  }
  /** 执行体：参数已校验，产物须符合 output.schema */
  execute(args: Record<string, unknown>, ctx: ToolCallContext): unknown | Promise<unknown>
}

export function defineTool(options: ToolDefineOptions): ToolSpec
```

`defineTool` 干三件事：把 `parameters` 转成 JSON Schema（`toolParamsToJsonSchema`）、
给 `output` 补默认（`schema: { type: 'json' }`、`render: defaultRender`）、把 `execute` 挂上。

```ts
// 最小的一个工具：只有说明和执行体
const ping = defineTool({
  description: '回显你给的名字',
  async execute(args) {
    return 'Hello, ' + String(args.name ?? 'world')
  },
})
```

### 二、参数：`ToolParamsSpec`（键即参数名）

```ts
/** 参数声明：复用已有的 ToolParamDef，只加一个 required */
export interface ToolParamSpec extends Omit<ToolParamDef, 'key'> {
  required?: boolean
}
export type ToolParamsSpec = Record<string, ToolParamSpec>
```

**键就是参数名**（不是 `key` 字段）—— 这是「教程形态」：`{ name: { type: 'string', required: true } }`。

`ToolParamSpec` 可用字段（`Omit<ToolParamDef,'key'>` + `required`，来自 `packages/kernel/src/toolRegistry.ts`）：

| 字段 | 说明 |
| --- | --- |
| `type` | `'select' \| 'string' \| 'number' \| 'boolean'`；缺省按 `'string'` 处理 |
| `required` | 必填标记 → 进 JSON Schema 的 `required` 数组 |
| `label` | 显示名 → 映射成 JSON Schema 的 `title` |
| `description` | 说明 → 原样进 `description` |
| `options` | `select` 用：候选值 → 映射成 `enum`（**label 只给人看，不发给模型**） |
| `min` / `max` / `step` | number 用 → 映射成 `minimum` / `maximum` / `multipleOf` |
| `default` | 非校验性默认值 → 原样进 `default` |
| `kind` / `unit` / `placeholder` / `span` / `component` … | UI 相关（`ToolParamDef` 的其余字段）；`defineTool` 不改它们，本次转换只用上面那些 |

### 三、`toolParamsToJsonSchema`：纯函数转换器

```ts
export function toolParamsToJsonSchema(params: ToolParamsSpec): ToolValueSchema

// 源码行为（逐条核对）：
// ① 逐参数调 paramToSchema：number→{type:'number',minimum,maximum,multipleOf}
//    boolean→{type:'boolean'}；select→{type:'string',enum}；其余→{type:'string'}
// ② label→title、description→description、default→default 一并带上
// ③ 有必填项才出现 required（模型端少一个字段就少一次幻觉）
```

```ts
toolParamsToJsonSchema({
  name: { type: 'string', required: true, label: '名字' },
  times: { type: 'number', min: 1, max: 5, step: 1 },
})
// → {
//     type: 'object',
//     properties: {
//       name: { type: 'string', title: '名字' },
//       times: { type: 'number', minimum: 1, maximum: 5, multipleOf: 1 },
//     },
//     required: ['name'],
//   }
```

### 四、注册：`ctx.registryOf('tool').add(键, spec)`

```ts
// 插件 apply 里
ctx.registryOf<ToolSpec>('tool').add('greet', defineTool({ /* … */ }))
```

- **场里的键就是工具名**（`ToolCallRequest.name` 要能对上它）；`defineTool` 里的 `name` 只是声明性的。
- 放置**随本插件 fiber 自动回收**（`registryOf` 的插件视图自带 `keep` 语义）—— 插件卸载，工具自动离表。
- `TOOL_KIND` 常量就是 `'tool'`（用常量别写死字符串也行：`ctx.registryOf<ToolSpec>(TOOL_KIND)`）。

### 五、调用：`runToolCall(field, emitter, request)`

```ts
export function runToolCall(
  field: Registry<ToolSpec>,
  emitter: ToolEventEmitter,          // 结构类型：只要有个 emit(name, ...args) 就行（Context / 插件 ctx / 假货都可）
  request: ToolCallRequest,
): Promise<ToolCallResult>
```

```ts
export interface ToolCallRequest {
  /** 工具名（= registryOf('tool') 里的键） */
  name: string
  /** 模型给的参数（执行前按 parameters 校验） */
  arguments?: Record<string, unknown>
  /** 关联 id（不给由内核生成） */
  callId?: string
  /** 取消信号（不给 = 不可取消） */
  signal?: AbortSignal
}
```

**执行顺序**（源码 `runToolCall`，一步不落）：

```
1. 算 callId（没给就自动 '工具名#序号'）、取 signal（没给就 new AbortController().signal = 不可取消）
2. 场里找不到这个工具 → ok:false, error: '未找到工具 "xxx"'
3. signal 已经 aborted → ok:false, error: '调用已取消'
4. 按 parameters 校验入参 → 有违规项 → ok:false, error: '参数校验失败：…'
5. await execute(args, { callId, signal }) → 抛错则收敛成 ok:false（error 用异常的 message）
6. signal 又 aborted → ok:false, error: '调用已取消'
7. 按 output.schema 校验产物 → 违规 → ok:false, error: '产物不符合 output.schema：…'
8. output.render(args, value) 渲染 → 归一成内容块（渲染抛错 → ok:false, error: '渲染失败：…'）
9. 无论成功失败，都发 tools/result（在返回之前发 —— 观察者拿到的就是最终态）
```

### 六、`ToolCallResult`：一次调用的终态

```ts
export interface ToolCallResult {
  ok: boolean
  /** 工具名 */
  name: string
  /** 本次调用的关联 id（与 tools/result 里的一致） */
  callId: string
  /** ok=true 时的规范产物（output.schema 已校验） */
  value?: JsonValue
  /** 可持久化的结果内容（output.render 的产出）；恒为数组，调用方无需判空 */
  content: ToolContentBlock[]
  error?: string
}
```

**内容块只有两种**（`ToolContentBlock`）：

```ts
export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'json'; value: JsonValue }
```

> 为什么只有两种：结果要**存得下来、读得回来**。要更花哨的展示（卡片 / 缩略图）是消费方拿这两个块再渲染的事 ——
> 内核不认 UI 概念。默认 renderer 也遵守这条：字符串 → `text` 块，其它值 → `json` 块。

**「一切失败都收敛成 `{ ok: false, error }`」**：调用方不用到处写 `try/catch`；而且**失败也发 `tools/result`** ——
观察者要看到「每一次调用」，不只是成功的那些。

### 七、产物声明：`output.schema` + `output.render`

```ts
output: {
  schema: { type: 'string' },              // 产物必须符合它，否则整个调用变 ok:false
  render: (_args, value) => [{ type: 'text', text: value as string }],  // 摆盘
}
```

- `schema` 缺省是 `{ type: 'json' }`（任意可持久化 JSON 值）；
- `render` 缺省是「字符串 → text 块，其它 → json 块」；
- `render` 的返回值会被 `normalizeContent` **强制校验**：不是数组、或块里塞了不可持久化的东西（`Date` / `Map` / 类实例）→ 抛错 → 整个调用 `ok:false`。

### 八、三条事件：把「提供方」和「观察方」连起来

| 事件名 | 参数 | 何时发 |
| --- | --- | --- |
| `tools/registered` | `(name: string, tool: ToolSpec, source: string)` | 一条工具进表（**同 id 顶替时也会发**，此前先发一条 `unregistered`） |
| `tools/unregistered` | `(name: string, source: string)` | 一条工具离表（显式撤销 / 清空 / 被顶替） |
| `tools/result` | `(exec: ToolExecView, result: ToolCallResult)` | `runToolCall` 在**结果物化时**发（先于 promise 兑现） |

```ts
export interface ToolExecView {
  name: string                              // 场里的键 = 工具名
  callId: string
  arguments: Record<string, unknown>        // 归一化后的入参（已校验）
}
```

**谁在发前两条**：不是插件，是**表本身** —— `toolFieldOptions(kind, emitter)` 给 kind = `'tool'` 的场接上 `onChange` 回调
（其它 kind 零开销）。这样「注册 / 撤销可能来自任何插件」，观察者都不会漏事件。

**三条事件名已在 `modelTool.ts` 模块加载时 `registerEventName`**，所以 dev 下不会因为「未登记」而 warn。

**观察者插件的写法**（它**不需要 inject 任何服务**）：

```ts
ctx.on('tools/result', (exec, result) => {
  console.log('[logger]', exec.name, exec.callId, result.ok, result.content)
})
```

### 九、类型表：`ToolValueSchema`（给模型看的 JSON Schema 子集）

```ts
export interface ToolValueSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'json'   // 缺省 'json'
  title?: string
  description?: string
  enum?: readonly (string | number | boolean)[]
  default?: JsonValue
  minimum?: number
  maximum?: number
  multipleOf?: number
  properties?: Record<string, ToolValueSchema>   // type: 'object' 时
  required?: readonly string[]                   // type: 'object' 时
  items?: ToolValueSchema                        // type: 'array' 时
}
```

校验由 `validateToolValue(schema, value, path = ''): string[]` 做（纯函数）——**返回违规项数组，空数组 = 通过**：

```ts
validateToolValue({ type: 'number', maximum: 5 }, 9)      // ['值 不得大于 5']
validateToolValue({ type: 'json' }, new Date())            // ['值 不是可持久化的 JSON 值']
validateToolValue({ type: 'object', required: ['name'] }, {})   // ['name 必填']
```

- **为什么返回列表而不是抛错 / 布尔**：参数违规要能一条条告诉模型（「seed 超出范围」比「参数不合法」有用得多）；
  产物违规要能写进日志定位是哪个工具的作者写错了。
- `isJsonValue(value)` 是判据：`null` / 布尔 / 字符串 / **有限数** / 递归的数组或**朴素对象**（原型必须是 `Object.prototype` 或 `null`）才算。
  `Date` / `Map` / 类实例一律不算。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/kernel/src/modelTool.ts` | `defineTool` / `runToolCall` / `toolParamsToJsonSchema` / `validateToolValue` / `toolFieldOptions` / `TOOL_KIND` / 三条事件名登记 |
| `packages/kernel/src/registry/registry.ts` | 注册场本体的 `onChange` 口（`toolFieldOptions` 就是接在这里的） |
| `packages/kernel/src/Context.ts` | `registryTable(kind)` 里 `new RegistryImpl(toolFieldOptions(kind, this.bus))` —— 每条事件从这里接上 |
| `packages/kernel/src/__tests__/modelTool.test.ts` | 锁住全部行为：事件时序、两套工具不混、取消、校验、渲染 |
| `packages/kernel/src/surface.ts` | `ctx.surface().modelTools` 读 `registryOf('tool')`，列出工具名 / 说明 / 参数 / 产物 schema / source |
| `packages/cloud-server/src/serverFramework/mcp.ts` | 服务端的另一张同形表（`MCP_TOOL_FIELD`）——「插件也能注册 MCP 工具」呼应的就是这套 |

## 完整例子

两个**互不认识**的插件：一个注册工具，一个只监听事件。这就是「注册场 + 事件」把两边连起来的真实样子。

### 目录长这样

```
plugin-model-tool-demo/
├── package.json            # 插件清单
└── src/
    ├── toolProvider.ts     # 提供方：注册两件工具（一个打招呼、一个数字翻倍）
    ├── toolLogger.ts       # 观察方：只监听 tools/* 事件，不认识提供方
    └── main.ts             # 装配脚本：注册 → 调用 → 看日志
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/plugin-model-tool-demo/`。

### 文件一：提供方

```ts
// 文件：packages\docs\public\examples\kernel\plugin-model-tool-demo/src/toolProvider.ts
// 格式：TypeScript 模块（插件入口：导出 name / apply）
// 位置：注册模型可调用工具的插件
import { defineTool, type Context, type PluginModule, type ToolSpec } from '@mini-canvas/kernel'

export const name = 'model-tool-provider'

export function apply(ctx: Context): void {
  // ① 取这张场（同 kind 全内核只有一张表；本插件放的东西随本插件卸载自动摘除）
  const tools = ctx.registryOf<ToolSpec>('tool')

  // ② 注册「打招呼」：参数名就是键；required 会进 JSON Schema
  tools.add('greet', defineTool({
    description: '向某人打招呼',
    parameters: {
      name: { type: 'string', required: true, label: '对方名字', description: '要打招呼的人' },
      excited: { type: 'boolean' },
    },
    // ③ 产物是字符串：schema 声明它，render 摆盘成 text 块
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute(args) {
      const who = String(args.name)
      const bang = args.excited === true ? '!!' : '!'
      return 'Hello, ' + who + bang
    },
  }))

  // ④ 注册「翻倍」：产物是 json 块（默认 renderer 就能干，这里显式写出来做示范）
  tools.add('double', defineTool({
    description: '把一个数字翻倍',
    parameters: { n: { type: 'number', required: true, min: -1000, max: 1000, step: 1 } },
    output: {
      schema: { type: 'object', properties: { n: { type: 'number' }, doubled: { type: 'number' } }, required: ['n', 'doubled'] },
      render: (_args, value) => [{ type: 'json', value }],
    },
    async execute(args, call) {
      // ⑤ callId 贯穿本次调用；signal 可取消（本工具很快，仅演示接口）
      if (call.signal.aborted) throw new Error('已取消')
      const n = Number(args.n)
      return { n, doubled: n * 2 }
    },
  }))
}

export const modelToolProviderPlugin: PluginModule = { name, apply }
```

### 文件二：观察方（只监听，不认识提供方）

```ts
// 文件：packages\docs\public\examples\kernel\plugin-model-tool-demo/src/toolLogger.ts
// 格式：TypeScript 模块（插件入口，观察者）
// 位置：打印每一次模型工具调用 —— 它不需要 inject 任何服务
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'model-tool-logger'

export function apply(ctx: Context): void {
  // ① 谁进表 / 谁离表
  ctx.on('tools/registered', (toolName: string, _tool, source: string) => {
    console.log('[logger] 工具进表：', toolName, '（谁放的：' + source + '）')
  })
  ctx.on('tools/unregistered', (toolName: string, source: string) => {
    console.log('[logger] 工具离表：', toolName, '（原本谁放的：' + source + '）')
  })

  // ② 每一次调用 —— 成功和失败都会到（runToolCall 在结果物化时发）
  ctx.on('tools/result', (exec, result) => {
    console.log(
      '[logger] 调用', exec.name, 'callId=' + exec.callId,
      '入参=' + JSON.stringify(exec.arguments),
      '结果=', result.ok ? JSON.stringify(result.content) : '失败：' + result.error,
    )
  })
}

export const modelToolLoggerPlugin: PluginModule = { name, apply }
```

### 文件三：装配脚本

```ts
// 文件：packages\docs\public\examples\kernel\plugin-model-tool-demo/src/main.ts
// 格式：TypeScript 模块（装配脚本，`npx tsx src/main.ts` 即可跑）
// 位置：注册 → 调用 → 看事件
import { Context, runToolCall, TOOL_KIND, type ToolSpec } from '@mini-canvas/kernel'
import { modelToolLoggerPlugin } from './toolLogger'
import { modelToolProviderPlugin } from './toolProvider'

const ctx = new Context({ dev: true })

ctx.plugin(modelToolLoggerPlugin)     // ① 先装观察者（这样「进表」事件也能收到）
ctx.plugin(modelToolProviderPlugin)   //    再装提供方
await ctx.start()

// ② 取同一张场来调工具（field 决定「用哪张表」，与 ctx.tools 无关）
const field = ctx.registryOf<ToolSpec>(TOOL_KIND)

// ③ 正常调用：参数、产物都对
const r1 = await runToolCall(field, ctx, { name: 'greet', arguments: { name: '世界', excited: true } })
console.log('[main] greet →', r1.ok, r1.content)

// ④ 参数校验失败：缺 required，收敛成 ok:false（不抛）
const r2 = await runToolCall(field, ctx, { name: 'greet', arguments: {} })
console.log('[main] 缺参数 →', r2.ok, r2.error)

// ⑤ 显式给 callId + 取消信号
const ac = new AbortController()
const r3 = await runToolCall(field, ctx, { name: 'double', arguments: { n: 21 }, callId: 'demo-1', signal: ac.signal })
console.log('[main] double →', r3.callId, r3.value)

// ⑥ 调用前就取消：直接返回失败
ac.abort()
const r4 = await runToolCall(field, ctx, { name: 'double', arguments: { n: 1 }, signal: ac.signal })
console.log('[main] 已取消 →', r4.ok, r4.error)   // false 调用已取消

// ⑦ 找不到工具
const r5 = await runToolCall(field, ctx, { name: 'ghost' })
console.log('[main] 找不到 →', r5.ok, r5.error)   // false 未找到工具 "ghost"

ctx.stop()
```

## 常见坑

1. **别把 `defineTool` 注册进 `ctx.tools`**。两套工具**不混**：`ctx.tools.register(def)` 收的是 `ToolDef`（生成工具），
   `defineTool` 产出的是 `ToolSpec`（模型工具）——形状不同、名字空间不同。混着写要么类型不通过，要么运行期报 `工具必须有 name`。
2. **参数名是「映射的键」，不是 `key` 字段**。写 `parameters: { name: { key: 'name', type: 'string' } }` 会多出一个没用的 `key`，
   而真正的参数名靠外层那个 `name` 键。
3. **`required` 只在给字符串值时才进 schema**：没有必填项时，导出的 schema **不会带 `required` 字段**（不是空数组）。
4. **产物必须是「可持久化 JSON 值」**。`execute` 返回 `Date` / `Map` / 类实例 → 产物校验直接 `ok:false`；
   `render` 里返回的块也一样（只认 `text` / `json` 两种，其它一律「内容块不可持久化」）。
5. **失败不抛错，而是 `{ ok: false, error }`**。要判成败必须看 `result.ok`；而且失败**同样发 `tools/result`**。
6. **`signal` 要自己透传才有用**。`runToolCall` 只在「调用前已 aborted」和「execute 返回后又 aborted」两处检查；
   工具内部要真正可取消，得把 `ctx.signal` 传给 `fetch` 这类下游。
7. **工具放在场里的键才是权威名**。`defineTool({ name: 'x' })` 只是声明性的 —— `runToolCall({ name })` 对的是 **`add(键, spec)` 的键**。
8. **注册随插件卸载自动摘除**（不用手动 `dispose`），手动 `dispose` 也支持（`add` 返回 `{ id, dispose() }`）。
9. **同 id 顶替会发两条事件**（先 `unregistered` 再 `registered`）—— 观察者按「进 / 出」成对处理时别漏这一对。

