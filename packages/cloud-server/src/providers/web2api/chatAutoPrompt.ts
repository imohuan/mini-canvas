/**
 * chat-auto 模式的提示词前缀 —— 把媒体参数拼成 web2api **真能解析**的指令。
 *
 * 为什么只能写进提示词：走 UI 自动化的平台（豆包 / dola 的 chat-auto）只有两个入参
 * （prompt + referenceImages），比例、时长、模型没有独立的参数位，只能写成前缀。
 *
 * 前缀**必须**是圆括号里的键值对（这是 2026-10-14 修掉的一个真 bug）：
 *
 *   /video(model:"Seedance 2.0 Fast", ratio:"9:16", durationSec:10) 一只猫在跑
 *   /image(model:"Seedream 4.5", ratio:"16:9") 夕阳下的城市
 *
 * 早先这里拼的是空格分隔的纯文本（`/video Seedance 2.0 Fast 9:16 10s`）——
 * web2api 的解析器（`server/src/platforms/_shared/chat-auto/prefix.ts` 的 parsePrompt）
 * 只认圆括号里的键值对，纯文本形式解析出来的 params 是**空的**：模型、比例、时长全被
 * 当成正文发给平台，等于这些参数根本没生效（用户实测「完全是以文本的形式来写，这是错误的」）。
 *
 * 键与取值口径（与 web2api 的解析器逐条对齐）：
 *   - 认的键：model / ratio / durationSec / style（别的键写了也没人读，不写免得噪音）；
 *   - 字符串值加引号、数字不加引号（解析器两种都认，加引号更保险）；
 *   - 空值（undefined / null / ''）整键跳过，让平台走自己的默认；
 *   - 正文为空时只发前缀，不留尾部空格。
 *
 * 纯函数、零依赖 —— 与前端那份同源（plugin-web2api-tools 的 chatAutoPrompt）。
 * 就地写（不引工作区包）：cloud-server 要能独立 npx 跑。
 */

export interface ChatAutoOptions {
  mode: 'image' | 'video'
  /** 平台侧模型名（如 Seedance 2.0 Fast）；不给就不写模型这句 */
  model?: unknown
  ratio?: unknown
  durationSec?: unknown
  style?: unknown
}

/** 只有这四个键会被 web2api 读取（顺序即前缀里的书写顺序） */
const KEY_ORDER = ['model', 'ratio', 'durationSec', 'style'] as const

/** 值 → 前缀里的字面量：数字原样、字符串加引号；空值返回 undefined（整键跳过） */
function literalOf(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'boolean') return String(value)
  const s = String(value).trim()
  return s === '' ? undefined : '"' + s.replace(/"/g, '') + '"'
}

/**
 * 数值型参数（时长）归一成数字：上游的按钮档位常把值写成字符串（'5' / '10'），
 * 直接拼会变成 `durationSec:"10"` —— web2api 的解析器虽能 coerce，
 * 但契约上这个是数字（前端那份也是数字），归一后两端形态一致。
 */
function numericOf(value: unknown): unknown {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return value
}

/**
 * 拼一次 chat-auto 的完整 prompt。
 * @param opts 已选的媒体参数（未选/空串的键会被跳过）
 * @param prompt 用户写的正文（可能为空 —— 那时只发前缀指令）
 */
export function buildChatAutoPrompt(opts: ChatAutoOptions, prompt: string): string {
  const parts: string[] = []
  for (const key of KEY_ORDER) {
    const literal = literalOf(key === 'durationSec' ? numericOf(opts[key]) : opts[key])
    if (literal !== undefined) parts.push(key + ':' + literal)
  }
  const head = '/' + opts.mode + (parts.length > 0 ? '(' + parts.join(', ') + ')' : '')
  const body = (prompt ?? '').trim()
  return body ? head + ' ' + body : head
}
