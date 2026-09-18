/**
 * modelTool —— **模型可调用的 function calling 工具**（设计文档 §7.2 的四个缺口都补在这里）。
 *
 * 与内核自带的 ctx.tools **是两回事，别混**（§7.3 命名决策）：
 * - `ctx.tools`：一个**服务**（换实现——本地/云端/假货——要改行为），两个工具插件 + 节点面板在用 → 原地不动；
 * - 本模块：一张**表**，按规则 5（"一张表"是场，"一个能手"是服务）本就该是场 → 落在
 *   `ctx.registryOf('tool')`，不占服务名。
 *
 * 四个缺口（§7.2）：
 * ① 事件：`tools/registered` / `tools/unregistered` / `tools/result`（模块加载时 registerEventName，
 *    否则 dev 下每次 emit 一条 warn，违反"零 error、warn 仅限既有白名单"）；
 * ② `defineTool` 糖：从 `parameters` 自动派生 JSON Schema（**复用已有的 ToolParamDef 词表**，不新造）；
 * ③ 执行上下文补 `callId`（关联一次调用）与 `signal`（可取消）；
 * ④ `output.schema` + `output.render`：产物规范化 + Native renderer（生成可持久化的结果内容）。
 *
 * 教程第 7 章的等价写法（两个互不认识的插件由注册场 + 事件连起来）：
 *
 *     // 提供方
 *     ctx.registryOf('tool').add('greet', defineTool({
 *       description: '打个招呼',
 *       parameters: { name: { type: 'string', required: true } },
 *       output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
 *       async execute(args) { return 'Hello, ' + args.name + '!' },
 *     }))
 *     // 观察者（不认识提供方）
 *     ctx.on('tools/result', (exec, result) => console.log(exec.name, result.content))
 *
 * 依赖方向：纯内核、零 DOM、零 Vue（可 headless 单测）。
 */
import { registerEventName } from './EventBus'
import type { Registry, RegistryImplOptions } from './registry/registry'
import type { ToolParamDef } from './toolRegistry'

/** 可持久化的 JSON 值（产物规范化到这一层，才谈得上"可落盘"） */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue }

/**
 * 给模型看的 JSON Schema 子集（够描述 function calling 参数与产物，且**不必引第三方库**）。
 *
 * 为什么不引 JSON Schema 库：核心里只要"声明 + 校验 + 序列化"三件事，
 * 依赖一个 schema 库会把内核从"零依赖"变成"跟库的版本走"。
 */
export interface ToolValueSchema {
  /** 缺省 = 'json'（任意可持久化 JSON 值） */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'json'
  /** 人类可读标题（参数的 label 映射成它） */
  title?: string
  description?: string
  /** 候选值（`type:'select'` 的参数映射成它） */
  enum?: readonly (string | number | boolean)[]
  /** 非校验性默认值（原样进 schema，供模型/UI 参考） */
  default?: JsonValue
  minimum?: number
  maximum?: number
  multipleOf?: number
  /** `type:'object'` 时的属性表 */
  properties?: Record<string, ToolValueSchema>
  /** `type:'object'` 时的必填键 */
  required?: readonly string[]
  /** `type:'array'` 时的元素 schema（缺省 = 任意 JSON 值） */
  items?: ToolValueSchema
}

/**
 * 结果内容块（Native renderer 的产出，**可持久化**）。
 *
 * 只有两种块：文本与 JSON。要更丰富的展示（卡片/缩略图）是消费方拿它再渲染的事，
 * 内核不认 UI 概念——这样存下来的结果在任何宿主里都读得回来。
 */
export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'json'; value: JsonValue }

/** 一次调用的运行上下文（§7.2 缺口③）：关联 + 可取消 */
export interface ToolCallContext {
  /** 一次调用的关联 id（调用方给；不给由内核生成）。贯穿 execute 与 tools/result */
  callId: string
  /** 取消信号（调用方持有 AbortController）。工具应把它透传给 fetch 等可取消的下游 */
  signal: AbortSignal
}

/** tools/result 里给观察者的"这次调用是谁"（只读视图，不含可变状态） */
export interface ToolExecView {
  /** 场里的键 = 工具名 */
  name: string
  callId: string
  /** 归一化后的入参（已校验） */
  arguments: Record<string, unknown>
}

/**
 * 参数声明：**复用已有的 ToolParamDef**（type/options/min/max/step/default 已能描述参数），
 * 只加一个 `required`（JSON Schema 必须知道哪些必填）。
 */
export interface ToolParamSpec extends Omit<ToolParamDef, 'key'> {
  required?: boolean
}

