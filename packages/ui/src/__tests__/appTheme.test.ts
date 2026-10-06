/**
 * appTheme —— 首页（项目页）与画布页**共用同一份主题配置**的行为锁。
 *
 * 用户报的问题原话："这两个页面的亮色主题和暗色主题，以及主题颜色都不一样"、
 * "你的主页根本没有使用到我画布中的主题颜色"。
 *
 * 根因：两页各读各的键。画布页读 `config/settings`（一个大对象，themeMode 与配色都在里面），
 * 首页却自己读 `config/themeMode`（一个独立的键），于是同一个用户看到两套值、两套配色。
 * 把"读哪份、写哪份"收进 appTheme 一处之后，两页就不可能再漂移。
 *
 * 这组测试盯的就是那几条容易再次长回来的缝：读错后端、写错键、以及首页偷偷绕过共用层。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  SETTINGS_KV_PATH,
  LEGACY_THEME_MODE_KV_PATH,
  SETTINGS_STORAGE_KEY,
  loadAppSettings,
  applyAppTheme,
  saveThemeMode,
  clearLegacyThemeModeKey,
  watchCloudSettings,
} from '../composables/appTheme'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 假 documentElement：只需 appTheme 真正会碰的那几样（class/dataset/style） */
function fakeRoot() {
  const classes = new Set<string>()
  const inline = new Map<string, string>()
  return {
    classList: {
      toggle: (name: string, on?: boolean) => {
        if (on) classes.add(name)
        else classes.delete(name)
      },
      contains: (name: string) => classes.has(name),
    },
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) => void inline.set(name, value),
      removeProperty: (name: string) => void inline.delete(name),
      getPropertyValue: (name: string) => inline.get(name) ?? '',
    },
    _classes: classes,
    _inline: inline,
  }
}

/** 最小 localStorage 替身（node 环境没有；画布页的本地后端用的就是这个键空间） */
function fakeLocalStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  }
}

describe('首页主题读同一份配置（config/settings）', () => {
  let store: ReturnType<typeof fakeLocalStorage>

  beforeEach(() => {
    store = fakeLocalStorage()
    vi.stubGlobal('localStorage', store)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('优先读云端的 config/settings（与画布页同一个键，不是另一个 themeMode 键）', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url))
      return {
        ok: true,
        status: 200,
        json: async () => ({ value: { themeMode: 'light', accentColorDark: '#7c3aed' } }),
      }
    })

    const result = await loadAppSettings()

    expect(calls).toContain(SETTINGS_KV_PATH)
    expect(result.source).toBe('cloud')
    expect(result.values.themeMode).toBe('light')
    expect(result.values.accentColorDark).toBe('#7c3aed')
  })

  it('读不到云端（后台没连）时，退回浏览器本地那份 config:settings —— 与画布页本地后端同一个 key', async () => {
    store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ themeMode: 'light', accentColorLight: '#ff0000' }))
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })

    const result = await loadAppSettings()

    expect(result.source).toBe('local')
    expect(result.values.themeMode).toBe('light')
    expect(result.values.accentColorLight).toBe('#ff0000')
  })

  it('两处都没有 → 返回空值而不是抛错（首页照常能开）', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })

    const result = await loadAppSettings()

    expect(result.source).toBe('none')
    expect(result.values).toEqual({})
  })

  it('把配置套到页面上：亮/暗模式 + 你的配色都生效（画布页那套函数，不重写一遍）', () => {
    const root = fakeRoot()

    const dispose = applyAppTheme(
      { themeMode: 'light', accentColorDark: '#7c3aed', accentColorLight: '#0891b2' },
      root as unknown as HTMLElement,
    )

    // 主题模式：亮色 → 摘掉 dark class（不再是首页自己那套 data-canvas-theme）
    expect(root._classes.has('dark')).toBe(false)
    // 配色：用户改过的那一格以最高优先级的**内联变量**写进去（与画布页完全同源）
    expect(root._inline.get('--uic-accent-color-dark')).toBe('#7c3aed')
    expect(typeof dispose).toBe('function')
  })

  it('切主题写回同一份 config/settings（读-改-写，不冲掉别人的设置）', async () => {
    const puts: Array<{ url: string; body: unknown }> = []
    const existing = { themeMode: 'dark', accentColorDark: '#7c3aed', snapToGrid: false }
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET'
      if (method === 'PUT') {
        puts.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      return { ok: true, status: 200, json: async () => ({ value: existing }) }
    })

    await saveThemeMode('light')

    expect(puts).toHaveLength(1)
    expect(puts[0].url).toBe(SETTINGS_KV_PATH)
    const value = (puts[0].body as { value: Record<string, unknown> }).value
    expect(value.themeMode).toBe('light')
    // 别的设置原样保留 —— 否则首页切一次主题会把画布页的配色整份抹掉
    expect(value.accentColorDark).toBe('#7c3aed')
    expect(value.snapToGrid).toBe(false)
  })

  it('云端写不进去时，本地那份也要同步更新（下次离线打开首页仍记得）', async () => {
    store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ themeMode: 'dark', accentColorDark: '#7c3aed' }))
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') throw new Error('offline')
      return { ok: true, status: 200, json: async () => ({ value: { themeMode: 'dark', accentColorDark: '#7c3aed' } }) }
    })

    await saveThemeMode('light')

    const written = JSON.parse(store.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(written.themeMode).toBe('light')
    expect(written.accentColorDark).toBe('#7c3aed')
  })

  it('清掉旧的独立 themeMode 键（只删那一个，不碰 config/settings）', async () => {
    const deletes: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        deletes.push(String(url))
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      return { ok: true, status: 200, json: async () => ({ value: {} }) }
    })

    await clearLegacyThemeModeKey()

    expect(deletes).toContain(LEGACY_THEME_MODE_KV_PATH)
    // 绝不能顺手把 config/settings 也删了 —— 那是两页共用的真源
    expect(deletes).not.toContain(SETTINGS_KV_PATH)
  })

  it('清理失败（后台没连）时安静收场，不抛错', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    await expect(clearLegacyThemeModeKey()).resolves.toBeUndefined()
  })
})

