/**
 * toolViews —— 内置画布 MCP 工具的**自定义卡片数据**（纯函数，零 Vue，可单测）。
 *
 * 用户口径（2026-10-07）：
 * 1. 画布相关的内置 MCP 工具是**完全自定义的卡片 UI** —— 不是「键值行」拼盘：
 *    概览 = 大数字瓦片 + 类型胶囊；列表 = 带图标/副标题的行；产物 = 缩略图网格；
 *    任务 = 进度条。每种工具的卡片刻意长得不一样，一眼能认出是哪个工具干的活。
 * 2. 展开区**不再有第二层「原始 JSON」折叠**（工具行本身已可折叠）：
 *    画布工具 = 直接出卡片；不认识的工具 = 直接出「输入 / 输出」两块。
 * 3. 收起行也给一句人话摘要（「25 节点 · 11 连线」这种），不再是 JSON 片段。
 *
 * 用户口径（2026-10-08，卡片紧凑化定稿 —— 用户在 demo 里选定「B 卡片 + C 资源列表」）：
 * 1. 卡片就是**紧凑两行**：头行 = 图标 + 人话标题 + 标记；内容行 = 一行
 *    （缩略图条 / 单条媒体行 / 胶囊 / 进度条）。早先的 88px 缩略图网格 + 大数字瓦片太占高度。
 * 2. 清单类**最多 3 条** + 「还有 N 条…」；资源列表只铺图片缩略图，音频/视频折成一句类型统计。
 * 3. 「详情」折叠块给 工具名称 / 输入 / 输出（三块都在、不省略；输入为空也写「（无输入）」）。
 *
 * 数据源是工具输出的 JSON 文本（cloud-server 的 MCP 工具全部 `toText({...})` 返回 JSON）。
 */

/** 卡片里一行的图标语义（组件映射到具体图标组件） */
export type CardIcon = 'canvas' | 'node' | 'image' | 'video' | 'audio' | 'text' | 'group' | 'job' | 'action' | 'file'

/** 卡片里的一块内容（纯数据；组件按 kind 渲染成不同视觉） */
export type CardBlock =
  /** 缩略图条（资源 / 产物）：组件最多画 3 张 + 「+N」，右侧可跟一句类型统计 */
  | { kind: 'images'; items: Array<{ src: string; label?: string }>; summary?: string }
  /** 胶囊组（计数 / 类型分布 / 动作清单）—— 计数画在文字前（「4 新增」） */
  | { kind: 'chips'; label?: string; items: Array<{ text: string; count?: string }> }
  /**
   * 单条媒体行：画面 + 标题 + 副标题（节点详情 / 文件预览 —— 卡片内容就是这一行）。
   *
   * 画面分两种（用户口径 2026-10-13）：图片给 thumb（一张缩略图）；
   * 视频 / 音频给 src + mediaKind（组件画一个播放位 —— 把视频地址塞进 <img> 必然裂图）。
   * 两者都可点开全屏预览（宿主那只注册的 MediaViewer）。
   */
  | { kind: 'media'; mediaKind?: 'image' | 'video' | 'audio'; thumb?: string; src?: string; title?: string; sub?: string }
  /** 带图标 / 副标题 / 尾标签的行（画布列表等清单；组件最多画 3 条 + 「还有 N 条…」） */
  | { kind: 'rows'; items: Array<{ title: string; sub?: string; tag?: string; icon?: CardIcon }> }
  /** 进度条（生成任务） */
  | { kind: 'progress'; value: number; text?: string }
  /** 提示行（成功 / 失败 / 说明） */
  | { kind: 'note'; text: string; tone: 'ok' | 'error' | 'info' }

