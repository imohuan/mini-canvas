/**
 * kv 路由 —— 画布数据的 KV 接口（GET/PUT/DELETE /api/kv/:type/:key）。
 *
 * 对外契约（计划 §四，定死）：
 *   GET    /api/kv/:type/:key  → 200 { value } | 404
 *   PUT    /api/kv/:type/:key  → body { value } → 200 { ok: true }
 *   DELETE /api/kv/:type/:key  → 200 { ok: true }
 *   GET    /api/kv/:type       → 200 { keys }（诊断/后台查看用）
 *
 * 语义要点：**未命中返回 404，而不是 200 + null**。客户端 HttpAdapter.get 靠 404 判
 * "从未保存过"，与 SaveServiceImpl 的 `undefined` 语义对齐 —— 若把 404 变成 200+null，
 * 空画布会被当成"保存过 null"，恢复逻辑走错分支（项目里踩过这个坑）。
 */
import { Hono, type Context } from 'hono'
import { isKvType, type KvStore } from '../store/kvStore.js'

/** key 长度上限：挡住把巨大字符串当 key 塞进来的意外用法（正常 key 都是 kebab-case 短名） */
const MAX_KEY_LENGTH = 512

export function kvRoutes(store: KvStore): Hono {
  const app = new Hono()

  /** 校验 :type 合法 + :key 非空且不过长；不合法返回错误文案，合法返回 null */
  function validate(type: string, key: string): string | null {
    if (!isKvType(type)) return `未知作用域: ${type}（只允许 config/canvas/resource/shortcut）`
    if (!key.trim()) return '缺少 key'
    if (key.length > MAX_KEY_LENGTH) return `key 过长（上限 ${MAX_KEY_LENGTH}）`
    return null
  }

  /**
   * 某作用域下的 key 列表（后台查看/诊断）。
   *
   * `?values=1` 时连**值**一起给：`{ type, keys, values: { key: value } }`。
   * 这是给"一次性读回整张画布"用的（客户端安装云端插件时那一读）：
   * 3 个 key 用 3 次 GET 读，未保存的会各回一个 404，浏览器控制台就多几条"加载资源失败"；
   * 走这个批量口一次拿齐，既少两次往返，也不再刷无意义的 404。
   * 注意：单项 GET 的 404 语义**不变**（那是"从未保存过"的信号，有单测锁着）。
   */
  const listKeys = async (c: Context) => {
    // `/api/kv/:type/` 那条的 param 推断会放宽成 string|undefined，故这里补个兜底
    const type = c.req.param('type') ?? ''
    if (!isKvType(type)) return c.json({ ok: false, error: `未知作用域: ${type}` }, 400)
    const keys = await store.keys(type)
    if (c.req.query('values') !== '1') return c.json({ ok: true, type, keys })
    const values: Record<string, unknown> = {}
    for (const key of keys) {
      const v = await store.get(type, key)
      if (v !== undefined) values[key] = v
    }
    return c.json({ ok: true, type, keys, values })
  }
  // 两个路径都收：`/api/kv/canvas` 是规范形式，`/api/kv/canvas/` 是常见笔误
  // （Hono 不会自动把带尾斜杠的请求折到不带的那条上，只注册一个会让调用方莫名 404）
  app.get('/api/kv/:type', listKeys)
  app.get('/api/kv/:type/', listKeys)

  app.get('/api/kv/:type/:key', async (c) => {
    const { type, key } = c.req.param()
    const bad = validate(type, key)
    if (bad) return c.json({ ok: false, error: bad }, 400)
    const value = await store.get(type, key)
    if (value === undefined) return c.json({ ok: false, error: '未保存过' }, 404)
    return c.json({ value })
  })

  app.put('/api/kv/:type/:key', async (c) => {
    const { type, key } = c.req.param()
    const bad = validate(type, key)
    if (bad) return c.json({ ok: false, error: bad }, 400)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON（应为 { value }）' }, 400)
    }
    if (!body || typeof body !== 'object' || !('value' in body)) {
      return c.json({ ok: false, error: 'body 缺少 value 字段（应为 { value }）' }, 400)
    }
    await store.set(type, key, (body as { value: unknown }).value)
    return c.json({ ok: true })
  })

  app.delete('/api/kv/:type/:key', async (c) => {
    const { type, key } = c.req.param()
    const bad = validate(type, key)
    if (bad) return c.json({ ok: false, error: bad }, 400)
    const removed = await store.remove(type, key)
    // 删不存在的直接报 ok:false 但仍是 200：DELETE 幂等，客户端不关心是否真删到
    return c.json({ ok: true, removed })
  })

  return app
}
