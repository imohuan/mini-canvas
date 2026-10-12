/**
 * 通知模块（G11）：解析口径、弹通知三态、提示音、读 KV、文案。
 *
 * 测试环境是 node（没有 Notification / AudioContext / fetch），所以：
 *   1. 每个用例都走**注入的假对象**，不碰真全局；
 *   2. 断言不只「返回值是多少」，还要看「该不该碰浏览器对象」——
 *      开关关着时用「一碰就抛」的假对象兜底：实现里多碰一下，测试立刻红。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseNotifyPrefs,
  loadNotifyPrefs,
  notifyPayload,
  showNotify,
  playNotifySound,
  DEFAULT_NOTIFY_PREFS,
} from '../agentNotify'
import type { AgentNotifyPrefs } from '../agentNotify'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

/** 假 Notification：静态带 permission，记录被 new 出来的实例（记 title / body） */
function fakeNotification(permission: string): {
  deps: { Notification: typeof Notification }
  made: Array<{ title: string; body?: string }>
} {
  const made: Array<{ title: string; body?: string }> = []
  function FakeNotification(this: unknown, title: string, opts?: { body?: string }): void {
    made.push({ title, body: opts?.body })
  }
  const ctor = FakeNotification as unknown as { permission: string }
  ctor.permission = permission
  return { deps: { Notification: ctor as unknown as typeof Notification }, made }
}

/** 假 AudioContext：记录 createOscillator / createGain / connect / start 等各被调了几次 */
function fakeAudio(): {
  deps: { audioContext: typeof AudioContext }
  calls: { oscillator: number; gain: number; connect: number; start: number; frequency: number }
} {
  const calls = { oscillator: 0, gain: 0, connect: 0, start: 0, frequency: 0 }
  const param = (): { value: number; setValueAtTime: () => void; exponentialRampToValueAtTime: () => void } => ({
    // 频率被赋值（默认 880）也记一笔
    set value(_v: number) {
      calls.frequency++
    },
    get value(): number {
      return 0
    },
    setValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  })
  class FakeAudioContext {
    currentTime = 0
    destination = {}
    createOscillator(): {
      type: string
      frequency: ReturnType<typeof param>
      connect: () => void
      start: (t: number) => void
      stop: (t: number) => void
    } {
      calls.oscillator++
      return {
        type: 'sine',
        frequency: param(),
        connect: () => {
          calls.connect++
        },
        start: () => {
          calls.start++
        },
        stop: () => undefined,
      }
    }
    createGain(): { gain: ReturnType<typeof param>; connect: () => void } {
      calls.gain++
      return {
        gain: param(),
        connect: () => {
          calls.connect++
        },
      }
    }
    close(): Promise<void> {
      return Promise.resolve()
    }
  }
  return { deps: { audioContext: FakeAudioContext as unknown as typeof AudioContext }, calls }
}