/** 一个工具的视图：family 决定用哪套 UI；画布族给 card，fallback 给 raw */
export interface ToolView {
  family: string
  /** 卡片标题（自定义卡片用；如「画布概览」） */
  heading: string
  /** 卡片头左侧的小图标（语义；组件映射到具体图标组件） */
  icon?: CardIcon
  /** 标题旁的小徽章（如「2 张」「31 个」） */
  badge?: string
  /** 卡片内容块（自定义卡片用） */
  blocks: CardBlock[]
  /** 收起行的一句人话摘要（没给就由组件兜底） */
  summary?: string
  /** fallback：解析不了的原始文本，原样展示 */
  raw?: string
}

/** 工具名 → 视图族。MCP 工具名形如 `mcp__canvas__canvas_get`（SDK 的 MCP_TOOL_PREFIX 前缀） */
export function toolFamily(name: string): string {
  const bare = name.replace(/^mcp__[a-zA-Z0-9_-]+__/, '')
  if (bare.startsWith('canvas_')) return 'canvas'
  if (bare.startsWith('resource_')) return 'resource'
  if (bare.startsWith('generation_')) return 'generation'
  if (bare === 'read_file' || bare === 'write_file' || bare === 'edit_file') return 'file'
  return 'fallback'
}

/** 尽力解析 JSON；不是对象返回 null（fallback 走原文） */
function safeJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    let v: unknown = JSON.parse(text)
    // MCP 约定把结果包在 content[].text 里（toText）——包了就剥，别让专用视图掉进 fallback。
    // 只认「纯 content 包装」（没有别的字段）或 content 是唯一信息字段两种形态；
    // 遍历所有块，取第一块能解析成对象的（多块输出不再掉 fallback）。
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      const content = o.content
      if (Array.isArray(content) && Object.keys(o).length === 1) {
        for (const block of content) {
          const b = block as { type?: unknown; text?: unknown }
          if (b && b.type === 'text' && typeof b.text === 'string') {
            try {
              v = JSON.parse(b.text)
              break
            } catch {
              /* 这块不是 JSON，看下一块 */
            }
          }
        }
      }
    }
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 节点的可读名：只认 data.label（与画布标题条 / @ 菜单同一口径），兜底 `类型 #id` */
function nodeLabel(n: Record<string, unknown>): string {
  const data = (n.data ?? {}) as Record<string, unknown>
  const label = data.label
  if (typeof label === 'string' && label.trim()) return label.trim().split('\n')[0].slice(0, 40)
  const t = (typeof data.nodeType === 'string' && data.nodeType) || n.type
  return String(t ?? '节点') + ' #' + String(n.id ?? '')
}

/** 节点类型 → 行图标 */
function nodeIcon(n: Record<string, unknown>): CardIcon {
  const data = (n.data ?? {}) as Record<string, unknown>
  const t = String((typeof data.nodeType === 'string' && data.nodeType) || n.type || '')
  if (t === 'image') return 'image'
  if (t === 'video') return 'video'
  if (t === 'audio') return 'audio'
  if (t === 'text') return 'text'
  if (t === 'group') return 'group'
  return 'node'
}

/** 资源名：带扩展名的直接展示；纯哈希截前 12 位 */
function resLabel(name: unknown): string {
  const s = String(name ?? '')
  return /\.[a-zA-Z0-9]+$/.test(s) ? s : s.slice(0, 12) + '…'
}

/** 资源名 / 资源地址 → 字符串（节点里的资源字段与服务端给的名字都是它） */
function resName(ref: unknown): string {
  return String(ref ?? '')
}

/**
 * 资源引用 → 浏览器可取的展示地址：已是完整地址（http/https/data:/ 开头）就原样用。
 *
 * 为什么需要它（用户 2026-10-08 报的「工具卡里的图片经常裂图」）：
 *   canvas_get 的节点 imageUrl 可能是**资产地址**（/api/assets/files/<hash>.jpeg）。
 *   早先 resUrl 无视这一点，直接拼 /api/canvases/<id>/resources/ + 它 → 双拼 404 裂图。
 *   现在统一走这里：完整地址原样、裸文件名才拼画布资源路由。
 */
