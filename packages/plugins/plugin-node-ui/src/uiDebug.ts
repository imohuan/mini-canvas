import {
  BRIDGE_GLOBAL,
  INPUTS_GLOBAL,
  serializeForScript,
  SHELL_STYLE,
  UI_GLOBAL,
  UPSTREAM_GLOBAL,
} from './uiData'

/**
 * uiDebug —— 调试副本的拼装（**离线预览 / 单测用**）。
 *
 * ⚠️ 2026-10-20 起，产品里的「调试」按钮**不再走这里**。它打开的是独立调试页
 * （另起一个端口，见 `debugDocServer.ts` / `debugDocAssets.ts`）：
 * 这里拼出来的副本是 `about:blank`，继承画布页的源，节点 HTML 里的脚本能读走管理令牌。
 * 保留本模块是为了「把一份文档存下来离线看」和测试（`uiDebug.test.ts`）仍然能用。
 *
 * ## 为什么需要它（用户 2026-10-15 报的问题）
 *
 * 「无法操作这个节点，也无法进行调试。正常写 UI 都是可以进行调试的。」
 *
 * 根因是**安全设计本身**，不是 bug：生成物住在 sandbox="allow-scripts" 的 iframe 里，
 * 故意**不给** allow-same-origin（少了这条，生成物就拿到宿主页面的源，
 * 能读整张画布的 localStorage、cookie 与宿主的 DOM）。于是：
 *
 *   · 父页面读不到它：contentDocument 是 null，DevTools 里也点不进去；
 *   · 它自己也没有可用的控制台：控制台按帧隔离，父页面伸手摸不到。
 *
 * 换句话说：**越安全，越没法调试**。这两件事在同一个 iframe 里是矛盾的。
 *
 * ## 当年怎么办：不动沙箱，另开一份副本
 *
 * 把节点里那份 HTML 原样写进一个**新窗口**（window.open + document.write），
 * 让它以普通页面的身份跑。同源之下（这也是它被换掉的原因）：
 *
 *   · DevTools 能点进这个窗口，控制台 / 断点 / 单步全都回来；
 *   · 外部能直接读它的变量（含 <script> 顶层的 let/const，不只是 window 属性）；
 *   · 宿主可通过 postMessage 与它对话（buildDebugBridge 把协议也带上），
 *     所以「操作它」也回来了。
 *
 * 而**画布上那个节点一行代码都不改** —— 沙箱照旧不透明，安全边界原地不动。
 * 调试窗口是「副本」：在副本里点坏了大不了重开一个，画布上那份不受影响。
 *
 * ## 为什么副本里的请求还能成功
 *
 * 副本带 <base href>，而生成物一律被要求写**绝对地址**（手册第 3 条硬性约束），
 * 所以它照样连得上后台。
 *
 * ## CSP 的差异（有意接受）
 *
 * 沙箱里那份 CSP 是 connect-src <后台源> <前端源>，用来「数据不外泄」。
 * 副本是给**开发者本人**看的开发工具，不是发布物：留着那道网反而会让
 * 「看响应 / 打断点」这类调试手段无从下手。所以副本**不带** meta CSP。
 */


/** 开一个调试窗口需要的东西（调用方现取，本模块不认识 Vue / DOM） */
export interface DebugWindowInput {
  /** 节点里存的 HTML（data.uiHtml；空 = 还没画，没什么可调试） */
  html: string
  /** 节点 id（写进标题与 __CANVAS_UI__.nodeId，副本要知道自己是谁） */
  nodeId: string
  /** 当前画布 id */
  canvasId: string
  /** 后台绝对地址（副本里的请求要用） */
  baseUrl: string
  /** 浅色还是深色（跟着画布主题走） */
  theme: 'light' | 'dark'
  /** 上游素材（与沙箱里那份同一份初值） */
  upstream: readonly unknown[]
  /** 输入参数（与沙箱里那份同一份初值） */
  inputs: Record<string, unknown>
  /** 画布主题色板（亮/暗两套） */
  palette?: unknown
}

/**
 * 拼出**调试副本**那份完整文档。
 *
 * **现已由独立调试页取代（2026-10-20）**：产品里的「调试」按钮改走
 * `POST /api/canvases/:id/debug-docs` + 独立源页面，不再 document.write 同源副本
 * （副本继承画布页的源，节点 HTML 里的脚本能读走管理令牌）。
 * 这里保留导出，是给**离线预览**与单测用的，不要再接回产品入口。
 *
 * 与沙箱里那份（buildSrcdoc）的差别只有两处，都是有意为之：
 *   1. **不注入 meta CSP** —— 副本是开发工具，不是发布物（见文件头）；
 *   2. **注入桥代码**（buildDebugBridge）—— 让副本也能收宿主的指令、
 *      也能把「参数 / 产物」报回来。少了它，副本就只是个不能动的截图。
 *
 * 其余（base / bootstrap 引导脚本 / shell 样式）与沙箱那份**逐字一致**，
 * 否则「调试看到的」与「画布上跑的」不是同一份东西，调试就失去意义。
 */
