/**
 * agentSettings —— TV DIRECTOR 全局设置里「后台对话 / 通知 / 目标预算」的行为锁。
 *
 * 为什么值得单开一条：这三个开关曾经是**死的**（点了只翻本地状态，刷新就丢，后台也读不到）。
 * 接真之后最容易再坏的方式是"键名 / 路径 / 默认值被各写一份"—— 那是肉眼看不出来、
 * 只有用户刷新或开第二个标签页才暴露的漂移。这条测试把契约钉死：
 *
 *   路径 = /api/kv/config/{agentRunMode, agentNotify, agentGoalDefaults}
 *   默认 = background / { browser: true, sound: true } / 50000
 *   后台没起 → 安静回落默认，绝不抛（首屏不能因为后台没起就白屏）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  AGENT_RUN_MODE_PATH,
  AGENT_NOTIFY_PATH,
  AGENT_GOAL_DEFAULTS_PATH,
  DEFAULT_AGENT_GOAL_BUDGET,
  DEFAULT_AGENT_NOTIFY,
  DEFAULT_AGENT_RUN_MODE,
  createAgentSettingsStore,
  loadAgentSettings,
  normalizeGoalBudget,
  saveAgentGoalBudget,
  saveAgentNotify,
  saveAgentRunMode,
  watchAgentSettings,
} from '../composables/agentSettings'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 假后台：GET 按路径给值（没登记的路径回 404 = 从未保存过）；PUT 记账 */
function kvFetch(routes: Record<string, unknown> = {}, opts: { failAll?: boolean } = {}) {
  const puts: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (opts.failAll) throw new Error('offline')
    if (init?.method === 'PUT') {
      puts.push({ url: u, body: JSON.parse(String(init.body)) })
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (!(u in routes)) return { ok: false, status: 404, json: async () => ({ ok: false, error: '未保存过' }) }
    return { ok: true, status: 200, json: async () => ({ value: routes[u] }) }
  })
  return puts
}

describe('三个键的路径与默认值（设计 §3.6.3 定死的契约）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('路径照设计：config/agentRunMode、config/agentNotify、config/agentGoalDefaults', () => {
    expect(AGENT_RUN_MODE_PATH).toBe('/api/kv/config/agentRunMode')
    expect(AGENT_NOTIFY_PATH).toBe('/api/kv/config/agentNotify')
    expect(AGENT_GOAL_DEFAULTS_PATH).toBe('/api/kv/config/agentGoalDefaults')
  })

  it('默认值：后台对话默认开（background）、通知与声音默认开、默认预算 50000', async () => {
    kvFetch() // 三个键都没保存过 → 全 404

    const s = await loadAgentSettings()

    expect(s.runMode).toBe('background')
    expect(s.runMode).toBe(DEFAULT_AGENT_RUN_MODE)
    expect(s.notify).toEqual({ browser: true, sound: true })
    expect(DEFAULT_AGENT_NOTIFY).toEqual({ browser: true, sound: true })
    expect(s.goalBudget).toBe(50000)
    expect(DEFAULT_AGENT_GOAL_BUDGET).toBe(50000)
  })

  it('后台读不到（没起/断网）→ 回落默认，不抛异常', async () => {
    kvFetch({}, { failAll: true })

    const s = await loadAgentSettings()

    expect(s).toEqual({ runMode: 'background', notify: { browser: true, sound: true }, goalBudget: 50000 })
  })

  it('读 KV 的值能覆盖默认值（刷新后保持）', async () => {
    kvFetch({
      [AGENT_RUN_MODE_PATH]: 'followTab',
      [AGENT_NOTIFY_PATH]: { browser: false, sound: true },
      [AGENT_GOAL_DEFAULTS_PATH]: { budget: 12000 },
    })

    const s = await loadAgentSettings()

    expect(s.runMode).toBe('followTab')
    expect(s.notify).toEqual({ browser: false, sound: true })
    expect(s.goalBudget).toBe(12000)
  })

  it('存了 { budget: 0 } 就是用户明确选的"不限"，不能被默认值盖回去', async () => {
    kvFetch({ [AGENT_GOAL_DEFAULTS_PATH]: { budget: 0 } })

    const s = await loadAgentSettings()

    expect(s.goalBudget).toBe(0)
  })

  it('坏数据（值形状不对）逐格回落默认，而不是把开关变成未定义行为', async () => {
    kvFetch({
      [AGENT_RUN_MODE_PATH]: 'whatever',
      [AGENT_NOTIFY_PATH]: { browser: 'yes' },
      [AGENT_GOAL_DEFAULTS_PATH]: { budget: 'abc' },
    })

    const s = await loadAgentSettings()

    expect(s.runMode).toBe('background')
    expect(s.notify).toEqual({ browser: true, sound: true })
    expect(s.goalBudget).toBe(0) // 键在、但值坏 → 归一化成"不限"，不是默认 50000
  })
})

