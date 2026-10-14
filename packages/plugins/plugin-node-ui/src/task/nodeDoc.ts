/**
 * nodeDoc —— 可视化节点的「说明书」（**纯逻辑，可单测**）。
 *
 * ## 为什么要有它（用户 2026-10-14 口径）
 *
 * 用户原话：「每个可视化节点要有详细的功能描述，包括它自己的输入和输出」、
 * 「希望通过 MCP 添加收藏的可视化节点……必须明确：节点是做什么的、功能效果、输入参数、输出或影响」。
 *
 * 现状的问题：收藏进资产库的节点包只有「名字 + 界面 + 脚本」，**没有一句话说它是干什么的**。
 * 于是 Agent 拿到一串包名只能猜：想用它不知道该建哪个，建了也不知道该怎么喂、会得到什么。
 *
 * ## 住在哪里
 *
 * 说明书落在**节点 data** 上（键 `uiNodeDoc`），跟着节点包一起走 ——
 * 打包时进包、导入时随节点还原、收藏后从资产库读得到。**不另立一份索引**：
 * 索引会和节点数据漂移（改了一处忘了另一处），而说明书本来就该跟节点长在一起。
 *
 * 形状（四件事，正是用户点名要的四条）：
 *
 * ```json
 * {
 *   "what":   "这个节点做什么",
 *   "effect": "功能效果（建出来会看到什么）",
 *   "inputs": [ { "name": "参考图", "type": "image", "desc": "连进来的图" } ],
 *   "outputs":[ { "name": "宫格图", "type": "image", "desc": "转出来的图" } ]
 * }
 * ```
 *
 * 输入/输出都**同时认「一行字」和「{name,type,desc}」两种写法** ——
 * 前者是作者随手写一句，后者是认真描述；不因为写法不同就把它丢掉。
 */

/** 说明书在节点 data 上的键 */
export const NODE_DOC_KEY = 'uiNodeDoc'

/** 一路输入/输出 */
export interface NodeIoEntry {
  /** 名字（「参考图」「宫格图」） */
  name: string
  /** 类型（image / video / audio / text / 任意，可省） */
  type?: string
  /** 一句话说明（可省） */
  desc?: string
}

/** 节点说明书 */
export interface NodeDoc {
  /** 节点是做什么的（必填 —— 一句话说不清就先别收藏） */
  what: string
  /** 功能效果（可选） */
  effect?: string
  /** 输入参数（可选） */
  inputs?: NodeIoEntry[]
  /** 输出或影响（可选） */
  outputs?: NodeIoEntry[]
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 把一条输入/输出规整成 { name, type?, desc? }。
 *
 * 认三种写法：
 *   · "参考图"                        → { name: '参考图' }
 *   · { name: '参考图' }               → 原样
 *   · "参考图: 连进来的图"             → { name: '参考图', desc: '连进来的图' }
 * 认不出（数字、null、空串）→ undefined（宁可不列，也别列一条看不懂的）。
 */
export function normalizeIoEntry(raw: unknown): NodeIoEntry | undefined {
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return undefined
    const at = s.search(/[:：]/)
    if (at > 0) {
      const name = s.slice(0, at).trim()
      const desc = s.slice(at + 1).trim()
      return name ? { name, ...(desc ? { desc } : {}) } : undefined
    }
    return { name: s }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    const name = str(o.name) || str(o.label) || str(o.port)
    if (!name) return undefined
    const type = str(o.type) || str(o.contentType)
    const desc = str(o.desc) || str(o.description) || str(o.what)
    return { name, ...(type ? { type } : {}), ...(desc ? { desc } : {}) }
  }
  return undefined
}

function normalizeIoList(raw: unknown): NodeIoEntry[] {
  if (raw === undefined || raw === null) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  const out: NodeIoEntry[] = []
  for (const item of arr) {
    const e = normalizeIoEntry(item)
    if (e) out.push(e)
  }
  return out
}

/**
 * 规整一份说明书；**没有 what 就当没写**（返回 undefined）。
 *
 * 为什么 what 是硬门槛：用户要的是「节点是做什么的」——这一条没有，说明书就等于没写，
 * 保留半个空壳只会让列表里出现一堆「（无说明）」。宁可不显示，逼作者写清那一句。
 */
export function normalizeNodeDoc(raw: unknown): NodeDoc | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const what = str(o.what) || str(o.desc) || str(o.description) || str(o.summary)
  if (!what) return undefined
  const effect = str(o.effect) || str(o.effects)
  const inputs = normalizeIoList(o.inputs ?? o.input)
  const outputs = normalizeIoList(o.outputs ?? o.output)
  return {
    what,
    ...(effect ? { effect } : {}),
    ...(inputs.length ? { inputs } : {}),
    ...(outputs.length ? { outputs } : {}),
  }
}

/** 从节点 data 里读说明书（没写 → undefined） */
export function nodeDocOf(data: unknown): NodeDoc | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  return normalizeNodeDoc((data as Record<string, unknown>)[NODE_DOC_KEY])
}

function ioLine(prefix: string, list: NodeIoEntry[] | undefined): string[] {
  if (!list || !list.length) return []
  return list.map((e) => {
    const bits = [e.type ? '[' + e.type + ']' : '', e.desc ?? ''].filter(Boolean).join(' ')
    return '  · ' + prefix + ' ' + e.name + (bits ? ' —— ' + bits : '')
  })
}

/**
 * 把说明书渲染成给 AI 看的几行字。
 *
 * 为什么要渲染成文本而不是直接回 JSON：这些字会进 MCP 工具的返回值与手册，
 * AI 读一段整齐的中文比读一个嵌套对象更容易照着办事（也更容易照抄进它的回答）。
 */
export function describeNodeDoc(doc: NodeDoc | undefined): string {
  if (!doc) return '（这个节点没有写说明书：不知道它是做什么的、要什么输入、给什么输出）'
  const lines = ['做什么：' + doc.what]
  if (doc.effect) lines.push('效果：' + doc.effect)
  lines.push(...ioLine('输入', doc.inputs))
  lines.push(...ioLine('输出', doc.outputs))
  return lines.join('\n')
}
