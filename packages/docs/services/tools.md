# `tools` · 工具表

**一句话定位**：**`tools` 是"外部能力"的登记台 —— 谁能让机器画一张图、谁能让机器写一段文字，都先来这里报名；要用的人按名字挑一个来调。**

**它属于哪一档**：**内核内置**。它由 `@mini-canvas/kernel` 自己建好（`Context` 构造时就创建一个 `ToolRegistry`），不装画布、不装任何插件也有 —— 纯 `new Context()` 就能 `ctx.get('tools')` 拿到它。源码在 `packages/kernel/src/toolRegistry.ts`。

## 用法

### 两种拿法，同一本名册

```ts
// 写法一：按服务名取
const tools = ctx.get<ToolService>('tools')

// 写法二：内核自带的语法糖（属性直读，不用 import 什么）
ctx.tools.list({ produces: 'image' })
```

两种写法看到的是**同一个底层表**（`ctx.tools` 的同名方法都转发到底层 `ToolRegistry`）。差别在**注册后怎么回收**：

- `ctx.tools.register(def)`：撤销已经自动登记进你的插件作用域（插件卸载即摘），**插件作者用这个**。注意它的返回值别依赖 —— 内核类型声明写的是 `Disposable`，当前实现返回的是 `undefined`。
- `ctx.get('tools').register(def)`：返回一个真正的 `Disposable`，谁调谁负责 `dispose()`。适合宿主或非插件代码（比如测试）。

### 方法逐个看

下面签名逐字来自 `packages/kernel/src/toolRegistry.ts` 的 `ToolService` 接口。

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `register` | `register(def: ToolDef): Disposable` | 注册一个工具；**同名重复注册抛错**（防静默覆盖） | 插件装载时报名 |
| `unregister` | `unregister(name: string): boolean` | 按名注销；不存在返回 `false` | 运行期撤下某个工具 |
| `has` | `has(name: string): boolean` | 问"这个名字在不在" | 注册前探一探，避免撞名抛错 |
| `get` | `get(name: string): ToolDef \| undefined` | 按名拿整条声明 | 想看某个工具的完整配置 |
| `list` | `list(filter?: ToolFilter): ToolDef[]` | 枚举工具，可按 `group` / `produces` / `accepts` 筛 | UI 里铺"模型下拉" |
| `invoke` | `invoke(name: string, input: ToolInput, options?: ToolInvokeOptions): Promise<ToolResult>` | 调一个工具；**异步形态在这里被统一驱动到完成** | 用户点了"发送" |

两个输入输出形状，看名字就懂：

```ts
// 筛选条件：给的键之间是"与"关系
interface ToolFilter {
  group?: string
  produces?: ToolResourceKind       // 'image' | 'text' | 'video' | 'audio'
  accepts?: ToolResourceKind        // 只留"能吃下这种输入"的工具
}

// 调用选项
interface ToolInvokeOptions {
  ctx?: ToolRunContext                       // 运行上下文（画布场景约定放 nodeId / canvasId）
  onProgress?: (p: ToolProgress) => void     // 进度回调，驱动进度条
  interval?: number                          // 轮询间隔 ms，默认 650
  timeoutMs?: number                         // 整体超时 ms，默认 300000（5 分钟）
}
```

### 一条工具声明里的字段（`ToolDef`）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `name` | `string` | **必填**，唯一名（如 `'image.generate:my-model'`）；重复注册抛错 |
| `title` | `string?` | 显示名（模型下拉里显示的就是它） |
| `description` | `string?` | 一句话说明 |
| `group` | `string?` | 分组（UI 据此归类，如 `'图片生成'`） |
| `produces` | `ToolResourceKind?` | 产出什么。节点据此挑"能给我出图的工具" |
| `accepts` | `ToolResourceKind[]?` | 接受哪些输入资源；**缺省 = 不挑食，什么都收** |
| `params` | `ToolParamDef[]?` | 声明式参数，UI 照着自动长控件 |
| `templates` | `ToolTemplate[]?` | 预设提示词模板，面板渲染"模板"下拉 |
| `run` | `(input: ToolInput, ctx: ToolRunContext) => ToolOutcome 或 Promise<ToolOutcome>` | 执行体 |