describe('写：PUT 到正确的路径与体（体契约 { value }）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('后台对话：PUT config/agentRunMode，值就是 background / followTab', async () => {
    const puts = kvFetch()

    await saveAgentRunMode('followTab')
    await saveAgentRunMode('background')

    expect(puts.map((p) => p.url)).toEqual([AGENT_RUN_MODE_PATH, AGENT_RUN_MODE_PATH])
    expect(puts[0].body).toEqual({ value: 'followTab' })
    expect(puts[1].body).toEqual({ value: 'background' })
  })

  it('通知：PUT config/agentNotify，体是 { browser, sound } 整份', async () => {
    const puts = kvFetch()

    await saveAgentNotify({ browser: false, sound: true })

    expect(puts).toHaveLength(1)
    expect(puts[0].url).toBe(AGENT_NOTIFY_PATH)
    expect(puts[0].body).toEqual({ value: { browser: false, sound: true } })
  })

  it('目标预算：PUT config/agentGoalDefaults，体是 { budget }；留空/非法收成 0（不限）', async () => {
    const puts = kvFetch()

    await saveAgentGoalBudget(50000)
    await saveAgentGoalBudget('')
    await saveAgentGoalBudget(-3)

    expect(puts.map((p) => p.url)).toEqual([AGENT_GOAL_DEFAULTS_PATH, AGENT_GOAL_DEFAULTS_PATH, AGENT_GOAL_DEFAULTS_PATH])
    expect(puts[0].body).toEqual({ value: { budget: 50000 } })
    expect(puts[1].body).toEqual({ value: { budget: 0 } })
    expect(puts[2].body).toEqual({ value: { budget: 0 } })
  })

  it('写失败（后台没起）安静收场：不抛，内存里的值由 store 负责已更新', async () => {
    kvFetch({}, { failAll: true })

    await expect(saveAgentRunMode('followTab')).resolves.toBeUndefined()
    await expect(saveAgentNotify({ browser: false, sound: false })).resolves.toBeUndefined()
    await expect(saveAgentGoalBudget(8000)).resolves.toBe(8000)
  })

  it('预算归一化：小数取整、空白收缩、非数字/负数 = 0', () => {
    expect(normalizeGoalBudget('1200.7')).toBe(1200)
    expect(normalizeGoalBudget('  8000  ')).toBe(8000)
    expect(normalizeGoalBudget('')).toBe(0)
    expect(normalizeGoalBudget('abc')).toBe(0)
    expect(normalizeGoalBudget(0)).toBe(0)
    expect(normalizeGoalBudget(-100)).toBe(0)
  })
})

