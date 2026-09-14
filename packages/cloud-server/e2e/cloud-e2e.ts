#!/usr/bin/env node
/**
 * cloud-server 端到端验收（**真浏览器 + 真服务 + 真磁盘**，不是单测）。
 *
 * 逐条对应计划的完成判据（§五 M3/M5）：
 *   1. 打开服务地址 → 看到真画布（VueFlow 挂载）
 *   2. 外部插件清单被读到，cloud-save 真的装上（ctx 服务在）
 *   3. 建节点/连线 → **服务器磁盘上的 json 随之变化**
 *   4. 换一个全新浏览器 profile（= 换一台机器）打开 → **画布完整恢复**  ← 云端保存的核心证据
 *   5. 大图搬上服务器 → 节点换成 /uploads/... → 刷新后仍能取回真字节
 *   6. 全程控制台零报错、零 4xx
 *
 * 跑法（先构建 ui 与插件）：
 *   cd packages/ui && pnpm build
 *   cd packages/plugins/plugin-cloud-save && pnpm build
 *   cd packages/cloud-server && pnpm e2e
 *
 * 服务由本脚本自己起（随机端口 + 临时数据目录），跑完自动清理，不污染你的工作区。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCloudServer } from '../src/server.js'
import { launchChrome, openPage, sleep } from './lib/cdp.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const UI_DIST = path.join(REPO_ROOT, 'packages/ui/dist')
const PLUGINS_DIR = path.join(REPO_ROOT, 'packages/plugins')

let failures = 0
function check(label: string, ok: boolean, extra?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${extra !== undefined ? '   ' + JSON.stringify(extra) : ''}`)
  if (!ok) failures += 1
}

/** 画布自带 seed（2 个节点），所以断言都是"相对"的 */
const SEED_NODES = 2

async function main(): Promise<void> {
  if (!exists(UI_DIST)) {
    console.error(`✗ 没找到画布构建产物：${UI_DIST}\n  请先执行：cd packages/ui && pnpm build`)
    process.exit(2)
  }
  const pluginBundle = path.join(PLUGINS_DIR, 'plugin-cloud-save/dist/plugin-cloud-save.js')
  if (!exists(pluginBundle)) {
    console.error(`✗ 没找到云端保存插件产物：${pluginBundle}\n  请先执行：cd packages/plugins/plugin-cloud-save && pnpm build`)
    process.exit(2)
  }

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-e2e-data-'))
  const srv = await createCloudServer({ dir: dataDir, uiDist: UI_DIST, pluginsDir: PLUGINS_DIR, port: 0 })
  const { url, port } = await srv.start()
  console.log(`服务已起：${url}（数据目录 ${dataDir}）\n`)

  try {
    await runChecks(url, dataDir)
    await runRealInteractionChecks(url, dataDir)
  } finally {
    srv.stop()
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
  }

  console.log('\n' + (failures === 0 ? '*** 全部通过 ***' : `${failures} 项失败`))
  process.exit(failures === 0 ? 0 : 1)
  void port
}

