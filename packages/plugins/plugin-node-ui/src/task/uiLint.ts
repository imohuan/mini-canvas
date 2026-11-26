/**
 * uiLint —— 可视化节点界面的**规范检查**（纯逻辑，零 IO，可单测）。
 *
 * ## 为什么要有它（用户 2026-11-26 口径）
 *
 * 用户原话：「这个逻辑，这部分需要使用代码进行检查，不能靠 ai」。
 *
 * 背景：AI 写完 HTML 就交付，可它漏掉的那些东西**在画面上看不出来** ——
 * 界面能显示、按钮能点，只有等用户删了连线还看到「上游 图片 1」、
 * 或者刷新后参数全丢，才发现不对。那时已经过去好几轮了。
 *
 * 所以把「必须做到的事」写成这里的一条条规则，由 canvas_ui_write / canvas_ui_update
 * 写完当场跑一遍，把没做到的**逐条点名**还给 AI。
 *
 * ## 规则分两档
 *
 * - **error**：违反就是坏的（外链、直接 fetch 后台），必须改；
 * - **warn**：能跑但有坑（没监听参数、onChange 里不读上游、没交参数……），
 *   交付前该补上。
 *
 * 为什么区分：只报 warn 的界面仍然可用（先让用户看到），
 * 但 AI 必须知道「还差什么」—— 全当 error 会把正常的中间状态也挡死。
 */

export type UiLintLevel = 'error' | 'warn'

export interface UiLintIssue {
  level: UiLintLevel
  /** 规则名（短，便于 AI 记住是哪一条） */
  rule: string
  /** 说人话的问题描述 + 该怎么改 */
  message: string
}

export interface UiLintResult {
  ok: boolean
  errors: UiLintIssue[]
  warnings: UiLintIssue[]
}

export interface UiLintOptions {
  /** 节点已声明的后台脚本名（不在里面的脚本被调用 → 403） */
  declaredScripts?: readonly string[]
  /** 这台机器上真实存在的脚本名（判定「调了一个不存在的脚本」） */
  knownScripts?: readonly string[]
}