describe('store：弹窗绑的响应式快照 + 写入口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('启动自动读一份后台，读到就覆盖默认值', async () => {
    kvFetch({
      [AGENT_RUN_MODE_PATH]: 'followTab',
      [AGENT_NOTIFY_PATH]: { browser: false, sound: false },
      [AGENT_GOAL_DEFAULTS_PATH]: { budget: 777 },
    })
    const store = createAgentSettingsStore()

    await vi.waitFor(() => expect(store.state.runMode).toBe('followTab'))
    expect(store.state.notify).toEqual({ browser: false, sound: false })
    expect(store.state.goalBudget).toBe(777)
    store.dispose()
  })

  it('启动读失败时保持默认值，不抛（首屏容错）', async () => {
    kvFetch({}, { failAll: true })
    const store = createAgentSettingsStore()

    await store.reload()

    expect(store.state.runMode).toBe('background')
    expect(store.state.notify).toEqual({ browser: true, sound: true })
    expect(store.state.goalBudget).toBe(50000)
    store.dispose()
  })

  it('三个写入口：先翻本地快照（界面立刻响应），再 PUT 到各自的路经', async () => {
    const puts = kvFetch()
    const store = createAgentSettingsStore()
    await store.reload()

    await store.setRunMode('followTab')
    expect(store.state.runMode).toBe('followTab')

    await store.setNotify({ browser: false })
    expect(store.state.notify).toEqual({ browser: false, sound: true }) // 只翻传进来的那一格

    const normalized = await store.setGoalBudget('900')
    expect(normalized).toBe(900)
    expect(store.state.goalBudget).toBe(900)

    expect(puts.map((p) => p.url)).toEqual([AGENT_RUN_MODE_PATH, AGENT_NOTIFY_PATH, AGENT_GOAL_DEFAULTS_PATH])
    expect(puts[0].body).toEqual({ value: 'followTab' })
    expect(puts[1].body).toEqual({ value: { browser: false, sound: true } })
    expect(puts[2].body).toEqual({ value: { budget: 900 } })
    store.dispose()
  })
})

describe('跨标签页同步：订阅 /api/kv/events，只认这三个键', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = []
    url: string
    onmessage: ((e: { data: string }) => void) | null = null
    closed = false
    constructor(url: string) {
      this.url = url
      FakeEventSource.instances.push(this)
    }
    close(): void {
      this.closed = true
    }
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
    vi.restoreAllMocks()
  })

  it('agentRunMode 变了 → 重读一份并回调；别的 config 键不打扰', async () => {
    kvFetch({ [AGENT_RUN_MODE_PATH]: 'followTab' })
    const seen: string[] = []

    const dispose = watchAgentSettings((s) => void seen.push(s.runMode))
    const es = FakeEventSource.instances[0]
    expect(es.url).toBe('/api/kv/events')

    es.emit('config', 'agentRunMode')
    await vi.waitFor(() => expect(seen).toEqual(['followTab']))

    // 与这三项无关的键（例：主题 / 插件清单）不该触发重读
    es.emit('config', 'settings')
    es.emit('config', 'plugin-manager:installed')
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toHaveLength(1)

    dispose()
    expect(es.closed).toBe(true)
  })

  it('坏广播数据被忽略；读到断线时回调拿到默认值，全程不抛', async () => {
    kvFetch({}, { failAll: true })
    const seen: unknown[] = []
    const dispose = watchAgentSettings((v) => void seen.push(v))
    const es = FakeEventSource.instances[0]

    // 坏数据（不是 JSON）直接忽略，连读都不读
    es.onmessage?.({ data: 'not-json' })
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toHaveLength(0)

    // 真广播但后台读不到：安静回落默认值，不抛
    es.emit('config', 'agentNotify')
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual({ runMode: 'background', notify: { browser: true, sound: true }, goalBudget: 50000 })
    dispose()
  })
})

/**
 * 源码守卫：那两个"死开关"不许写回来。
 *
 * 曾经的样子是直接绑 s.director.notify / s.director.sound（组件里的本地状态），点了只翻自己、
 * 刷新即丢、后台永远读不到。这条把"必须经过 agentSettings"钉住。
 */
describe('设置弹窗必须绑 agentSettings（死开关不许复活）', () => {
  it('ModalsArea.vue 里没有 s.director.notify / s.director.sound，且三个新项都在', () => {
    const src = readFileSync(path.join(PKG_ROOT, 'src/components/areas/ModalsArea.vue'), 'utf-8')

    expect(src).not.toContain('s.director.notify')
    expect(src).not.toContain('s.director.sound')
    expect(src).toContain('useAgentSettings')
    expect(src).toContain('agent.state.runMode')
    expect(src).toContain('agent.state.notify.browser')
    expect(src).toContain('agent.state.notify.sound')
    expect(src).toContain('agent.state.goalBudget')
    // 目标预算落在 KV 里而不是组件内（输入框提交走 agent.setGoalBudget）
    expect(src).toContain('agent.setGoalBudget')
    // 用户口径的说明文字（设计 §3.6.3 的两行说明）
    expect(src).toContain('离开或关闭浏览器也会进行')
    expect(src).toContain('点 + 选目标时用这里的默认预算')
  })
})