/**
 * 源码守卫：全仓不许再出现旧的 `config/themeMode` 这个键。
 *
 * 为什么值得单开一条：两套配置的 bug 是"写代码时看不出、只有用户同时开两个页面才暴露"的那种。
 * 光靠读代码难以挡住它慢慢长回来，用一条扫描把它钉死。
 */
describe('两套配置的老路不许复活', () => {
  it('源码里不再有任何地方读写独立的 themeMode KV 键（一律走 config/settings）', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        // appTheme.ts 是**唯一**允许记得旧键的模块（它负责把旧键清掉），跳过它本身
        else if (name === 'appTheme.ts') continue
        else if (/\.(vue|ts)$/.test(name)) {
          const src = readFileSync(full, 'utf-8')
          if (src.includes(LEGACY_THEME_MODE_KV_PATH)) {
            offenders.push(path.relative(PKG_ROOT, full).replace(/\\/g, '/'))
          }
        }
      }
    }
    for (const sub of ['components', 'composables']) walk(path.join(PKG_ROOT, 'src', sub))

    expect(offenders, `这些文件仍在用旧键 ${LEGACY_THEME_MODE_KV_PATH}，请改走 appTheme：\n${offenders.join('\n')}`).toEqual([])
  })
})

/**
 * 跨标签页实时同步：别的页面（画布页/另一个首页标签）改了配置，已打开的首页要**立刻**跟上，
 * 不该等用户手动刷新。
 *
 * 用户实测场景：两个标签页开着，在画布页把强调色改了，另一个标签页的首页还是旧颜色 ——
 * 因为首页只在挂载时读一次。接上后台的 KV 变更广播（/api/kv/events）后这才闭环。
 */
describe('首页订阅配置变更（跨标签页实时同步）', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = []
    url: string
    onmessage: ((e: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    closed = false
    constructor(url: string) {
      this.url = url
      FakeEventSource.instances.push(this)
    }
    close(): void {
      this.closed = true
    }
    /** 测试用：模拟服务端广播一条 KV 变更 */
    emit(type: string, key: string): void {
      this.onmessage?.({ data: JSON.stringify({ type, key }) })
    }
  }

  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource as unknown)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('config/settings 变了 → 重新读一份并回调（带上最新值）', async () => {
    const seen: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', async (url: string) => {
      expect(String(url)).toBe(SETTINGS_KV_PATH)
      return { ok: true, status: 200, json: async () => ({ value: { themeMode: 'dark', accentColorDark: '#920000' } }) }
    })

    const dispose = watchCloudSettings((v) => void seen.push(v))
    const es = FakeEventSource.instances[0]
    expect(es).toBeTruthy()
    expect(es.url).toBe('/api/kv/events')

    es.emit('config', 'settings')
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0].themeMode).toBe('dark')
    expect(seen[0].accentColorDark).toBe('#920000')

    // 别的 key 变了不触发（比如 plugin-manager:installed）
    es.emit('config', 'plugin-manager:installed')
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toHaveLength(1)

    dispose()
    expect(es.closed).toBe(true)
  })

  it('服务端广播断线/坏数据时安静收场，不抛错', async () => {
    const seen: unknown[] = []
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    const dispose = watchCloudSettings((v) => void seen.push(v))
    const es = FakeEventSource.instances[0]
    es.onmessage?.({ data: 'not-json' })
    es.emit('config', 'settings')
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toHaveLength(0)
    dispose()
    expect(es.closed).toBe(true)
  })
})
