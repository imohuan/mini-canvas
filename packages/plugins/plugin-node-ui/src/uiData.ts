/**
 * uiData —— 「AI 可视化节点」的纯逻辑（零 Vue / 零 DOM，Node 可单测）。
 *
 * 这个节点干一件事：**把数据与要求交给 AI，让 AI 写一段 HTML，在节点里画出来**。
 * 于是这里收敛四件事：
 *   1. 节点声明的「输入参数」（有哪些数据、各是什么类型）—— AI 靠它知道该画什么；
 *   2. 交给 AI 的提示词：数据结构、**画布接口怎么调**（让它能真的动手）、硬性约束；
 *   3. AI 回来的 HTML 怎么变成能安全渲染的东西（自包含文档 + 注入数据 + 沙箱边界）；
 *   4. 上游素材的归一（形状与底栏交付的一致，本插件不认识「边」）。
 *
 * 为什么放在 .vue 外面：这些都不需要浏览器，放这里能用普通断言直接测
 * （「算得对不对」与「画得对不对」分开，出问题能立刻定位是哪一层）。
 */

/** 输入参数的类型词表（闭合）。AI 与后面的取值都按它理解一个参数是什么东西。 */
export const UI_INPUT_TYPES = ['text', 'number', 'boolean', 'json', 'table', 'image', 'video', 'audio'] as const
export type UiInputType = (typeof UI_INPUT_TYPES)[number]

/** 类型 → 给 AI 看的一句人话（写进提示词，比裸类型名好懂） */
export const UI_INPUT_TYPE_LABELS: Record<UiInputType, string> = {
  text: '文本',
  number: '数字',
  boolean: '开关（true/false）',
  json: '任意 JSON',
  table: '表格（行对象数组）',
  image: '图片地址（可直接放进 img 的 src）',
  video: '视频地址（可直接放进 video 的 src）',
  audio: '音频地址（可直接放进 audio 的 src）',
}

const TYPE_SET: ReadonlySet<string> = new Set(UI_INPUT_TYPES)

export function isUiInputType(v: unknown): v is UiInputType {
  return typeof v === 'string' && TYPE_SET.has(v)
}

/** 一条输入参数声明 */
export interface UiInputDecl {
  /** 键名。AI 生成的 HTML 用 window.__CANVAS_INPUTS__[这个键] 取它 */
  key: string
  type: UiInputType
  /** 可选一句话说明（写给 AI 看：这个参数装的是什么数据） */
  note?: string
}

/**
 * 键名归一：去首尾空白，并挡掉会破坏取值的字符。
 *
 * 为什么挡：生成的 HTML 常用 inputs[键] 或解构取值；键里带引号/括号时，
 * 轻则取不到（静默 undefined → 界面空白），重则别处拼串出坑。
 * 与其在渲染时到处转义，不如在入口就把这类字符换成下划线（中文键照收）。
 */
