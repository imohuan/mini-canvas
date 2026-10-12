/**
 * plugin-node-ui · 后台半 —— 给 AI 的「怎么画」工具（**这是本插件的核心缝**）。
 *
 * ## 为什么必须有它
 *
 * 用户在画布里引用一个可视化节点时，AI 只拿到一个节点 id。它**不知道**：
 *   - 这个节点是什么（一块会渲染 HTML 的画布）；
 *   - 内容该写进哪个字段；
 *   - 写出来的 HTML 跑在什么环境里、有什么约定；
 *   - 能调哪些后台接口。
 * 少任何一条，AI 都只能瞎猜（或者干脆不画）。所以把它做成 MCP 工具：
 * AI 调一次拿到完整约定，再调一次就把界面写进去。
 *
 * ## 四个工具（**其余用内置的**）
 *
 *   canvas_ui_guide    读「怎么画」的手册（含这张画布现有的节点，便于引用别的节点）
 *   canvas_ui_write    把界面整段写进可视化节点（第一次画 / 整段重画）
 *   canvas_ui_update   在现有 HTML 里**局部替换**（old → new）：改一个 class 不必重写整段
 *   canvas_ui_read     读节点现在的内容（改之前先看一眼）
 *
 * 改**已有节点**的字段、删节点，都用云服务**内置的** canvas_batch_nodes（它本来就支持
 * update / delete，而且是增量、带写锁的）—— 本插件不再各造一个重复工具。
 * 2026-10-12 用户指出：「我不是有一个删除的功能吗」，对，重复了。
 *
 * ## 这个文件怎么被加载、能用什么
 *
 * 打成单文件 dist/server.js → 丢进 cloud-server 的 server-plugins → 启动时用
 * import(data:text/javascript) 加载。**data: URL 里解析不了裸模块名**，所以产物必须自包含：
 * 除了 node: 内置模块，什么都不许 external（见 scripts/build-server.mjs）。
 * 于是这里只用 ctx 给的能力段（routes / mcp / tryGet），零第三方依赖。
 */

/** 手册里最多列多少个节点（防大画布把工具返回撑爆） */
const MAX_LISTED_NODES = 60