/** 假 fetch：记录请求的路径，返回指定状态的 JSON 响应 */
function fakeFetch(status: number, body: unknown): { f: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const f = (async (url: string) => {
    urls.push(String(url))
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { f, urls }
}

describe('parseNotifyPrefs', () => {
  it('缺省（用户从没动过开关）→ 回落默认值（都开），与设置弹窗显示一致', () => {
    // 曾经这里是「全 false」—— 而设置弹窗读不到键时显示「开」，两边打架就出现
    // 「界面显示开着、实际一条通知都不弹」（用户报的 bug）。
    for (const raw of [undefined, null]) {
      expect(parseNotifyPrefs(raw)).toEqual({ notify: true, sound: true })
    }
  })

  it('非布尔垃圾值 → 回落默认值，不会因为值是垃圾就变成全关', () => {
    for (const raw of ['x', 0, '', []]) {
      expect(parseNotifyPrefs(raw)).toEqual({ notify: true, sound: true })
    }
    // 对象里字段是垃圾值：那一格回落默认值，另一格不受牵连
    expect(parseNotifyPrefs({})).toEqual({ notify: true, sound: true })
  })

  it('护栏：插件的缺省值必须与设置弹窗的 DEFAULT_AGENT_NOTIFY 逐字一致（防再次漂移）', () => {
    // 两处默认值分散在两个包（依赖方向 plugins → ui 走不通，没法共享常量），
    // 只能靠这条测试当桥：谁改了 ui 那份、没改插件这份，这里立刻红。
    const uiSrc = read('../../../../ui/src/composables/agentSettings.ts')
    const m = uiSrc.match(/DEFAULT_AGENT_NOTIFY[^=]*=\s*\{\s*browser:\s*(true|false),\s*sound:\s*(true|false)\s*\}/)
    expect(m, '在 ui 的 agentSettings.ts 里没找到 DEFAULT_AGENT_NOTIFY 的布尔字面量（口径变了？请同步本条测试）').toBeTruthy()
    const uiDefault = { notify: m![1] === 'true', sound: m![2] === 'true' }
    expect(DEFAULT_NOTIFY_PREFS).toEqual(uiDefault)
  })

  it('护栏：摘要压缩用的是「空白」正则（\\s+），不是丢反斜杠的 /s+/', () => {
    // 曾经写成 /s+/g：它匹配字母 s，于是换行原样留在通知正文里、正文里所有 s 还被
    // 换成空格（真机实测）。这条守卫直接读组件源码，防止再手滑敲掉那个反斜杠。
    const vue = read('../components/AgentConversation.vue')
    expect(vue).toContain(".replace(/\\s+/g, ' ')")
    expect(vue).not.toContain(".replace(/s+/g, ' ')")
  })

  it('护栏：每轮开跑时重读一次通知开关（设置里改了要立刻生效，不必刷新页面）', () => {
    // 开关只挂载时读一次的话，用户中途关掉它、当前页面照样弹（实测）。
    const vue = read('../components/AgentConversation.vue')
    const onRunStart = vue.indexOf('queueAtRunStart = queue.value.count')
    expect(onRunStart, '没找到「一轮开跑」那段 watch').toBeGreaterThan(-1)
    // 同一条分支里必须紧接着重读开关
    const after = vue.slice(onRunStart, onRunStart + 400)
    expect(after).toContain('refreshNotifyPrefs()')
  })

  it('旧形状：整键就是一个布尔 → 两个开关都跟着它', () => {
    expect(parseNotifyPrefs(true)).toEqual({ notify: true, sound: true })
    expect(parseNotifyPrefs(false)).toEqual({ notify: false, sound: false })
  })

  it('新形状：notify / sound 各认各的，缺的那格回落默认值（开）', () => {
    // 缺的那格必须跟设置弹窗一致（弹窗读缺键 = 显示「开」），不能悄悄变成关。
    expect(parseNotifyPrefs({ notify: true })).toEqual({ notify: true, sound: true })
    expect(parseNotifyPrefs({ sound: true })).toEqual({ notify: true, sound: true })
    expect(parseNotifyPrefs({ notify: true, sound: true })).toEqual({ notify: true, sound: true })
  })

  it('设置弹窗可能用 browser 这个词：browser 与 notify 等价', () => {
    expect(parseNotifyPrefs({ browser: true, sound: false })).toEqual({ notify: true, sound: false })
    expect(parseNotifyPrefs({ browser: true })).toEqual({ notify: true, sound: true })
  })

  it('显式 false 必须尊重：另一个字段为真也不改它', () => {
    expect(parseNotifyPrefs({ notify: false, sound: true })).toEqual({ notify: false, sound: true })
    expect(parseNotifyPrefs({ sound: false, notify: true })).toEqual({ notify: true, sound: false })
  })

  it('字段在但值是 undefined → 回落默认值（不因为键存在就当真）', () => {
    expect(parseNotifyPrefs({ sound: undefined, notify: undefined })).toEqual({ notify: true, sound: true })
  })

  it('字段是字符串 true / 数字 1 这类「看着像」的值 → 不算，回落默认值', () => {
    expect(parseNotifyPrefs({ notify: 'true', sound: 1 })).toEqual({ notify: true, sound: true })
  })
})

describe('notifyPayload', () => {
  it('标题用会话名，正文带上最后一句摘要', () => {
    const p = notifyPayload('round_done', { title: '会话A', summary: '写完了' })
    expect(p.title).toContain('会话A')
    expect(p.body).toContain('写完了')
  })

  it('没有标题 → 兜底 Agent；标题只有空白也兜底', () => {
    expect(notifyPayload('round_done', {}).title).toBe('Agent')
    expect(notifyPayload('round_done', { title: '   ' }).title).toBe('Agent')
  })

  it('没有摘要 / 空白摘要 → 不崩，正文仍是通用文案', () => {
    expect(notifyPayload('round_done', { title: '会话A' }).body.length).toBeGreaterThan(0)
    expect(notifyPayload('round_done', { title: '会话A', summary: '   ' }).body.length).toBeGreaterThan(0)
  })

  it('两种时机的正文必须不同（用户要能分清是哪种）', () => {
    const round = notifyPayload('round_done', { title: '会话A' })
    const idle = notifyPayload('queue_idle', { title: '会话A' })
    expect(round.body).not.toBe(idle.body)
  })
})

describe('showNotify', () => {
  it('开关关 → skipped，连 Notification 都不构造（假对象会抛，证明没被碰）', () => {
    const boom = {
      get Notification(): never {
        throw new Error('不该构造 Notification')
      },
    }
    for (const prefs of [
      { notify: false, sound: false },
      { notify: false, sound: true },
    ]) {
      expect(showNotify('round_done', {}, prefs, boom)).toBe('skipped')
    }
  })

  it('permission 是 default / denied → unsupported', () => {
    expect(showNotify('round_done', {}, { notify: true, sound: false }, fakeNotification('default').deps)).toBe('unsupported')
    expect(showNotify('round_done', {}, { notify: true, sound: false }, fakeNotification('denied').deps)).toBe('unsupported')
  })

  it('permission 是 granted → shown，且 title / body 与 notifyPayload 一致', () => {
    const { deps, made } = fakeNotification('granted')
    const opts = { title: '会话A', summary: '写完了' }
    expect(showNotify('round_done', opts, { notify: true, sound: false }, deps)).toBe('shown')
    const want = notifyPayload('round_done', opts)
    expect(made).toHaveLength(1)
    expect(made[0].title).toBe(want.title)
    expect(made[0].body).toBe(want.body)
  })
})

describe('playNotifySound', () => {
  it('sound 关 → false，且未构造 AudioContext（假对象会抛，证明没被碰）', () => {
    const boom = {
      get audioContext(): never {
        throw new Error('不该构造 AudioContext')
      },
    }
    // 用法细则里就是「只给 sound 一格」的裸对象；类型上补个断言，模拟 JS 调用方
    expect(playNotifySound({ sound: false } as AgentNotifyPrefs, boom)).toBe(false)
    // notify 为真也不带来声音：两个开关各管各的
    expect(playNotifySound({ notify: true, sound: false }, boom)).toBe(false)
  })

  it('sound 开（notify 关也一样响）→ true，并真的走完振荡器接线', () => {
    const { deps, calls } = fakeAudio()
    expect(playNotifySound({ sound: true, notify: false }, deps)).toBe(true)
    expect(calls.oscillator).toBe(1)
    expect(calls.gain).toBe(1)
    expect(calls.connect).toBe(2) // 振荡器 → 增益，增益 → 输出
    expect(calls.start).toBe(1)
    expect(calls.frequency).toBeGreaterThanOrEqual(1) // 频率设成了某个数（默认 880）
  })

  it('构造 AudioContext 抛错 → false（不抛）', () => {
    const boom = {
      audioContext: function Boom(this: unknown): void {
        throw new Error('自动播放被拒')
      } as unknown as typeof AudioContext,
    }
    expect(playNotifySound({ sound: true, notify: false }, boom)).toBe(false)
  })
})

describe('loadNotifyPrefs', () => {
  it('走 config 批量口（不再逐键 GET，避免没存过时刷 404）', async () => {
    const { f, urls } = fakeFetch(200, { value: { notify: true, sound: false } })
    await loadNotifyPrefs({ fetchImpl: f })
    expect(urls[0]).toBe('/api/kv/config?values=1')
  })

  it('批量口的 { values: { agentNotify } } → 正常解析', async () => {
    const { f } = fakeFetch(200, { values: { agentNotify: { notify: true, sound: true } } })
    expect(await loadNotifyPrefs({ fetchImpl: f })).toEqual({ notify: true, sound: true })
  })

  it('批量口里没有这个键（用户从没动过开关）→ 回落默认值（都开），且没产生 404 请求', async () => {
    // 这条就是「通知没效果」的回归测试：键不存在时**不能**当全关。
    const { f, urls } = fakeFetch(200, { values: {} })
    expect(await loadNotifyPrefs({ fetchImpl: f })).toEqual({ notify: true, sound: true })
    expect(urls[0]).not.toContain('agentNotify')
  })

  it('404（后台读不到，不是「用户没设过」）→ 全 false 静默', async () => {
    const { f } = fakeFetch(404, { ok: false, error: '未保存过' })
    expect(await loadNotifyPrefs({ fetchImpl: f })).toEqual({ notify: false, sound: false })
  })

  it('200 体 { value: { notify: true } } → notify 开、sound 回落默认值（开）', async () => {
    const { f } = fakeFetch(200, { value: { notify: true } })
    expect(await loadNotifyPrefs({ fetchImpl: f })).toEqual({ notify: true, sound: true })
  })

  it('fetch 抛错 → 全 false，不抛（后台没起也不能白屏）', async () => {
    const f = (async () => {
      throw new Error('连不上')
    }) as unknown as typeof fetch
    await expect(loadNotifyPrefs({ fetchImpl: f })).resolves.toEqual({ notify: false, sound: false })
  })

  it('baseUrl 拼在路径前面（云端托管时用）', async () => {
    const { f, urls } = fakeFetch(200, { value: true })
    await loadNotifyPrefs({ fetchImpl: f, baseUrl: 'http://127.0.0.1:5210/' })
    expect(urls[0]).toBe('http://127.0.0.1:5210/api/kv/config?values=1')
  })
})
