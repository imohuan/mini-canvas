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
import type { Provider } from '../providers/types.js'

export function actionsRoutes(
  registry: ProviderRegistry,
  /** 宿主注入：按平台 id 查账号清单（拿不到就只有模型行，不出账号二级菜单） */
  accountsOf?: (providerId: string) => Array<{ id: string; name?: string; default?: boolean }>,
): Hono {
  const app = new Hono()

  /**
   * 把「所属平台的图标」贴到每条动作上。
   *
   * 为什么在后台做：前端只拿得到动作清单，拿不到 provider 对象；
   * 而图标兜底需要「动作没写 → 用它所属平台写的」这一层（用户口径 2026-11-10）。
   */
  const withProviderIcons = (): Array<Record<string, unknown>> => {
    const out: Array<Record<string, unknown>> = []
    for (const p of registry.listProviders() as Provider[]) {
      const icon = typeof p.icon === 'string' && p.icon.trim() !== '' ? p.icon : ''
      // 账号清单（多账号时底栏要在模型行右侧出二级菜单；只有一个号就没什么可选）
      const accounts = accountsOf?.(p.id) ?? []
      const defaultAccount = accounts.find((a) => a.default)?.id ?? accounts[0]?.id ?? ''
      for (const a of p.actions) {
        out.push({
          ...a,
          ...(icon ? { providerIcon: icon } : {}),
          ...(accounts.length > 1
            ? {
                accounts: accounts.map((acc) => ({ id: acc.id, name: acc.name ?? acc.id })),
                defaultAccount,
              }
            : {}),
        })
      }
    }
    return out.sort(
      (x, y) =>
        (typeof x.order === 'number' ? x.order : Number.POSITIVE_INFINITY) -
        (typeof y.order === 'number' ? y.order : Number.POSITIVE_INFINITY),
    )
  }

  app.get('/api/actions', (c) => {
    const version = registry.contentVersion
    const ifVersion = c.req.query('ifVersion')
    // 版本没变 → 只回版本号（前端据此跳过重注册，避免无谓的重建）
    if (ifVersion !== undefined && Number(ifVersion) === version) {
      return c.json({ ok: true, version, changed: false, actions: [] })
    }
    return c.json({ ok: true, version, changed: true, actions: withProviderIcons() })
  })

  return app
}