/** 外链（沙箱里连不上）：http(s) 地址、协议相对、<link>、带 src 的 script */
const EXTERNAL_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /<link\b[^>]*href\s*=\s*["']?\s*(?:https?:)?\/\//i, what: '<link> 外链样式' },
  { re: /<script\b[^>]*\bsrc\s*=/i, what: '<script src> 外链脚本' },
  { re: /(?:src|href)\s*=\s*["']https?:\/\//i, what: 'http(s) 图片/资源地址' },
  { re: /url\(\s*["']?https?:\/\//i, what: 'CSS 里的外链（url(http…)）' },
  { re: /@import\s+url\(\s*["']?https?:\/\//i, what: '@import 外链字体/样式' },
]

/** 从界面里认「调了哪些后台脚本」（与 declare.ts 同一套写法，含 CanvasUI.task） */
function scriptNamesCalled(html: string): string[] {
  const out = new Set<string>()
  const re = /(?:CanvasUI\s*\.\s*task|(?<![.\w])task)\s*\(\s*["']([A-Za-z0-9_-]{1,64})["']/g
  for (const m of html.matchAll(re)) if (m[1]) out.add(m[1])
  return [...out]
}

/**
 * 检查一段界面 HTML 是否符合可视化节点规范。
 *
 * @param html 节点的 uiHtml 原文
 */
export function lintUiHtml(html: string, opts: UiLintOptions = {}): UiLintResult {
  const errors: UiLintIssue[] = []
  const warnings: UiLintIssue[] = []
  const src = html || ''
  const add = (level: UiLintLevel, rule: string, message: string): void => {
    ;(level === 'error' ? errors : warnings).push({ level, rule, message })
  }

  if (!src.trim()) {
    add('error', 'empty', '界面是空的：先用 canvas_ui_write 写一段自包含 HTML。')
    return { ok: false, errors, warnings }
  }

  // ① 外链（沙箱里一律连不上，写了就是白屏/裂图）
  for (const p of EXTERNAL_PATTERNS) {
    if (p.re.test(src)) {
      add(
        'error',
        'external-link',
        '用了' + p.what + '。沙箱里只有后台一个源可达，外链一律连不上；' +
          '样式写 <style>、脚本写 <script>、图标用内联 SVG 或字符。',
      )
      break
    }
  }

  // ② 页面自己 fetch 后台（不透明源会被请求边界拒掉）
  if (/(?:^|[^.\w])fetch\s*\(/.test(src)) {
    add(
      'error',
      'direct-fetch',
      '界面里直接 fetch 会被请求边界拒绝（沙箱是 Origin: null）。' +
        '读画布/改节点用 CanvasUI.api(path, init)，跑脚本用 CanvasUI.task。',
    )
  }

  // ③ 调了没声明的脚本（用户点按钮就 403）
  const declared = new Set(opts.declaredScripts ?? [])
  const known = opts.knownScripts ? new Set(opts.knownScripts) : undefined
  for (const name of scriptNamesCalled(src)) {
    if (known && !known.has(name)) {
      add('error', 'unknown-script', '调用了 "' + name + '"，但这台机器的 task-scripts/ 里没有这个脚本（拼写要对得上文件全名）。')
      continue
    }
    if (!declared.has(name)) {
      add(
        'error',
        'undeclared-script',
        '调用了 "' + name + '" 但节点没声明它（当前声明：' +
          (declared.size ? [...declared].join('、') : '无') +
          '）。不声明用户一点就 403。用 canvas_ui_write / canvas_fn_call 会顺手补，' +
          '也可以自己写进节点的 data.uiScripts。',
      )
    }
  }

  // ④ 参数监听（用户点名：节点必须实现参数监听）
  const hasOnChange = /CanvasUI\s*\.\s*onChange\s*\(/.test(src)
  if (!hasOnChange) {
    add(
      'error',
      'missing-onchange',
      '没有注册 CanvasUI.onChange。节点必须实现参数监听：上游或参数一变，界面要照着重画。' +
        '照抄这段：CanvasUI.onChange(function (d) { 用 d.upstream / d.inputs 重画 }).',
    )
  } else {
    /** onChange 那段代码的大致范围（到下一个顶层语句为止）：只在这个窗口里找上游读取 */
    const at = src.search(/CanvasUI\s*\.\s*onChange\s*\(/)
    const window = src.slice(at, at + 1200)
    const readsUpstreamInCallback =
      /\.upstream\b/.test(window) || /__CANVAS_UPSTREAM__/.test(window)
    if (!readsUpstreamInCallback) {
      add(
        'warn',
        'onchange-ignores-upstream',
        'onChange 里没用到上游（既没读 d.upstream，也没读 window.__CANVAS_UPSTREAM__）。' +
          '这样删了连线界面还是老样子 —— 2026-11-26 用户截图就是这个现象。' +
          '回调里要按新上游重画，读到空就清空素材。',
      )
    }
  }

  // ⑤ 参数要交出去（不交就进不了节点，刷新后全丢）
  if (!/CanvasUI\s*\.\s*setInputs\s*\(/.test(src) && !/CanvasUI\s*\.\s*save\s*\(/.test(src)) {
    add(
      'warn',
      'no-persist',
      '界面从没调 setInputs（也没 save）：用户改的值不会进节点，刷新后全丢。' +
        '配置类界面应当在一次修改完成时调一次 CanvasUI.setInputs(参数对象)。',
    )
  }

  // ⑥ 读注入上下文（主题 / 后台地址 / 画布与节点 id 都从它来）
  if (!/__CANVAS_UI__/.test(src)) {
    add(
      'warn',
      'no-ui-context',
      '没读 window.__CANVAS_UI__：拿不到主题、后台地址、canvasId / nodeId。' +
        '深浅色、回写产物、拼绝对地址都要用它。',
    )
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** 给 AI 看的一行结论（没有问题时是空串，避免噪音） */
export function formatLint(r: UiLintResult): string {
  const lines: string[] = []
  for (const e of r.errors) lines.push('  ✗ [' + e.rule + '] ' + e.message)
  for (const w of r.warnings) lines.push('  ! [' + w.rule + '] ' + w.message)
  return lines.join('\n')
}