/** parameters 形态：键即参数名（教程形态 `{ name: { type:'string', required:true } }`） */
export type ToolParamsSpec = Record<string, ToolParamSpec>

/** `defineTool` 的入参 */
export interface ToolDefineOptions {
  /** 工具名（**声明性的**：注册时的键才是权威；写上便于阅读与将来列给模型） */
  name?: string
  /** 一句话说明（发给模型看） */
  description: string
  /** 声明式参数（缺省 = 不收参数） */
  parameters?: ToolParamsSpec
  /**
   * 产物声明：
   * - `schema`：规范值的形状（缺省 `{type:'json'}`）。不符则整个调用收敛成 `ok:false`；
   * - `render`：纯函数，把规范值渲染成可持久化内容块（缺省：字符串 → text 块，其它 → json 块）。
   */
  output?: {
    schema?: ToolValueSchema
    render?(args: Record<string, unknown>, value: JsonValue): ToolContentBlock[]
  }
  /** 执行体：参数已校验，产物须符合 `output.schema` */
  execute(args: Record<string, unknown>, ctx: ToolCallContext): unknown | Promise<unknown>
}

/** 注册进 `ctx.registryOf('tool')` 的完整形状（字段名与教程对齐：description/parameters/output/execute） */
export interface ToolSpec {
  name?: string
  description: string
  parameters: ToolValueSchema
  output: {
    schema: ToolValueSchema
    render(args: Record<string, unknown>, value: JsonValue): ToolContentBlock[]
  }
  execute(args: Record<string, unknown>, ctx: ToolCallContext): unknown | Promise<unknown>
}

/** 一次调用的入参 */
export interface ToolCallRequest {
  /** 工具名（= `registryOf('tool')` 里的键） */
  name: string
  /** 模型给的参数（执行前按 parameters 校验） */
  arguments?: Record<string, unknown>
  /** 关联 id（不给由内核生成） */
  callId?: string
  /** 取消信号（不给 = 不可取消） */
  signal?: AbortSignal
}

/** 一次调用的终态结果（`content` 恒为数组，调用方无需判空） */
export interface ToolCallResult {
  ok: boolean
  /** 工具名 */
  name: string
  /** 本次调用的关联 id（与 tools/result 里的一致） */
  callId: string
  /** ok=true 时的规范产物（`output.schema` 已校验） */
  value?: JsonValue
  /** 可持久化的结果内容（`output.render` 的产出） */
  content: ToolContentBlock[]
  error?: string
}

/**
 * 广播口（结构类型：Context / 插件 scope / 假货都满足）。
 * 为什么不让内部直接抓着 EventBus：headless 单测可以直接传一个记数组的假货。
 */
export interface ToolEventEmitter {
  emit(name: string, ...args: any[]): void
}

/** 注册场种类名：模型可调用工具（§7.3 定案，别再叫 tools） */
export const TOOL_KIND = 'tool'

/** 把一个参数声明转成 JSON Schema 属性。把"参数名"从 ToolParamDef 的 key 字段挪回**映射的键**（教程形态） */
function paramToSchema(param: ToolParamSpec): ToolValueSchema {
  const out: ToolValueSchema = {}
  switch (param.type) {
    case 'number':
      out.type = 'number'
      if (param.min !== undefined) out.minimum = param.min
      if (param.max !== undefined) out.maximum = param.max
      if (param.step !== undefined) out.multipleOf = param.step
      break
    case 'boolean':
      out.type = 'boolean'
      break
    case 'select':
      // 下拉 → 字符串 + 候选值（option 的 label 只给人看，不发给模型）
      out.type = 'string'
      out.enum = (param.options ?? []).map((o) => o.value)
      break
    default:
      // 'string' 或未声明（教程形态里可以只给 required）
      out.type = 'string'
  }
  if (param.label !== undefined) out.title = param.label
  if (param.description !== undefined) out.description = param.description
  if (param.default !== undefined) out.default = param.default as JsonValue
  return out
}

/**
 * 纯函数：`parameters` → JSON Schema（缺口②的转换器）。
 * 键即参数名；有必填项才出现 `required`（模型端少一个字段就少一次幻觉）。
 */
export function toolParamsToJsonSchema(params: ToolParamsSpec): ToolValueSchema {
  const properties: Record<string, ToolValueSchema> = {}
  const required: string[] = []
  for (const [key, param] of Object.entries(params)) {
    properties[key] = paramToSchema(param)
    if (param.required) required.push(key)
  }
  const schema: ToolValueSchema = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}