async function runChecks(baseUrl: string, dataDir: string): Promise<void> {
  // ==================== 第一轮：机器 A ====================
  console.log('--- 第一轮（机器 A：全新浏览器 profile）---')
  const chromeA = await launchChrome()
  const pageA = await openPage(chromeA.port)
  await pageA.goto(baseUrl + '/')
  await sleep(7000)

  const basic = await pageA.ev<{ hasPane: boolean; nodes: number; title: string }>(
    `(() => ({ title: document.title, hasPane: !!document.querySelector('.vue-flow__pane'), nodes: document.querySelectorAll('.vue-flow__node').length }))()`,
  )
  check('画布渲染出来（VueFlow 已挂载）', basic.hasPane, basic)

  const pluginInfo = await pageA.ev<{ manifest: string[]; hasService: boolean; status: unknown }>(
    `(async () => {
       const m = await fetch('/plugin-manifest.json').then((r) => r.json())
       const api = window.MiniCanvasUI
       const ctx = api && api.getContext()
       return { manifest: m.plugins.map((p) => p.id), hasService: !!ctx?.get?.('cloud-save'), status: ctx?.get?.('cloud-save')?.status?.() ?? null }
     })()`,
    true,
  )
  check('清单里有云端保存插件', pluginInfo.manifest.some((id) => id.includes('cloud-save')), pluginInfo.manifest)
  check('插件真的装上了（ctx 服务在）', pluginInfo.hasService, pluginInfo.status)

  const built = await pageA.ev<{ before: number; nodes: { id: string }[]; edges: number }>(
    `(() => {
       const host = window.MiniCanvasUI.getHost()
       const before = host.nodeStore.getNodes().length
       host.command.execute('command:create-node', { type: 'text', position: { x: 100, y: 100 } })
       host.command.execute('command:create-node', { type: 'image', position: { x: 420, y: 140 } })
       host.command.execute('command:create-node', { type: 'text', position: { x: 100, y: 320 } })
       const nodes = host.nodeStore.getNodes()
       host.graph.addEdge({ source: nodes[0].id, target: nodes[1].id })
       return { before, nodes: nodes.map((n) => ({ id: n.id })), edges: host.graph.getEdges().length }
     })()`,
  )
  check('新建 3 个节点 + 1 条连线', built.nodes.length === built.before + 3 && built.edges === 1, built)

  // 大图搬运：放一张超过默认门槛（32KB）的图，等插件把它搬到服务器
  const placed = await pageA.ev<{ id: string; dataUrlBytes: number }>(
    `(() => {
       const cv = document.createElement('canvas')
       cv.width = 900; cv.height = 700
       const g = cv.getContext('2d')
       const img = g.createImageData(cv.width, cv.height)
       for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761) % 256
       g.putImageData(img, 0, 0)
       const dataUrl = cv.toDataURL('image/png')
       const host = window.MiniCanvasUI.getHost()
       const target = host.nodeStore.getNodes().find((n) => n.type === 'image')
       if (!target) return { id: '', dataUrlBytes: 0 }
       host.graph.updateNode(target.id, { data: { imageUrl: dataUrl, imageName: 'big.png' } })
       return { id: target.id, dataUrlBytes: dataUrl.length }
     })()`,
  )
  check('放了一张超过搬运门槛的图（> 32KB）', placed.dataUrlBytes > 32 * 1024, placed)

  console.log('  等同步落盘...')
  await sleep(6000)

  // 服务器磁盘：这才是"真的上云了"的证据（不看前端内存）
  const disk = diskState(dataDir)
  check('磁盘出现 canvas:graph.json', disk.files.includes('canvas%3Agraph.json'), disk.files)
  check('磁盘节点数与画布一致', disk.nodes?.length === built.nodes.length, {
    disk: disk.nodes?.length,
    canvas: built.nodes.length,
  })
  check('磁盘边数 = 1', disk.edges?.length === 1, { edges: disk.edges?.length })

  const uploaded = await pageA.ev<{ imageUrl: string; status: unknown }>(
    `(() => {
       const host = window.MiniCanvasUI.getHost()
       const n = host.nodeStore.getNode(${JSON.stringify(placed.id)})
       return { imageUrl: n.data.imageUrl, status: host.ctx.get('cloud-save').status() }
     })()`,
  )
  check('节点里的图已换成服务器地址', String(uploaded.imageUrl).startsWith('/uploads/'), uploaded)

  const uploadsDir = path.join(dataDir, 'uploads')
  const uploadFiles = exists(uploadsDir) ? readdirSync(uploadsDir) : []
  const uploadName = String(uploaded.imageUrl).replace('/uploads/', '')
  check('服务器 uploads/ 里真有这个文件', uploadFiles.includes(uploadName), { files: uploadFiles })
  if (uploadFiles.includes(uploadName)) {
    const size = statSync(path.join(uploadsDir, uploadName)).size
    check('文件是真字节（不是空壳）', size > 1000, { size })
  }

  const idsOnA = built.nodes.map((n) => Number(n.id)).sort((a, b) => a - b)
  const errsA = pageA.consoleErrors.filter((e) => !/favicon/i.test(e))
  const failedA = pageA.failedRequests.filter((u) => !/favicon/i.test(u))
  pageA.close()
  chromeA.kill()

  // ==================== 第二轮：机器 B（另一个全新 profile）====================
  console.log('\n--- 第二轮（机器 B：另一个全新 profile，localStorage 是空的）---')
  await sleep(1200)
  const chromeB = await launchChrome()
  const pageB = await openPage(chromeB.port)
  await pageB.goto(baseUrl + '/')
  await sleep(9000)

  const restored = await pageB.ev<{ nodes: string[]; edges: number; status: unknown }>(
    `(() => {
       const api = window.MiniCanvasUI
       const host = api && api.getHost()
       return { nodes: host ? host.nodeStore.getNodes().map((n) => n.id) : [], edges: host ? host.graph.getEdges().length : -1, status: api?.getContext()?.get?.('cloud-save')?.status?.() ?? null }
     })()`,
  )
  const idsOnB = (restored.nodes ?? []).map((n) => Number(n)).sort((a, b) => a - b)
  check('★ 换机器后画布完整恢复（同一批节点 id）', JSON.stringify(idsOnB) === JSON.stringify(idsOnA), {
    got: idsOnB,
    want: idsOnA,
    status: restored.status,
  })
  check('★ 换机器后连线也恢复', restored.edges === 1, { edges: restored.edges })

  // 图片经服务器 URL 回读（换机器后图还在，这才是真"不丢"）
  if (uploadName) {
    const imgBack = await pageB.ev<{ status: number; size: number }>(
      `(async () => { const r = await fetch(${JSON.stringify(uploaded.imageUrl)}); const b = await r.blob(); return { status: r.status, size: b.size } })()`,
      true,
    )
    check('★ 换机器后图片仍能取回', imgBack.status === 200 && imgBack.size > 1000, imgBack)
  }

  const errsB = pageB.consoleErrors.filter((e) => !/favicon/i.test(e))
  const failedB = pageB.failedRequests.filter((u) => !/favicon/i.test(u))
  pageB.close()
  chromeB.kill()

  console.log('\n控制台错误 A: ' + JSON.stringify(errsA))
  console.log('控制台错误 B: ' + JSON.stringify(errsB))
  console.log('失败请求  A: ' + JSON.stringify(failedA))
  console.log('失败请求  B: ' + JSON.stringify(failedB))
  check('全程控制台零报错', errsA.length === 0 && errsB.length === 0, { errsA, errsB })
  check('全程零 4xx/5xx 请求', failedA.length === 0 && failedB.length === 0, { failedA, failedB })
  void SEED_NODES
}

