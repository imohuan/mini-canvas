/**
 * node-ui 后台：功能函数列出 / 查询 / 调用。
 * 从 server.ts 的 apply 原样迁出，注册顺序与 handler 不变。
 */
import type { ServerCtx } from './shared-types.js'
import { ensureVirtualCanvas } from './virtualCanvas.js'
import { waitRun } from './waitRun.js'
import { listDraftScripts, listFunctions, runScript, scriptDocs, scriptMethods } from '../task/runs.js'
import { isDraftScriptName } from '../task/scripts.js'
import { resolveTaskScriptsDir } from '../task/routes.js'
import { describeFunction } from '../task/fnDoc.js'

export function applyFunctions(ctx: ServerCtx): void {

  // ==================== 后台功能函数：列出 / 查 / 调用（用户 2026-10-14 口径）====================
  //
  // 用户原话：「梳理每个可视化节点可能导出的后台接口或扩展工具函数」，写清
  // 「工具做什么 / 输入参数有哪些 / 返回结果是什么 / 调用示例」，并且
  // 「MCP 可直接调用这些后台接口；调用时不需要外部传 Canvas ID / Node ID」；
  // 另要「列出所有功能函数」「调用指定功能函数」「可选：查询参数与返回值 schema」。
  //
  // 关于「不传 Canvas ID / Node ID」：脚本的 ctx 里本来要这两个（用来回写画布）。
  // 既然调用方不必提供，就由这里**造一张虚拟画布**顶上（见 virtualContext）——
  // 虚拟画布的 id 固定带前缀，与用户真实画布不冲突，也不会污染任何真画布。
  //
  // 关于「要不要声明依赖」：`/api/task/call` 那道 403 是给**节点界面**设的（防界面乱调机器上的脚本）。
  // 这里的调用方是 Agent 本人（MCP），它要的是「跑一下看返回什么」，没有节点可声明 ——
  // 所以直接走 runScript（与路由同一个执行体）而不过那道校验。**这不是绕过权限**：
  // 能调 MCP 的人本来就能读画布、能建节点、能调生成；脚本清单本来就是给 Agent 发现的
  // （见 canvas_fn_list）。护栏仍在两处：脚本名白名单 + 跑在虚拟画布上。

  // ⑨ 列出全部功能函数（脚本 × 函数 × 说明书）
  ctx.mcp.tool({
    name: 'canvas_fn_list',
    description:
      '列出**这台机器上所有能调的后台功能函数**（task-scripts 里每个脚本导出的每个函数）。' +
      '每个函数带上它的说明书：做什么 / 参数 / 返回 / 示例（作者写了才有；没写会标出来）。' +
      '用它来回答「有哪些后台能力可以用」，或者照着挑一个用 canvas_fn_call 调。' +
      'keyword 可按脚本名 / 函数名 / 说明过滤。',
    input: { keyword: 'string' },
    handler: async (args) => {
      const dir = resolveTaskScriptsDir(ctx)
      const all = await listFunctions(dir)
      // 在建脚本（下划线打头）不进上面的清单 —— 但要让作者知道它们**存在**且没验完，
      // 否则他会以为自己的脚本没了。见 guide 的 0.3 那三条约定。
      const drafts = await listDraftScripts(dir)
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : ''
      const hit = keyword
        ? all.filter((f) => f.script.includes(keyword) || f.fn.includes(keyword) || (f.what ?? '').includes(keyword))
        : all
      return {
        ok: true,
        total: all.length,
        shown: hit.length,
        functions: hit,
        text: hit.length ? hit.map(describeFunction).join('\n') : '（没有匹配的功能函数）',
        // 在建脚本单独报一句：它们不在上面那份清单里，但确实存在（作者要知道）
        ...(drafts.length
          ? {
              drafts: drafts.map((x) => x.name),
              draftHint:
                '这些是**在建脚本**（文件名下划线打头、未验证），故意不进上面的可用清单：' +
                drafts.map((x) => x.name + '（可调：' + (x.methods.join('、') || '没有导出函数') + '）').join('；') +
                '。要测它们就把名字直接传给 canvas_fn_call（带下划线即可）；跑通了把下划线去掉，它就成了可用脚本。',
            }
          : {}),
        // 「没写说明书」不该只是一句抱怨 —— 给出**照着能改**的做法（用户口径要「给例子」）。
        // 说明书由**脚本作者**写在脚本里（AI 改不了服务器上的文件），所以这句是写给"用户/作者"看的。
        ...(hit.some((f) => !f.what)
          ? {
              missingDocs: hit.filter((f) => !f.what).map((f) => f.script + '.' + f.fn),
              howToAddDocs:
                '想让上面这些函数也带上说明（做什么 / 参数 / 返回 / 示例），在脚本里 export 一个 docs 对象即可，' +
                '照 <数据根>/task-scripts/demo.mjs 那份抄（它每一行都有注释）：' +
                'export const docs = { run: { what: "...", args: [{ name: "width", type: "number", required: true, desc: "..." }], returns: "...", example: "run(640)" } }',
            }
          : {}),
      }
    },
  })

  // ⑩ 查一个函数的参数与返回值（「可选：查询功能函数的参数与返回值 schema」）
  ctx.mcp.tool({
    name: 'canvas_fn_info',
    description:
      '查某个后台功能函数的详情：它做什么、输入参数有哪些（名字 / 类型 / 是否必填 / 说明）、' +
      '返回什么、怎么调用（示例）。给 script（脚本名）与 fn（函数名）。' +
      '说明文字来自脚本作者写的 docs；没写就只能列出参数名（按真实导出）。',
    input: { script: 'string', fn: 'string' },
    required: ['script'],
    handler: async (args) => {
      const dir = resolveTaskScriptsDir(ctx)
      const script = typeof args.script === 'string' ? args.script.trim() : ''
      const fn = typeof args.fn === 'string' ? args.fn.trim() : ''
      if (!script) return { ok: false, error: '缺少 script（脚本名，不带 .mjs）' }
      const docs = await scriptDocs(dir, script)
      const methods = await scriptMethods(resolveTaskScriptsDir(ctx), script)
      if (!methods) return { ok: false, error: '拿不到脚本的方法（不存在 / 加载失败）：' + script }
      if (!fn) {
        return { ok: true, script, functions: methods.map((m) => ({ fn: m, ...(docs[m] ?? {}) })) }
      }
      if (!methods.includes(fn)) {
        return {
          ok: false,
          error: '脚本 ' + script + ' 里没有导出函数 ' + fn + '（可用的：' + methods.join('、') + '）',
        }
      }
      return { ok: true, script, fn, ...(docs[fn] ?? {}), args: docs[fn]?.args ?? [] }
    },
  })

  // ⑪ 调用指定功能函数（**不必传 Canvas ID / Node ID**）
  ctx.mcp.tool({
    name: 'canvas_fn_call',
    description:
      '直接调用一个**后台功能函数**（task-scripts 里的 script.fn），把结果拿回来。' +
      'args 是位置参数数组（按 canvas_fn_info 给的顺序）；wait 缺省为真 = 等它跑完并回结果。' +
      '**不需要传 Canvas ID / Node ID** —— 这类函数要它们只是为了"回写画布"，' +
      '而这里由工具自己造一张虚拟画布顶上，专门给你取返回值用。' +
      '先 canvas_fn_list / canvas_fn_info 看清参数与返回，再来调。' +
      '★ script 允许**下划线打头**：那是在建脚本（还没验证），这样你才能测自己刚写的那份；' +
      '测通过之后把下划线去掉，它才会出现在 canvas_fn_list 里给别人用。',
    input: { script: 'string', fn: 'string', argsJson: 'string', wait: 'boolean', timeoutMs: 'number' },
    required: ['script', 'fn'],
    handler: async (args) => {
      const script = typeof args.script === 'string' ? args.script.trim() : ''
      const fn = typeof args.fn === 'string' ? args.fn.trim() : ''
      if (!script) return { ok: false, error: '缺少 script（脚本名，不带 .mjs）' }
      if (!fn) return { ok: false, error: '缺少 fn（要调的函数名）' }
      let callArgs: unknown[] = []
      if (typeof args.argsJson === 'string' && args.argsJson.trim()) {
        try {
          const parsed = JSON.parse(args.argsJson)
          if (!Array.isArray(parsed)) return { ok: false, error: 'argsJson 必须是 JSON 数组，例如 "[640, \"x.png\"]"' }
          callArgs = parsed
        } catch (err) {
          return { ok: false, error: 'argsJson 不是合法 JSON：' + (err instanceof Error ? err.message : String(err)) }
        }
      }
      const dir = resolveTaskScriptsDir(ctx)
      const methods = await scriptMethods(dir, script)
      if (!methods) return { ok: false, error: '拿不到脚本的方法（不存在 / 加载失败）：' + script }
      if (!methods.includes(fn)) {
        return { ok: false, error: '脚本 ' + script + ' 里没有导出函数 ' + fn + '（可用的：' + methods.join('、') + '）' }
      }
      // 虚拟画布上下文：见文件末尾 virtualContext 的说明（不碰任何真画布）
      const vctx = await ensureVirtualCanvas(ctx)
      const wait = args.wait !== false
      const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : undefined
      const started = await runScript({
        dir,
        name: script,
        methods: fn,
        args: callArgs,
        canvasId: vctx.canvasId,
        nodeId: vctx.nodeId,
        baseUrl: ctx.tryGet<string>('selfOrigin') ?? '',
        dataRoot: ctx.tryGet<{ dataRoot?(): string }>('canvasStore')?.dataRoot?.() ?? '',
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      })
      if (!started.ok) return { ok: false, error: started.error }
      if (!wait) return { ok: true, runId: started.run.runId, state: started.run.state, canvasId: vctx.canvasId, nodeId: vctx.nodeId }
      // 等待比脚本自己的超时**多留 5 秒**：脚本超时那一刻会由它的超时器收成 error 并落进运行表，
      // 擦边相等的话我们会先一步判成「还在跑」，把它自己的报错盖掉（报出来的就成了「等超时了」）。
      const scriptTimeout = timeoutMs ?? 10 * 60 * 1000
      const final = await waitRun(started.run.runId, scriptTimeout + 5000)
      return {
        ok: final.state === 'done',
        script,
        fn,
        // 在建脚本（下划线打头）如实标出来：这次是"作者在测自己的东西"，不是"用了别人的成品"
        ...(isDraftScriptName(script)
          ? {
              draft: true,
              draftNote:
                '这次调的是**在建脚本**（下划线打头、还没验证）。跑通之后把 ' + script + '.mjs 改名为 ' +
                script.slice(1) + '.mjs，它才会进 canvas_fn_list 的可用清单。',
            }
          : {}),
        ...(final.state === 'error' ? { error: final.error } : { result: final.result }),
        logs: final.tail.slice(-20),
        state: final.state,
        virtualCanvasId: vctx.canvasId,
        note: '这次调用跑在一张虚拟画布上（只为取返回值）；产物写在它名下，不碰你的画布。',
      }
    },
  })
}