/** 「怎么画」的手册正文：先说它是什么，再给硬性约束，最后给能调的接口 */
const GUIDE = [
  '【可视化节点（type = "ui"）—— 画界面用】',
  '',
  '它是一块**空画布**：节点里会渲染你写的一段 HTML。它自己没有界面、没有设置项 ——',
  '内容完全由你决定。用户把它放到画布上、连好素材，然后让你画。',
  '',
  '## 一、怎么画 / 怎么改',
  '',
  '**第一次画**（或整段重画）：',
  '',
  '  canvas_ui_write({ canvasId, nodeId, html })',
  '    · html 给一整段自包含的 HTML（不用包 <!DOCTYPE>，也不用包 markdown 代码块）',
  '    · 写完立刻在节点里渲染出来（用户当场就能看到）',
  '    · 它只写这一个节点，不碰别的',
  '',
  '**改一小块**（写完发现要调一个 class / 一段文字）：**不要整段重写**，用局部替换：',
  '',
  '  canvas_ui_update({ canvasId, nodeId, old, new })',
  '    · old = 现在的代码片段（要原样、能在当前 HTML 里找到）',
  '    · new = 改后的片段',
  '    · 例：old: "class=\\\"card\\\"" → new: "class=\\\"card card--big\\\""',
  '    · old 找不到时会报错，并把当前内容回一段给你，照着改 old 再试',
  '    · old 出现多次 = 全换掉（会回报次数）；只想换一处就把 old 写得更长更精确',
  '',
  '改之前想先看现状：canvas_ui_read({ canvasId, nodeId }) → { html }',
  '',
  '## 二、你的 HTML 跑在哪（**必须遵守，否则白屏**）',
  '',
  '它住在一个**沙箱 iframe** 里（不透明源）。渲染前宿主会注入这些全局变量，直接用：',
  '',
  '  window.__CANVAS_INPUTS__   → { 键: 值 }                                    节点声明的输入参数',
  '  window.__CANVAS_UPSTREAM__ → [{ refName, kind, url?, value?, nodeId? }]    连进来的素材',
  '  window.__CANVAS_UI__       → { theme, baseUrl, canvasId, nodeId }',
  '',
  '硬性约束：',
  '  1. 不许外链任何 js / css / 字体 / 图片 CDN —— 沙箱里只有后台一个源可达，外链一律连不上。',
  '  2. 样式写 <style>、脚本写 <script>，图标用内联 SVG 或字符。',
  '  3. 铺满整块（html, body 宽高 100%，body margin 0），字号 12–14px。',
  '  4. 深浅色都要能看清：读 __CANVAS_UI__.theme，或用 html[data-theme="dark"] 写分支。',
  '  5. 发请求必须写**绝对地址**（页面基地址是 about:srcdoc，相对路径解析不出来）。',
  '     baseUrl 与 canvasId 都从 __CANVAS_UI__ 取。',
  '',
  '## 三、读画布：看规模 / 读一个节点 / 读整张',
  '',
  '  canvas_get({ canvasId, nodeId })   ← **只读那一个节点**（还附带它的连线与邻居节点）',
  '  canvas_get({ canvasId })           ← 读整张全量（节点多的时候别这么用）',
  '  canvas_overview({ canvasId })      ← 只读规模与类型分布',
  '  canvas_list_canvases()             ← 这台服务器上有哪些画布',
  '',
  '要引用别的节点、或想看看某个节点连了什么，就用第一条（省一次全量搬运）。',
  '',
  '## 四、要改画布上的东西，用内置的 canvas_batch_nodes',
  '',
  '**改字段是「替换」语义**：你给的那个键覆盖原值，该节点 data 里别的键保留。',
  '所以只写要改的键，不要整份 data 抄一遍。',
  '',
  '  canvas_batch_nodes({ canvasId, update: [{ id, data: { 只写要改的键 } }] })   ← 改',
  '  canvas_batch_nodes({ canvasId, delete: ["3"] })                              ← 删（连带它的连线）',
  '  canvas_batch_nodes({ canvasId, add: [{ type, position, data? }] })            ← 新建',
  '',
  '这三条都是增量的：只动你点名的节点，不会碰别的、也不搬整张画布。',
  '读整张画布用 canvas_get；只看规模用 canvas_overview。',
  '',
  '## 五、沙箱里（你自己写的 HTML 里）能调什么',
  '',
  '注意：上面三条是**你**（Agent）通过 MCP 调的工具。而**你写出来的那个界面**在浏览器里跑，',
  '它走的是 HTTP，不是 MCP。它能用的只有这几条（都实测可用）：',
  '',
  '  读整张画布   GET  {base}/api/canvases/{canvasId}     → { ok, nodes, edges, view }',
  '  增量改节点   POST {base}/api/canvas/nodes   body { add?, delete?, update? }',
  '               ⚠️ **改一个节点就用这条**（同样只动点名那个，不搬整张画布）',
  '  增量改连线   POST {base}/api/canvas/edges   body { add?, delete?, update? }',
  '  整体写回     PUT  {base}/api/canvases/{canvasId}   body { nodes, edges }',
  '               ⚠️ 整体替换：少一个节点它就没了。只有真要换掉整张画布时才用。',
  '  画布清单     GET  {base}/api/canvases               → { canvases: [{id,name}] }',
  '  下单生成     POST {base}/api/jobs   body { canvasId, nodeId, actionId, prompt?, values? }',
  '               （先 GET {base}/api/actions 看有哪些 actionId 与参数）',
  '',
  '## 六、一个能跑的最小例子',
  '',
  '  <div style="padding:12px;font:13px system-ui">',
  '    <h3 id="t" style="margin:0 0 8px"></h3>',
  '    <div id="list"></div>',
  '  </div>',
  '  <script>',
  '    var U = window.__CANVAS_UPSTREAM__ || [];',
  '    document.getElementById("t").textContent = "素材 " + U.length + " 份";',
  '    document.getElementById("list").innerHTML = U.map(function (x) {',
  '      return x.kind === "image"',
  '        ? "<img src=\"" + x.url + "\" style=\"width:120px\">"',
  '        : "<p>" + String(x.value || "") + "</p>";',
  '    }).join("");',
  '  </script>',
].join('\n')