/**
 * 第三/四轮：**真鼠标交互**。
 *
 * 前两轮是"程序化建节点"，那只能证明数据链路通，证明不了"用户真的能拖能连能删"
 * （计划 §五 M3 明确要求"画布能拖/连/删，与 pnpm dev 行为一致"）。
 * 这里用 CDP 的原生输入事件真的按下-移动-抬起，最后再让**一台全新机器**确认
 * 这些手工操作的结果也确实过云了 —— 这是最强的一条：手上做的事换机器也在。
 */
async function runRealInteractionChecks(baseUrl: string, dataDir: string): Promise<void> {
  console.log('\n--- 第三轮（真鼠标拖/连/删）---')
  const chrome = await launchChrome()
  const page = await openPage(chrome.port)
  await page.goto(baseUrl + '/')
  await sleep(8000)

  // 先把视图框到全部节点上。
  //
  // 这不是"作弊"：真用户面对一个视野外的节点也是先挪视图再操作。而鼠标手势测的是
  // "能不能拖/连/删"，不是"能不能盲操屏幕外的东西"——节点若大半在视野外，
  // elementFromPoint 根本找不到落点，测出来只会是假失败（上一版就是这么误报的）。
  await page.ev(`(() => window.MiniCanvasUI.getHost().viewport.fitView(0.25))()`)
  await sleep(1200)

  /** 某节点某端口锚点的屏幕坐标（锚点本身 0×0，真正接住鼠标的是外层跟随区） */
  const portPointById = (nodeId: string, side: 'source' | 'target') =>
    page.ev<{ x: number; y: number } | null>(
      `(() => {
         const n = document.querySelector('.vue-flow__node[data-id="' + ${JSON.stringify(nodeId)} + '"]')
         if (!n) return null
         const el = n.querySelector('.moving-handle-anchor--${side}')
         if (!el) return null
         const r = el.getBoundingClientRect()
         return { x: Math.round(r.x), y: Math.round(r.y) }
       })()`,
    )

  /**
   * 列出每个节点"确实点得中"的屏幕点。
   *
   * 为什么要扫一圈而不是直接用中心点：画布上节点可以互相重叠（用户随手把它们摞在一起），
   * 这时"目标节点的正中心"很可能盖在**另一个节点**上面——按那个点去拖/去点，动的是别人，
   * 测出来的结论也就反了。极端情况下某个节点会被完全盖住，**压根没有可点的像素**
   * （本脚本跑出来就是这样：node 1 被 node 3 整个压住）。所以先扫出"哪些节点真的点得中"，
   * 再从中挑目标，而不是假定某个节点一定可点。
   *
   * 判定方式：逐个候选点用 `elementFromPoint` 验证"这个点真的属于该节点"，并避开端口锚点
   * （那是拉线用的，属于另一个交互）。
   */
  const hitPoints = () =>
    page.ev<Array<{ id: string; point: { x: number; y: number } | null; reason: string }>>(
      `(() => {
         const pane = document.querySelector('.vue-flow__pane')
         const p = pane ? pane.getBoundingClientRect() : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
         const out = []
         for (const root of document.querySelectorAll('.vue-flow__node')) {
           const id = root.getAttribute('data-id')
           const r = root.getBoundingClientRect()
           // 只取"节点矩形 ∩ 画布可视区"这块：节点大半在视野外时，按整矩形算出的点会落到画布外
           const left = Math.max(r.x, p.x), top = Math.max(r.y, p.y)
           const right = Math.min(r.x + r.width, p.x + p.width), bottom = Math.min(r.y + r.height, p.y + p.height)
           if (right - left < 20 || bottom - top < 20) { out.push({ id, point: null, reason: '可见部分太小' }); continue }
           let found = null
           for (let fy = 0.45; fy <= 0.9 && !found; fy += 0.1) {
             for (let fx = 0.2; fx <= 0.8 && !found; fx += 0.1) {
               const x = Math.round(left + (right - left) * fx)
               const y = Math.round(top + (bottom - top) * fy)
               const el = document.elementFromPoint(x, y)
               if (!el || el.closest('.moving-handle-anchor')) continue
               const owner = el.closest('.vue-flow__node')
               if (owner && owner.getAttribute('data-id') === id) found = { x, y }
             }
           }
           out.push({ id, point: found, reason: found ? 'ok' : '被其它节点整个盖住' })
         }
         return out
       })()`,
    )

  // 取两个"当前没有边相连"的节点来做连接用例（否则去重会让边数不变，白测一场）
  const pair = await page.ev<{ a: string; b: string } | null>(
    `(() => {
       const host = window.MiniCanvasUI.getHost()
       const nodes = host.nodeStore.getNodes()
       const edges = host.graph.getEdges()
       const linked = new Set(edges.map((e) => e.source + '>' + e.target))
       for (const a of nodes) {
         for (const b of nodes) {
           if (a.id !== b.id && !linked.has(a.id + '>' + b.id) && !linked.has(b.id + '>' + a.id)) {
             return { a: a.id, b: b.id }
           }
         }
       }
       return null
     })()`,
  )
  check('画布上能找到一对"还没连过"的节点（连接用例的前提）', pair !== null, pair)

  // ① 真拖动（按 id）
  // 挑一个"真的点得中"的节点来拖/点：被别的节点整个盖住的节点没有可点像素，
  // 拿它测只会得到假失败（上面 hitPoints 会把原因写清楚）。
  const scanned = await hitPoints()
  const clickable = scanned.filter((s) => s.point !== null)
  const covered = scanned.filter((s) => s.point === null)
  check(
    '能扫出"真的点得中"的节点（鼠标点到的是它自己，不是盖在它上面的别人）',
    clickable.length > 0,
    { clickable: clickable.map((c) => c.id), covered: covered.map((c) => `${c.id}(${c.reason})`) },
  )
  const target = clickable[0] ?? null
  const dragId = target?.id ?? ''
  check('挑到一个可拖动的目标节点', target !== null, { id: dragId })

  const posBefore = await page.ev<{ x: number; y: number }>(
    `(() => window.MiniCanvasUI.getHost().nodeStore.getNode(${JSON.stringify(dragId)}).position)()`,
  )
  const grabPoint = target?.point ?? null
  if (grabPoint) {
    await page.dragMouse(
      grabPoint,
      { x: grabPoint.x + 120, y: grabPoint.y + 90 },
      16,
    )
    await sleep(1000)
  }
  const posAfter = await page.ev<{ x: number; y: number }>(
    `(() => window.MiniCanvasUI.getHost().nodeStore.getNode(${JSON.stringify(dragId)}).position)()`,
  )
  check(
    '★ 真鼠标拖动节点，那个节点的位置真的变了',
    Math.abs(posAfter.x - posBefore.x) > 1 || Math.abs(posAfter.y - posBefore.y) > 1,
    { id: dragId, before: posBefore, after: posAfter },
  )

  // ② 真连线：从 a 的 source 拖到 b 的 target（这两个之间确定还没边）
  const edgesBefore = await page.ev<number>(`(() => window.MiniCanvasUI.getHost().graph.getEdges().length)()`)
  const src = pair ? await portPointById(pair.a, 'source') : null
  const dst = pair ? await portPointById(pair.b, 'target') : null
  if (src && dst) {
    await page.dragMouse(src, dst, 18)
    await sleep(1300)
  }
  const edgesAfter = await page.ev<number>(`(() => window.MiniCanvasUI.getHost().graph.getEdges().length)()`)
  check('★ 真鼠标从端口拖出连线，边数 +1', edgesAfter === edgesBefore + 1, {
    from: pair?.a,
    to: pair?.b,
    before: edgesBefore,
    after: edgesAfter,
  })

  // ③ 真点选 + 真 Delete（点同一个节点，最后按 id 核对它确实没了）
  const nodesBeforeDelete = await page.ev<number>(
    `(() => window.MiniCanvasUI.getHost().nodeStore.getNodes().length)()`,
  )
  // 点选用"确认命中它"的点（拖动之后位置变了，重新扫一次）
  const reScan = await hitPoints()
  const cardPoint = reScan.find((s) => s.id === dragId)?.point ?? null
  if (cardPoint) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: cardPoint.x,
      y: cardPoint.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: cardPoint.x,
      y: cardPoint.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await sleep(700)
    const selected = await page.ev<number>(`(() => window.MiniCanvasUI.getHost().selection.ids.size)()`)
    check('点一下节点就选中了', selected === 1, { selected })
    await page.pressKey('Delete')
    await sleep(900)
  }
  const nodesAfterDelete = await page.ev<number>(
    `(() => window.MiniCanvasUI.getHost().nodeStore.getNodes().length)()`,
  )
  check('★ 选中后按 Delete 删掉了这个节点', nodesAfterDelete === nodesBeforeDelete - 1, {
    before: nodesBeforeDelete,
    after: nodesAfterDelete,
  })
  const gone = await page.ev<boolean>(
    `(() => !window.MiniCanvasUI.getHost().nodeStore.getNode(${JSON.stringify(dragId)}))()`,
  )
  check('删掉的正是那一个（按 id 核对）', gone, { id: dragId })

  // 删节点会级联删掉它的边，故最终态以"删除后"的读数为准（别拿删除前的 edgesAfter 比）
  const finalState = await page.ev<{ nodes: number; edges: number }>(
    `(() => {
       const host = window.MiniCanvasUI.getHost()
       return { nodes: host.nodeStore.getNodes().length, edges: host.graph.getEdges().length }
     })()`,
  )

  const errs = page.consoleErrors.filter((e) => !/favicon/i.test(e))
  check('真交互过程零控制台报错', errs.length === 0, errs)
  page.close()
  chrome.kill()

  // 手工操作也要过云：磁盘上的数字应与画布一致
  console.log('  等手工操作同步落盘...')
  await sleep(5000)
  const disk = diskState(dataDir)
  check('★ 手工操作的结果也写到了服务器磁盘', disk.nodes?.length === nodesAfterDelete, {
    disk: disk.nodes?.length,
    canvas: nodesAfterDelete,
  })

  // ==================== 第四轮：又一全新 profile，确认手工改动也在 ====================
  console.log('\n--- 第四轮（又一全新 profile：确认手工改动也在）---')
  const chromeC = await launchChrome()
  const pageC = await openPage(chromeC.port)
  await pageC.goto(baseUrl + '/')
  await sleep(9000)
  const final = await pageC.ev<{ nodes: number; edges: number }>(
    `(() => {
       const host = window.MiniCanvasUI.getHost()
       return { nodes: host.nodeStore.getNodes().length, edges: host.graph.getEdges().length }
     })()`,
  )
  check(
    '★ 换机器看到的正是手工操作后的状态（删掉的没复活、连的线也在）',
    final.nodes === finalState.nodes && final.edges === finalState.edges,
    { got: final, want: finalState },
  )
  const errsC = pageC.consoleErrors.filter((e) => !/favicon/i.test(e))
  check('最后一台机器控制台零报错', errsC.length === 0, errsC)
  pageC.close()
  chromeC.kill()
}

/** 读服务器磁盘上的 kv 文件（"数据真的落盘"的唯一证据） */
function diskState(dataDir: string): { files: string[]; nodes: unknown[] | null; edges: unknown[] | null } {
  const kv = path.join(dataDir, 'kv')
  if (!exists(kv)) return { files: [], nodes: null, edges: null }
  const files = readdirSync(kv)
  const read = (name: string): unknown[] | null => {
    const f = files.find((n) => n === name)
    return f ? (JSON.parse(readFileSync(path.join(kv, f), 'utf8')) as unknown[]) : null
  }
  return { files, nodes: read('canvas%3Agraph.json'), edges: read('canvas%3Agraph-edges.json') }
}

function exists(p: string): boolean {
  return existsSync(p)
}

main().catch((err: unknown) => {
  console.error('\n端到端脚本崩了: ' + (err instanceof Error ? err.stack : String(err)))
  process.exit(1)
})