function toDisplayUrl(canvasId: unknown, ref: string): string {
  const s = String(ref ?? '')
  if (/^(https?:|data:|\/)/i.test(s)) return s
  return '/api/canvases/' + String(canvasId ?? '') + '/resources/' + s
}

/** 图片资源名 → 画布资源访问地址（浏览器经它取字节）；完整地址由 toDisplayUrl 原样透出 */
function resUrl(canvasId: unknown, name: unknown): string {
  return toDisplayUrl(canvasId, String(name ?? ''))
}

/**
 * 本机绝对路径 → **服务端已有的**资源访问地址（浏览器能真的取到字节的那条路）。
 *
 * 为什么需要它（用户实测报的「读取图片时加载错误」）：
 *   read_file 的入参是**本机绝对路径**（如 \\?\D:\\...\\.mini-canvas\\assets\\files\\faaca433.jpeg，
 *   模型读文件就是这么读的）。早先这里直接拼了个 /api/agent/file?path=… —— 那个路由
 *   服务端从来不存在，静态兜底会把 index.html 返回给 <img>（HTML 当图片 → 永远是裂图）。
 *   服务端真正能出字节的只有两条路（assetStore.localPathFromUrl 认的也是这两条）：
 *     /api/assets/files/<hash>                     ← assets/files/ 下的字节
 *     /api/canvases/<canvasId>/resources/<hash>    ← 画布资源目录下的字节
 *   路径对得上就翻成对应地址；对不上（用户在磁盘上别处的图）返回 null，由调用方退化成
 *   纯文本卡片（宁可不显示预览，也不给一个必然裂掉的 <img>）。
 *
 * 关键一步：**画布 id 优先从路径里认**（用户实测 2026-10-10）。
 *   read_file 的入参只有 file_path，**没有** canvasId —— 所以按参数取恒为空，
 *   图片永远退化成一行文件名（用户报的「读图片看不到图、只有文件名」）。
 *   而画布资源的真实路径长这样：
 *     …/.mini-canvas/canvases/<canvasId>/resources/<hash>.png
 *   画布 id 就写在里面，直接认出来即可，不必依赖入参。
 */
function fileUrlFromPath(p: string, canvasId: unknown): string | null {
  const norm = String(p ?? '').replace(/\\/g, '/')
  if (!norm) return null
  const assetsAt = norm.lastIndexOf('/assets/files/')
  if (assetsAt >= 0) {
    const hash = norm.slice(assetsAt + '/assets/files/'.length)
    return hash && !hash.includes('/') ? '/api/assets/files/' + hash : null
  }
  const resAt = norm.lastIndexOf('/resources/')
  // 画布 id：先认入参，没有就从路径里认（read_file 只有路径、没有 canvasId）
  const canvas = String(canvasId ?? '') || canvasIdFromPath(norm, resAt)
  if (resAt >= 0 && canvas) {
    const segs = norm.slice(resAt + '/resources/'.length).split('/')
    const hash = segs[segs.length - 1]
    return hash ? '/api/canvases/' + canvas + '/resources/' + hash : null
  }
  return null
}

/**
 * 从画布资源的绝对路径里认出画布 id，形状必须**严格**是 `…/canvases/<id>/resources/…`。
 *
 * 为什么要连 `/canvases/` 一起认、而不是「随便一段 /resources/ 前面的东西」：
 * 别处的路径也可能带 `/resources/`（如 node_modules 里的某个包）—— 那种情况按「前一段」
 * 猜出来的 id 是错的，拼出的地址必然 404，等于凭空造一张裂图。认不出就返回空串，
 * 让调用方退化成纯文本卡片（宁可不预览，也不给裂图）。
 */
function canvasIdFromPath(norm: string, resAt: number): string {
  if (resAt < 0) return ''
  const before = norm.slice(0, resAt)
  const at = before.lastIndexOf('/')
  if (at < 0) return ''
  const id = before.slice(at + 1)
  // 前一段必须是 `canvases`（`…/canvases/<id>/resources/…`），否则不认
  const parent = before.slice(0, at)
  if (!parent.endsWith('/canvases')) return ''
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : ''
}