export const name = 'node-ui'

/** 后台 ctx 的最小形状（就地声明，不 import 工作区包 —— 见文件头说明） */
interface ServerCtx {
  routes: {
    get(path: string, handler: (c: ServerCtxLike) => Response | Promise<Response>): void
  }
  mcp: {
    tool(def: {
      name: string
      description: string
      input?: Record<string, 'string' | 'number' | 'boolean'>
      required?: string[]
      handler(args: Record<string, unknown>): unknown | Promise<unknown>
    }): void
  }
  tryGet<T = unknown>(name: string): T | undefined
}

/** Hono 处理函数的参数（只声明本文件用到的字段） */
interface ServerCtxLike {
  json(body: unknown, status?: number): Response
  req: {
    json(): Promise<unknown>
    header(name: string): string | undefined
    url: string
  }
}

/** 画布存储（宿主上架的服务；用来读任意画布的节点） */
interface CanvasStoreLike {
  readCanvas(id: string): Promise<{ nodes: unknown[]; edges: unknown[] } | undefined>
  writeCanvas(id: string, data: { nodes: unknown[]; edges: unknown[] }): Promise<void>
  list(): Promise<string[]>
}

/** 节点形状（本文件只关心这几个字段） */
interface NodeLike {
  id: string
  type: string
  data?: Record<string, unknown>
}

/** 增量改画布的结果（只声明用到的那几个字段） */
interface PatchResult {
  ok?: boolean
  added?: string[]
  deleted?: string[]
  updated?: string[]
  errors?: Array<{ message: string }>
}

/** 默认画布的文档（宿主上架的服务；有写锁，优先用它） */
interface DocLike {
  getNodes(): NodeLike[]
  getEdges(): Array<{ source: string; target: string }>
  batchNodes(input: unknown): Promise<PatchResult>
}

/**
 * 本服务自己的 origin。
 *
 * 生成的页面住在不透明源沙箱里（Origin: null），请求什么都算跨源；dev 下前端地址经 vite
 * 代理转发还会把预检搞坏（实测）。所以让**后台自报**地址，前端写进节点，渲染时页面直连这里。
 */
export function selfOrigin(c: ServerCtxLike): string {
  const host = c.req.header('host')
  if (!host) return ''
  const proto =
    c.req.header('x-forwarded-proto') ||
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return proto + '://' + host
}

/** 取节点的短描述（给手册里那句「这块画布上有什么」用） */
function describeNode(n: NodeLike): string {
  const d = n.data ?? {}
  const label = typeof d.label === 'string' && d.label ? ' "' + d.label + '"' : ''
  const bits: string[] = []
  for (const key of ['text', 'imageUrl', 'videoUrl', 'audioUrl']) {
    const v = d[key]
    if (typeof v !== 'string' || !v) continue
    bits.push(key + '=' + (v.length > 80 ? v.slice(0, 80) + '…' : v))
  }
  if (n.type === 'ui') bits.push('内容:' + (typeof d.uiHtml === 'string' && d.uiHtml ? '已画' : '还是空的'))
  return '- 节点 ' + n.id + '（' + n.type + '）' + label + (bits.length ? ' · ' + bits.join(' · ') : '')
}

/** 读某张画布的节点（默认画布优先用宿主那份有写锁的 doc） */
async function nodesOf(ctx: ServerCtx, canvasId: string): Promise<NodeLike[]> {
  if (canvasId === 'default') {
    const doc = ctx.tryGet<DocLike>('doc')
    if (doc && typeof doc.getNodes === 'function') return doc.getNodes()
  }
  const store = ctx.tryGet<CanvasStoreLike>('canvasStore')
  if (!store) return []
  const data = await store.readCanvas(canvasId)
  return (data?.nodes ?? []) as NodeLike[]
}

/**
 * 把界面写进一个节点（**只写这一个**，不搬整张画布）。
 *
 * 默认画布走宿主那份 doc —— 它带写锁（与 AI / 网页端的写排成一条链，不会互相覆盖），
 * 而且写盘会走 canvasStore 的变更通知，前端实时通道能收到；直接写 storage 会绕过那把锁。
 */
