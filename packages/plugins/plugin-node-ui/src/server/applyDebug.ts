/**
 * node-ui 后台：调试连接（邀请制 / SSE / 轮询 / 独立调试页）。
 * 从 server.ts 的 apply 原样迁出，注册顺序与 handler 不变。
 */
import type { ServerCtx } from './shared-types.js'
import { nodesOf, uiNodeOf, writeUiHtml } from './canvasAccess.js'
import { buildDebugDocs } from './debugDocs.js'
import { UI_DEBUG_INVITE_KEY, isAcceptMatching, newSessionId, readInvite, type DebugAcceptPayload } from '../debugSession.js'
import { isSafeCanvasId } from '../canvasPathsShared.js'

export function applyDebug(ctx: ServerCtx): void {

  // ==================== 调试连接（用户 2026-10-15 定的邀请制）====================
  //
  // 要解决的问题：Agent 想调试一个可视化节点的**运行实例**（读变量、执行脚本），
  // 而同一张画布可能开着多个标签页 —— 必须让用户选一个，且后续重连认的还是同一个。
  //
  // 职责划分（与 debugSession.ts 的注释同口径）：
  //   · 后台（这两个工具）：放邀请标记 / 收回执并记住「谁被选中」；不碰 HTML。
  //   · 前端（UiContent）：看到标记弹确认框；被点中的标签页写 sessionStorage 凭据、
  //     回执、清标记、进调试态（iframe 注入 SDK、拦截刷新）。
  //
  // 为什么 SDK 连接走 WebSocket 而后台不发 HTTP 给页面：页面在沙箱 iframe 里，
  // 后台无法直接叫它 —— 只能由页面里的 SDK 主动拨过来（浏览器安全的常识约束）。
  // 所以这里只「留名字」：连接建立后 SDK 报 hello（session / canvasId / nodeId），
  // 后台按名字认识它。

  /** 当前挂着的调试会话（每张画布同时最多一个 —— 调试是独占动作） */
  const debugSessions = new Map<string, { session: string; nodeId: string }>()

  /**
   * eval 执行通道（SSE 下行 + HTTP POST 上行）。
   *
   * 为什么不是 WebSocket：cloud-server 没有 WS 设施，外挂插件也拿不到 http server 挂
   * upgrade 监听；SSE 项目里已有成熟先例（任务日志 watchRun）。SDK 脚本里 EventSource
   * 拨号到 debug-events，后台把 eval 任务塞进 pending 表；执行结果从 debug-result 回来，
   * 由 waiter 的 resolve 送回 MCP 调用方。stop 同理：挂一个 promise，disconnect 时 resolve。
   */
  type DebugEval = { type: 'eval'; id: string; code: string }
  type DebugWaiter = { resolve: (v: { ok: boolean; result?: unknown; error?: string; stopped?: boolean }) => void }
  const debugEvals = new Map<string, DebugEval[]>() // session → 未被 SDK 取走的 eval 队列
  const debugSse = new Map<string, (e: DebugEval | { type: 'stop' }) => void>() // session → SSE 投递口
  const debugResults = new Map<string, DebugWaiter>() // evalId → 等结果的 resolve
  const debugStops = new Map<string, DebugWaiter>() // session → 等 disconnect 的 resolve
  let debugEvalSeq = 0
  /** 调试链路统一日志前缀（2026-10-17 排查通道失联时加的；后台控制台 grep 这个词） */
  const DLOG = '[node-ui][debug]'
  function dlog(...parts: unknown[]): void {
    console.log(DLOG, ...parts)
  }

  // ⑫ 发起调试连接：在节点上放邀请标记，等用户在某个标签页上确认
  ctx.mcp.tool({
    name: 'canvas_ui_connect',
    description:
      '对某个可视化节点发起**调试连接**（临时状态，不改节点 HTML）。' +
      '调用后，所有打开这张画布的标签页都会弹一个确认对话框；用户点中哪个标签页，' +
      '调试链接就建在哪个标签页的节点实例上（多标签页只认被点中的那一个）。' +
      '用户确认后用 canvas_ui_debug_eval 在这个连接里执行脚本；' +
      '调试完用 canvas_ui_disconnect 断开。连接只对**当前开着画布页面**的节点有效，' +
      '页面没开 / 用户没确认都会让它一直挂着（返回里给了 session，可再次 connect 重发邀请）。',
    input: { canvasId: 'string', nodeId: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) {
        dlog('connect 失败：', JSON.stringify(picked))
        return picked
      }
      const { canvasId, nodeId } = picked
      const session = newSessionId()
      dlog('connect 发起：canvasId=' + canvasId, 'nodeId=' + nodeId, 'session=' + session)
      // 邀请写成**合并**进 data（batchNodes 的 update 是浅合并）：只添这一个字段，
      // 不碰 uiHtml / uiInputs 等既有字段 —— 这是「临时状态」与「重写内容」的根本区别。
      const res = await writeUiHtml(ctx, canvasId, nodeId, {
        [UI_DEBUG_INVITE_KEY]: { session, at: Date.now() },
      })
      if (!res.ok) {
        dlog('connect 放邀请标记失败：', JSON.stringify(res))
        return { ok: false, error: res.error ?? '放邀请标记失败' }
      }
      debugSessions.set(canvasId, { session, nodeId })
      return {
        ok: true,
        canvasId,
        nodeId,
        session,
        hint: '邀请已发出：打开这张画布的每个标签页都会弹确认框，用户点中哪个就用哪个。' +
          '用户确认后，前端会清掉邀请标记并连上后台（WebSocket hello 带 session）。' +
          '如果标签页上没弹框，检查画布页面是否开着。',
      }
    },
  })

  // ⑬ 收回执：前端把「用户点了哪个标签页」报上来
  ctx.routes.post('/api/node-ui/debug-accept', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: '请求体不是合法 JSON' }, 400)
    }
    const accept = body as DebugAcceptPayload | undefined
    if (!accept || typeof accept.session !== 'string' || typeof accept.nodeId !== 'string' || typeof accept.canvasId !== 'string') {
      return c.json({ ok: false, error: '缺少 session / nodeId / canvasId' }, 400)
    }
    dlog('accept 收到回执：', JSON.stringify(accept))
    // 回执必须配得上当前邀请：邀请没了（前端已清）或对不上号都拒绝。
    // 为什么查节点 data 而不是内存 Map：Map 只在**这个**后台进程里，而邀请标记在
    // 画布数据里（后台重启也能恢复判断）—— 用同一份事实，别养两套。
    const node = (await nodesOf(ctx, accept.canvasId)).find((n) => String(n.id) === accept.nodeId)
    const invite = readInvite(node?.data)
    if (!isAcceptMatching(invite, accept)) {
      dlog('accept 拒绝：邀请=' + JSON.stringify(invite), '回执=' + JSON.stringify(accept))
      return c.json({ ok: false, error: '回执与当前邀请不匹配（可能已被确认过或已过期）' }, 409)
    }
    // 邀请标记落盘清除（前端只是 updateNodeRuntime——不落盘，刷新后标记会复活）。
    // 必须在记会话之前清：标记在 = 邀请还挂着，清掉才是「已被认领」的语义。
    await writeUiHtml(ctx, accept.canvasId, accept.nodeId, { [UI_DEBUG_INVITE_KEY]: null })
    // 记下被选中的标签页：后续 eval 只对它生效（eval 找的是 SSE 通道里的 session）
    debugSessions.set(accept.canvasId, { session: accept.session, nodeId: accept.nodeId })
    dlog('accept 成立：session=' + accept.session, 'nodeId=' + accept.nodeId, 'canvasId=' + accept.canvasId)
    return c.json({ ok: true, wsPath: '/api/node-ui/debug-events', session: accept.session })
  })

  // SSE 下行通道：SDK 脚本拨进来，等 eval / stop。
  ctx.routes.get('/api/node-ui/debug-events', (c) => {
    const session = c.req.query?.('session') ?? ''
    const owning = [...debugSessions.entries()].find(([, s]) => s.session === session)
    if (!session || !owning) {
      dlog('debug-events 404：session=' + session, '已注册会话=' + JSON.stringify([...debugSessions.values()]))
      return c.json({ ok: false, error: '未知调试会话' }, 404)
    }
    dlog('debug-events SSE 接入：session=' + session)
    // 手写 SSE 流（外挂插件产物零第三方依赖：不 import hono/streaming）。
    // 格式：每条事件一行 data: <json> + 空行；每 20 秒一行注释帧保活。
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        let ping: ReturnType<typeof setInterval> | undefined
        const send = (text: string): void => {
          if (closed) return
          try { controller.enqueue(encoder.encode(text)) } catch { closed = true }
        }
        const teardown = (): void => {
          if (closed) return
          closed = true
          dlog('debug-events SSE 断开：session=' + session)
          if (ping !== undefined) clearInterval(ping)
          debugSse.delete(session)
          try { controller.close() } catch { /* 已关 */ }
        }
        const push = (e: DebugEval | { type: 'stop' }): void => {
          send('data: ' + JSON.stringify(e) + '\n\n')
          if ('type' in e && e.type === 'stop') {
            // stop 发完就收流：SDK 的 fetch 流读到的 done 会自然结束重连循环
            setTimeout(teardown, 50)
          }
        }
        // 重连恢复：把还没取走的 eval 立刻补发一遍
        const backlog = debugEvals.get(session) ?? []
        for (const e of backlog) push(e)
        debugEvals.set(session, [])
        debugSse.set(session, push)
        dlog('debug-events 补发积压 eval：session=' + session, '条数=' + backlog.length)
        // 保活 + 最长存活：调试会话不该无限挂着（长流会把 CDP/代理拖死）
        ping = setInterval(() => send(': ping\n\n'), 20_000)
        setTimeout(teardown, 15 * 60_000)
        // 请求中断（页签关闭 / SDK 重连）时清理
        const raw = (c as unknown as { req: { raw?: Request } }).req.raw
        raw?.signal?.addEventListener('abort', teardown)
      },
    })
    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  })

  // 上行回包：SDK 执行完 eval 从这里交结果
  ctx.routes.post('/api/node-ui/debug-result', async (c) => {
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ ok: false, error: '请求体不是合法 JSON' }, 400) }
    dlog('result 收到回包：', JSON.stringify(body))
    const m = body as { session?: unknown; id?: unknown; ok?: unknown; result?: unknown; error?: unknown } | null
    if (!m || typeof m.id !== 'string') return c.json({ ok: false, error: '缺少 id' }, 400)
    const waiter = debugResults.get(m.id)
    if (!waiter) {
      dlog('result 无人在等（可能已超时）：id=' + m.id)
      return c.json({ ok: false, error: '没有在等的 eval（可能已超时）' }, 404)
    }
    debugResults.delete(m.id)
    waiter.resolve({
      ok: m.ok === true,
      ...(m.ok === true ? { result: m.result } : { error: typeof m.error === 'string' ? m.error : '执行失败' }),
    })
    return c.json({ ok: true })
  })


  // 轮询下行（2026-10-16 自动化测试发现流式通道在 sandbox iframe 里不可靠——
  // 后台写入成功、前端 reader 永远读不到帧；轮询是保底通道，语义与 SSE 相同：
  // GET 一次 = 取走当前挂起的 eval 队列，逐条执行后照旧 POST debug-result）。
  ctx.routes.get('/api/node-ui/debug-poll', (c) => {
    const session = c.req.query?.('session') ?? ''
    if (!session || ![...debugSessions.values()].some((s) => s.session === session)) {
      dlog('debug-poll 404：session=' + session, '已注册会话=' + JSON.stringify([...debugSessions.values()]))
      return c.json({ ok: false, error: '未知调试会话' }, 404)
    }
    const pending = debugEvals.get(session) ?? []
    debugEvals.set(session, [])
    if (pending.length > 0) dlog('debug-poll 取走 eval：session=' + session, '条数=' + pending.length, 'ids=' + pending.map((e) => e.id).join(','))
    return c.json({ ok: true, evals: pending })
  })

  // ⑭ 在调试连接里执行一段脚本（eval）
  ctx.mcp.tool({
    name: 'canvas_ui_debug_eval',
    description:
      '在**已建立的调试连接**里执行一段 JavaScript（跑在用户确认过的那个标签页的节点 iframe 里，' +
      '与页面同上下文：能读 window、DOM、页面里的变量），把结果或报错拿回来。' +
      '前提：先 canvas_ui_connect 且用户已在某个标签页上确认。结果不能结构化克隆的部分会被 JSON 化。',
    input: { canvasId: 'string', code: 'string' },
    required: ['canvasId', 'code'],
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const code = typeof args.code === 'string' ? args.code : ''
      if (!code.trim()) return { ok: false, error: '缺少 code（要执行的 JavaScript）' }
      const sess = debugSessions.get(canvasId)
      if (!sess) {
        dlog('eval 拒绝：画布没有调试会话 canvasId=' + canvasId)
        return { ok: false, error: '这张画布没有挂着的调试会话：先 canvas_ui_connect' }
      }
      // 轮询通道（2026-10-16）：不再要求 SDK 挂着 SSE —— eval 进挂起队列，SDK 每秒
      // GET debug-poll 取走执行。queueIdle 由 30 秒兜底超时照旧负责。
      const id = 'e' + ++debugEvalSeq
      dlog('eval 入队：id=' + id, 'session=' + sess.session, 'code=' + code.slice(0, 200))
      const backlog = debugEvals.get(sess.session) ?? []
      // 协议形状：SDK（debugSession.buildSdkScriptBody）按 m.type === 'eval' 分发，
      // 入队必须带 type 字段（2026-10-17 真机抓到：缺 type 导致 SDK 收到后静默丢弃，
      // eval 全部 30 秒超时）。SSE 与轮询两条下行通道同用这张表，形状必须一致。
      backlog.push({ type: 'eval', id, code })
      debugEvals.set(sess.session, backlog)
      const result = await new Promise<{ ok: boolean; result?: unknown; error?: string; stopped?: boolean }>((resolve) => {
        debugResults.set(id, { resolve })
        // 30 秒兜底：SDK 挂了不该让 MCP 调用永远挂着
        setTimeout(() => {
          if (debugResults.has(id)) {
            debugResults.delete(id)
            dlog('eval 超时：id=' + id, 'session=' + sess.session)
            resolve({ ok: false, error: '执行超时（30 秒没等到回包）' })
          }
        }, 30_000)
      })
      dlog('eval 完成：id=' + id, JSON.stringify(result).slice(0, 300))
      if (result.stopped) return { ok: false, error: '调试会话已被断开' }
      return result.ok ? { ok: true, result: result.result } : { ok: false, error: result.error ?? '执行失败' }
    },
  })

  // ⑮ 断开调试连接：给 SDK 发 stop，等它收线；清会话
  ctx.mcp.tool({
    name: 'canvas_ui_disconnect',
    description:
      '断开某个可视化节点的**调试连接**（canvas_ui_connect 建立的）。节点数据不动、' +
      '页面不动 —— 只是停掉执行通道。断开后 sessionStorage 里的凭据由前端在组件卸载时清。',
    input: { canvasId: 'string' },
    handler: async (args) => {
      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const sess = debugSessions.get(canvasId)
      if (!sess) return { ok: false, error: '这张画布没有挂着的调试会话' }
      const push = debugSse.get(sess.session)
      push?.({ type: 'stop' })
      // 轮询通道也要送 stop（2026-10-17 真机：SSE 在 sandbox iframe 里不可靠，
      // 只 push SSE 的话 SDK 根本收不到 stop —— 徽标不熄、凭据不清、拦截不摘）。
      const backlog = debugEvals.get(sess.session) ?? []
      backlog.push({ type: 'stop' as never, id: '', code: '' })
      debugEvals.set(sess.session, backlog)
      // 等 stop 送达（最多 2 秒）再清，避免 SDK 还挂着就丢队列
      await new Promise((r2) => setTimeout(r2, 300))
      debugSessions.delete(canvasId)
      debugEvals.delete(sess.session)
      debugStops.delete(sess.session)
      return { ok: true, canvasId, note: '调试连接已断开。' }
    },
  })

  // ⑯ 独立调试页面：后台拼一份完整 HTML + 数据 JS，落到 resources/debug/（用户 2026-10-17 定）
  //    供 Chrome MCP / 任何浏览器自动化直接打开 —— 普通页面，无沙箱，DevTools / CDP 全通。
  //    2026-10-20：文件不再由后台同源回读，改由独立端口（debugOrigin）提供，见 buildDebugDocs。
  ctx.mcp.tool({
    name: 'canvas_ui_build_debug_doc',
    description:
      '为一个可视化节点生成「独立调试页面」：后台把节点 HTML + 上游数据 + 参数拼成三份文件' +
      '（debug-*.html 壳 / context-*.js 数据 / sdk-*.js 桥），落到画布 resources/debug/ 目录，' +
      '返回可直接打开的 URL 与本机绝对路径。页面由**独立的调试源**（另一个端口）提供，' +
      '读不到画布页的令牌；Chrome MCP / 任何浏览器自动化打开 HTML URL 即可全自动调试' +
      '（普通页面，无沙箱无 CSP）。页面里 CanvasUI.save 用的是只限本节点的短令牌（10 分钟）。' +
      '数据更新 = 重跑本工具重写 context.js；' +
      '窗口里的 sdk.js 每 5 秒轮询，context 一变界面自动重画（CanvasUI.onChange 触发）。' +
      'version 可选：传了就生成带版本的独立文件（多版本并存）；不传则覆盖无版本那份。',
    input: { canvasId: 'string', nodeId: 'string', version: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      const version = typeof args.version === 'string' && args.version.trim() ? args.version.trim() : undefined
      const html = typeof node.data?.uiHtml === 'string' ? node.data.uiHtml : ''
      if (!html.trim()) return { ok: false, error: '这个节点还没有内容（还没画过）。先 canvas_ui_write。' }
      return buildDebugDocs(ctx, {
        canvasId,
        nodeId,
        html,
        inputs: (node.data?.uiInputs ?? {}) as Record<string, unknown>,
        upstream: node.data?.uiUpstream,
        version,
        withPaths: true,
        hint:
          '用浏览器打开 urls.html 即可调试（普通页面，DevTools/CDP 全通）。' +
          '改了上游/参数后重跑本工具，窗口 5 秒内自动刷新。' +
          '想改界面？编辑 paths.html（或用 canvas_ui_write 改节点后重跑本工具）。',
      })
    },
  })

  // ⑯b 画布内「调试」按钮用：把当前这份界面写到独立源，返回可打开的 URL。
  //     与上面的 MCP 工具共用 buildDebugDocs（一次实现，两处入口）。
  //     管理令牌由 cloud-server 的中间件统一校验（这条是 POST）。
  ctx.routes.post('/api/canvases/:canvasId/debug-docs', async (c) => {
    const cc = c as unknown as {
      req: { param?(n: string): string | undefined; json(): Promise<unknown> }
    }
    const canvasId = cc.req.param?.('canvasId') ?? ''
    let body: Record<string, unknown>
    try {
      const raw = await cc.req.json()
      body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    } catch {
      return c.json({ ok: false, error: '请求体不是合法 JSON' }, 400)
    }
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId : ''
    const html = typeof body.html === 'string' ? body.html : ''
    const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : undefined
    if (!canvasId) return c.json({ ok: false, error: '缺少画布 id' }, 400)
    if (!isSafeCanvasId(canvasId)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    if (!nodeId) return c.json({ ok: false, error: '缺少 nodeId' }, 400)
    if (!html.trim()) return c.json({ ok: false, error: '这份界面还是空的，没什么可调试的' }, 400)
    const built = await buildDebugDocs(ctx, {
      canvasId,
      nodeId,
      html,
      inputs: (body.inputs && typeof body.inputs === 'object' ? body.inputs : {}) as Record<string, unknown>,
      upstream: body.upstream,
      version,
      withPaths: false,
      hint: '把这个 URL 开在独立窗口里调试；改了参数后本组件会重发一次，页面 5 秒内跟上。',
    })
    return built.ok ? c.json(built) : c.json(built, 400)
  })

  /**
   * 旧调试文件的读取口（GET）—— **已永久关闭**，见下面的说明。
   *
   * 2026-10-20（审查 S1）：这条路由是**后台同源**的 text/html 通道 —— 节点 HTML 里的脚本
   * 在这里执行就能读走 `localStorage` 里的管理令牌。现在没有任何降级路径会用到它。
   */
  ctx.routes.get('/api/canvases/:canvasId/resources/debug/:file', async (c) => {
    /*
     * 这条通道**永远**关着。
     *
     * 它曾经是调试页的读取口：`text/html`、与后台同源，节点 HTML 里的脚本能直接读走
     * `localStorage.plume_admin_token`。现在调试产物只由另一个端口的只读服务提供。
     * 保留这条路由（而不是删掉）是为了给旧链接一个明确的 404 说明，而不是落到 SPA 兜底
     * 回一份 index.html 让调用方误以为拿到了页面。
     */
    return c.json(
      { ok: false, error: '调试页在独立源上（启动日志里的「调试页」地址）。这条同源通道已永久关闭。' },
      404,
    )
  })
}

