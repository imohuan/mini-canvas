#!/usr/bin/env node
/**
 * 实时通道端到端验收（**真 MCP 客户端 + 真服务 + 真浏览器**）。
 *
 * 验的命题只有一句：**AI 改完画布，用户不用刷新浏览器就能看到**。
 *
 * 这条链路之前是断的（AI 改的是服务器文件，网页端只在装插件那一次读过云端），
 * 所以必须用「真浏览器 + 真 MCP 客户端」来验，而不是单测里喂假事件：
 *   1. 真浏览器打开画布（装上 cloud-save 插件，连上 SSE）；
 *   2. 用官方 MCP 客户端往画布加节点 —— **全程不碰浏览器**；
 *   3. 等一小会儿，在浏览器里查画布：节点应该自己出现了，且页面**没有刷新过**；
 *   4. 再验反向的一条：AI 删掉节点，浏览器里的节点也跟着消失；
 *   5. 顺带验「本地正在做的事不被冲掉」与「全程零报错」。
 *
 * 跑法（先构建 ui 与插件）：
 *   cd packages/ui && pnpm build
 *   cd packages/plugins/plugin-cloud-save && pnpm build
 *   cd packages/cloud-server && pnpm e2e:realtime
 */
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createCloudServer } from '../src/server.js'
import { launchChrome, openPage, sleep } from './lib/cdp.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const UI_DIST = path.join(REPO_ROOT, 'packages/ui/dist')
const PLUGINS_DIR = path.join(REPO_ROOT, 'packages/plugins')

