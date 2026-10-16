/**
 * debugSession —— 调试连接的纯逻辑（零 Vue / 零 DOM / 零网络，Node 可单测）。
 *
 * 解决的问题：同一张画布开了多个标签页时，Agent 只能调试**其中一个**。
 * 定谁的方案（用户 2026-10-15 定的口径）：
 *
 *   1. Agent 发起连接 → 后台在节点上放一个**邀请标记**（临时状态，落 data 但由前端清）；
 *   2. 打开这张画布的每个标签页都会看到标记 → 各自弹确认对话框；
 *   3. 用户只点其中一个 → **只有被点中的那个**写 sessionStorage（自己本地的凭据）并回执后台；
 *   4. 前端清掉节点上的邀请标记 —— 因为节点数据经 SSE 同步，标记不清的话
 *      所有标签页都以为「还有邀请」；
 *   5. 被选中的标签页进调试态：iframe 额外注入 SDK 脚本、拦截刷新。
 *
 * 为什么是「邀请 + 凭据」两份状态：邀请在**节点数据**里（让所有标签页都看得见），
 * 凭据在 **sessionStorage** 里（每个标签页一份、刷新还在、关页就没了）。
 * 凭据的存在 = 「我就是当时被选中的那个标签页」，刷新重连时靠它自动确认，不再弹窗。
 */

/** 节点 data 上存邀请标记的字段名（与后台 server.ts 的 MCP 工具同词表） */
export const UI_DEBUG_INVITE_KEY = 'uiDebugInvite'

/** sessionStorage 里存凭据的键名 */
export const DEBUG_CREDENTIAL_KEY = 'mc-ui-debug-credential'

/** 一次调试邀请的形状（存在节点 data 上，经 SSE 同步到所有标签页） */
export interface DebugInvite {
  /** 发起方给本次会话起的编号；凭据里要带上它，防串台 */
  session: string
  /** 发起时间（排查用） */
  at: number
}

/** 一次调试连接的凭据（存在被选中标签页的 sessionStorage 里） */
export interface DebugCredential {
  /** 与邀请里的 session 同值：证明「我是为这次会话确认过的那个标签页」 */
  session: string
  /** 被调试的节点 */
  nodeId: string
  /** 画布 id（一份 sessionStorage 只服务一张画布，存上防跨画布误认） */
  canvasId: string
  /** 确认时间（排查用） */
  at: number
}

/** 后台回执的载荷（被选中标签页写 sessionStorage 的同时回给后台的形状） */
export interface DebugAcceptPayload {
  session: string
  nodeId: string
  canvasId: string
}

/** 会话编号：时间戳 + 随机尾巴，碰撞概率可忽略（排查日志时看开头几位就够定位） */
export function newSessionId(now: number = Date.now()): string {
  const rand = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')
  return now.toString(36) + rand
}

/** 把节点 data 里的邀请标记读成干净形状；没有 / 形状不对 = undefined（不猜） */
export function readInvite(data: unknown): DebugInvite | undefined {
  const invite = (data as Record<string, unknown> | undefined)?.[UI_DEBUG_INVITE_KEY] as
    | Record<string, unknown>
    | undefined
  if (!invite || typeof invite !== 'object') return undefined
  if (typeof invite.session !== 'string' || !invite.session) return undefined
  return { session: invite.session, at: typeof invite.at === 'number' ? invite.at : 0 }
}

/**
 * 判断一次回执能不能配上当前邀请。
 *
 * 三样必须全对上：session（防旧回执配新邀请）、nodeId、canvasId。
 * 任何一样对不上都拒绝 —— 多标签页场景里宁可让用户再点一次，也不能接错页。
 */
export function isAcceptMatching(invite: DebugInvite | undefined, accept: DebugAcceptPayload | undefined): boolean {
  if (!invite || !accept) return false
  return (
    accept.session === invite.session &&
    typeof accept.nodeId === 'string' && accept.nodeId.length > 0 &&
    typeof accept.canvasId === 'string' && accept.canvasId.length > 0
  )
}

