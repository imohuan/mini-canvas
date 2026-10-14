/**
 * 资产批量删除：并发删多条不许丢更新。
 *
 * 为什么要有这组测试（用户报的现场，2026-10-14）：
 *   「我批量删除之后刷新页面，又会出现一些内容……我全选删除之后依然还有数据，
 *     删除了之后还是会有」——前端「全选删除」是 for 循环里 void 调 deleteAssetById，
 *   也就是**并发**发 N 个 DELETE。而后台 AssetStore 的每个写都是
 *   「读整张 index.json → 改 → 整份写回」，读改写没串行：N 个并发删除各自读到同一份旧账，
 *   各自写回，后写的把先写的整条覆盖掉 —— 实测 12 条并发删只剩 1 条被删掉
 *   （真机 HTTP 复现：5 条并发删只删掉 1 条，其余 4 条还在）。
 *
 * 判据是「删完必须真的没了」：链条修好之后，任意条数的并发删除都要全部生效。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AssetStore } from '../store/assetStore'
import { assetsRoutes } from '../routes/assets'

let root: string
let assets: AssetStore
let app: Hono

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-batch-del-'))
  assets = new AssetStore(root)
  app = new Hono()
  app.route('/', assetsRoutes(assets))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 造 n 条资产（上传路径，字节真落盘，与用户自己传的素材同一条路） */
async function seed(n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const a = await assets.saveUpload(new Uint8Array([i, i + 1, i + 2]), 'f' + i + '.png')
    ids.push(a.id)
  }
  return ids
}

describe('资产批量删除', () => {
  it('并发删 12 条：全部删掉，一条都不许剩（store 层）', async () => {
    const ids = await seed(12)
    expect(await assets.list()).toHaveLength(12)
    // 前端「全选删除」的形状：并发发 N 个删除，不排队
    await Promise.all(ids.map((id) => assets.remove(id)))
    expect(await assets.list()).toHaveLength(0)
  })

  it('并发删 12 条：走过路由也一样（HTTP 层，前端真正打的那条路）', async () => {
    const ids = await seed(12)
    const statuses = await Promise.all(
      ids.map((id) => app.fetch(new Request('http://x/api/assets/' + id, { method: 'DELETE' }))),
    )
    expect(statuses.every((r) => r.status === 200)).toBe(true)
    const left = (await (await app.fetch(new Request('http://x/api/assets'))).json()) as { assets: unknown[] }
    expect(left.assets).toHaveLength(0)
  })

  it('删除与「读列表」并发：读到的迁移写不许把删掉的项写回来', async () => {
    // 老数据形态（登记表里没有 path）才会触发读时迁移写盘 —— 那一次写最容易覆盖并发删除
    await fs.mkdir(path.join(root, 'assets'), { recursive: true })
    const legacy = Array.from({ length: 8 }, (_, i) => ({
      id: 'legacy-' + i,
      name: 'l' + i + '.png',
      kind: 'image',
      url: '/api/assets/files/deadbeef0000000' + i + '.png',
      source: 'upload',
      createdAt: Date.now() - i,
    }))
    await fs.writeFile(path.join(root, 'assets', 'index.json'), JSON.stringify(legacy))
    const store = new AssetStore(root)
    const ids = legacy.map((l) => l.id)
    await Promise.all([
      ...ids.slice(0, 4).map((id) => store.remove(id)),
      store.list(),
      store.list(),
    ])
    const left = (await store.list()).map((a) => a.id).sort()
    expect(left).toEqual(ids.slice(4).sort())
  })
})