/** 从输入 JSON 里拿 canvasId（各工具入参字段同名） */
function inCanvasId(argsText: string | undefined): string {
  const args = safeJson(argsText)
  return args ? String(args.canvasId ?? '') : ''
}

/**
 * 折叠行后面那截「这工具到底干了什么」的人话（用户口径 2026-10-11）。
 *
 * 为什么需要它：默认工具（exec_command 这类）收起时只显示一个工具名，
 * 而同一种工具能跑千千万万条命令 —— 光看名字根本分不清哪个是哪个。
 * 用户口径：后面要跟一截**执行内容**的截断（命令本身 / 动的哪个文件），
 * 而不是输出结果。
 *
 * 为什么不复用卡片摘要（ToolView.summary）：那是**输出**侧的人话
 *（「25 节点 · 11 连线」），而工具收起时你更想知道「它执行了什么」。
 * 取不到执行内容时返回空串，调用方自己回退（绝不编内容）。
 */
export function toolBrief(name: string, argsText: string | undefined): string {
  const bare = name.replace(/^mcp__[a-zA-Z0-9_-]+__/, '')
  const a = safeJson(argsText)
  if (!a) return ''
  const clip = (s: string, n = 60): string => (s.length > n ? s.slice(0, n) + '…' : s)
  const one = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim()
  // 执行命令类：给命令本身（描述是次选 —— 没命令时至少说明它要干什么）
  if (bare === 'exec_command' || bare === 'input_command') {
    const cmd = one(a.cmd ?? a.input ?? a.command)
    if (cmd) return clip(cmd)
    const desc = one(a.description ?? a.prompt)
    return desc ? clip(desc) : ''
  }
  // 文件类：给动的哪个文件（全路径太长，只留文件名）
  if (bare === 'read_file' || bare === 'write_file' || bare === 'edit_file') {
    const p = one(a.file_path ?? a.path)
    const base = p.split(/[\\/]/).pop() ?? ''
    return base ? clip(base) : ''
  }
  return ''
}

const note = (text: string, tone: 'ok' | 'error' | 'info' = 'info'): CardBlock => ({ kind: 'note', text, tone })

/** 图片 / 视频 / 音频的扩展名 —— 只有这三类才配「文件预览」卡片（其它一律走默认折叠行） */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|ogv)$/i
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i

/**
 * read_file 读到的**媒体**文件：图片走 media 缩略图块，视频 / 音频走注册件（media 字段）。
 *
 * 为什么按**扩展名**判、而不是按输出文本（用户口径 2026-10-13 的落地）：
 * read_file 的输出五花八门 —— 图片是「image/png, 55.7 kB」、视频是
 * 「looks like a binary file (contains NUL bytes)」、超限的图是
 * 「Image too large: 13.3 MB exceeds the 5.0 MB limit.」（真机转录里三种都出现过）。
 * 拿输出文本判会把后两种漏掉，读视频 / 音频永远变成默认折叠行。
 *
 * 为什么地址必须由 fileUrlFromPath 映射出来、映射不到就整个卡片都不给（返回 null）：
 * 服务端能出字节的只有 /api/assets/files/<hash> 与 /api/canvases/<id>/resources/<hash>
 * 两条路，别的地址一律 404。「文件预览」卡片的全部价值就是那张画面 ——
 * 给不出画面就没有卡片的意义，宁可回退默认折叠行（输入 / 输出），也别摆一张裂开的图。
 */
function fileMediaOf(p: string, canvasId: unknown): { kind: 'image' | 'video' | 'audio'; src: string; name: string } | null {
  const isImage = IMAGE_EXT.test(p)
  const isVideo = !isImage && VIDEO_EXT.test(p)
  const isAudio = !isImage && !isVideo && AUDIO_EXT.test(p)
  if (!isImage && !isVideo && !isAudio) return null
  const src = fileUrlFromPath(p, canvasId)
  if (!src) return null
  return { kind: isImage ? 'image' : isVideo ? 'video' : 'audio', src, name: p.split(/[\\/]/).pop() ?? p }
}

