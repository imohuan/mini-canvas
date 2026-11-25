/**
 * declare —— 「这个节点依赖哪些后台脚本」这件事的纯逻辑（零 IO，可单测）。
 *
 * ## 两个来路，都要过这里
 *
 * 1. **AI 自己写的**：直接写节点 data.uiScripts（经 canvas_batch_nodes）—— 优先，不覆盖。
 * 2. **后台顺手扫的**：canvas_ui_write / canvas_ui_update 写完界面，扫一遍 HTML，
 *    把里面调到的脚本名补进声明 —— 兜底。
 *
 * 为什么必须有第 2 条：AI 会忘。而忘了的后果不是"少写一行"这么轻 —— 是界面画出来了、
 * 用户点一下却 403，而 AI 从画面上完全看不出哪里错了（2026-10-13 用户确认的"双保险"）。
 */

/**
 * 从界面 HTML 里认「调了哪个脚本」用的正则。
 *
 * 认的是手册里教的那个写法：`{ type: "call", name: "scale", ... }`。
 * 前面要求一个分隔符（行首 / `{` / `,` / `(` / 空白），否则 `filename: "x"` 里的
 * `name:` 会被误当成一次脚本调用。
 * 三种引号写法（`name:` / `'name':` / `"name":`）都认。
 */
export const SCRIPT_CALL_RE = /(?:^|[{,(\s])["\']?name["\']?\s*:\s*["\']([A-Za-z0-9_-]{1,64})["\']/g

/**
 * 第二种写法：手册里教的那句 `CanvasUI.task("脚本名", "函数", …)`。
 *
 * 为什么必须认它（2026-11-26 真机踩到）：手册第 3.3 节教的就是这个写法，
 * 但自动补声明只认 `{ type: "call", name: "x" }` —— 于是按手册写的界面
 * **一条声明都补不上**，界面画好了、用户点「生成」直接 403。
 * 当时那个节点里只剩一个旧的 `_pixelize`，界面调的 `pixelize` 没人声明。
 *
 * 正则要求前面是 `CanvasUI.task` 或独立的 `task(`（不跟在 `.` 或字母后面，
 * 免得把 `someTask(` 也算进来）；名字仍要过 knownNames 白名单，噪音不会进来。
 */
export const TASK_CALL_RE = /(?:CanvasUI\s*\.\s*task|(?<![.\w])task)\s*\(\s*["\']([A-Za-z0-9_-]{1,64})["\']/g

/**
 * 从界面 HTML 里扫出它调用了哪些脚本。
 *
 * **只认这台机器上真实存在的脚本名**（knownNames）：
 * 界面里到处是 `name: "xxx"`（给 input 起名、给变量起名…），不过滤会收进一堆噪音，
 * 声明里塞满不存在的脚本名，反而让人不敢信它。过滤之后剩下的才是真调用。
 */
export function detectScriptCalls(html: string, knownNames: readonly string[]): string[] {
  if (!html) return []
  const known = new Set(knownNames)
  const out = new Set<string>()
  // 正则带 g（有 lastIndex 状态），所以每次现造一个，避免跨调用串状态
  // 两种写法都要扫：`{ name: "x" }` 与 `CanvasUI.task("x", …)`（手册教的是后者）。
  for (const source of [SCRIPT_CALL_RE.source, TASK_CALL_RE.source]) {
    const re = new RegExp(source, 'g')
    for (const m of html.matchAll(re)) {
      const name = m[1]
      if (name && known.has(name)) out.add(name)
    }
  }
  return [...out].sort()
}

/** 声明表里一条：脚本名 → 它的内容摘要（打包/校验用；拿不到就是空对象） */
export interface ScriptDecl {
  /** 脚本文件内容的 sha256（打包时据此判断"本机那份和我包里这份是不是同一个"） */
  sha256?: string
  /** 什么时候被记进来的（诊断用） */
  at?: number
}

/** 脚本名白名单（与 task/scripts.ts 同一套判据：不允许斜杠、点、空格） */
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 合并声明：**已有的不丢，新发现的补上**。
 *
 * 为什么是合并不是覆盖：AI 自己写的那份更可信（它知道界面真正依赖什么），
 * 而后台扫出来的只是"猜"，扫漏了不该把 AI 写的冲掉。
 * sha256 同理：已有值优先，避免每次改界面都把哈希刷成"当时那份"。
 */
export function mergeDeclared(
  existing: unknown,
  add: readonly string[],
  shaOf: (name: string) => string | undefined,
  now: number,
): Record<string, ScriptDecl> {
  const out: Record<string, ScriptDecl> = {}
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    for (const [k, v] of Object.entries(existing as Record<string, unknown>)) {
      if (!NAME_RE.test(k)) continue
      const decl = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
      out[k] = {
        ...(typeof decl.sha256 === 'string' && decl.sha256 ? { sha256: decl.sha256 } : {}),
        ...(typeof decl.at === 'number' ? { at: decl.at } : {}),
      }
    }
  }
  for (const name of add) {
    if (!NAME_RE.test(name)) continue
    const prev = out[name] ?? {}
    const sha = prev.sha256 ?? shaOf(name)
    out[name] = { ...(sha ? { sha256: sha } : {}), at: prev.at ?? now }
  }
  return out
}