`params` 里的每一项只描述"这个参数长什么样"，不用写控件代码：

```ts
{
  key: 'ratio',
  label: '比例',
  type: 'select',                   // 'select' | 'string' | 'number' | 'boolean'
  options: [{ label: '16:9', value: '16:9' }, { label: '1:1', value: '1:1' }],
  default: '16:9',
  kind: 'ratio',                    // 可选：语义类型，主题层可映射成预设控件
}
```

### `run` 的两种返回形态

```ts
// 形态一：同步完成 —— 直接给结果
run: () => ({ ok: true, urls: ['https://example.com/a.png'] })

// 形态二：异步任务 —— 返回一个轮询函数，invoke 按 interval 一直调到 done
run: async () => {
  const taskId = await submit()
  return async () => {
    const t = await query(taskId)
    if (t.status === 'done') return { status: 'done', result: { ok: true, urls: t.urls } }
    return { status: 'running', progress: t.percent, message: t.stage, taskId }
  }
}
```

**为什么要"统一在 `invoke` 里驱动轮询"**：否则每个节点 UI 都要自己写轮询循环、自己算超时、自己把异常包成"失败结果"。现在调用方只需要处理一种返回形态。

### 两个现成的小助手（纯函数）

从 `@mini-canvas/kernel` 导入，UI 侧直接用，避免各写一份口径不一的默认值逻辑：

```ts
// 把声明的参数 schema 收敛成"当前生效的参数值"：有默认用默认，下拉没选就取第一项
export function resolveToolParams(def: ToolDef | undefined, current?: Record<string, unknown>): Record<string, unknown>

// 取某工具可用的提示词模板：工具自己的优先；再加"同产出类型"里 forTools 命中它的共享模板，按 id 去重
export function resolveToolTemplates(def: ToolDef | undefined, all?: readonly ToolDef[]): ToolTemplate[]
```

### 两个默认值

```ts
export const DEFAULT_TOOL_INTERVAL = 650      // ms，轮询间隔
export const DEFAULT_TOOL_TIMEOUT = 300_000   // ms，整体超时（5 分钟）
```

## 注意事项

1. **同名工具再注册一次会抛错，不是覆盖**。`register` 里写死了一句 `throw new Error('[tools] tool "x" already registered')` —— 这是故意的（静默覆盖会让两个插件互相顶掉、排查无门）。想在"已存在就跳过"的场景注册（比如内置模型表 + 后台模型表补齐），先 `has(name)` 问一句，或者只补对方没有的那些名字。
2. **`ctx.tools.register` 与 `ctx.get('tools').register` 的返回值不一样**：前者 `void`、回收自动；后者 `Disposable`、要自己管。插件里请用前者，否则插件卸载后工具还留在名册里 —— 变成"幽灵工具"，点了报"未找到工具"。
3. **`invoke` 不抛异常**。工具不存在返回 `{ ok: false, error: '未找到工具 "x"' }`；`run` 里抛错会收敛成 `{ ok: false, error: 原始消息 }`；轮询超时收敛成 `{ ok: false, error: '任务超时（未在预期时间内完成）' }`。所以调用方的判据是 `result.ok`，别用 `try/catch` 猜。
4. **异步工具必须自己走到终态**。返回轮询函数后，只要它一直回 `'running'`，`invoke` 就会一直轮询到 `timeoutMs`（默认 5 分钟）才失败收场。轮询函数里要有"到达终态就回 `'done'`"的分支，否则用户会盯着一个转不完的圈。
5. **`produces` 不写，节点就找不到你**。节点的判据是 `ctx.tools.list({ produces: 'image' })` 这类筛选；一个"能出图的工具"如果忘了 `produces: 'image'`，它在 UI 里就是不存在的 —— 功能没错，只是没人能发现它。`accepts` 相反：不写等于"什么输入都收"，写了就把不合类型的输入挡在外面。

