/**
 * node-ui 后台：说明书 / 收藏 / 导出 / 从收藏建节点。
 * 从 server.ts 的 apply 原样迁出，注册顺序与 handler 不变。
 */
import { promises as fs } from 'node:fs'
import type { AssetStoreLike, ServerCtx } from './shared-types.js'
import { addNodeToCanvas, assetNameOf, uiNodeOf, writeUiHtml } from './canvasAccess.js'
import { NODE_DOC_KEY, describeNodeDoc, nodeDocOf } from '../task/nodeDoc.js'
import { saveToDownloads } from '../task/downloadDir.js'
import { PACK_EXT, readNodePack } from '../task/pack.js'
import { planImport } from '../task/importPack.js'
import { resolveScriptPath } from '../task/scripts.js'
import { resolveTaskScriptsDir } from '../task/routes.js'

export function applyFavorites(ctx: ServerCtx): void {

  // ==================== 可视化节点：说明书 + 收藏可复用（用户 2026-10-14 口径）====================
  // ⑤b 导出到**本机下载目录**（用户口径 2026-10-14：「调试通过之后自动打包成一个 zip 文件，
  //     保存到默认的下载地址。不然的话，你的这个节点一删，后台就完全没有意义了，
  //     还要重新写 HTML 代码」）。
  //
  //     与 canvas_ui_package 的区别：那条是收进**资产库**（能在画布间拖），
  //     这条是落成**本机文件**（节点删了也能靠它恢复）。两条都该做，用途不同。
  ctx.mcp.tool({
    name: 'canvas_ui_export',
    description:
      '把某个**可视化节点**（界面 + 它依赖的后台脚本）打包成一个 .mcnode 文件，' +
      '**自动保存到本机下载目录**，返回值里给绝对路径。' +
      '用途：给"这个节点 + 它的后台"留一份可带走的存档 —— 节点删了、画布没了，都能从它原样恢复。' +
      '★ 前后端调通之后**建议收尾就调它**（用户点名要的）。' +
      '同名文件已存在时不会覆盖，自动加 " (2)" 这样的后缀（旧那份是用户的保命符）。' +
      '想同时收进资产库（之后能从左侧资源库拖到别的画布）就再调 canvas_ui_package。' +
      '前提：这个节点得有界面内容（先 canvas_ui_write）。',
    input: { canvasId: 'string', nodeId: 'string', name: 'string' },
    required: ['nodeId'],
    handler: async (args) => {
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked
      try {
        const { buildNodePack } = await import('../task/pack.js')
        const dir = resolveTaskScriptsDir(ctx)
        const built = await buildNodePack(
          { id: node.id, type: node.type, ...(node.data ? { data: node.data } : {}) },
          dir,
          Date.now(),
        )
        const wanted = typeof args.name === 'string' && args.name ? args.name : built.manifest.name
        const saved = await saveToDownloads(built.bytes, wanted + PACK_EXT)
        return {
          ok: true,
          nodeId,
          canvasId,
          path: saved.path,
          dir: saved.dir,
          fileName: saved.fileName,
          bytes: saved.bytes,
          scripts: Object.keys(built.manifest.scripts),
          ...(built.manifest.missing.length ? { missing: built.manifest.missing } : {}),
          note:
            '已保存到下载目录：' + saved.path +
            '（节点删了也能从这个文件恢复；要能拖到别的画布用，再调一次 canvas_ui_package 收进资产库）',
        }
      } catch (err) {
        return { ok: false, error: '导出失败：' + (err instanceof Error ? err.message : String(err)) }
      }
    },
  })

  //
  // 用户原话：「每个可视化节点要有详细的功能描述，包括它自己的输入和输出」、
  // 「列出收藏的可视化节点」、「把收藏的可视化节点加到画布、建成节点」、
  // 「查这些节点各自能干什么（功能说明 + 输入 + 输出）」。
  //
  // 落点：说明书写在**节点 data 里**（键 NODE_DOC_KEY），随节点包一起走 ——
  // 收藏进库时进包、从库建节点时随节点还原、上面那些工具直接读它。

  // ⑥ 写说明书：把「这个节点是做什么的、要什么输入、给什么输出」写到节点上
  ctx.mcp.tool({
    name: 'canvas_ui_describe',
    description:
      '给一个**可视化节点**写功能说明书（它做什么 / 功能效果 / 输入参数 / 输出或影响）。' +
      '这份说明书会跟着节点包一起被收藏进资产库 —— 别人（和别的 Agent）从库里挑节点时，' +
      '看的就是这几句。**收藏之前建议先写它**，否则库里只有一堆看不懂的包名。' +
      'what 是必填的那一句。输入输出各给一个 **JSON 字符串**（这套参数表只收字符串）：' +
      'inputsJson 例如 \'["参考图", "列数"]\' 或 \'[{"name":"列数","type":"number","desc":"几列"}]\'；' +
      'outputsJson 同理。只写这一个节点，不动别的。',
    // ⚠️ inputsJson / outputsJson 走**JSON 字符串**而不是数组：插件的 MCP 参数简表只认
    //    string / number / boolean（见 serverFramework/mcp.ts 的说明），数组传不进来 ——
    //    写成字符串是这套朴素 schema 下唯一能让复杂结构过关的形态（与 canvas_fn_call 的 argsJson 同一条）。
    input: {
      canvasId: 'string',
      nodeId: 'string',
      what: 'string',
      effect: 'string',
      inputsJson: 'string',
      outputsJson: 'string',
    },
    required: ['nodeId', 'what'],
    handler: async (args) => {
      const what = typeof args.what === 'string' ? args.what.trim() : ''
      if (!what) return { ok: false, error: '缺少 what（这个节点是做什么的，一句话）' }
      const picked = await uiNodeOf(ctx, args)
      if (!picked.ok) return picked
      const { canvasId, nodeId, node } = picked

      // 四件事摊平收：inputs / outputs 收「一行字」或「{name,type,desc}」两种写法（见 nodeDoc.ts）
      const doc: Record<string, unknown> = { what }
      const effect = typeof args.effect === 'string' ? args.effect.trim() : ''
      if (effect) doc.effect = effect
      for (const [key, field] of [
        ['inputsJson', 'inputs'],
        ['outputsJson', 'outputs'],
      ] as const) {
        const raw = typeof args[key] === 'string' ? args[key].trim() : ''
        if (!raw) continue
        try {
          doc[field] = JSON.parse(raw)
        } catch (err) {
          return { ok: false, error: key + ' 不是合法 JSON：' + (err instanceof Error ? err.message : String(err)) }
        }
      }

      const res = await writeUiHtml(ctx, canvasId, nodeId, { [NODE_DOC_KEY]: doc })
      if (!res.ok) return { ok: false, error: res.error ?? '写入失败' }
      return { ok: true, nodeId, canvasId, doc: nodeDocOf({ [NODE_DOC_KEY]: doc }) }
    },
  })

  // ⑦ 列收藏的可视化节点（资产库里的节点包），带上各自的功能说明
  ctx.mcp.tool({
    name: 'canvas_ui_favorites',
    description:
      '列出**资产库里收藏的可视化节点**（节点包 .mcnode），每个带上它的功能说明书' +
      '（做什么 / 效果 / 输入 / 输出）与包里的脚本清单。' +
      '用它来回答「有哪些收藏的节点可以复用」，或者照着挑一个用 canvas_ui_add_favorite 建到画布上。' +
      'keyword 可以按名字 / 说明过滤。',
    input: { keyword: 'string' },
    handler: async (args) => {
      const store = ctx.tryGet<AssetStoreLike>('assetStore')
      if (!store || typeof store.list !== 'function') return { ok: false, error: '宿主没有资产服务，读不了收藏' }
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim() : ''
      const all = await store.list()
      const packs = all.filter((a) => a.kind === 'node-package')
      const readOne = ctx.tryGet<{ readFile?(n: string): Promise<Uint8Array | undefined> }>('assetStore')
      const items: Array<Record<string, unknown>> = []
      for (const a of packs) {
        let doc: string | undefined
        let scripts: string[] = []
        try {
          const bytes = readOne?.readFile ? await readOne.readFile(assetNameOf(a.url)) : undefined
          if (bytes) {
            const pack = readNodePack(bytes)
            doc = describeNodeDoc(nodeDocOf(pack.node.data))
            scripts = Object.keys(pack.scripts)
          }
        } catch {
          // 读不出来（老包 / 坏包）：照样列出来，只是不带说明书 —— 藏起来更糟
        }
        const hit = !keyword || a.name.includes(keyword) || (doc ? doc.includes(keyword) : false)
        if (!hit) continue
        items.push({
          assetId: a.id,
          name: a.name,
          url: a.url,
          ...(a.folderId ? { folderId: a.folderId } : {}),
          ...(scripts.length ? { scripts } : {}),
          ...(doc ? { doc } : { doc: '（这个包没写说明书：不知道它是做什么的）' }),
        })
      }
      return {
        ok: true,
        total: packs.length,
        shown: items.length,
        favorites: items,
        // 这条提示原先写"它自己会开一张虚拟画布取数据"——**是错的**：虚拟画布只有
        // canvas_fn_call 用（脚本的 ctx 要 canvasId/nodeId 才拼得出回写地址），
        // 建收藏节点走的是真实目标画布，只需要给它画布 id（不传 = 默认画布）。
        // 照错的那句办事，AI 会等一个不会发生的行为（审查发现）。
        hint: '用 canvas_ui_add_favorite 把其中某一个建到画布上（给 name 或 url 指定是哪个；canvasId 不传就是默认画布）',
      }
    },
  })

  // ⑧ 把收藏的节点建成节点（落到指定画布；不传 canvasId 就落到默认画布）
  ctx.mcp.tool({
    name: 'canvas_ui_add_favorite',
    description:
      '把**资产库里收藏的可视化节点**（节点包）建成画布上的一个节点。' +
      '传 url（canvas_ui_favorites 给的）或者 name（包名）来指定是哪一个。' +
      '建之前会先把包里的脚本写到服务器（有同名不同内容的脚本就整包升版本，不动本机已有的），' +
      '然后把节点数据（含界面与依赖声明）还原到画布上。' +
      '返回建出来的 nodeId —— 之后就能用 canvas_ui_read / canvas_ui_write 改它。',
    input: { url: 'string', name: 'string', canvasId: 'string', positionX: 'number', positionY: 'number' },
    handler: async (args) => {
      const store = ctx.tryGet<AssetStoreLike>('assetStore')
      if (!store || typeof store.list !== 'function') return { ok: false, error: '宿主没有资产服务，读不了收藏' }
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      if (!url && !name) return { ok: false, error: '要指定建哪一个：给 url（canvas_ui_favorites 的 url）或 name（包名）' }
      const packs = (await store.list()).filter((a) => a.kind === 'node-package')
      const asset = url ? packs.find((a) => a.url === url) : packs.find((a) => a.name === name || a.name.replace(/\.mcnode$/i, '') === name)
      if (!asset) {
        return {
          ok: false,
          error: '收藏里没有这一项：' + (url || name) + '（现有：' + (packs.map((p) => p.name).join('、') || '一个都没有') + '）',
        }
      }
      const bytes = await store.readFile?.(assetNameOf(asset.url))
      if (!bytes) return { ok: false, error: '取不到这个包的字节：' + asset.url }

      const canvasId = typeof args.canvasId === 'string' && args.canvasId ? args.canvasId : 'default'
      const dir = resolveTaskScriptsDir(ctx)
      let pack
      try {
        pack = readNodePack(bytes)
      } catch (err) {
        return { ok: false, error: '这个包读不出来：' + (err instanceof Error ? err.message : String(err)) }
      }

      // 落地：与「拖包进画布」同一条路（写脚本 → 算好节点数据）
      let plan
      try {
        plan = await planImport(pack, dir)
      } catch (err) {
        return { ok: false, error: '算导入计划失败：' + (err instanceof Error ? err.message : String(err)) }
      }
      const written: string[] = []
      try {
        await fs.mkdir(dir, { recursive: true })
        for (const w of plan.write) {
          const abs = resolveScriptPath(dir, w.name)
          if (!abs) throw new Error('脚本名不合法：' + w.name)
          await fs.writeFile(abs, w.text, 'utf8')
          written.push(w.name)
        }
      } catch (err) {
        return { ok: false, error: '写脚本失败：' + (err instanceof Error ? err.message : String(err)), written }
      }

      // 建节点：走宿主那份有写锁的画布文档（与网页端 / AI 的写排成一条链）
      const x = typeof args.positionX === 'number' ? args.positionX : undefined
      const y = typeof args.positionY === 'number' ? args.positionY : undefined
      const nodeType = String((pack.node as { type?: unknown }).type ?? 'ui')
      const res = await addNodeToCanvas(ctx, canvasId, {
        type: nodeType,
        data: plan.data as Record<string, unknown>,
        ...(x !== undefined && y !== undefined ? { position: { x, y } } : {}),
      })
      if (!res.ok) return { ok: false, error: res.error }
      return {
        ok: true,
        canvasId,
        nodeId: res.id,
        name: asset.name,
        action: plan.action,
        ...(plan.version === undefined ? {} : { version: plan.version }),
        written,
        skipped: plan.skip,
        doc: describeNodeDoc(nodeDocOf(plan.data)),
      }
    },
  })
}