/** 可持久化的 JSON 值？（产物规范化与内容块都靠它） */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false // Date/Map/class 实例都不算
    return Object.values(value as Record<string, unknown>).every(isJsonValue)
  }
  return false
}

/** 拼违规项路径：根处不加前缀，对象用 '.key'、数组用 '[i]' */
function joinPath(base: string, key: string): string {
  return base ? base + '.' + key : key
}

/**
 * 纯函数：按 schema 校验一个值，返回**带路径**的违规项（空数组 = 通过）。
 *
 * 为什么返回列表而不是抛错/布尔：参数违规要能一条条告诉模型（"seed 超出范围"比"参数不合法"有用得多），
 * 产物违规要能写进日志定位是哪个工具的作者写错了。
 */
export function validateToolValue(schema: ToolValueSchema, value: unknown, path = ''): string[] {
  const at = path || '值'
  const type = schema.type ?? 'json'
  if (type === 'json') {
    return isJsonValue(value) ? [] : [at + ' 不是可持久化的 JSON 值']
  }
  const out: string[] = []
  switch (type) {
    case 'string':
      if (typeof value !== 'string') out.push(at + ' 应为 string')
      break
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        out.push(at + ' 应为 number')
      } else if (type === 'integer' && !Number.isInteger(value)) {
        out.push(at + ' 应为整数')
      } else {
        if (schema.minimum !== undefined && value < schema.minimum) out.push(at + ' 不得小于 ' + schema.minimum)
        if (schema.maximum !== undefined && value > schema.maximum) out.push(at + ' 不得大于 ' + schema.maximum)
        if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
          const steps = value / schema.multipleOf
          if (Math.abs(steps - Math.round(steps)) > 1e-9) out.push(at + ' 必须是 ' + schema.multipleOf + ' 的倍数')
        }
      }
      break
    case 'boolean':
      if (typeof value !== 'boolean') out.push(at + ' 应为 boolean')
      break
    case 'array':
      if (!Array.isArray(value)) {
        out.push(at + ' 应为数组')
      } else if (schema.items) {
        const items = schema.items
        value.forEach((item, i) => {
          out.push(...validateToolValue(items, item, at + '[' + i + ']'))
        })
      }
      break
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        out.push(at + ' 应为对象')
        break
      }
      const record = value as Record<string, unknown>
      for (const key of schema.required ?? []) {
        if (record[key] === undefined) out.push(joinPath(path, key) + ' 必填')
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        const given = record[key]
        if (given === undefined) continue // 缺可选项不算错
        out.push(...validateToolValue(child, given, joinPath(path, key)))
      }
      break
    }
  }
  // enum 放在类型检查之后（类型都不对时再报"不在候选里"是噪音）
  if (out.length === 0 && schema.enum && !schema.enum.includes(value as string | number | boolean)) {
    out.push(at + ' 必须是 ' + schema.enum.join(' / ') + ' 之一')
  }
  return out
}

/** 缺省 renderer：字符串直接成文本块，其它值原样成 JSON 块（可持久化） */
function defaultRender(_args: Record<string, unknown>, value: JsonValue): ToolContentBlock[] {
  return typeof value === 'string' ? [{ type: 'text', text: value }] : [{ type: 'json', value }]
}

/** 把异常收敛成可展示的 message */
function messageOf(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return msg || fallback
}

/**
 * 缺口②：`defineTool` 糖 —— 从 `parameters` 自动派生 JSON Schema，产出注册表就绪的定义。
 *
 * 与教程形态一致（`description / parameters / output / execute`），不新造参数词表：
 * `parameters` 就是"键 → ToolParamSpec"，其中 ToolParamSpec 复用 ToolParamDef 的字段。
 */
export function defineTool(options: ToolDefineOptions): ToolSpec {
  const spec: ToolSpec = {
    description: options.description,
    parameters: toolParamsToJsonSchema(options.parameters ?? {}),
    output: {
      schema: options.output?.schema ?? { type: 'json' },
      render: options.output?.render ?? defaultRender,
    },
    execute: options.execute,
  }
  if (options.name !== undefined) spec.name = options.name
  return spec
}

/** 自增序号（不需要全局唯一，只要同进程内能区分两次调用） */
let callSeq = 0

/** 结果内容块的规范化：只放行可持久化的两种块 */
function normalizeContent(blocks: unknown): ToolContentBlock[] {
  if (!Array.isArray(blocks)) throw new Error('render 必须返回内容块数组')
  return blocks.map((block): ToolContentBlock => {
    const b = block as { type?: unknown; text?: unknown; value?: unknown } | null
    if (b && b.type === 'text' && typeof b.text === 'string') return { type: 'text', text: b.text }
    if (b && b.type === 'json' && isJsonValue(b.value)) return { type: 'json', value: b.value }
    throw new Error('内容块不可持久化（只允许 text / json 两种块）')
  })
}