async function writeUiHtml(
  ctx: ServerCtx,
  canvasId: string,
  nodeId: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  if (canvasId === 'default') {
    const doc = ctx.tryGet<DocLike>('doc')
    if (doc && typeof doc.batchNodes === 'function') {
      try {
        const res = await doc.batchNodes({ update: [{ id: nodeId, data }] })
        if (!res.ok) return { ok: false, error: (res.errors ?? []).map((e) => e.message).join('; ') || '写入失败' }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: '写入失败：' + String(err) }
      }
    }
  }
  // 非默认画布：宿主没给那张画布的 doc，只能自己读-改-写（只改这一个节点）。
  const store = ctx.tryGet<CanvasStoreLike>('canvasStore')
  if (!store) return { ok: false, error: '后台没有画布存储服务，无法写入' }
  const snap = await store.readCanvas(canvasId)
  if (!snap) return { ok: false, error: '画布不存在：' + canvasId }
  const nextNodes = (snap.nodes as Array<Record<string, unknown>>).map((n) =>
    String(n.id) === nodeId ? { ...n, data: { ...((n.data as Record<string, unknown>) ?? {}), ...data } } : n,
  )
  await store.writeCanvas(canvasId, { nodes: nextNodes, edges: snap.edges })
  return { ok: true }
}

