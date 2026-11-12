/**
 * CanvasDocumentPool —— 同一张画布必须永远拿到**同一个实例**。
 *
 * 为什么这条值得单测：CanvasDocument 的写锁（runExclusive）是**实例字段**，
 * 而「多个写方各自 new 一个」会让锁形同虚设 —— 这正是 2026-10-14 那个现场：
 * 后台写任务进度（非默认画布）+ 网页端保存画布并发，后写者把前者的帧盖回去，
 * 表现为「任务在后台 done 了，节点上永远停在生成中 60%」。
 * 默认画布没事（全进程就一个实例），所以只咬用户自建的画布。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasDocumentPool } from '../mcp/canvasDocPool'
import { CanvasDocument } from '../mcp/canvasDoc'
import { CanvasStore } from '../store/canvasStore'
import { CanvasResourceStore } from '../store/canvasResources'

let dir: string
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

async function pool() {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-pool-'))
  const store = new CanvasStore(dir)
  const resources = new CanvasResourceStore(dir)
  return { pool: new CanvasDocumentPool(store, resources), store, resources }
}

describe('CanvasDocumentPool', () => {
  it('同一画布取两次 → 同一实例（写锁才是同一把）', async () => {
    const { pool: p } = await pool()
    expect(p.for('c1')).toBe(p.for('c1'))
    expect(p.for('c1')).not.toBe(p.for('c2'))
  })

  it('预登记的实例会被复用（默认画布不能出现第二个实例）', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-pool-seed-'))
    const store = new CanvasStore(dir)
    const resources = new CanvasResourceStore(dir)
    const defaultDoc = new CanvasDocument(store, resources, 'default')
    const p = new CanvasDocumentPool(store, resources, [{ canvasId: 'default', doc: defaultDoc }])
    expect(p.for('default')).toBe(defaultDoc)
  })
})
