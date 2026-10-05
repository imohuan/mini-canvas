/**
 * assets 路由 —— 资产目录的 HTTP 面。
 *
 * 契约：
 *   GET    /api/assets                → { ok, assets }（全部，最新在前）
 *   POST   /api/assets?name=  (bytes) → { ok, asset }（上传 = 字节落 assets/files）
 *   GET    /api/assets/files/:name    → 字节（上传的资产）
 *   DELETE /api/assets/:id            → { ok }
 *
 * 生成产物**不在这里登记**（TaskManager 归档时登记），这里只读 + 上传 + 删。
 */
import { Hono } from 'hono'
import type { AssetStore } from '../store/assetStore.js'
import { isSafeAssetName } from '../store/canvasPaths.js'
import { mimeFromName } from '../store/mime.js'

export function assetsRoutes(store: AssetStore): Hono {
  const app = new Hono()

  app.get('/api/assets', async (c) => c.json({ ok: true, assets: await store.list() }))

  app.post('/api/assets', async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength === 0) return c.json({ ok: false, error: '空文件' }, 400)
    const name = c.req.query('name') ?? ''
    return c.json({ ok: true, asset: await store.saveUpload(bytes, name) })
  })

  app.get('/api/assets/files/:name', async (c) => {
    const name = c.req.param('name')
    if (!isSafeAssetName(name)) return c.json({ ok: false, error: '非法路径' }, 400)
    const bytes = await store.readFile(name)
    if (!bytes) return c.json({ ok: false, error: '资产不存在' }, 404)
    return c.body(bytes, 200, {
      'content-type': mimeFromName(name),
      // 内容寻址：地址与字节绑定 → 可安全长缓存
      'cache-control': 'public, max-age=31536000, immutable',
    })
  })

  app.delete('/api/assets/:id', async (c) => {
    const ok = await store.remove(c.req.param('id'))
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: '资产不存在' }, 404)
  })

  return app
}
