/**
 * chatAutoPrompt —— 把服务端**确实会解析**的参数拼成 chat-auto 的前缀指令（纯函数，node 可单测）。
 *
 * 为什么必须这么拼：web2api 的 `doubao/chat-auto` 与 `dola/chat-auto` 只有两个参数
 * （prompt + referenceImages）—— 媒体参数没有独立的入参位，只能写进 prompt 前缀：
 *
 *   /video({model:"Seedance 2.0 Fast", ratio:"16:9", durationSec:10}) 一只猫在跑
 *   /image({model:"Seedream 4.5", ratio:"16:9"}) 夕阳下的城市
 *
 * 服务端解析器（platforms/_shared/chat-auto/prefix.ts）的中英别名与取值：
 *   model/模型、ratio/比例/画幅、durationSec/时长、style/风格；
 *   durationSec **只接受 5 或 10**（其它值就近取 10 或 5）。
 *
 * 只写服务端认得的键（model / ratio / durationSec / style）—— UI 上多出来的参数
 * （如运镜主体）不在这里，免得塞进去没人读。
 */

/** 一次 chat-auto 调用的参数（都来自预置配置表里已声明的字段） */
export interface ChatAutoArgs {
  /** 媒体模式：/image 或 /video */
  mode: 'image' | 'video'
  model?: unknown
  ratio?: unknown
  durationSec?: unknown
  style?: unknown
}

/** 只有这四个键会被服务端读取（其余一律忽略，不写进前缀免得噪音） */
const KEY_ORDER = ['model', 'ratio', 'durationSec', 'style'] as const

/** 值 → 前缀里的字面量：数字原样、字符串加引号（服务端两种都认，引号更保险） */
function literalOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'boolean') return String(value)
  const s = String(value).trim()
  return s === '' ? undefined : '"' + s.replace(/"/g, '') + '"'
}

/**
 * 拼装 chat-auto 的完整 prompt。
 * @param args 已选的媒体参数（未选/空串的键会被跳过）
 * @param body 用户输入的正文（可能为空 —— 那时只发前缀指令）
 */
export function buildChatAutoPrompt(args: ChatAutoArgs, body: string): string {
  const parts: string[] = []
  for (const key of KEY_ORDER) {
    const literal = literalOf(args[key])
    if (literal !== undefined) parts.push(key + ':' + literal)
  }
  const prefix = '/' + args.mode + (parts.length > 0 ? '(' + parts.join(', ') + ')' : '')
  const text = (body ?? '').trim()
  return text ? prefix + ' ' + text : prefix
}

/**
 * 服务端把非 5/10 的时长就近取整（>=8 → 10，否则 5）。
 * UI 上如实说明，免得用户以为"拖到 7 秒"真的生效了。
 */
export function normalizeDurationSec(value: unknown): number | undefined {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return n >= 8 ? 10 : 5
}
