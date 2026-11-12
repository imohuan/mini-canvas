/**
 * assets 路由 —— 资产目录的 HTTP 面。
 *
 * 契约：
 *   GET    /api/assets                → { ok, assets }（全部，最新在前）
 *   POST   /api/assets?name=  (bytes) → { ok, asset }（上传 = 字节落 assets/files）
 *                                   ?folderId= 直接登记进某个文件夹
 *   GET    /api/assets/files/:name    → 字节（上传的资产）
 *   DELETE /api/assets/:id            → { ok }
 *   PATCH  /api/assets/:id            → { ok, asset }（body: { folderId?, tags? }）
 *   POST   /api/assets/batch          → { ok, updated }（body: { ids, folderId? } 批量移动）
 *
 * 文件夹（树形，存 assets/folders.json）：
 *   GET    /api/asset-folders         → { ok, folders }
 *   POST   /api/asset-folders         → { ok, folder }（body: { name, parentId? }）
 *   PATCH  /api/asset-folders/:id     → { ok, folder }（body: { name? } 或 { parentId? } 移动）
 *   DELETE /api/asset-folders/:id     → { ok }（子项上移到父级，不销毁）
 *
 * 生成产物**不在这里登记**（TaskManager 归档时登记），这里只读 + 上传 + 删。
 */
import { Hono } from 'hono'
import type { AssetStore } from '../store/assetStore.js'
import { isSafeAssetName } from '../store/canvasPaths.js'
import { mimeFromName } from '../store/mime.js'
import { maxUploadBytes, readBodyLimited, uploadErrorBody } from '../uploads.js'
import { inlineAssetHeaders } from '../inlineAsset.js'

export function assetsRoutes(store: AssetStore): Hono {
  const app = new Hono()

  app.get('/api/assets', async (c) => c.json({ ok: true, assets: await store.list() }))

  app.post('/api/assets', async (c) => {
    const read = await readBodyLimited(
      { header: (n) => c.req.header(n), arrayBuffer: () => c.req.arrayBuffer(), stream: c.req.raw.body },
      maxUploadBytes(),
    )
    if (!read.ok) {
      const e = uploadErrorBody(read)
      return c.json(e.body, e.status)
    }
    const bytes = read.bytes
    const name = c.req.query('name') ?? ''
    const folderId = c.req.query('folderId') || undefined
    return c.json({ ok: true, asset: await store.saveUpload(bytes, name, folderId) })
  })

  app.get('/api/assets/files/:name', async (c) => {
    const name = c.req.param('name')
    if (!isSafeAssetName(name)) return c.json({ ok: false, error: '非法路径' }, 400)
    const bytes = await store.readFile(name)
    if (!bytes) return c.json({ ok: false, error: '资产不存在' }, 404)
    return c.body(bytes, 200, {
      ...inlineAssetHeaders(mimeFromName(name)),
      // 内容寻址：地址与字节绑定 → 可安全长缓存
      'cache-control': 'public, max-age=31536000, immutable',
    })
  })

  app.delete('/api/assets/:id', async (c) => {
    const ok = await store.remove(c.req.param('id'))
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: '资产不存在' }, 404)
  })

  app.patch('/api/assets/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { folderId?: string; tags?: string[]; name?: string }
    let asset
    if (typeof body.name === 'string') {
      asset = await store.renameAsset(c.req.param('id'), body.name)
    } else if (Array.isArray(body.tags)) {
      asset = await store.setAssetTags(c.req.param('id'), body.tags)
    } else if ('folderId' in body) {
      asset = await store.setAssetFolder(c.req.param('id'), body.folderId || undefined)
    }
    return asset ? c.json({ ok: true, asset }) : c.json({ ok: false, error: '资产不存在' }, 404)
  })

  app.post('/api/assets/batch', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: string[]; folderId?: string }
    if (!Array.isArray(body.ids) || body.ids.length === 0) return c.json({ ok: false, error: 'ids 为空' }, 400)
    const updated = await store.setAssetsFolder(body.ids, body.folderId || undefined)
    return c.json({ ok: true, updated })
  })

  // ===== 文件夹 =====
  app.get('/api/asset-folders', async (c) => c.json({ ok: true, folders: await store.listFolders() }))

  app.post('/api/asset-folders', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; parentId?: string }
    if (!body.name?.trim()) return c.json({ ok: false, error: '缺少 name' }, 400)
    return c.json({ ok: true, folder: await store.createFolder(body.name, body.parentId || undefined) })
  })

  app.patch('/api/asset-folders/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; parentId?: string; icon?: string }
    if ('parentId' in body) {
      const moved = await store.moveFolder(c.req.param('id'), body.parentId || undefined)
      return moved ? c.json({ ok: true, folder: moved }) : c.json({ ok: false, error: '文件夹不存在或移动成环' }, 404)
    }
    if ('icon' in body) {
      const updated = await store.setFolderIcon(c.req.param('id'), body.icon ?? '')
      return updated ? c.json({ ok: true, folder: updated }) : c.json({ ok: false, error: '文件夹不存在' }, 404)
    }
    const renamed = await store.renameFolder(c.req.param('id'), body.name ?? '')
    return renamed ? c.json({ ok: true, folder: renamed }) : c.json({ ok: false, error: '文件夹不存在' }, 404)
  })

  app.delete('/api/asset-folders/:id', async (c) => {
    const ok = await store.removeFolder(c.req.param('id'))
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: '文件夹不存在' }, 404)
  })

  return app
}
