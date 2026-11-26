/**
 * node-ui 后台：给 AI 的基础工具（guide / write / update / read / package）。
 * 从 server.ts 的 apply 原样迁出，注册顺序与 handler 不变。
 */
import type { AssetStoreLike, ServerCtx } from './shared-types.js'
import { describeNode, nodesOf, uiNodeOf, writeUiHtml } from './canvasAccess.js'
import { nodeDocOf, describeNodeDoc } from '../task/nodeDoc.js'
import { planDeclared, UI_SCRIPTS_KEY } from '../task/declarePlan.js'
import { lintUiHtml } from '../task/uiLint.js'
import { readUiConfig } from '../uiConfig.js'
import { listAllScriptNames } from '../task/scripts.js'
import { isDraftScriptName, resolveScriptPath } from '../task/scripts.js'
import { inspectScript } from '../task/inspect.js'
import { normalizeScriptDocs } from '../task/fnDoc.js'
import { formatScriptList, resolveTaskScriptsDir } from '../task/routes.js'
import { listScripts } from '../task/runs.js'
import GUIDE from '../guide.md?raw'

/** 手册里最多列多少个节点（防大画布把工具返回撑爆） */
const MAX_LISTED_NODES = 60

/**
 * 写完界面**当场按规范检查一遍**（用户 2026-11-26：这部分要用代码检查，不能靠 AI）。
 *
 * 检查放在「声明已经算好之后」：这样「调了没声明的脚本」这条会立刻暴露，
 * 而不是等用户点按钮 403 才发现。机器上的脚本清单现读，读不到就当不知道（不误报）。
 */
async function lintAfterWrite(
  ctx: ServerCtx,
  html: string,
  declared: unknown,
): Promise<{ ok: boolean; errors: string[]; warnings: string[]; text: string }> {
  const declaredNames =
    declared && typeof declared === 'object' && !Array.isArray(declared)
      ? Object.keys(declared as Record<string, unknown>)
      : []
  let known: string[] | undefined
  try {
    known = await listAllScriptNames(resolveTaskScriptsDir(ctx))
  } catch {
    known = undefined
  }
  const r = lintUiHtml(html, {
    declaredScripts: declaredNames,
    ...(known ? { knownScripts: known } : {}),
    // 运行档位：允许联网时「引用外部脚本/组件库」只提醒、不判死
    allowNetwork: readUiConfig(ctx.tryGet<{ get(k: string): unknown }>('settings')).netEnabled,
  })
  return {
    ok: r.ok,
    errors: r.errors.map((e) => '[' + e.rule + '] ' + e.message),
    warnings: r.warnings.map((w) => '[' + w.rule + '] ' + w.message),
    // 给 AI 的一句结论：有错写「必须改」，只有警告写「建议改」；全干净就是空串
    text: r.ok
      ? r.warnings.length
        ? '界面已写入。规范检查有 ' + r.warnings.length + ' 条建议（不改也能跑）：\n' +
          r.warnings.map((w) => '  ! ' + w.message).join('\n')
        : ''
      : '界面已写入，但规范检查没通过（这些不修会出问题）：\n' +
        r.errors.map((e) => '  ✗ ' + e.message).join('\n') +
        (r.warnings.length ? '\n建议：\n' + r.warnings.map((w) => '  ! ' + w.message).join('\n') : ''),
  }
}

