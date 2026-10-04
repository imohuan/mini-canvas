/**
 * actions 路由 —— 把后台的动作清单交给前端。
 *
 * 契约：
 *   GET /api/actions[?ifVersion=N] → { ok, version, actions: ActionDef[] }
 *
 * 前端的模型下拉列的就是 `actions`。**后台加一个 provider，前端自动多一项** ——
 * 前端一行不用改、插件也不用重装，这才是"后台是真身"的完整形态。
 *
 * `ifVersion`：前端带上上次拿到的版本号。没变就只回 `{ ok, version, changed: false }`，
 * 省掉整份清单的搬运 —— 前端每隔几秒问一次也不心疼。
 */
import { Hono } from 'hono'
import type { ProviderRegistry } from '../providers/registry.js'

export function actionsRoutes(registry: ProviderRegistry): Hono {
  const app = new Hono()

  app.get('/api/actions', (c) => {
    const version = registry.contentVersion
    const ifVersion = c.req.query('ifVersion')
    // 版本没变 → 只回版本号（前端据此跳过重注册，避免无谓的重建）
    if (ifVersion !== undefined && Number(ifVersion) === version) {
      return c.json({ ok: true, version, changed: false, actions: [] })
    }
    return c.json({ ok: true, version, changed: true, actions: registry.listActions() })
  })

  return app
}
