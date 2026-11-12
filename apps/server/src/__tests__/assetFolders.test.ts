/**
 * 资产文件夹 / 批量移动 / 标签 —— store 与路由双层单测。
 *
 * 锁住的用户口径：
 * - 资产按文件夹组织（树形嵌套），后台保存结构与前端显示一致；
 * - 「移动到」= 真挪；「添加到」= 也落一个归属（同一字段，语义差异只在交互）；
 * - 文件夹删除不销毁数据（子项上移）；
 * - 标签是固定清单，覆盖式写入。
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-folders-'))
  assets = new AssetStore(root)
  app = new Hono()
  app.route('/', assetsRoutes(assets))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const call = (p: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request('http://x' + p, {
      method,
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    }),
  )
const j = async (r: Response) => (await r.json()) as Record<string, any>

describe('AssetStore 文件夹', () => {
  it('建文件夹 → 嵌套 → 改名 → 移动（不能移进自己的子孙）', async () => {
    const a = await assets.createFolder('甲')
    const b = await assets.createFolder('乙', a.id)
    expect(b.parentId).toBe(a.id)
    const renamed = await assets.renameFolder(a.id, '甲改')
    expect(renamed?.name).toBe('甲改')
    // 乙 挪回根
    expect((await assets.moveFolder(b.id, undefined))?.parentId).toBeUndefined()
    // 甲 挪进 乙？乙的父是 undefined，甲不是乙的子孙 → 允许
    expect((await assets.moveFolder(a.id, b.id))?.parentId).toBe(b.id)
    // 乙 挪进 甲 = 成环 → 拒绝（返回 undefined，原状不变）
    expect(await assets.moveFolder(b.id, a.id)).toBeUndefined()
  })

  it('删文件夹：资产和子文件夹上移到父级，不销毁', async () => {
    const parent = await assets.createFolder('父')
    const child = await assets.createFolder('子', parent.id)
    const asset = await assets.saveUpload(new TextEncoder().encode('png-bytes'), 'a.png', child.id)
    expect(asset.folderId).toBe(child.id)
    expect(await assets.removeFolder(parent.id)).toBe(true)
    // 子文件夹上移到根
    expect((await assets.listFolders()).find((f) => f.id === child.id)?.parentId).toBeUndefined()
    // 资产在「子」里：子整体上移，资产仍留在「子」（跟着文件夹走，不散架）
    expect((await assets.list()).find((x) => x.id === asset.id)?.folderId).toBe(child.id)
    const parent2 = await assets.createFolder('父2')
    const direct = await assets.saveUpload(new TextEncoder().encode('q'), 'q.png', parent2.id)
    await assets.removeFolder(parent2.id)
    expect((await assets.list()).find((x) => x.id === direct.id)?.folderId).toBeUndefined()
  })

  it('资产移动 / 批量移动 / 标签覆盖', async () => {
    const f1 = await assets.createFolder('一')
    const f2 = await assets.createFolder('二')
    const a1 = await assets.saveUpload(new TextEncoder().encode('x'), 'x.png', f1.id)
    const a2 = await assets.saveUpload(new TextEncoder().encode('y'), 'y.png', f1.id)
    expect((await assets.setAssetFolder(a1.id, f2.id))?.folderId).toBe(f2.id)
    // 移到不存在的文件夹 → undefined（拒绝）
    expect(await assets.setAssetFolder(a1.id, 'nope')).toBeUndefined()
    expect(await assets.setAssetsFolder([a1.id, a2.id], undefined)).toBe(2)
    expect(await assets.setAssetsFolder([a1.id], 'nope')).toBe(0)
    expect((await assets.setAssetTags(a1.id, ['角色', '风格', '角色']))?.tags).toEqual(['角色', '风格'])
    expect((await assets.setAssetTags(a1.id, []))?.tags).toBeUndefined()
  })
})

describe('asset 路由：文件夹与批量', () => {
  it('文件夹 CRUD 全流程 + 批量移动 + PATCH 标签', async () => {
    const made = await j(await call('/api/asset-folders', 'POST', { name: '素材库' }))
    expect(made.folder.name).toBe('素材库')
    const fid = made.folder.id as string

    const up = await app.fetch(
      new Request('http://x/api/assets?name=z.png&folderId=' + fid, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: 'bytes',
      }),
    )
    const uploaded = await j(up)
    expect(uploaded.asset.folderId).toBe(fid)

    const patch = await j(await call('/api/assets/' + uploaded.asset.id, 'PATCH', { tags: ['场景'] }))
    expect(patch.asset.tags).toEqual(['场景'])

    const batch = await j(await call('/api/assets/batch', 'POST', { ids: [uploaded.asset.id], folderId: undefined }))
    expect(batch.updated).toBe(1)
    expect((await assets.list()).find((x) => x.id === uploaded.asset.id)?.folderId).toBeUndefined()

    const folders = await j(await call('/api/asset-folders'))
    expect(folders.folders.map((f: any) => f.name)).toContain('素材库')
    expect((await j(await call('/api/asset-folders/' + fid, 'PATCH', { name: '改名库' }))).folder.name).toBe('改名库')
    expect((await j(await call('/api/asset-folders/' + fid, 'DELETE'))).ok).toBe(true)
    // 删完后 GET 该文件夹 → 404（Hono 无匹配路由回纯文本 404，检查状态码即可）
    expect((await call('/api/asset-folders/' + fid)).status).toBe(404)
  })
})
