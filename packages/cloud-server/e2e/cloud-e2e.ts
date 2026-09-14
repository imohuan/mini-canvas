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