/**
 * 跑一次模型可调用工具（缺口③④的执行侧）：校验入参 → execute → 校验产物 → render，
 * 并把 `tools/result` 在**结果物化时**发出去（先于本函数返回，观察者拿到的就是最终态）。
 *
 * 为什么入参是"场 + 广播口"而不是 ctx：headless 单测与别的宿主都能直接跑，
 * 且这条路径**不碰 ctx.tools**（两套工具不混，§7.3）。
 *
 * 一切失败都收敛成 `{ ok:false, error }`（调用方到处写 try/catch 是重复劳动），
 * 且失败同样发 `tools/result`——观察者要看到"每一次调用"，不只是成功的那几次。
 */
export async function runToolCall(
  field: Registry<ToolSpec>,
  emitter: ToolEventEmitter,
  request: ToolCallRequest,
): Promise<ToolCallResult> {
  callSeq += 1
  const callId = request.callId ?? request.name + '#' + callSeq
  const signal = request.signal ?? new AbortController().signal
  const args = request.arguments ?? {}

  const done = (
    rest: Pick<ToolCallResult, 'ok' | 'content'> & { value?: JsonValue; error?: string },
  ): ToolCallResult => {
    const result: ToolCallResult = { ok: rest.ok, name: request.name, callId, content: rest.content }
    if (rest.value !== undefined) result.value = rest.value
    if (rest.error !== undefined) result.error = rest.error
    // 结果物化：在返回之前发（教程第 7 章那条"logger 先触发"的性质）
    emitter.emit('tools/result', { name: request.name, callId, arguments: args }, result)
    return result
  }
  const abort = (): ToolCallResult => done({ ok: false, content: [], error: '调用已取消' })

  const spec = field.top(request.name)?.value
  if (!spec) return done({ ok: false, content: [], error: '未找到工具 "' + request.name + '"' })
  if (signal.aborted) return abort()

  const violations = validateToolValue(spec.parameters, args)
  if (violations.length > 0) {
    return done({ ok: false, content: [], error: '参数校验失败：' + violations.join('；') })
  }

  let raw: unknown
  try {
    raw = await spec.execute(args, { callId, signal })
  } catch (err) {
    return done({ ok: false, content: [], error: messageOf(err, '工具执行失败') })
  }
  if (signal.aborted) return abort()

  const value = raw as JsonValue
  const outViolations = validateToolValue(spec.output.schema, value)
  if (outViolations.length > 0) {
    return done({ ok: false, content: [], error: '产物不符合 output.schema：' + outViolations.join('；') })
  }

  let content: ToolContentBlock[]
  try {
    content = normalizeContent(spec.output.render(args, value))
  } catch (err) {
    return done({ ok: false, content: [], error: '渲染失败：' + messageOf(err, '未知原因') })
  }
  return done({ ok: true, content, value })
}

/**
 * 缺口①：给 `ctx.registryOf('tool')` 这张场接上事件（只对 'tool' 种类生效，别的种类零开销）。
 *
 * 为什么接在场这一层：注册/撤销可能来自任何插件（也可能被同 id 顶替），
 * 只有"表本身"知道每一次进出；接在这里才能保证观察者不漏事件。
 *
 * 事件的三个语义：
 * - `tools/registered`：一条工具进表（同 id 顶替时也会发，此前先发一条 unregistered）；
 * - `tools/unregistered`：一条工具离表（显式撤销 / 清空 / 被顶替）；
 * - `tools/result`：由 {@link runToolCall} 在结果物化时发，不在本函数里。
 */
export function toolFieldOptions(kind: string, emitter: ToolEventEmitter): RegistryImplOptions<unknown> {
  if (kind !== TOOL_KIND) return {}
  return {
    onChange(change) {
      if (change.type !== 'added') {
        emitter.emit('tools/unregistered', change.key, (change.previous ?? change.entry).source)
      }
      if (change.type !== 'removed') {
        emitter.emit('tools/registered', change.key, change.entry.value, change.entry.source)
      }
    },
  }
}

// 事件名登记（§7.4）：编译期的 interface Events 不进运行时登记表，
// 不在这里 registerEventName 就会在 dev 下每次 emit 一条 warn（违反"warn 仅限既有白名单"）。
registerEventName('tools/registered')
registerEventName('tools/unregistered')
registerEventName('tools/result')

