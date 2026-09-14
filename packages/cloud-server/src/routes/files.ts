/**
 * files 路由 —— 画布资源（图片/视频等字节）的上传与回读。
 *
 * 契约（计划 §四）：
 *   POST /api/files     body: 原始字节 → 200 { id, url, size, mime }
 *   GET  /uploads/:name → 文件字节（按内容哈希命名 → 长缓存，内容永不改）
 *   GET  /api/files     → 200 { files: [id] }（后台查看用）
 *
 * 扩展名来源优先级：`?name=` → `x-file-name` 头 → Content-Type 反查。
 * 都拿不到时存成无扩展名（仍能取回，只是浏览器可能当二进制下载）。
 */
import { Hono } from 'hono'
import { extFromMime, mimeOf, safeExt, type FileStore } from '../store/fileStore.js'

/** 单次上传上限（防误传超大文件把磁盘写满；画布里最大的东西是视频） */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

export function fileRoutes(store: FileStore): Hono {
  const app = new Hono()

  app.post('/api/files', async (c) => {
    const buf = new Uint8Array(await c.req.arrayBuffer())
    if (buf.byteLength === 0) return c.json({ ok: false, error: '空文件' }, 400)
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ ok: false, error: `文件过大（上限 ${MAX_UPLOAD_BYTES} 字节）` }, 413)
    }
    const name = c.req.query('name') || c.req.header('x-file-name') || ''
    // 白名单外（含 .html/.js）回落空扩展名：同源托管下这些会造成 XSS 面，不能按原名存
    const ext = safeExt(name) || extFromMime(c.req.header('content-type') || '')
    const stored = await store.save(buf, ext)
    return c.json(stored)
  })

  app.get('/api/files', async (c) => c.json({ ok: true, files: await store.ids() }))

  app.get('/uploads/:name', async (c) => {
    const id = c.req.param('name')
    const bytes = await store.read(id)
    if (!bytes) return c.json({ ok: false, error: '文件不存在' }, 404)
    // 内容寻址：URL 与字节绑定，内容一变 URL 就变 → 可安全长缓存
    return c.body(bytes, 200, {
      'content-type': mimeOf(id),
      'cache-control': 'public, max-age=31536000, immutable',
    })
  })

  return app
}