export function applyTools(ctx: ServerCtx): void {

  // ② 给 AI 的手册（含这张画布现有的节点）
  ctx.mcp.tool({
    name: 'canvas_ui_guide',
    description:
      '读「怎么给可视化节点画界面」的手册：它是什么、内容写进哪、HTML 跑在什么环境、' +
      '必须遵守哪些约定、能调哪些接口。给可视化节点画东西之前**先调它**。' +
      '里面还有**实时**清单：这张画布的节点、这台机器上的脚本、以及前后端完整接口表。' +
      '用户一提「可视化节点 / ui 节点 / 面板 / 预览器」，第一个动作就应该是它。' +
      '⚠️ 别去翻项目源码（那是实现、随时会变；本手册是稳定契约）。' +
      '⚠️ 动手前先照手册第〇节**跟用户确认需求**（只展示还是要干活），别埋头就写。',
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
      // 任务脚本的**实时清单**：AI 靠它知道「这台机器上现在能叫后台做什么」。
      // 每次现读目录（不缓存）：用户往 task-scripts 放一个文件，下一次读手册就该看得见。
      let tasks = ''
      try {
        const scripts = await listScripts(resolveTaskScriptsDir(ctx))
        tasks =
          '\n\n## 这台机器上的任务脚本（实时）\n\n' +
          formatScriptList(scripts) +
          '\n\n（要新动作 = 往 task-scripts 放一个 .mjs；脚本是用户写的，AI 只负责调。）'
      } catch (err) {
        tasks = '\n\n（任务脚本清单读取失败：' + String(err) + '）'
      }
      return { ok: true, guide: GUIDE + list + tasks }
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
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      const html = typeof args.html === 'string' ? args.html : ''
      if (!html.trim()) return { ok: false, error: '缺少 html（要写的界面内容）' }

      // 双保险（用户 2026-10-13 确认）：顺手扫一遍这段界面调了哪些脚本，补进节点声明。
      //
      // 为什么必须兜：AI 会忘写声明，忘了的后果是"界面画出来了、用户点一下 403"，
      // 而 AI 从画面上看不出哪里错 —— 那种坏法最难查。
      //
      // ⚠️ 声明必须并进**同一次写盘**。第一版让它自己去读 doc、再单独写一次 ——
      // 真机上那条路读不到东西，于是静默什么都不做（界面照写、返回值正常、声明空着）。
      // 现在：先问 plan（纯计算，拿 node.data 当输入），再和 uiHtml 一起交上去。
      const plan = await planDeclared(html, node.data?.[UI_SCRIPTS_KEY], resolveTaskScriptsDir(ctx), Date.now())
      const res = await writeUiHtml(ctx, canvasId, nodeId, {
        uiHtml: html,
        uiGeneratedAt: Date.now(),
        uiBy: 'mcp',
        ...(plan ? { [UI_SCRIPTS_KEY]: plan.next } : {}),
      })
      if (!res.ok) return { ok: false, error: res.error ?? '写入失败' }
      // 写完当场按规范检查（不靠 AI 自己记）
      const lint = await lintAfterWrite(ctx, html, plan ? plan.next : node.data?.[UI_SCRIPTS_KEY])
      return {
        ok: true,
        nodeId,
        canvasId,
        bytes: html.length,
        // 把"我替你补了哪些"回给 AI —— 它下次就知道该自己写上（声明仍是它的责任）
        ...(plan ? { declaredScripts: plan.added } : {}),
        lint: { ok: lint.ok, errors: lint.errors, warnings: lint.warnings },
        ...(lint.text ? { lintText: lint.text } : {}),
      }
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
      const oldText = typeof args.old === 'string' ? args.old : ''
      const newText = typeof args.new === 'string' ? args.new : ''
      if (!oldText) return { ok: false, error: '缺少 old（要改掉的现有代码片段）' }
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
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
      // 同 canvas_ui_write：局部改也可能引入一次新的脚本调用（加了段 fetch），照样兜一下。
      // 声明与 uiHtml 并进**同一次写**（理由见上面那段注释）。
      const plan = await planDeclared(next, node.data?.[UI_SCRIPTS_KEY], resolveTaskScriptsDir(ctx), Date.now())
      const res = await writeUiHtml(ctx, canvasId, nodeId, {
        uiHtml: next,
        uiGeneratedAt: Date.now(),
        uiBy: 'mcp',
        ...(plan ? { [UI_SCRIPTS_KEY]: plan.next } : {}),
      })
      if (!res.ok) return { ok: false, error: res.error ?? '写入失败' }
      const lint = await lintAfterWrite(ctx, next, plan ? plan.next : node.data?.[UI_SCRIPTS_KEY])
      return {
        ok: true,
        nodeId,
        canvasId,
        replaced: count,
        bytes: next.length,
        ...(plan ? { declaredScripts: plan.added } : {}),
        lint: { ok: lint.ok, errors: lint.errors, warnings: lint.warnings },
        ...(lint.text ? { lintText: lint.text } : {}),
      }
    },
  })

  // ④ 读：改之前先看一眼现状
  ctx.mcp.tool({
    name: 'canvas_ui_read',
    description:
      '读某个可视化节点：现在渲染的 HTML、它的**功能说明书**（做什么 / 效果 / 输入 / 输出）、' +
      '以及它声明依赖的后台脚本。改之前先看一眼，避免把用户满意的东西改掉。' +
      'html 是空字符串 = 这个节点还没画过。',
    input: { canvasId: 'string', nodeId: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      const html = typeof node.data?.uiHtml === 'string' ? node.data.uiHtml : ''
      const doc = nodeDocOf(node.data)
      const declared = node.data?.[UI_SCRIPTS_KEY]
      return {
        ok: true,
        nodeId,
        canvasId,
        type: node.type,
        html,
        empty: !html,
        ...(doc ? { doc } : {}),
        docText: describeNodeDoc(doc),
        ...(declared && typeof declared === 'object' ? { scripts: Object.keys(declared) } : {}),
      }
    },
  })

  /**
   * ④b **验收工具**：一个节点到底合不合格，用它一次问清。
   *
   * 为什么单独开一条（用户 2026-11-26）：「写完之后必须代码验证一下（你可以提供一个单独的
   * MCP 进行验证）」。canvas_ui_write 的 lint 只管**这一份 HTML**；这里管**整个节点**：
   * 界面规不规范、依赖声明的脚本在不在机器上、说明书写了没、产物有没有落在槽位。
   *
   * 为什么必须能单独调：AI 可能是分几步改的（先写界面、再补声明、再写说明书），
   * 中间任何一步之后都该能重新验一次，而不必再写一遍界面。
   */
  ctx.mcp.tool({
    name: 'canvas_ui_check',
    description:
      '**验收**一个可视化节点：逐项检查它是否符合规范，返回 problems（必须改）/ warnings（建议改）/ checks（逐项结果）。' +
      '查七件事：① 界面本身（外链、直接 fetch、缺 onChange、onChange 不理上游、从不交参数、没读 __CANVAS_UI__）；' +
      '② 界面调的脚本有没有声明、机器上有没有那份脚本；③ 声明的脚本里有没有机器上已经不存在的；' +
      '④ 有没有写功能说明书（uiNodeDoc，用 canvas_ui_describe 补）；⑤ 有没有产物落在本节点槽位；' +
      '⑥ 节点是不是可视化节点；⑦ 界面是不是空的。' +
      '写完界面、补完声明、写说明书之后，都该调一次它；`ok: true` 才算交付。',
    input: { canvasId: 'string', nodeId: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      const html = typeof node.data?.uiHtml === 'string' ? node.data.uiHtml : ''
      const declaredRaw = node.data?.[UI_SCRIPTS_KEY]
      const declared =
        declaredRaw && typeof declaredRaw === 'object' && !Array.isArray(declaredRaw)
          ? Object.keys(declaredRaw as Record<string, unknown>)
          : []
      let known: string[] | undefined
      try {
        known = await listAllScriptNames(resolveTaskScriptsDir(ctx))
      } catch {
        known = undefined
      }
      const lint = lintUiHtml(html, {
        declaredScripts: declared,
        ...(known ? { knownScripts: known } : {}),
        allowNetwork: readUiConfig(ctx.tryGet<{ get(k: string): unknown }>('settings')).netEnabled,
      })
      const doc = nodeDocOf(node.data)
      const problems: string[] = []
      const warnings: string[] = []
      const checks: Array<{ name: string; ok: boolean; detail: string }> = []
      const note = (name: string, ok: boolean, detail: string): void => {
        checks.push({ name, ok, detail })
        if (ok) return
        if (name.startsWith('界面·')) problems.push(detail)
        else warnings.push(detail)
      }

      note('界面·非空', !!html.trim(), html.trim() ? '有界面内容' : '界面是空的：先用 canvas_ui_write 写一段自包含 HTML')
      for (const e of lint.errors) note('界面·error', false, '[' + e.rule + '] ' + e.message)
      for (const w of lint.warnings) note('界面·warn', false, '[' + w.rule + '] ' + w.message)
      if (!lint.errors.length && !lint.warnings.length) note('界面·规范', true, '规范检查通过')

      // 声明里有、机器上没有：打包会缺脚本，界面调它也会失败
      if (known) {
        const missing = declared.filter((n) => !known.includes(n))
        note(
          '脚本·都在机器上',
          missing.length === 0,
          missing.length ? '节点声明了这些脚本，但 task-scripts/ 里没有：' + missing.join('、') : '声明的脚本都在',
        )
      }

      /*
       * 脚本本身也要验（用户 2026-11-26：「我是要对脚本和节点都进行检查」）。
       *
       * 只查「文件在不在」是不够的：一个脚本可能 import 就报错、可能一个函数都没导出、
       * 可能导出了却没写 docs。这三种在界面上都表现为「点了没反应 / 报看不懂的错」，
       * 所以在这里逐条列清楚。每个脚本都会真起一个短命子进程 import 一次（与
       * canvas_fn_list 同一条路），所以语法错也能被抓到。
       */
      const scriptReports: Array<{
        name: string
        draft: boolean
        ok: boolean
        methods: string[]
        undocumented: string[]
        error?: string
      }> = []
      for (const name of declared) {
        const report: (typeof scriptReports)[number] = {
          name,
          draft: isDraftScriptName(name),
          ok: false,
          methods: [],
          undocumented: [],
        }
        /*
         * ⚠️ 一次 import 就要把「函数名 + 说明书」都取回来。
         *
         * 这里是 review 抓到的：首版先调 scriptMethods、再调 scriptDocs，那个脚本会被
         * **import 两遍**（每次 inspect 都是一个子进程）。用户脚本可能有几十毫秒的顶层开销，
         * 声明里挂 5 个脚本 = 多起 5 个进程、慢一倍；更糟的是「两次结果可能不一致」——
         * 中间有人改了文件，就会出现「有函数但 docs 是旧的」。
         * inspectScript 本来就一次带回了 methods 和 docs，这里直接用。
         */
        const abs = resolveScriptPath(resolveTaskScriptsDir(ctx), name)
        const inspected = abs ? await inspectScript(abs) : undefined
        if (!inspected || !inspected.ok) {
          report.error = '拿不到这个脚本的导出函数（文件不存在 / 语法错 / 加载失败）'
          scriptReports.push(report)
          note('脚本·' + name + ' 能加载', false, '脚本 ' + name + '：' + report.error)
          continue
        }
        const methods = inspected.methods
        report.ok = true
        report.methods = methods
        if (methods.length === 0) {
          report.error = '一个函数都没导出（脚本里要 export 能调的函数）'
          scriptReports.push(report)
          note('脚本·' + name + ' 有可调函数', false, '脚本 ' + name + '：' + report.error)
          continue
        }
        const docs = normalizeScriptDocs(inspected.docs)
        report.undocumented = methods.filter((fn) => !docs[fn]?.what)
        scriptReports.push(report)
        note(
          '脚本·' + name + ' 有可调函数',
          true,
          '脚本 ' + name + ' 导出了：' + methods.join('、') + (report.draft ? '（在建：去掉下划线才算可用）' : ''),
        )

        note(
          '脚本·' + name + ' 有说明书',
          report.undocumented.length === 0,
          report.undocumented.length
            ? '脚本 ' + name + ' 里这些函数没写 docs：' + report.undocumented.join('、') +
              '。在脚本里加 export const docs = { ' + report.undocumented[0] + ': { what, args, returns, example } }，' +
              'Agent 才知道怎么调。'
            : '脚本 ' + name + ' 的函数说明书齐全',
        )
      }

      note(
        '说明书',
        !!doc,
        doc
          ? '说明书已写：' + (doc.what ?? '')
          : '没写功能说明书（uiNodeDoc）。用 canvas_ui_describe 补一句「做什么 / 效果 / 输入 / 输出」，收藏和复用时别人才能看懂',
      )

      /*
       * 产物：**地址或引用都算**。
       *
       * 为什么不能只看地址：节点保存时会把「地址」这类投影删掉、只留引用（`resourceId`）——
       * 那是 2026-11-20 定的规矩，不是没产物。只看 uiOutputUrl / imageUrl 会把
       * 已经出过图、地址被清理掉的节点误判成「还没有产物」（本工具首版就踩了，真机核对时发现）。
       */
      const outUrl = [node.data?.uiOutputUrl, node.data?.imageUrl, node.data?.videoUrl, node.data?.audioUrl].find(
        (v) => typeof v === 'string' && v,
      ) as string | undefined
      const outRef = typeof node.data?.resourceId === 'string' && node.data.resourceId
        ? (node.data.resourceId as string)
        : undefined
      const hasOutput = !!outUrl || !!outRef
      note(
        '产物·已落在节点',
        hasOutput,
        outUrl
          ? '产物地址：' + outUrl
          : outRef
            ? '产物引用：' + outRef + '（地址是它的投影，保存时会被清掉，所以这里只看引用）'
            : '这个节点还没有产物（点一次生成、或让界面 save 一次再看；纯展示节点可以忽略这一条）',
      )

      return {
        ok: problems.length === 0,
        canvasId,
        nodeId,
        problems,
        warnings,
        checks,
        declaredScripts: declared,
        ...(known ? { missingScripts: declared.filter((n) => !known.includes(n)) } : {}),
        scripts: scriptReports,
        docText: describeNodeDoc(doc),
      }
    },
  })

  // ⑤ 打包：把「这个节点 + 它依赖的脚本」收成一个包，放进资产库。
  //
  //     为什么要给 AI 这个工具：它写完界面与脚本之后，成品就这样**收进库**，
  //     下一张画布可以直接拖出来用 —— 不必等人去点右键。
  //     导出成文件（下载）仍走右键：那是一次浏览器下载，MCP 表达不了。
  ctx.mcp.tool({
    name: 'canvas_ui_package',
    description:
      '把某个**可视化节点**连同它依赖的后台脚本打成一个包，收进资产库（之后可以从左侧资源库拖到任何画布复用）。' +
      '包名默认取节点标题，可用 name 指定；folderId 指定存进哪个资产文件夹（不传 = 个人资产库根）。' +
      '只会带**节点声明过的**脚本（data.uiScripts）；声明里列了但机器上没有的，会在 missing 里如实报出来。' +
      '前提：这个节点得有界面内容（先 canvas_ui_write）。' +
      '⚠️ 收藏前建议先 canvas_ui_describe 写功能说明书 —— 库里没有说明书的包，别人只能靠猜。',
    input: { canvasId: 'string', nodeId: 'string', name: 'string', folderId: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked

      // 与 HTTP 那条路共用同一份打包逻辑（避免"两条路各写一遍"）
      try {
        const { buildNodePack } = await import('../task/pack.js')
        const dir = resolveTaskScriptsDir(ctx)
        const built = await buildNodePack(
          { id: node.id, type: node.type, ...(node.data ? { data: node.data } : {}) },
          dir,
          Date.now(),
        )
        const store = ctx.tryGet<{
          saveUpload(bytes: Uint8Array, name: string, folderId?: string): Promise<{ id: string; name: string; url: string }>
        }>('assetStore')
        if (!store || typeof store.saveUpload !== 'function') return { ok: false, error: '宿主没有资产服务，存不进库' }
        const wantedName = typeof args.name === 'string' && args.name ? args.name : built.manifest.name
        const fileName = wantedName.endsWith('.plumenode') ? wantedName : wantedName + '.plumenode'
        const folderId = typeof args.folderId === 'string' && args.folderId ? args.folderId : undefined
        const asset = await store.saveUpload(built.bytes, fileName, folderId)
        return {
          ok: true,
          nodeId,
          canvasId,
          assetId: asset.id,
          name: asset.name,
          url: asset.url,
          scripts: Object.keys(built.manifest.scripts),
          ...(built.manifest.missing.length ? { missing: built.manifest.missing } : {}),
          bytes: built.bytes.length,
          // 顺手回报有没有说明书：没有的话提醒一句（收藏的意义就是给别人复用）
          ...(nodeDocOf(node.data)
            ? { doc: describeNodeDoc(nodeDocOf(node.data)) }
            : { warning: '这个节点还没写功能说明书（canvas_ui_describe）。收藏进库之后，别人只能看包名猜它是干什么的。' }),
        }
      } catch (err) {
        return { ok: false, error: '打包失败：' + (err instanceof Error ? err.message : String(err)) }
      }
    },
  })
}

