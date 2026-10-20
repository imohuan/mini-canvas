/**
 * 「拖一个节点，松手后它自己弹回原位」—— 复现并钉死。
 *
 * 机制（与「进度卡 60%」是同一个根因的另一个症状）：
 * 后台写进度帧是**读整张画布 → 只改那个节点的 runState → 把整张写回去**。
 * 如果这一步与网页端「把节点位置存上去」并发，而两条路拿的不是同一把写锁，
 * 就会：后台先读（此时位置还是 A）→ 网页写进新位置 B → 后台把手里那份写回（位置又变 A）。
 * 用户看到的就是：明明拖到了新地方，松手又跳回原处。
 *
 * 非默认画布从前**每个请求各建一个 CanvasDocument**（锁是实例字段 → 锁不同），
 * 所以这个坑只咬用户自建的画布；默认画布共用一个实例，不会。
 */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasDocumentPool } from '../mcp/canvasDocPool'
import type { CanvasDocument } from '../mcp/canvasDoc'
import { CanvasStore } from '../store/canvasStore'
import { CanvasResourceStore } from '../store/canvasResources'

const CID = 'usercanvas000001'
const NODE = 'n1'

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapback-'))
  const store = new CanvasStore(dir)
  const resources = new CanvasResourceStore(dir)
  await store.writeCanvas(CID, {
    nodes: [{ id: NODE, type: 'video', position: { x: 0, y: 0 }, data: {} }],
    edges: [],
  })
  return { dir, store, resources }
}

/** 后台那一拍：写进度帧（读全量 → 只改 runState → 写全量） */
type BatchDoc = Pick<CanvasDocument, 'batchNodes'>

const writeProgress = (doc: BatchDoc, progress: number) =>
  doc.batchNodes({ update: [{ id: NODE, data: { runState: { status: 'running', progress } } }] })

/** 网页端那一拍：用户拖完，把新位置存上去 */
const writePosition = (doc: BatchDoc, x: number, y: number) =>
  doc.batchNodes({ update: [{ id: NODE, position: { x, y } }] })

describe('拖拽后被弹回原位', () => {
  it('★ 进度帧与位置保存并发：位置必须留住（同一把写锁）', async () => {
    const { dir, store, resources } = await setup()
    const pool = new CanvasDocumentPool(store, resources)
    // 反复几十轮：每轮都是「进度帧 + 位置写」同时发。
    // 共用一把锁 → 每轮都串行执行 → 位置一次都不该丢。
    for (let round = 1; round <= 30; round++) {
      await Promise.all([
        writeProgress(pool.for(CID), round),
        writePosition(pool.for(CID), 500 + round, 300 + round),
        writeProgress(pool.for(CID), round),
      ])
      const n = (await store.readCanvas(CID))!.nodes[0] as {
        position: { x: number; y: number }
      }
      expect(n.position).toEqual({ x: 500 + round, y: 300 + round })
    }
    // 位置保住了，进度帧也在（两件事都活）
    const node = (await store.readCanvas(CID))!.nodes[0] as {
      position: { x: number; y: number }
      data: { runState?: { progress?: number } }
    }
    expect(node.data.runState?.progress).toBe(30)
    await fs.rm(dir, { recursive: true, force: true })
  })

  /**
   * 反证（确定性的，不靠时序碰运气）：把「读-改-写」拆开、中间插进别人的写，
   * 位置一定会被那份陈旧的快照盖回去 —— 这就是没有共享锁时的真实时序。
   *
   * 后台那一拍做的事等价于：读整张（位置还是 0,0）→ 只改 runState → 整张写回。
   * 只要「读」和「写」之间别人改了位置，那一拍就把位置带回旧值。
   */
  it('反证：陈旧快照整张写回 → 位置被弹回（无共享锁时就是这条时序）', async () => {
    const { dir, store, resources } = await setup()
    const pool = new CanvasDocumentPool(store, resources)
    // ① 后台那一拍先「读到手」（此刻位置 0,0）
    const stale = await store.readCanvas(CID)
    // ② 用户这一拍把新位置写下去（走了另一把锁）
    await writePosition(pool.for(CID), 500, 300)
    // ③ 后台把手里那份陈旧快照整张写回
    const nodes = (stale!.nodes as Array<Record<string, unknown>>).map((n) => ({
      ...n,
      data: { ...(n.data as object), runState: { status: 'running', progress: 10 } },
    }))
    await store.writeCanvas(CID, { nodes, edges: stale!.edges })
    // ④ 用户拖到的位置没了 —— 与用户看到的一模一样
    const node = (await store.readCanvas(CID))!.nodes[0] as { position: { x: number; y: number } }
    expect(node.position).toEqual({ x: 0, y: 0 }) // ← 这就是「松手又弹回去」
    await fs.rm(dir, { recursive: true, force: true })
  })
})