/** 凭据形状校验（sessionStorage 里读出来的东西不可信，用前必须过一遍） */
export function isCredential(v: unknown): v is DebugCredential {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return (
    typeof c.session === 'string' && c.session.length > 0 &&
    typeof c.nodeId === 'string' && c.nodeId.length > 0 &&
    typeof c.canvasId === 'string' && c.canvasId.length > 0
  )
}

/** 读本标签页的凭据（没有 / 形状不对 = undefined；sessionStorage 可能抛错，一并吞掉） */
export function readCredential(storage: Pick<Storage, 'getItem'>): DebugCredential | undefined {
  try {
    const raw = storage.getItem(DEBUG_CREDENTIAL_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    return isCredential(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 写凭据；写不进去（隐私模式等）就安静失败 —— 调试是尽力而为，不该把页面搞挂 */
export function writeCredential(storage: Pick<Storage, 'setItem'>, cred: DebugCredential): void {
  try {
    storage.setItem(DEBUG_CREDENTIAL_KEY, JSON.stringify(cred))
  } catch {
    /* 存不下就没凭据：下次刷新重弹确认，功能不坏 */
  }
}

/** 清凭据（连接正式断开时调用；不关标签页也要能把身份放下） */
export function clearCredential(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(DEBUG_CREDENTIAL_KEY)
  } catch {
    /* 同上：尽力而为 */
  }
}

/**
 * 组装「SDK 连接脚本」的正文（纯字符串，不含 <script> 壳 —— 由 appendSdkScript 包）。
 *
 * 通道选型（2026-10-16 真机自动化测试修订）：**轮询下行 + HTTP POST 上行**。
 * 为什么不用 SSE：sandbox iframe（opaque origin）里 fetch 流式响应不可靠 ——
 * 真机复现：后台写入成功、前端 reader 永远读不到帧（连接挂起、无错误无数据）；
 * curl 同一端点却即时收到。轮询语义等价（GET 取走挂起队列），且与界面自身的
 * fetch 用法完全一致（/api/task/call 那条路一直稳定）。
 * 为什么：后台（cloud-server）没有任何 WebSocket 设施，外挂插件也拿不到 http server
 * 实例挂 upgrade 监听；而 SSE 项目里已有成熟先例（任务日志的 watchRun 就是）。
 * 本脚本只做通信。协议：
 *   下行（GET debug-poll 的 JSON）：{ evals: [{ type:'eval', id, code } | { type:'stop' }] }
 *   上行（POST /api/node-ui/debug-result）：{ session, id, ok, result?, error? }
 * 轮询由 setInterval 每秒一次（刷新后凭据还在时自动接住恢复路径）。
 */
export interface SdkScriptOptions {
  /** 后台 http(s) 基地址（SSE 与 POST 都走它） */
  baseUrl: string
  session: string
  canvasId: string
  nodeId: string
}

export function buildSdkScriptBody(opts: SdkScriptOptions): string {
  return [
    '(function(){',
    '  var BASE = ' + JSON.stringify(opts.baseUrl) + ';',
    '  var SESSION = ' + JSON.stringify(opts.session) + ';',
    '  var stopped = false;',
    '  function log(){ try { console.log.apply(console, ["[ui-sdk]"].concat([].slice.call(arguments))); } catch (e0) {} }',
    '  log("SDK 启动: session=" + SESSION, "base=" + BASE);',
    '  function reply(id, ok, fields){',
    '    var body = Object.assign({ session: SESSION, id: id, ok: ok }, fields || {});',
    '    log("回包开始: id=" + id, "ok=" + ok, JSON.stringify(body).slice(0, 200));',
    '    fetch(BASE + "/api/node-ui/debug-result", { method: "POST",',
    '      headers: { "content-type": "text/plain" },',
    '      body: JSON.stringify(body) }).then(function(res){',
    '        log("回包响应: id=" + id, "status=" + res.status);',
    '      }).catch(function(err){',
    '        log("回包失败: id=" + id, (err && err.message) || err);',
    '        try { document.title = "REPLY-ERR:" + ((err && err.message) || err); } catch (e3) {}',
    '      });',
    '  }',
    // 上行回包用 **text/plain 的 POST**（简单请求，不触发预检）—— 真机自动化 2026-10-16
    // 抓到：application/json 的 POST 会预检，预检在 sandbox iframe 里静默失败，回包永远
    // 到不了后台；后台 c.req.json() 不挑 content-type，text/plain 两相容。
    // 下行用轮询（debug-poll）—— 流式读 SSE 在沙箱（无 allow-same-origin）里不可靠：
    // EventSource 的跨源连接行为不可靠（实测 2026-10-15：请求都不发出），而 fetch 在
    // 同一沙箱里一直在用（界面调后台接口就是它）。SSE 帧解析只认 'data: ' 行，够用。
    '  function poll(){',
    '    if (stopped) return;',
    '    fetch(BASE + "/api/node-ui/debug-poll?session=" + encodeURIComponent(SESSION))',
    '      .then(function(res){ if (!res.ok) throw new Error("poll " + res.status); return res.json(); })',
    '      .then(function(body){',
    '        var list = body.evals || [];',
    '        if (list.length > 0) log("poll 取到 eval: " + list.length + " 条");',
    '        for (var i = 0; i < list.length; i++) {',
    '          var m = list[i];',
    '          log("收到消息: type=" + m.type, "id=" + m.id);',
    '          handle(m);',
    '        }',
    '      })',
    '      .catch(function(err){',
    '        log("poll 失败: " + ((err && err.message) || err));',
    '        try { document.title = "POLL-ERR:" + ((err && err.message) || err); } catch (e2) {}',
    '        if (stopped) return;',
    '      });',
    '  }',
    '  function handle(m){',
    '    if (m.type === "stop") { stopped = true; return; }',
    '    if (m.type !== "eval" || typeof m.id !== "string" || typeof m.code !== "string") return;',
    '    try { parent.postMessage({ __uiDebugEvt: { kind: "eval", id: m.id } }, "*"); } catch (e5) {}',
    '    var fields;',
    '    try { fields = { result: (0, eval)(m.code) }; }',
    '    catch (err) { fields = { error: String((err && err.message) || err) };',
    '      log("eval 执行出错: id=" + m.id, fields.error);',
    '      try { parent.postMessage({ __uiDebugEvt: { kind: "error", id: m.id, detail: fields.error } }, "*"); } catch (e6) {}',
    '      reply(m.id, false, fields); return; }',
    '    log("eval 执行完成: id=" + m.id, "结果=" + JSON.stringify(fields).slice(0, 200));',
    '    try { parent.postMessage({ __uiDebugEvt: { kind: "result", id: m.id } }, "*"); } catch (e7) {}',
    '    reply(m.id, true, fields);',
    '  }',
    '  poll();',
    '  setInterval(poll, 1000);',
    '})();',
  ].join('\n')
}
/**
 * 给一份 iframe 文档**追加** SDK 连接脚本（挂在 </body> 前；找不到就追加到文末）。
 *
 * 为什么是「追加」而不是改 buildSrcdoc：srcdoc 是上游 computed，改它等于给所有节点
 * 常驻注入 —— 用户口径是「只有调试时才连」。追加发生在**渲染边界**（UiContent 拿到
 * srcdoc 之后），平时零成本、节点数据一个字节不动。
 */
export function appendSdkScript(docHtml: string, scriptBody: string): string {
  const safe = scriptBody.split('</').join('<\\/')
  const tag = '<script>' + safe + '</script>'
  const closeAt = docHtml.lastIndexOf('</body>')
  if (closeAt >= 0) return docHtml.slice(0, closeAt) + tag + docHtml.slice(closeAt)
  return docHtml + tag
}