export function normalizeInputKey(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/['"]/g, '')
    .replace(/[.[\](){}<>,\\$`=+*\/\\|&^%#@!?;:~]+/g, '_')
    .slice(0, 64)
}

/**
 * 把节点 data 里那份「输入参数」归一成干净清单。
 *
 * 判据只有一条：**有合法 key 与合法 type 才算一条**。其余一律丢掉 ——
 * 宁可少一个参数，也不要带一个 undefined 的值去问 AI「这个是什么类型」。
 * 同 key 后到者覆盖先到者（与 upsertInput / 面板的编辑手感一致）。
 */
export function normalizeInputs(raw: unknown): UiInputDecl[] {
  if (!Array.isArray(raw)) return []
  const map = new Map<string, UiInputDecl>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const key = normalizeInputKey(rec.key)
    if (!key) continue
    if (!isUiInputType(rec.type)) continue
    const note = typeof rec.note === 'string' && rec.note.trim() ? rec.note.trim().slice(0, 200) : undefined
    map.delete(key)
    map.set(key, note ? { key, type: rec.type, note } : { key, type: rec.type })
  }
  return [...map.values()]
}

/** 加一条：同 key 已存在 = 覆盖（移到末尾），与注册场「同 id 替换」同一套手感 */
export function upsertInput(list: readonly UiInputDecl[], decl: UiInputDecl): UiInputDecl[] {
  const key = normalizeInputKey(decl.key)
  if (!key || !isUiInputType(decl.type)) return [...list]
  const next = list.filter((d) => d.key !== key)
  next.push(decl.note ? { key, type: decl.type, note: decl.note } : { key, type: decl.type })
  return next
}

/** 删第 index 条（越界 = 原样返回，不抛） */
export function removeInputAt(list: readonly UiInputDecl[], index: number): UiInputDecl[] {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return [...list]
  return list.filter((_, i) => i !== index)
}

/**
 * 一条连进本节点的上游素材。
 *
 * 形状与底栏交给我们的一致（见 plugin-bottom-bar 的 BarRunInput.resources）——
 * **本插件不认识「边」、也不认识「节点类型」**：连了什么由底栏算好递过来。
 * 这正是「插件之间不互相考虑」的落点：我们只消费一份中立的数据形状。
 */
export interface UpstreamItem {
  /** 带序号的引用名（图片1 / 文本1 …），AI 在提示词里看到的也是它 */
  refName: string
  kind: string
  /** 图片/视频/音频类素材的地址 */
  url?: string
  /** 文本类素材的内容 */
  value?: string
  /** 提供这条素材的节点 id（画布接口要用；底栏给了才有） */
  nodeId?: string
}

/** 把底栏递来的 resources 归一成 UpstreamItem[]（形状不对的丢掉，不猜） */
export function normalizeUpstream(raw: unknown): UpstreamItem[] {
  if (!Array.isArray(raw)) return []
  const out: UpstreamItem[] = []
  // 序号按 **kind 各自计**（图片1 / 图片2 / 文本1 …），与底栏的 collectUpstreamMaterials
  // 同一套口径 —— 两边若不一致，用户 @ 到的「图片2」到了这里就变成另一个名字。
  const seq: Record<string, number> = {}
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const kind = typeof rec.kind === 'string' && rec.kind ? rec.kind : 'other'
    const url = typeof rec.url === 'string' && rec.url ? rec.url : undefined
    const value = typeof rec.value === 'string' && rec.value ? rec.value : undefined
    // 既没地址又没内容 = 空素材，给 AI 只会变成一行废话
    if (!url && !value) continue
    const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : ''
    const nodeId = typeof rec.id === 'string' && rec.id ? rec.id : undefined
    seq[kind] = (seq[kind] ?? 0) + 1
    const refName = name || (CN_KIND[kind] ?? kind) + seq[kind]
    out.push({
      refName,
      kind,
      ...(url ? { url } : {}),
      ...(value ? { value } : {}),
      ...(nodeId ? { nodeId } : {}),
    })
  }
  return out
}

/** 素材类型 → 中文前缀（与底栏 collectUpstreamMaterials 里那张表同款） */
const CN_KIND: Record<string, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }

/**
 * 画布接口速查（写进提示词，让 AI 真的能动手而不用猜）。
 *
 * 为什么要有这份：用户的口径是「提示词写得好，它就能直接请求后台」。光说"你可以调接口"
 * 没用 —— 模型不知道有哪些接口、参数长什么样，只能编。给一份**准确的最小子集**
 * （改数据 / 建节点 / 删节点 / 下单生成，这四件是它真会用的），它就能写出能跑的代码。
 *
 * ⚠️ 这份表与 cloud-server 的路由对齐，改接口时要一起改（见 routes/canvasOps.ts 与 jobs.ts）。
 */
export const CANVAS_API_GUIDE = [
  '以下接口都相对 `base`（下面的「后台地址」）。**必须写绝对地址**——页面在 srcdoc 里，',
  '相对路径解析不出来，写 \`fetch("/api/…")\` 或 \`fetch("api/…")\` 都会失败。',
  '',
  '- 读整张画布：`GET  ${base}/api/canvases/${canvasId}` → `{ ok, nodes, edges, view }`',
  '- 改节点（**整体替换**，不是合并！）：',
  '  `PUT ${base}/api/canvases/${canvasId}`  body `{ nodes, edges }`',
  '  想改一个节点的字段：先 GET 拿全量 → 改那个字段 → 把整份 POST 回去。**少一个节点它就没了。**',
  '- 节点形状：`{ id, type, position:{x,y}, data:{…} }`',
  '- 新增/删除节点：先 GET 拿全量，在 nodes 数组里加减，再 PUT 回去。新节点的 id 自己起',
  '  （建议 `ui-` 开头 + 时间戳，避免撞上已有数字 id）。',
  '- 画布列表：`GET ${base}/api/canvases` → `{ canvases: [{id,name}] }`',
  '- 提交一次生成任务（AI 出图/出视频）：`POST ${base}/api/jobs`',
  '  body `{ canvasId, nodeId, actionId, prompt?, values?, resources? }`',
  '  先 `GET ${base}/api/actions` 看有哪些 actionId 与参数。任务进度由后台写回那个节点。',
].join('\n')

/** 一次生成请求（底栏动作的输入 + 节点现状） */
export interface UiGenRequest {
  /** 用户写在底栏输入框里的话 */
  prompt: string
  /** 节点声明的输入参数 */
  inputs: UiInputDecl[]
  /** 上游连进来的素材（底栏算好的） */
  upstream: UpstreamItem[]
  /** 上一次生成的 HTML（有它 = 这是一次「改」，不是从零写） */
  previousHtml?: string
  /** 后台绝对地址（生成页面调接口要用；空 = 不给它接口文档） */
  baseUrl?: string
  /** 当前画布 id */
  canvasId?: string
  /** 本节点自己的 id（写回/自查时用） */
  nodeId?: string
}

/** 输入声明 → 给 AI 看的那张表（键 → 类型人话） */
export function buildInputsContract(inputs: readonly UiInputDecl[]): Array<{ key: string; type: string; note?: string }> {
  return inputs.map((d) => ({
    key: d.key,
    type: UI_INPUT_TYPE_LABELS[d.type],
    ...(d.note ? { note: d.note } : {}),
  }))
}

/**
 * 组装给 AI 的提示词。
 *
 * 硬性约束（不是风格偏好，缺一条生成的 HTML 就跑不起来）：
 *   1. **只输出 HTML** —— 模型默认爱包一层 markdown 代码块与解释文字；
 *   2. 不许外链 js/css —— 沙箱里只有你这一个后台可达，CDN 一律连不上；
 *   3. 请求要写**绝对地址**（页面的基地址是 about:srcdoc，相对路径解析不出来）；
 *   4. 数据已经注入在 window 上，不用自己去取。
 */
export function buildUiPrompt(req: UiGenRequest): string {
  const parts: string[] = []
  parts.push('你是「画布可视化节点」的前端。请生成一段**自包含的 HTML**，在节点卡片里把这些数据画出来，必要时提供可以操作画布的交互。')
  parts.push('')
  parts.push('## 硬性约束（缺一条就跑不起来）')
  parts.push('1. 只输出 HTML 代码本身，**不要** markdown 代码块、不要任何解释文字。')
  parts.push('2. 不许外链任何 js / css / 字体（CDN 连不上）；样式写在 <style>、脚本写在 <script>，图标用内联 SVG 或字符。')
  parts.push('3. 要请求后台时必须写**绝对地址**（页面在 srcdoc 里，相对路径解析不出来）。')
  parts.push('4. 图片直接用给定的地址放进 img 的 src。')
  parts.push('5. 自适应：占满 100% 宽高（body 的 margin 归 0），字号 12–14px；深浅色都要能看清。')
  parts.push('')
  parts.push('## 数据从哪来（渲染前已经注入，直接用）')
  parts.push('- window.__CANVAS_INPUTS__ ：本节点声明的输入参数（键 → 值）')
  parts.push('- window.__CANVAS_UPSTREAM__ ：画布上连进本节点的上游素材（数组）')
  parts.push("- window.__CANVAS_UI__ ：{ theme: 'light' | 'dark', baseUrl, canvasId, nodeId }")
  parts.push('- 根元素上有 data-theme 属性（light / dark），可以用它分支写 CSS')
  parts.push('**不要假设还有别的数据。**')
  parts.push('')

  const contract = buildInputsContract(req.inputs)
  parts.push('## 本节点声明的输入参数')
  if (contract.length === 0) {
    parts.push('（还没声明任何参数。若确实没有数据可画，就按用户的话生成一个界面。）')
  } else {
    for (const c of contract) {
      parts.push('- ' + c.key + ' —— ' + c.type + (c.note ? '：' + c.note : ''))
    }
  }
  parts.push('')

  parts.push('## 画布上连进来的上游素材')
  if (req.upstream.length === 0) {
    parts.push('（没有连任何素材。）')
  } else {
    for (const u of req.upstream) {
      const payload = u.url ? '地址 ' + u.url : '内容：' + truncate(u.value ?? '', 400)
      const idPart = u.nodeId ? '，节点 id ' + u.nodeId : ''
      parts.push('- ' + u.refName + '（' + u.kind + idPart + '）—— ' + payload)
    }
  }
  parts.push('')

  if (req.baseUrl) {
    parts.push('## 你可以操作画布（后台接口）')
    parts.push('base = ' + req.baseUrl)
    parts.push('canvasId = ' + (req.canvasId ?? 'default'))
    if (req.nodeId) parts.push('本节点 id = ' + req.nodeId)
    parts.push(CANVAS_API_GUIDE)
    parts.push('')
  } else {
    parts.push('## 说明')
    parts.push('这次没有后台地址，**不要**尝试发任何网络请求，只做纯展示。')
    parts.push('')
  }

  if (req.prompt.trim()) {
    parts.push('## 用户的要求')
    parts.push(req.prompt.trim())
    parts.push('')
  }

  if (req.previousHtml && req.previousHtml.trim()) {
    parts.push('## 现有实现（在它基础上改，保留仍然正确的部分）')
    parts.push(truncate(req.previousHtml, 12000))
    parts.push('')
  }

  parts.push('现在输出 HTML（第一行就是 < 开头的标签或 <!DOCTYPE html>）。')
  return parts.join('\n')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n…（已截断）' : s
}

/**
 * 从模型回包里抠出 HTML。
 *
 * 模型再听话也会带壳：最常见的是 markdown 代码块，其次是「好的，我为你生成了……」这种开场白。
 * 这里把壳剥掉，只留文档本体；认不出标签就当原文（宁可不认，也不截掉用户真正要的那段）。
 */
export function extractHtml(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let text = raw.trim()
  if (!text) return ''
  const fence = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(text)
  if (fence && fence[1] !== undefined) text = fence[1].trim()
  const start = text.search(/<!DOCTYPE|<html|<div|<svg|<style|<script|<table|<canvas|<!--/i)
  if (start > 0) text = text.slice(start).trim()
  return text
}

/**
 * 把一个值编成**能安全塞进 script 标签里的 JS 字面量**。
 *
 * 为什么不能直接 JSON.stringify：内容里出现 </script> 会把脚本标签提前闭合
 * （AI 生成的 HTML 里带这个字符串完全可能），后面剩下的字节就变成正文被浏览器当标签解析。
 * 把 < 转成 \u003c 之后，JSON 的语义一个字节都不变，但再也拼不出结束标签。
 */
export function serializeForScript(value: unknown): string {
  let json: string
  try {
    json = JSON.stringify(value) ?? 'null'
  } catch {
    return 'null'
  }
  return json
    .split('<').join('\\u003c')
    .split('\u2028').join('\\u2028')
    .split('\u2029').join('\\u2029')
}

/**
 * 生成页面的内容安全策略。
 *
 * **这是本插件唯一的安全边界**，所以每一段都是有意写的：
 *
 * - `connect-src` 只放行两个源：页面自己的源与后台的源。生成的界面能调画布接口
 *   （那是它的价值），但连不上别处 —— 数据不外泄、脚本不能拿去当跳板。
 * - `img-src / media-src` 放开（`*`）：素材地址可能是任意站点，拦了就是裂图；
 *   图片/音视频本身不构成"发出数据"。
 * - `script-src` 必须 `unsafe-inline`：生成物就是内联脚本，没有别的形态。
 * - `default-src 'none'`：其余一律拒（frame / object / form-action / worker 等）。
 *
 * 关掉网络（netEnabled=false）时 desc 传 `'none'` —— 那才是"纯展示"。
 *
 * @param allow 允许联网的源（空数组 / 未传 = 一律不许，等同 'none'）
 */
export function buildCsp(allow: readonly string[] = []): string {
  const origins = allow.map((s) => s.trim()).filter(Boolean)
  const connect = origins.length > 0 ? origins.join(' ') : "'none'"
  return [
    "default-src 'none'",
    'img-src * data: blob:',
    'media-src * data: blob:',
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    'font-src data:',
    'connect-src ' + connect,
  ].join('; ')
}

/** 注入给生成页面的全局变量名（写在提示词里那份契约的落实处，改这里就要一起改提示词） */
export const INPUTS_GLOBAL = '__CANVAS_INPUTS__'
export const UPSTREAM_GLOBAL = '__CANVAS_UPSTREAM__'
export const UI_GLOBAL = '__CANVAS_UI__'

/** 生成页面的外壳样式（铺满卡片、深浅色都对） */
const SHELL_STYLE = [
  'html, body { margin: 0; padding: 0; width: 100%; height: 100%; }',
  'body { font: 13px/1.5 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }',
  "html[data-theme='light'] body { color: #374151; background: transparent; }", // 主题色白名单: iframe 是不透明源，取不到宿主主题变量（见下方说明）
  "html[data-theme='dark'] body { color: #d1d5db; background: transparent; }", // 主题色白名单: 同上，暗色那一套
  '* { box-sizing: border-box; }',
].join('\n')

/** 渲染 iframe 时的运行参数 */
export interface SrcdocOptions {
  /** 浅色还是深色（跟着画布走） */
  theme?: 'light' | 'dark'
  /** 节点 id（生成的界面里可能用它自查时带上） */
  nodeId?: string
  /** 后台绝对地址（给了它才能发请求；同时决定 CSP 放行谁） */
  baseUrl?: string
  /** 当前画布 id */
  canvasId?: string
  /** 允许联网（默认 false = 纯展示，最安全的一档） */
  allowNetwork?: boolean
  /** 允许额外的源（一般不用；留给将来别的后台） */
  extraOrigins?: readonly string[]
}

/**
 * 给生成页面用的 `<base href>`。
 *
 * 为什么需要：srcdoc 文档的地址是 `about:srcdoc`，**相对路径解析不出来**（实测：
 * `fetch("/health")` 直接 TypeError）。有了 base，页面里写相对地址就能落到后台；
 * 模型少犯一类错。文档里已经反复强调"写绝对地址"，这是额外的兜底。
 */
function baseTagHref(raw?: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    return u.origin + (u.pathname.endsWith('/') ? u.pathname : u.pathname + '/')
  } catch {
    return ''
  }
}

/**
 * 把 AI 的 HTML 组装成一整份可以交给 iframe srcdoc 的文档。
 *
 * 两种形态都认：
 * - 模型给了完整文档（有 html 标签）→ 只往它里面**插**外壳样式、base 与引导脚本；
 * - 模型只给了一段片段（大多数情况）→ 用我们的骨架把它包起来。
 *
 * 为什么不额外「消毒」HTML：真正兜住安全的是 iframe 的 sandbox（不给 allow-same-origin，
 * 生成物拿不到宿主的 localStorage / cookie / DOM）+ 上面那份 CSP（它连不上后台以外的任何地方）。
 * 在这里用正则去洗标签只会一边误伤正常界面、一边漏掉能绕过的写法 —— 那是「看起来很安全」。
 */
export function buildSrcdoc(
  html: string,
  inputs: Record<string, unknown>,
  upstream: readonly UpstreamItem[],
  options: SrcdocOptions = {},
): string {
  const theme = options.theme === 'dark' ? 'dark' : 'light'
  const baseUrl = baseTagHref(options.baseUrl)

  // ⚠️ 这里**绝不能**放 Date.now() 之类每次都变的值。
  //
  // 这个函数的结果直接喂给 iframe 的 srcdoc，而它是上游的一个 computed —— 只要它每次
  // 算出不同的字符串，Vue 就会认定属性变了、去更新 srcdoc，浏览器随即**整页重载**那个 iframe
  // （2026-10-12 用户实测：拖节点时里面的界面一直在刷新，因为拖动会导致节点数据对象重建、
  //   computed 跟着重算）。纯函数 = 输入没变就不产出新值 = iframe 一次都不重载。
  const uiPayload: Record<string, unknown> = {
    theme,
    baseUrl: options.baseUrl ?? '',
    canvasId: options.canvasId ?? 'default',
    nodeId: options.nodeId ?? '',
  }
  const bootstrap =
    '<script>window[' + JSON.stringify(INPUTS_GLOBAL) + ']=' + serializeForScript(inputs) + ';' +
    'window[' + JSON.stringify(UPSTREAM_GLOBAL) + ']=' + serializeForScript(upstream) + ';' +
    'window[' + JSON.stringify(UI_GLOBAL) + ']=' + serializeForScript(uiPayload) + ';</script>'

  // CSP：只在允许联网时放行源；否则 connect-src 'none'（纯展示）
  const allow: string[] = []
  if (options.allowNetwork && options.baseUrl) {
    allow.push(options.baseUrl)
    if (typeof location !== 'undefined' && location.origin) allow.push(location.origin)
  }
  if (options.allowNetwork && options.extraOrigins) allow.push(...options.extraOrigins)
  const csp = buildCsp(allow)

  const head =
    '<meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
    (baseUrl ? '<base href="' + baseUrl + '">' : '') +
    '<style>' + SHELL_STYLE + '</style>' +
    bootstrap

  const body = html.trim()

  // 完整文档：插进 head 之后（没有 head 就插在 html 之后，再不行插到最前）
  if (/<html[\s>]/i.test(body)) {
    const headMatch = /<head[^>]*>/i.exec(body)
    if (headMatch && headMatch.index !== undefined) {
      const at = headMatch.index + headMatch[0].length
      return body.slice(0, at) + head + body.slice(at)
    }
    const htmlMatch = /<html[^>]*>/i.exec(body)
    if (htmlMatch && htmlMatch.index !== undefined) {
      const at = htmlMatch.index + htmlMatch[0].length
      return body.slice(0, at) + head + body.slice(at)
    }
    return head + body
  }

  // 片段：套我们的骨架
  return (
    '<!DOCTYPE html><html data-theme="' + theme + '"><head>' + head + '</head><body>' + body + '</body></html>'
  )
}

