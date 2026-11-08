/**
 * 图标清单接口：provider 作者靠它确认「icon 能写什么」。
 *
 * 三个契约：
 * 1. 清单包含全部平台，每个都有 key / 名字 / 能认的别名；
 * 2. 每个别名都能被 `platformOfIconHint` 认出，且认回的正是那个 key；
 * 3. 认不出的写法如实回 matched:false，不假装命中。
 */
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { iconRoutes, ICON_ALIASES } from '../routes/icons'
import { agentRoutes } from '../routes/agent'
import { createModelIconService } from '../../ui/render/modelIconService'
import { MODEL_BRAND_ICONS } from '../../ui/render/modelBrandIcons'

function makeApp() {
  const app = new Hono()
  app.route('/', iconRoutes())
  return app
}
const j = (r: Response) => r.json() as Promise<any>

describe('GET /api/agent/icons', () => {
  it('列出全部平台', async () => {
    const body = await j(await makeApp().request('/api/agent/icons'))
    expect(body.ok).toBe(true)
    expect(body.count).toBe(Object.keys(MODEL_BRAND_ICONS).length)
    const keys = body.platforms.map((p: { key: string }) => p.key)
    for (const key of Object.keys(MODEL_BRAND_ICONS)) expect(keys).toContain(key)
  })

  it('每个平台都有展示名与别名数组', async () => {
    const body = await j(await makeApp().request('/api/agent/icons'))
    for (const p of body.platforms) {
      expect(typeof p.name).toBe('string')
      expect(p.name.length).toBeGreaterThan(0)
      expect(Array.isArray(p.aliases)).toBe(true)
      expect(p.aliases.length, p.key + ' 没有别名').toBeGreaterThan(0)
    }
  })
})

describe('别名的真实性：列出什么就必须真能认', () => {
  const svc = createModelIconService()

  it('每个别名都能认回它所属的 key', () => {
    const wrong: string[] = []
    for (const [key, aliases] of Object.entries(ICON_ALIASES)) {
      for (const alias of aliases) {
        const got = svc.platformOfIconHint(alias)
        if (got !== key) wrong.push(alias + ' → ' + (got || '(认不出)') + '，期望 ' + key)
      }
    }
    expect(wrong).toEqual([])
  })

  it('每个平台 key 自己都能命中', () => {
    for (const key of Object.keys(MODEL_BRAND_ICONS)) {
      expect(svc.platformOfIconHint(key), key).toBe(key)
    }
  })

  it('ICON_ALIASES 覆盖了全部平台（漏一个就会在清单页看不到示例）', () => {
    const missing = Object.keys(MODEL_BRAND_ICONS).filter((k) => !(k in ICON_ALIASES))
    expect(missing).toEqual([])
  })
})

describe('GET /api/agent/icons/:hint', () => {
  it('认得出的写法回 key 与名字', async () => {
    const body = await j(await makeApp().request('/api/agent/icons/' + encodeURIComponent('火山引擎')))
    expect(body.matched).toBe(true)
    expect(body.key).toBe('volcengine')
    expect(body.name).toBe('火山引擎')
  })

  it('平台 key 原样查也认', async () => {
    const body = await j(await makeApp().request('/api/agent/icons/seedance'))
    expect(body.matched).toBe(true)
    expect(body.key).toBe('seedance')
  })

  it('认不出回 matched:false（不是 404）', async () => {
    const res = await makeApp().request('/api/agent/icons/' + encodeURIComponent('完全不认识的词'))
    expect(res.status).toBe(200)
    const body = await j(res)
    expect(body.matched).toBe(false)
    expect(body.key).toBe('')
  })

  it('大小写与空白不影响', async () => {
    const body = await j(await makeApp().request('/api/agent/icons/' + encodeURIComponent('  KLING ')))
    expect(body.key).toBe('kling')
  })
})

describe('真实挂载点：agentRoutes 里带上了图标清单', () => {
  it('agent 路由根部包含 /api/agent/icons', async () => {
    const app = new Hono()
    // 只验挂载：服务给最小桩，图标清单本身不依赖它们
    app.route('/', agentRoutes({} as never, { getPolicy: () => ({ enabled: false, rules: [] }) } as never))
    const res = await app.request('/api/agent/icons')
    expect(res.status).toBe(200)
    const body = await j(res)
    expect(body.ok).toBe(true)
    expect(body.count).toBeGreaterThan(0)
  })
})

describe('GET /api/agent/icons.svg', () => {
  it('给出每个平台的完整 svg（可直接 v-html）', async () => {
    const body = await j(await makeApp().request('/api/agent/icons.svg'))
    expect(body.platforms.length).toBe(Object.keys(MODEL_BRAND_ICONS).length)
    for (const p of body.platforms) {
      expect(p.svg.startsWith('<svg')).toBe(true)
      expect(p.svg).toContain('viewBox')
    }
  })
})
