/**
 * fnDoc —— 后台功能函数（task-scripts/*.mjs）的**说明书与调用表**（纯逻辑，可单测）。
 *
 * ## 为什么要有它（用户 2026-10-14 口径）
 *
 * 用户原话：「每个可视化节点可能存在后台接口……这些后台能力相当于扩展工具函数」、
 * 「梳理每个可视化节点可能导出的后台接口或扩展工具函数」，要写清
 * 「工具做什么 / 输入参数有哪些 / 返回结果是什么 / 调用示例」，并且
 * 「MCP 可直接调用这些后台接口，调用时不需要外部传 Canvas ID / Node ID」。
 *
 * 现状：脚本里 export 的函数只有**名字**（见 inspect.ts，它只列函数名，不 import 脚本）。
 * 名字之外的一切（干什么、收什么、回什么）**只有脚本作者知道** ——
 * 所以约定作者在脚本里躺一份说明书，我们把它们收上来。
 *
 * ## 约定（作者侧）
 *
 * 脚本里 export 一个**叫 `docs` 的普通对象**（不是函数，所以它不会出现在「可调函数」清单里）：
 *
 * ```js
 * export const docs = {
 *   scale: {
 *     what: '把图片缩放到指定宽度',
 *     args:  [{ name: 'width', type: 'number', required: true, desc: '目标宽度（像素）' }],
 *     returns: '缩放后的图片地址',
 *     example: 'scale(640)',
 *   },
 * }
 * ```
 *
 * 字段都**宽松**（写法不同不丢 `what` 就认）：
 *   · `what` / `desc` / `summary` 都当「工具做什么」；
 *   · `args` / `params` / `input` / `inputs` 都当输入参数；
 *   · `returns` / `return` / `output` / `outputs` 都当返回结果；
 *   · `example` / `usage` 都当调用示例。
 *
 * 没写说明书的函数**照样列出来**（名字来自真实 import），只是标一句「没写说明书」——
 * 不能因为作者偷懒就把这个功能整个藏起来，那样 Agent 就永远发现不了它能用。
 */

/** 说明书里一个参数 */
export interface FnArgDoc {
  name: string
  /** 类型（string / number / boolean / object / 任意，可省） */
  type?: string
  /** 必填 */
  required?: boolean
  /** 一句话说明 */
  desc?: string
}

/** 一个函数的说明书 */
export interface FnDoc {
  /** 工具做什么 */
  what: string
  /** 输入参数 */
  args: FnArgDoc[]
  /** 返回结果（一句话） */
  returns?: string
  /** 调用示例（一句话，形如 `scale(640)`） */
  example?: string
}

/** 一个脚本里所有函数的说明书：函数名 → 说明书 */
export type ScriptDocs = Record<string, Partial<FnDoc> & { what?: string }>

export interface FnSummary {
  /** 脚本名（task-scripts/ 里的文件名） */
  script: string
  /** 函数名 */
  fn: string
  /** 工具做什么（没写说明书 → undefined） */
  what?: string
  /** 输入参数（没写 → 空数组） */
  args: FnArgDoc[]
  returns?: string
  example?: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 一条参数：认「'width'」和「{ name, type, required, desc }」两种写法 */
export function normalizeArgDoc(raw: unknown): FnArgDoc | undefined {
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
    const name = str(o.name) || str(o.key) || str(o.arg)
    if (!name) return undefined
    const type = str(o.type)
    const desc = str(o.desc) || str(o.description) || str(o.what)
    const required = typeof o.required === 'boolean' ? o.required : undefined
    return {
      name,
      ...(type ? { type } : {}),
      ...(required === undefined ? {} : { required }),
      ...(desc ? { desc } : {}),
    }
  }
  return undefined
}

function normalizeArgList(raw: unknown): FnArgDoc[] {
  if (raw === undefined || raw === null) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  const out: FnArgDoc[] = []
  for (const item of arr) {
    const a = normalizeArgDoc(item)
    if (a) out.push(a)
  }
  return out
}

/**
 * 规整一份「函数名 → 说明书」的表。
 *
 * 只收**有 `what` 的条目**：没有 what 的等于作者什么都没说，
 * 列出来只会得到「（无说明）」——那种条目还不如让上层回落到「没写说明书」那句统一文案。
 */
export function normalizeScriptDocs(raw: unknown): ScriptDocs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ScriptDocs = {}
  for (const [fn, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const o = v as Record<string, unknown>
    const what = str(o.what) || str(o.desc) || str(o.summary)
    if (!what) continue
    const args = normalizeArgList(o.args ?? o.params ?? o.input ?? o.inputs)
    const returns = str(o.returns) || str(o.return) || str(o.output) || str(o.outputs)
    const example = str(o.example) || str(o.usage)
    out[fn] = {
      what,
      ...(args.length ? { args } : {}),
      ...(returns ? { returns } : {}),
      ...(example ? { example } : {}),
    }
  }
  return out
}

/**
 * 把「真实导出的函数名」与「作者写的说明书」并成一张清单。
 *
 * **以真实导出为准**（说明书里写了但脚本里没有的，忽略 —— 那是过期文档）；
 * 真实导出而说明书没写的，照样列出（只是没有 what）。
 */
export function mergeFunctions(script: string, methods: readonly string[], docs: ScriptDocs): FnSummary[] {
  const out: FnSummary[] = []
  for (const fn of methods) {
    const d = docs[fn]
    out.push({
      script,
      fn,
      ...(d?.what ? { what: d.what } : {}),
      args: d?.args ?? [],
      ...(d?.returns ? { returns: d.returns } : {}),
      ...(d?.example ? { example: d.example } : {}),
    })
  }
  return out
}

/** 把一条函数说明书渲染成给 AI 看的几行字 */
export function describeFunction(f: FnSummary): string {
  const lines: string[] = []
  lines.push('- ' + f.script + '.' + f.fn + (f.what ? '：' + f.what : '：（这个函数没写说明书）'))
  if (f.args.length) {
    lines.push(
      '    参数：' +
        f.args
          .map((a) => a.name + (a.type ? ':' + a.type : '') + (a.required ? '（必填）' : '') + (a.desc ? ' ' + a.desc : ''))
          .join('、'),
    )
  } else {
    lines.push('    参数：无')
  }
  if (f.returns) lines.push('    返回：' + f.returns)
  if (f.example) lines.push('    示例：' + f.example)
  return lines.join('\n')
}