/**
 * 从 read_file 的输出里抠出**读数**（「410.4 kB」这种），放卡片右上角的徽章。
 *
 * 为什么用这么松的匹配：真机转录里读数前的部分好几种形态 —— 图片是
 * 「image/png, 55.7 kB」、有的带前缀；抠不到就不给徽章（宁可不显示，也不编一个数）。
 */
function sizeOf(outputText: string | undefined): string | undefined {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*([kKmMgG]?B)\b/.exec(outputText ?? '')
  return m ? m[1] + ' ' + m[2] : undefined
}

/** 空卡片（什么块都没提炼出来）时返回 null，让调用方走 fallback */
function card(heading: string, blocks: CardBlock[], extra: Partial<ToolView> = {}): ToolView | null {
  if (!blocks.length) return null
  return { family: '', heading, blocks, ...extra }
}

/**
 * 工具的卡片视图。argsText 是工具**入参** JSON，outputText 是**输出** JSON 文本。
 * 认不出的工具 / 提炼不出内容 → fallback（raw 原文，由组件直出输入 / 输出）。
 */
export function toolView(name: string, argsText: string | undefined, outputText: string | undefined): ToolView {
  const family = toolFamily(name)
  const bare = name.replace(/^mcp__[a-zA-Z0-9_-]+__/, '')
  const data = safeJson(outputText)
  const args = safeJson(argsText) ?? {}
  const canvasId = String(args.canvasId ?? data?.canvasId ?? '')

  if (family === 'canvas') {
    // 失败：卡片上一条红字（不是 JSON 片段）
    if (data && data.ok === false) {
      const v = card('执行失败', [note(String(data.error ?? '未知错误'), 'error')])!
      return { ...v, family, summary: '失败：' + String(data.error ?? '') }
    }
    if (bare === 'canvas_list_canvases' && Array.isArray(data?.canvases)) {
      const list = (data.canvases as Array<Record<string, unknown>>).slice(0, 20)
      const cur = inCanvasId(argsText)
      const v = card('画布列表', [
        {
          kind: 'rows',
          items: list.map((c) => ({
            title: String(c.name ?? '(未命名)'),
            sub: String(c.id ?? ''),
            icon: 'canvas' as CardIcon,
            ...(cur && String(c.id) === cur ? { tag: '当前' } : {}),
          })),
        },
      ], { icon: 'canvas', badge: String(data.canvases.length) + ' 张' })!
      return { ...v, family, summary: String(data.canvases.length) + ' 张画布' }
    }
    if (bare === 'canvas_overview') {
      const types = (data?.types ?? {}) as Record<string, unknown>
      // 紧凑两行（用户口径 2026-10-08）：内容行 = 计数胶囊（节点/连线/类型分布全在一行）
      const chips = [
        { text: '节点', count: String(data?.nodeCount ?? 0) },
        { text: '连线', count: String(data?.edgeCount ?? 0) },
        ...Object.entries(types).map(([t, c]) => ({ text: t, count: String(c) })),
      ]
      const v = card('画布概览', [{ kind: 'chips', items: chips }], { icon: 'canvas' })!
      return { ...v, family, summary: data?.nodeCount + ' 节点 · ' + data?.edgeCount + ' 连线' }
    }
    if (bare === 'canvas_get' && data?.node) {
      const node = data.node as Record<string, unknown>
      const d = (node.data ?? {}) as Record<string, unknown>
      const pos = node.position as Record<string, unknown> | undefined
      const posText = pos ? '(' + String(pos.x ?? 0) + ', ' + String(pos.y ?? 0) + ')' : ''
      // 图片节点带资源引用：出缩略图（卡片的核心信息）。
      // 只认图片地址（用户口径 2026-10-08）：早先把 videoUrl / audioUrl 也塞进 <img> ——
      // 视频 / 音频节点必然裂图；节点行本身有类型图标，不预告览不丢核心信息。
      const ref = String(d.imageUrl || d.panoUrl || '')
      const neighbors = Array.isArray(data.neighbors) ? (data.neighbors as Array<Record<string, unknown>>) : []
      // 紧凑两行（用户口径 2026-10-08）：标记 = 「名字 · #id」；内容行 = 一枚 40px 缩略图
      // + 尺寸/坐标 + 「相邻 N 个」（与 demo 一致）
      const sizeBits = [
        d.imageWidth && d.imageHeight ? String(d.imageWidth) + '×' + String(d.imageHeight) : '',
        posText,
      ].filter(Boolean)
      const v = card('节点详情', [{
        kind: 'media',
        ...(ref && canvasId ? { thumb: toDisplayUrl(canvasId, ref) } : {}),
        title: sizeBits.join(' · ') || nodeLabel(node),
        ...(neighbors.length ? { sub: '相邻节点 ' + neighbors.length + ' 个' } : {}),
      }], { icon: nodeIcon(node), badge: nodeLabel(node) + ' · #' + String(node.id ?? '') })!
      return { ...v, family, summary: nodeLabel(node) }
    }
    if (bare === 'canvas_get' && data && Array.isArray(data.nodes)) {
      const nodes = data.nodes as Array<Record<string, unknown>>
      const blocks: CardBlock[] = [
        { kind: 'chips', items: [
          { text: '节点', count: String(data.nodeCount ?? nodes.length) },
          { text: '连线', count: String(data.edgeCount ?? 0) },
        ] },
        { kind: 'rows', items: nodes.map((n) => ({ title: nodeLabel(n), sub: '#' + String(n.id ?? ''), icon: nodeIcon(n) })) },
      ]
      const v = card('画布全览', blocks, { icon: 'canvas' })!
      return { ...v, family, summary: nodes.length + ' 节点' }
    }
    if (bare === 'canvas_add_media' && data?.ok) {
      // 媒体类型决定卡片怎么说（image / video / audio）。认不出就按图片说，
      // 与工具缺省值一致（不写 type 就是 image）。
      const mediaType = data.type === 'video' || data.type === 'audio' ? String(data.type) : 'image'
      const label = mediaType === 'video' ? '视频' : mediaType === 'audio' ? '音频' : '图片'
      const iconName = mediaType === 'video' ? 'video' : mediaType === 'audio' ? 'audio' : 'image'
      const blocks: CardBlock[] = []
      const ref = resName(data.ref)
      if (ref && canvasId) blocks.push({ kind: 'images', items: [{ src: resUrl(canvasId, ref), label: ref }] })
      blocks.push({ kind: 'rows', items: [{ title: '新节点 #' + String(data.nodeId ?? ''), sub: String(data.mime ?? '') + (data.size ? ' · ' + String(data.size) : ''), icon: iconName }] })
      const v = card(label + '已加入画布', blocks, { icon: iconName })!
      return { ...v, family, summary: '新节点 #' + String(data.nodeId ?? '') }
    }
    if (bare.startsWith('canvas_batch_') && data) {
      const n = (v: unknown): string => Array.isArray(v) ? String(v.length) : '0'
      const blocks: CardBlock[] = [
        { kind: 'chips', items: [
          { text: '新增', count: n(data.added) },
          { text: '更新', count: n(data.updated) },
          { text: '删除', count: n(data.deleted) },
        ] },
      ]
      const errs = Array.isArray(data.errors) ? (data.errors as Array<{ message?: unknown }>) : []
      for (const e of errs.slice(0, 5)) blocks.push(note(String(e.message ?? '错误'), 'error'))
      if (errs.length > 5) blocks.push(note('… 错误共 ' + errs.length + ' 条', 'error'))
      const v = card(bare === 'canvas_batch_edges' ? '连线批量操作' : '节点批量操作', blocks, {
        icon: bare === 'canvas_batch_edges' ? 'node' : 'node',
        badge: '+' + n(data.added),
      })!
      return { ...v, family, summary: '+' + n(data.added) + ' ~' + n(data.updated) + ' -' + n(data.deleted) }
    }
  }

  if (family === 'resource') {
    if (data?.ok === false) {
      const v = card('执行失败', [note(String(data.error ?? '未知错误'), 'error')])!
      return { ...v, family, summary: '失败：' + String(data.error ?? '') }
    }
    if (bare === 'resource_list' && Array.isArray(data?.resources)) {
      const resources = data.resources as unknown[]
      const total = Number(data.count ?? resources.length)
      const blocks: CardBlock[] = []
      // 服务端两种形态都认（用户口径 2026-10-08）：
      //   老形态 = 字符串数组（资源名），只有图，全部进缩略图条（行为不变）；
      //   富形态 = [{ name, mime, kind, url }]（url 可直接取字节）—— 图进缩略图条，
      //   音频/视频/其它**不再逐个成行**，折成一句类型统计（用户口径 2026-10-08：列表别占地方）。
      // 先归一化成同一形状（字符串项当「无 mime 的图」，与老形态行为一致），再分块 —— 混排也不丢项。
      const items = resources.map((r) => {
        if (!r || typeof r !== 'object') return { name: r, mime: '', kind: 'image', url: '' }
        const o = r as Record<string, unknown>
        const mime = String(o.mime ?? '')
        const kind = String(o.kind ?? '') || (mime.startsWith('image/') ? 'image' : '')
        return { name: o.name, mime, kind, url: typeof o.url === 'string' ? o.url : '' }
      })
      const images = items.filter((r) => r.kind === 'image')
      const others = items.filter((r) => r.kind !== 'image')
      // 类型统计（「27 图 · 12 音频 · 2 视频」）：跟在缩略图条右侧；没有图时它就是内容行
      const countOf = (k: string): number => items.filter((r) => r.kind === k).length
      const statsBits = [
        countOf('image') ? countOf('image') + ' 图' : '',
        countOf('audio') ? countOf('audio') + ' 音频' : '',
        countOf('video') ? countOf('video') + ' 视频' : '',
        countOf('other') ? countOf('other') + ' 其它' : '',
      ].filter(Boolean)
      const stats = statsBits.join(' · ')
      if (images.length) {
        blocks.push({ kind: 'images', items: images.map((r) => ({
          // url 是服务端给好的展示地址；没有 url 才按文件名拼画布资源路由
          src: r.url || toDisplayUrl(canvasId, String(r.name ?? '')),
          label: resLabel(r.name),
        })), ...(others.length ? { summary: stats } : {}) })
      } else if (others.length) {
        // 一张图都没有：内容行给类型统计（不铺行、不铺图）
        blocks.push({ kind: 'chips', items: statsBits.map((t) => ({ text: t.replace(/^\d+ /, ''), count: t.split(' ')[0] })) })
      }
      const v = card('资源列表', blocks, { icon: 'file', badge: String(total) + ' 个' })!
      return { ...v, family, summary: String(total) + ' 个资源' }
    }
    if (bare === 'resource_upload' && data?.ok) {
      const ref = resName(data.ref)
      const blocks: CardBlock[] = []
      if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(ref) && canvasId) {
        blocks.push({ kind: 'images', items: [{ src: resUrl(canvasId, ref), label: ref }] })
      }
      blocks.push({ kind: 'rows', items: [{ title: ref || '(资源)', sub: [data.mime, data.size].filter(Boolean).join(' · '), icon: 'file' }] })
      const v = card('资源已上传', blocks, { icon: 'file' })!
      return { ...v, family, summary: ref }
    }
  }

  if (family === 'generation') {
    if (data?.ok === false) {
      const v = card('执行失败', [note(String(data.error ?? '未知错误'), 'error')])!
      return { ...v, family, summary: '失败：' + String(data.error ?? '') }
    }
    if (bare === 'generation_actions' && Array.isArray(data?.actions)) {
      const acts = data.actions as Array<Record<string, unknown>>
      const v = card('可用生成动作', [
        { kind: 'chips', items: acts.map((a) => ({ text: String(a.title ?? a.label ?? a.id ?? '动作') })) },
      ], { icon: 'action', badge: String(acts.length) + ' 个' })!
      return { ...v, family, summary: acts.length + ' 个可用动作' }
    }
    if (bare === 'generation_create' && data?.ok) {
      const blocks: CardBlock[] = [
        { kind: 'chips', items: [
          ...(args.nodeId ? [{ text: '节点', count: '#' + String(args.nodeId) }] : []),
          { text: '状态', count: String(data.status ?? '') },
        ] },
      ]
      if (args.prompt) blocks.push({ kind: 'note', text: String(args.prompt).replace(/\s+/g, ' ').slice(0, 80), tone: 'info' })
      const v = card('生成任务已提交', blocks, { icon: 'job', badge: String(data.jobId ?? '').slice(0, 8) })!
      return { ...v, family, summary: '任务 ' + String(data.jobId ?? '') }
    }
    if (bare === 'generation_status' && data?.job) {
      const job = data.job as Record<string, unknown>
      const blocks: CardBlock[] = [
        { kind: 'progress', value: Number(job.progress ?? 0), text: String(job.message ?? '') },
      ]
      const result = (job.result ?? {}) as Record<string, unknown>
      const urls = Array.isArray(result.urls) ? (result.urls as unknown[]) : []
      const jobCanvas = String(job.canvasId ?? canvasId)
      if (urls.length) {
        // 产物 url 可能是完整地址，也可能是画布资源目录里的文件名（用户口径 2026-10-08）：
        // 完整地址原样用，文件名才拼画布资源路由 —— 早先一律拼文件名，完整地址被拼成双截 404。
        blocks.push({ kind: 'images', items: urls.map((u) => { const s = String(u); const nm = s.split('/').pop(); return { src: toDisplayUrl(jobCanvas, s), label: resLabel(nm) } }) })
      }
      const v = card('生成任务', blocks, { icon: 'job', badge: String(job.status ?? '') })!
      return { ...v, family, summary: String(job.status ?? '') + ' ' + String(job.progress ?? 0) + '%' }
    }
  }

  if (family === 'file') {
    const p = String(args.file_path ?? args.path ?? '')
    const m = fileMediaOf(p, canvasId)
    /**
     * 读到**媒体**（图片 / 视频 / 音频）→「文件预览」卡片；读文本 / 其它 → 不造卡片，
     * 掉到下面的 fallback（默认折叠行的「输入 / 输出」）。
     *
     * 用户口径（2026-10-13）：①「图片：根据我给你的参考图，做成卡片的效果」；
     * ②「除了视频、图片、音频，其他的都回退到默认的状态」。
     * 所以这一族**只有媒体才成卡片** —— 早先读一段代码也造「文件」卡片，
     * 卡片族没有折叠箭头、整块摊开，正是用户报的问题。
     */
    if (m) {
      const size = sizeOf(outputText)
      const sub = [m.kind, size].filter(Boolean).join(' · ')
      // 卡片内容就是一「行」媒体（用户参考图的形态）：
      // 图片给 thumb（40px 缩略图）；视频 / 音频给 src + mediaKind（组件画播放位）。
      const block: CardBlock =
        m.kind === 'image'
          ? { kind: 'media', mediaKind: 'image', thumb: m.src, title: m.name, sub }
          : { kind: 'media', mediaKind: m.kind, src: m.src, title: m.name, sub }
      return {
        family,
        heading: '文件预览',
        icon: m.kind,
        ...(size ? { badge: size } : {}),
        blocks: [block],
        summary: m.name,
      }
    }
  }

  // fallback：不认识的工具 / 解析不了 —— 组件直出「输入 / 输出」两块（不再套原始 JSON 折叠）
  return { family: 'fallback', heading: bare || name, blocks: [], raw: (outputText ?? '').slice(0, 2000) }
}