export function apply(ctx: ServerCtx): void {
  // ① 「我是谁」：前端靠它拿后台真实地址（见 selfOrigin 的说明）
  ctx.routes.get('/api/node-ui/info', (c) => c.json({ ok: true, origin: selfOrigin(c) }))

  // ② 给 AI 的手册（含这张画布现有的节点）
  ctx.mcp.tool({
    name: 'canvas_ui_guide',
    description:
      '读「怎么给可视化节点画界面」的手册：它是什么、内容写进哪、HTML 跑在什么环境、' +
      '必须遵守哪些约定、能调哪些接口。给可视化节点画东西之前**先调它**。' +
      '同时列出这张画布现有的节点（便于你引用别的节点）。',
    input: { canvasId: 'string' },
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      let list = ''
      try {
        const nodes = await nodesOf(ctx, canvasId)
        const shown = nodes.slice(0, MAX_LISTED_NODES)
        list =
          '\n\n## 这块画布上有什么（canvasId = ' +
          canvasId +
          '，共 ' +
          nodes.length +
          ' 个节点）\n\n' +
          (shown.length ? shown.map(describeNode).join('\n') : '（空画布）') +
          (nodes.length > shown.length ? '\n…还有 ' + (nodes.length - shown.length) + ' 个' : '')
      } catch (err) {
        list = '\n\n（画布节点列表读取失败：' + String(err) + '）'
      }
      return { ok: true, guide: GUIDE + list }
    },
  })

  // ③ 写：把界面画进可视化节点（第一次画 / 重画都走它）
  ctx.mcp.tool({
    name: 'canvas_ui_write',
    description:
      '把一段自包含的 HTML 写进某个**可视化节点**（type = "ui"），节点里立刻渲染出来。' +
      '写之前先调 canvas_ui_guide 读手册（有必须遵守的约定），改之前可先 canvas_ui_read 看现状。' +
      'html 直接给代码本体，不用包 markdown 代码块。只写这一个节点，不动别的。',
    input: { canvasId: 'string', nodeId: 'string', html: 'string' },
    required: ['nodeId', 'html'],
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : ''
      const html = typeof args.html === 'string' ? args.html : ''
      if (!nodeId) return { ok: false, error: '缺少 nodeId' }
      if (!html.trim()) return { ok: false, error: '缺少 html（要写的界面内容）' }

      const nodes = await nodesOf(ctx, canvasId)
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return { ok: false, error: '画布 ' + canvasId + ' 上没有节点 ' + nodeId }
      if (node.type !== 'ui') {
        return {
          ok: false,
          error:
            '节点 ' + nodeId + ' 是「' + node.type + '」类型，不是可视化节点（type 必须是 "ui"）。' +
            '要画界面请先建一个：用内置的 canvas_batch_nodes 加一个 { type: "ui", position: {...} }。',
        }
      }

      const res = await writeUiHtml(ctx, canvasId, nodeId, {
        uiHtml: html,
        uiGeneratedAt: Date.now(),
        uiBy: 'mcp',
      })
      if (!res.ok) return { ok: false, error: res.error ?? '写入失败' }
      return { ok: true, nodeId, canvasId, bytes: html.length }
    },
  })

  // ③b 更新：**在现有 HTML 里做局部替换**（像改代码那样，不必整段重写）
  //
  //     为什么它不能被 canvas_batch_nodes 取代：那条只能整段替换 uiHtml 的值。
  //     而 AI 写完几百行 HTML 后想改一个 class，整段重写既费 token 又容易改坏别处。
  //     这里给 old / new 两个参数：old = 现在的片段，new = 改后的片段。
  ctx.mcp.tool({
    name: 'canvas_ui_update',
    description:
      '在可视化节点**现有的 HTML 里做局部替换**（改一小块，不必整段重写）。' +
      'old = 现在的代码片段（要原样、能在当前 HTML 里找到），new = 改后的片段。' +
      '例：old: "class=\\\"card\\\"" , new: "class=\\\"card card--big\\\""。' +
      'old 在当前 HTML 里找不到时会报错，并把当前内容的一小段回给你，方便你对着改。' +
      '整段重画用 canvas_ui_write；想先看现状用 canvas_ui_read。',
    input: { canvasId: 'string', nodeId: 'string', old: 'string', new: 'string' },
    required: ['nodeId', 'old'],
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : ''
      const oldText = typeof args.old === 'string' ? args.old : ''
      const newText = typeof args.new === 'string' ? args.new : ''
      if (!nodeId) return { ok: false, error: '缺少 nodeId' }
      if (!oldText) return { ok: false, error: '缺少 old（要改掉的现有代码片段）' }

      const nodes = await nodesOf(ctx, canvasId)
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return { ok: false, error: '画布 ' + canvasId + ' 上没有节点 ' + nodeId }
      if (node.type !== 'ui') {
        return { ok: false, error: '节点 ' + nodeId + ' 是「' + node.type + '」类型，不是可视化节点' }
      }
      const html = typeof node.data?.uiHtml === 'string' ? node.data.uiHtml : ''
      if (!html) {
        return { ok: false, error: '这个节点还没有内容（还没画过）。整段画上去请用 canvas_ui_write。' }
      }

      // 数一数 old 出现几次：0 次要报错（并且把现状回一小段，让它知道该拿什么当 old）
      const count = html.split(oldText).length - 1
      if (count === 0) {
        return {
          ok: false,
          error: '当前 HTML 里找不到这段 old。下面是现在内容的前 800 个字符，照着它改 old 再试：\n' + html.slice(0, 800),
        }
      }
      // 出现多次：全换掉，并把次数报回去（AI 若只想换一处，就该把 old 写得更长更精确）
      const next = html.split(oldText).join(newText)
      const res = await writeUiHtml(ctx, canvasId, nodeId, { uiHtml: next, uiGeneratedAt: Date.now(), uiBy: 'mcp' })
      if (!res.ok) return { ok: false, error: res.error ?? '写入失败' }
      return { ok: true, nodeId, canvasId, replaced: count, bytes: next.length }
    },
  })

  // ④ 读：改之前先看一眼现状
  ctx.mcp.tool({
    name: 'canvas_ui_read',
    description:
      '读某个可视化节点现在渲染的 HTML（改之前先看一眼，避免把用户满意的东西改掉）。' +
      '空字符串 = 这个节点还是空的，还没画过。',
    input: { canvasId: 'string', nodeId: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId : ''
      if (!nodeId) return { ok: false, error: '缺少 nodeId' }
      const nodes = await nodesOf(ctx, canvasId)
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return { ok: false, error: '画布 ' + canvasId + ' 上没有节点 ' + nodeId }
      const html = typeof node.data?.uiHtml === 'string' ? node.data.uiHtml : ''
      return { ok: true, nodeId, canvasId, type: node.type, html, empty: !html }
    },
  })
}