export function buildDebugDoc(input: DebugWindowInput): string {
  const theme = input.theme === 'dark' ? 'dark' : 'light'
  const base = baseHref(input.baseUrl)

  const uiPayload = {
    theme,
    baseUrl: input.baseUrl,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    // 标一份「这是调试副本」：生成物可以用它给自己加个角标（例如 DEBUG），
    // 免得开发者对着副本改半天，以为改的是画布上那个。
    debug: true,
    ...(input.palette ? { palette: input.palette } : {}),
  }

  const bootstrap =
    '<script>window[' + JSON.stringify(INPUTS_GLOBAL) + ']=' + serializeForScript(input.inputs) + ';' +
    'window[' + JSON.stringify(UPSTREAM_GLOBAL) + ']=' + serializeForScript(input.upstream) + ';' +
    'window[' + JSON.stringify(UI_GLOBAL) + ']=' + serializeForScript(uiPayload) + ';</script>'

  const head =
    '<meta charset="utf-8">' +
    (base ? '<base href="' + base + '">' : '') +
    '<style>' + SHELL_STYLE + '</style>' +
    bootstrap +
    buildDebugBridge()

  const body = input.html.trim()

  // 完整文档：插进 head 之后（与 buildSrcdoc 同一套判据）
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

  return '<!DOCTYPE html><html data-theme="' + theme + '"><head>' + head + '</head><body>' + body + '</body></html>'
}

/**
 * 调试副本的 <base href>（与 uiData 里 baseTagHref 同一套算法）。
 *
 * 为什么副本也必须有它：副本在 about:blank 里，没有 base 的话相对地址
 * 全部解析不出来。给了 base，页面里写相对地址也能落到后台。
 */
function baseHref(raw?: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw)
    return u.origin + (u.pathname.endsWith('/') ? u.pathname : u.pathname + '/')
  } catch {
    return ''
  }
}


/**
 * 调试副本（离线预览用）里的助手 window.CanvasUI。
 *
 * ## 现状：这不是产品里那个「调试」按钮走的路
 *
 * 2026-10-20 起，画布上的「调试」按钮打开的是**独立调试页**（另起一个端口，
 * 见 `debugDocServer.ts` / `debugDocAssets.ts`），不再是这里拼出来的同源副本。
 * 原因很直接：`about:blank` 副本继承画布页的源，节点 HTML 里的脚本能读走管理令牌。
 *
 * `buildDebugDoc` / `buildDebugBridge` 保留下来，是给**离线预览**和单测用的
 * （`uiDebug.test.ts` 靠它钉住"数据与沙箱那份一致"）。不要再拿它开产品入口。
 *
 * ## 为什么副本的 save 要让宿主代传
 *
 * 副本与画布上那个沙箱节点是**两份独立的运行实例**。如果副本里的 CanvasUI.save
 * 直接往后端写，它会：
 *   · 把产物写进同一个槽位，覆盖掉画布上那份；
 *   · 绕过宿主的 updateNode，于是撤销栈、落盘、云端同步全不认这笔写入。
 *
 * 所以桥**只往宿主报**（__canvasUiDebug 标记），由宿主决定要不要真的落进节点。
 *
 * ## 与沙箱那份（buildUiBridge）的差别
 *
 *   · 目标不是 parent（副本窗口里没有 iframe），而是 **window.opener**；
 *     opener 不存在（例如直接把文档存成文件打开）就**不发**，也不等回包；
 *   · 收宿主的回包要认 __canvasUiDebugResult（与 save 那条链同一个标记）；
 *   · save 的字节由**宿主代传**（副本自己不 fetch 上传）。
 */
