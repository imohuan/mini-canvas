/**
 * 「发送键」设置（用户口径 2026-10-25）：全局设置 → 目标设置下面多一行，
 * 可选 **Ctrl+回车 / Shift+回车 / 回车**。
 *
 * 为什么单测：这条要把设置页的写入、后台 KV 的键名、Agent 面板的读取**三处对齐**。
 * 任何一处写岔（比如设置页写 `agentComposer`、面板读 `agentSubmitKey`），界面看着正常、
 * 刷新后设置就失效 —— 只有用户改完再刷新才会发现。这里把契约一起钉死。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  AGENT_COMPOSER_PREFS_KEY,
  AGENT_COMPOSER_PREFS_PATH,
  CONFIG_KEYS_PATH,
  DEFAULT_SUBMIT_KEY_MODE,
  loadAgentSettings,
  normalizeSubmitKeyMode,
  saveSubmitKeyMode,
  createAgentSettingsStore,
} from '../composables/agentSettings'
import { __resetKvEventsForTests } from '../composables/kvEvents'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function kvFetch(routes: Record<string, unknown> = {}, opts: { failAll?: boolean } = {}) {
  const puts: Array<{ url: string; body: unknown }> = []
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (opts.failAll) throw new Error('offline')
    if (init?.method === 'PUT') {
      puts.push({ url: u, body: JSON.parse(String(init.body)) })
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    if (u === CONFIG_KEYS_PATH) {
      const values: Record<string, unknown> = {}
      for (const [p, v] of Object.entries(routes)) values[p.split('/').pop()!] = v
      return { ok: true, status: 200, json: async () => ({ ok: true, type: 'config', keys: Object.keys(values), values }) }
    }
    return { ok: false, status: 404, json: async () => ({ ok: false }) }
  })
  return { puts }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  __resetKvEventsForTests()
})

describe('发送键设置的键名 / 路径 / 默认值', () => {
  it('键名与路径固定，默认 Ctrl+回车（保持现有行为）', () => {
    expect(AGENT_COMPOSER_PREFS_KEY).toBe('agentComposerPrefs')
    expect(AGENT_COMPOSER_PREFS_PATH).toBe('/api/kv/config/agentComposerPrefs')
    expect(DEFAULT_SUBMIT_KEY_MODE).toBe('ctrl-enter')
  })

  it('读：没存过 ⇒ 默认；存了 ⇒ 用它；坏值 ⇒ 回落默认', async () => {
    kvFetch()
    expect((await loadAgentSettings()).submitKeyMode).toBe('ctrl-enter')

    kvFetch({ [AGENT_COMPOSER_PREFS_PATH]: { submitKeyMode: 'shift-enter' } })
    expect((await loadAgentSettings()).submitKeyMode).toBe('shift-enter')

    kvFetch({ [AGENT_COMPOSER_PREFS_PATH]: { submitKeyMode: 'nonsense' } })
    expect((await loadAgentSettings()).submitKeyMode).toBe('ctrl-enter')
  })

  it('写：PUT 到 config/agentComposerPrefs，体是 { submitKeyMode }', async () => {
    const { puts } = kvFetch()
    await saveSubmitKeyMode('enter')
    expect(puts).toEqual([{ url: AGENT_COMPOSER_PREFS_PATH, body: { value: { submitKeyMode: 'enter' } } }])
  })

  it('归一化：只认三种，其余回落 ctrl-enter', () => {
    expect(normalizeSubmitKeyMode('ctrl-enter')).toBe('ctrl-enter')
    expect(normalizeSubmitKeyMode('shift-enter')).toBe('shift-enter')
    expect(normalizeSubmitKeyMode('enter')).toBe('enter')
    expect(normalizeSubmitKeyMode(undefined)).toBe('ctrl-enter')
    expect(normalizeSubmitKeyMode('ENTER')).toBe('ctrl-enter')
    expect(normalizeSubmitKeyMode(1)).toBe('ctrl-enter')
  })
});

describe('store：设置页改完立刻进快照，并广播给 Agent 面板', () => {
  it('setSubmitKeyMode：先翻本地快照，再 PUT', async () => {
    const { puts } = kvFetch()
    const store = createAgentSettingsStore()
    await store.reload()

    await store.setSubmitKeyMode('shift-enter')

    expect(store.state.submitKeyMode).toBe('shift-enter')
    expect(puts.some((p) => p.url === AGENT_COMPOSER_PREFS_PATH)).toBe(true)
    store.dispose()
  })

  it('写入后发本地广播事件（同页 Agent 面板立刻生效，不必等刷新）', async () => {
    kvFetch()
    // 这个包的测试跑在 node（没有 window）：装一个最小桩，只验「发了什么事件」
    const seen: unknown[] = []
    const listeners = new Set<(e: Event) => void>()
    vi.stubGlobal('window', {
      dispatchEvent(e: Event) { for (const fn of listeners) fn(e); return true },
      addEventListener(_t: string, fn: (e: Event) => void) { listeners.add(fn) },
      removeEventListener(_t: string, fn: (e: Event) => void) { listeners.delete(fn) },
    })
    vi.stubGlobal('CustomEvent', class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail }
    })
    const store = createAgentSettingsStore()
    await store.reload()
    const on = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener('mini-canvas:agent-composer-prefs-changed', on)

    await store.setSubmitKeyMode('enter')

    window.removeEventListener('mini-canvas:agent-composer-prefs-changed', on)
    expect(seen).toEqual([{ submitKeyMode: 'enter' }])
    store.dispose()
  })
})

describe('设置页 UI：目标设置下面那一行', () => {
  const src = readFileSync(path.resolve(PKG_ROOT, 'src/components/areas/ModalsArea.vue'), 'utf8')

  it('放在「目标设置」之后（用户指的就是这个位置）', () => {
    // 取真实控件的位置（注释里也会出现这两个词，所以要取最后一次 / 带 UI 标记的那处）
    const goalAt = src.lastIndexOf('aria-label="目标默认预算"')
    const sendAt = src.lastIndexOf('aria-label="发送键"')
    expect(goalAt).toBeGreaterThan(-1)
    expect(sendAt).toBeGreaterThan(-1)
    expect(sendAt).toBeGreaterThan(goalAt)
  })

  it('三个选项的文案都在（Ctrl + 回车 / Shift + 回车 / 回车）', () => {
    for (const label of ['Ctrl + 回车', 'Shift + 回车', '回车']) {
      expect(src, '缺少选项：' + label).toContain(label)
    }
  })

  it('控件接的是 store 的 submitKeyMode / setSubmitKeyMode', () => {
    expect(src).toContain('agent.state.submitKeyMode')
    expect(src).toContain('agent.setSubmitKeyMode')
  })
})

describe('Agent 面板：读取同一个键（不自己再造一份）', () => {
  const src = readFileSync(
    path.resolve(PKG_ROOT, '../plugins/plugin-agent/src/components/AgentConversation.vue'),
    'utf8',
  )

  it('订阅设置页的本地广播 + 订阅跨标签页 KV 变更', () => {
    expect(src).toContain('mini-canvas:agent-composer-prefs-changed')
  })
})