let failures = 0
function check(label: string, ok: boolean, extra?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${extra !== undefined ? '   ' + JSON.stringify(extra) : ''}`)
  if (!ok) failures += 1
}

/** 在浏览器里取一段画布状态（所有断言都走这里，避免拼一堆表达式） */
const PROBE = `(() => {
  const api = window.MiniCanvasUI
  const host = api && api.getHost()
  const st = host ? host.ctx.get("cloud-save").status() : null
  return {
    hasHost: !!host,
    realtime: !!(st && st.realtime),
    applied: st ? st.appliedRounds : -1,
    ids: host ? host.nodeStore.getNodes().map((n) => n.id) : [],
    texts: host ? host.nodeStore.getNodes().map((n) => String(n.data.text ?? "")) : [],
  }
})()`

async function main(): Promise<void> {
  if (!existsSync(UI_DIST)) {
    console.error('✗ 没找到画布构建产物：' + UI_DIST + '\n  请先执行：cd packages/ui && pnpm build')
    process.exit(2)
  }
  const bundle = path.join(PLUGINS_DIR, 'plugin-cloud-save/dist/plugin-cloud-save.js')
  if (!existsSync(bundle)) {
    console.error('✗ 没找到云端保存插件产物：' + bundle + '\n  请先执行：cd packages/plugins/plugin-cloud-save && pnpm build')
    process.exit(2)
  }

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'realtime-e2e-'))
  const srv = await createCloudServer({ dir: dataDir, uiDist: UI_DIST, pluginsDir: PLUGINS_DIR, port: 0 })
  const { url } = await srv.start()
  console.log(`服务已起：${url}（数据目录 ${dataDir}）\n`)

  const chrome = await launchChrome()
  const page = await openPage(chrome.port)
  try {
    // 打一个标记：用来证明"页面从头到尾没被刷新过"（刷新会把它抹掉）
   await page.goto(url + "/")
   await page.ev(`(() => { window.__realtimeProbe = "alive" })()`)
    // 记录所有画布相关的写请求：用来区分「增量保存」与「整包覆盖」。
    // 只看画布最终状态是不够的 —— 旧实现（整包 PUT）在本地已合并的情况下同样能看到 AI 的节点。
    await page.ev(
      `(() => {
         window.__savePaths = []
         const orig = window.fetch
         window.fetch = function (input, init) {
           try {
             const u = String(typeof input === "string" ? input : (input && input.url) || "")
             if (u.indexOf("/api/canvas/") >= 0 || u.indexOf("/api/kv/canvas/") >= 0) {
               window.__savePaths.push((init && init.method ? init.method : "GET") + " " + u)
             }
           } catch { /* 记录失败不影响原请求 */ }
           return orig.apply(this, arguments)
         }
       })()`,
    )
   console.log("--- 打开真浏览器，等插件装好 ---")
    await sleep(8000)

    const ready = await page.ev<{ hasHost: boolean; realtime: boolean; ids: string[] }>(PROBE)
    check('画布跑起来且插件已装上', ready.hasHost, { ids: ready.ids })
    check('★ 插件已连上实时通道（画布会自己跟着 AI 的改动变）', ready.realtime, ready)

    // ==================== AI 经 MCP 加节点（全程不碰浏览器）====================
    console.log("\n--- AI 经 MCP 往画布加节点（不碰浏览器）---")
    const client = new Client({ name: 'realtime-e2e', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)))
    const added = await client.callTool({
      name: 'canvas.batch_nodes',
      arguments: {
        add: [{ type: 'text', id: 'ai-realtime-1', position: { x: 200, y: 200 }, data: { text: 'AI 实时加进来的' } }],
      },
    })
    const addedText = ((added as { content: { text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("")
    check('MCP 工具执行成功（服务端确实改了画布）', addedText.includes('"ok":true'), addedText.slice(0, 200))

    // ==================== 浏览器应该自己跟上（不刷新）====================
    console.log("\n--- 等浏览器自己跟上（不刷新页面）---")
    let seen: { ids: string[]; applied: number } = { ids: [], applied: -1 }
    let appeared = false
    for (let i = 0; i < 20 && !appeared; i++) {
      await sleep(500)
      seen = await page.ev<{ ids: string[]; applied: number }>(PROBE)
      appeared = seen.ids.includes('ai-realtime-1')
    }
    check('★ AI 加的节点在浏览器里自己出现了（没刷新页面）', appeared, seen)

    const texts = await page.ev<string[]>(PROBE + '.texts')
    check('★ 节点内容也对（AI 写的那段文字）', texts.includes('AI 实时加进来的'), { texts })

    const alive = await page.ev<string>(`(() => String(window.__realtimeProbe ?? ''))()`)
    check('★ 页面确实没被刷新过（标记还在）', alive === 'alive', { alive })

    // ==================== AI 删节点，浏览器跟着消失 ====================
    console.log("\n--- AI 经 MCP 删掉这个节点 ---")
    await client.callTool({ name: 'canvas.batch_nodes', arguments: { delete: ['ai-realtime-1'] } })
    let gone = false
    for (let i = 0; i < 20 && !gone; i++) {
      await sleep(500)
      const now = await page.ev<{ ids: string[] }>(PROBE)
      gone = !now.ids.includes('ai-realtime-1')
    }
    check('★ AI 删掉的节点在浏览器里也消失了', gone)

    // ==================== AI 加的节点，不能被画布的保存盖掉 ====================
    // 本轮修掉的核心问题：画布保存原先整包 PUT，会把 AI 在两次保存之间做的改动整个盖掉。
    // 这里让画布真的改一次节点位置（等价于用户拖完落定），确定会触发一次保存。
    console.log('\n--- 画布保存一次，看 AI 刚加的节点还在不在 ---')
    await client.callTool({
      name: 'canvas.batch_nodes',
      arguments: {
        add: [{ type: 'text', id: 'ai-keep-1', position: { x: 300, y: 300 }, data: { text: '别把我盖掉' } }],
      },
    })

    let merged = false
    for (let i = 0; i < 20 && !merged; i++) {
      await sleep(500)
      const now = await page.ev<{ ids: string[] }>(PROBE)
      merged = now.ids.includes('ai-keep-1')
    }
    check('AI 加的节点已合进本地画布（保存前的前提）', merged)

    // 让画布改一个节点位置 → 触发一次正常的保存（原来这一步会把 ai-keep-1 整份覆盖掉）
    await page.ev(
      `(() => {
         const host = window.MiniCanvasUI.getHost()
         const n = host.nodeStore.getNodes().find((x) => x.id !== 'ai-keep-1')
         host.graph.updateNode(n.id, { position: { x: n.position.x + 60, y: n.position.y + 40 } })
       })()`,
    )
    await sleep(3000)

    const afterSave = await page.ev<{ ids: string[] }>(PROBE)
    check('★ 画布保存之后，AI 刚加的节点还在（没被整包覆盖掉）', afterSave.ids.includes('ai-keep-1'), afterSave)

   // 再从服务端侧面确认一次：不只是本地内存里留着，服务器上那份也还在
   const onServer = await client.callTool({ name: 'canvas.get', arguments: {} })
   const onServerText = ((onServer as { content: { text?: string }[] }).content ?? []).map((c) => c.text ?? '').join('')
   check('★ 服务器上那份也还有它（保存没把它从云端抹掉）', onServerText.includes('ai-keep-1'))

    // 关键区别：上面那条断言在「旧实现（整包 PUT）」下同样会过（因为本地已经合并了 AI 的节点）。
    // 真正能区分新旧实现的是**保存走了哪条路** —— 所以这里直接看请求 URL。
    const usedDelta = await page.ev<boolean>(
      `(() => (window.__savePaths ?? []).some((p) => p.indexOf('/api/canvas/nodes') >= 0))()`,
    )
    check('★ 保存走的是增量口（不是整包 PUT）——这条才区分得出新旧实现', usedDelta)

    // ==================== 本地正在做的事不被冲掉 ====================
   console.log("\n--- 本地新建节点后再让 AI 改：本地那个不能丢 ---")
    const localId = await page.ev<string>(
      `(() => window.MiniCanvasUI.getHost().graph.createNode('text', { x: 700, y: 500 }, { text: '本地建的' }))()`,
    )
    await client.callTool({ name: 'canvas.batch_nodes', arguments: { add: [{ type: 'text', data: { text: 'AI 又加一个' } }] } })
    await sleep(2500)
    const after = await page.ev<{ ids: string[]; texts: string[] }>(PROBE)
    check('★ 本地刚建的节点还在（没被云端整包覆盖冲掉）', after.ids.includes(localId), { localId, ids: after.ids })
    check('AI 新加的那个也进来了', after.texts.includes('AI 又加一个'), { texts: after.texts })

    const errors = page.consoleErrors.filter((e) => !/favicon/i.test(e))
    const failed = page.failedRequests.filter((u) => !/favicon/i.test(u))
    check('全程控制台零报错', errors.length === 0, errors)
    check('全程零 4xx/5xx 请求（实时通道不该刷失败请求）', failed.length === 0, failed)

    await client.close()
  } finally {
    page.close()
    chrome.kill()
    srv.stop()
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
  }

  console.log('\n' + (failures === 0 ? '*** 全部通过 ***' : `${failures} 项失败`))
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('\n端到端脚本崩了: ' + (err instanceof Error ? err.stack : String(err)))
  process.exit(1)
})