export function buildDebugBridge(): string {
  const S = String.fromCharCode(39)
  const lines = [
    '<script>',
    '(function(){',
    '  var U = window[' + JSON.stringify(UI_GLOBAL) + '] || {};',
    // 副本是 window.open 出来的普通窗口：宿主是 opener，不是 parent。
    '  var HOST = window.opener || null;',
    '  function post(msg){ if (HOST) { try { HOST.postMessage(msg, ' + S + '*' + S + '); } catch (e) {} } }',
    '  var cmdHandlers = [];',
    // 副本也走宿主代发：每条请求带 reqId，宿主回 __canvasUiDebugResult / task-event。
    '  var seq = 0, pending = {};',
    '  function hostCall(type, fields, opts){',
    '    opts = opts || {};',
    '    return new Promise(function(resolve, reject){',
    '      var id = ' + S + 'h' + S + ' + (++seq);',
    '      pending[id] = { resolve: resolve, reject: reject };',
    '      fields = fields || {};',
    '      fields.__canvasUiDebug = 1; fields.type = type; fields.reqId = id;',
    '      if (opts.onLog || opts.onProgress) {',
    '        pending[id].onTaskEvent = function(ev){',
    '          if (ev.type === ' + S + 'log' + S + ' && opts.onLog) opts.onLog(ev.line);',
    '          else if (ev.type === ' + S + 'progress' + S + ' && opts.onProgress) opts.onProgress(ev.value);',
    '        };',
    '      }',
    '      post(fields);',
    '    });',
    '  }',
    '  function settle(m){',
    '    var p = pending[m.reqId]; if (!p) return;',
    '    delete pending[m.reqId];',
    '    if (m.ok === false) p.reject(new Error(m.error || ' + S + '宿主代发失败' + S + '));',
    '    else p.resolve(m);',
    '  }',
    '  function ready(){ post({ __canvasUiDebug: 1, type: ' + S + 'ready' + S + ' }); }',
    '  window.addEventListener(' + S + 'message' + S + ', function(e){',
    '    if(!HOST || e.source !== HOST) return;',
    '    var d = e.data; if(!d) return;',
    // 宿主回包用的标记是 __canvasUiDebugResult（save 那条链一直是它）；
    // 两个标记都要认，否则 task / cancel 的 Promise 永远不结算。
    '    if ((d.__canvasUiDebug === 1 || d.__canvasUiDebugResult === 1) && d.reqId) {',
    '      if (d.type === ' + S + 'task-event' + S + ') {',
    '        var pe = pending[d.reqId]; if (pe && pe.onTaskEvent) pe.onTaskEvent(d.event || {});',
    '        return;',
    '      }',
    '      settle(d); return;',
    '    }',
    '    if(!d.__canvasUiCmd) return;',
    '    for(var i = 0; i < cmdHandlers.length; i++){',
    '      try { cmdHandlers[i](d); } catch(err) {}',
    '    }',
    '  });',
    '  ready();',
    '  if(document.readyState === ' + S + 'loading' + S + '){',
    '    document.addEventListener(' + S + 'DOMContentLoaded' + S + ', ready);',
    '  }',
    '  window.addEventListener(' + S + 'load' + S + ', ready);',
    '  window[' + JSON.stringify(BRIDGE_GLOBAL) + '] = {',
    '    setInputs: function(params){ post({ __canvasUiDebug: 1, type: ' + S + 'state' + S + ', state: params }); },',
    '    onChange: function(fn){',
    '      cmdHandlers.push(function(d){',
    '        if (d.type === ' + S + 'data' + S + ') fn({ upstream: d.upstream, inputs: d.inputs });',
    '      });',
    '    },',
    // 交产物：字节交给宿主传，副本不自己 fetch（见文件头）
    '    save: function(data, name){',
    '      var fname = String(name || ' + S + 'out.png' + S + ');',
    '      var withExt = /\./.test(fname) ? fname : fname + ' + S + '.png' + S + ';',
    '      return new Promise(function(resolve, reject){',
    '        var reqId = ' + S + 'r' + S + ' + Date.now() + Math.random();',
    '        var onMsg = function(ev){',
    '          if (!HOST || ev.source !== HOST) return;',
    '          var d = ev.data;',
    '          if (!d || !d.__canvasUiDebugResult || d.reqId !== reqId) return;',
    '          window.removeEventListener(' + S + 'message' + S + ', onMsg);',
    '          if (d.ok) {',
    // 宿主已经落进节点了：再报一条 saved，让宿主那边能弹提示 / 做 UI 反应。
    '            var done = { __canvasUiDebug: 1, type: ' + S + 'saved' + S + ', url: d.url, name: withExt };',
    '            if (typeof data === ' + S + 'string' + S + ') done.text = data;',
    '            post(done);',
    '            resolve(d.url);',
    '          } else reject(new Error(d.error || ' + S + '宿主没有接收这次产物' + S + '));',
    '        };',
    '        window.addEventListener(' + S + 'message' + S + ', onMsg);',
    '        if (typeof data === ' + S + 'string' + S + ') {',
    '          post({ __canvasUiDebug: 1, type: ' + S + 'save' + S + ', reqId: reqId, name: withExt,',
    '            payload: new Blob([data], { type: ' + S + 'text/plain' + S + ' }), text: data });',
    '          return;',
    '        }',
    // 二进制：Blob / Uint8Array / ArrayBuffer 都能结构化克隆，直接交给宿主
    '        post({ __canvasUiDebug: 1, type: ' + S + 'save' + S + ', reqId: reqId, name: withExt, payload: data });',
    '      });',
    '    },',
    // 叫后台干活：也走宿主代发（统一带令牌，副本不必自己知道令牌）
    '    task: function(name, methods, args, opts){',
    '      opts = opts || {};',
    '      return hostCall(' + S + 'task' + S + ', { name: String(name), methods: String(methods),',
    '        args: args || [], wait: opts.wait === true,',
    '        subscribe: !!(opts.onLog || opts.onProgress) && opts.wait !== true }, opts).then(function(j){',
    '          if (j.ok === false) throw new Error(j.error || ' + S + '脚本跑失败了' + S + ');',
    '          return j;',
    '        });',
    '    },',
    '    cancel: function(runId){',
    '      return hostCall(' + S + 'task-cancel' + S + ', { runId: runId }).catch(function(err){',
    '        return { ok: false, error: (err && err.message) || err }; });',
    '    },',
    '  };',
    '})();',
    '<\/script>',
  ]
  return lines.join('\n')
}

