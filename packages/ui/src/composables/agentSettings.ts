/**
 * agentSettings —— TV DIRECTOR 全局设置里「后台对话 / 通知 / 目标预算」的读写入口。
 *
 * 三个键（设计 §3.6.3 / 实现计划 Task 5.1 已定死，别自创别的路径）：
 *   config/agentRunMode      'background' | 'followTab'  —— 「后台对话」开关
 *   config/agentNotify       { browser, sound }          —— 「浏览器通知 / 通知声音」
 *   config/agentGoalDefaults { budget }                  —— 「目标设置」的默认预算
 *
 * 为什么收在一个模块里、而不是组件里就地 fetch：
 *   - 这三个键**后台也在读**（后台按 agentRunMode 决定断线时 abort 不 abort），
 *     路径/键名/默认值在两处各写一份就会漂移 —— appTheme 那次"两套主题"的教训；
 *   - 读写都要容错：后台没起时首屏用默认值，不报错、不白屏。
 *
 * 与 appTheme 的一处**有意不同**：这里不做 localStorage 回落。这三个键的权威值在后台，
 * 本地再存一份就等于又造一个"第二真源"（后台读不到它，行为会两套）。后台不可达时
 * 改动只活在内存里，刷新后回到默认值 —— 这是说真话的降级。
 */
import { reactive } from 'vue'

/** 三个键的裸 key（KV 路径由它拼出来，与 appTheme 同一套命名习惯） */
export const AGENT_RUN_MODE_KEY = 'agentRunMode'
export const AGENT_NOTIFY_KEY = 'agentNotify'
export const AGENT_GOAL_DEFAULTS_KEY = 'agentGoalDefaults'
/** 云端 KV 路径：config 作用域，接口见 cloud-server 的 routes/kv.ts（GET/PUT /api/kv/:type/:key） */
export const AGENT_RUN_MODE_PATH = '/api/kv/config/' + AGENT_RUN_MODE_KEY
export const AGENT_NOTIFY_PATH = '/api/kv/config/' + AGENT_NOTIFY_KEY
export const AGENT_GOAL_DEFAULTS_PATH = '/api/kv/config/' + AGENT_GOAL_DEFAULTS_KEY

/** 「后台对话」两种模式：background=开（连接断了这一轮也跑完）；followTab=关（旧行为，断线 abort） */
export type AgentRunMode = 'background' | 'followTab'
export interface AgentNotifySettings {
  browser: boolean
  sound: boolean
}
export interface AgentGoalDefaults {
  budget: number
}
/** 一份完整设置快照（设置弹窗绑的就是它） */
export interface AgentSettings {
  runMode: AgentRunMode
  notify: AgentNotifySettings
  /** 目标默认预算；0 = 不限 */
  goalBudget: number
}

/** 默认值：后台对话默认开（§3.2）；两个通知默认开；默认预算 50000 */
export const DEFAULT_AGENT_RUN_MODE: AgentRunMode = 'background'
export const DEFAULT_AGENT_NOTIFY: AgentNotifySettings = { browser: true, sound: true }
export const DEFAULT_AGENT_GOAL_BUDGET = 50000
export const AGENT_SETTINGS_DEFAULTS: AgentSettings = {
  runMode: DEFAULT_AGENT_RUN_MODE,
  notify: { ...DEFAULT_AGENT_NOTIFY },
  goalBudget: DEFAULT_AGENT_GOAL_BUDGET,
}

/**
 * 读一个 KV 键的裸值。
 * 未保存过（404）/ 后台没起 / 坏数据 → undefined，由调用方各自回落默认值；
 * 任何情况下**不抛** —— 首屏不能因为后台没起就白屏。
 */
async function readKvValue(path: string): Promise<unknown> {
  if (typeof fetch === 'undefined') return undefined
  try {
    const res = await fetch(path, { headers: { accept: 'application/json' } })
    if (!res.ok) return undefined
    const body = (await res.json()) as { value?: unknown }
    return body && typeof body === 'object' && 'value' in body ? body.value : undefined
  } catch {
    return undefined
  }
}

/** 不认识的值一律当默认（乱改 KV 不等于把开关改成"未定义行为"） */
function normalizeRunMode(v: unknown): AgentRunMode {
  return v === 'followTab' ? 'followTab' : DEFAULT_AGENT_RUN_MODE
}

/** 逐字段归一：只认 boolean，缺/坏的那一格回落默认（后台可能存着老形状） */
function normalizeNotify(v: unknown): AgentNotifySettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<AgentNotifySettings>
  return {
    browser: typeof o.browser === 'boolean' ? o.browser : DEFAULT_AGENT_NOTIFY.browser,
    sound: typeof o.sound === 'boolean' ? o.sound : DEFAULT_AGENT_NOTIFY.sound,
  }
}

/** 预算归一化：留空 / 0 / 负数 / 非数字 = 不限（0）；小数向下取整 */
export function normalizeGoalBudget(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * 读「目标默认预算」这一键。
 * 要区分两种情况：**整键没存过** → 用默认预算；**存了 { budget: 0 }** → 用户明确选了"不限"，
 * 就是 0，不能被默认值盖回去。
 */
function budgetFromKv(raw: unknown): number {
  if (!raw || typeof raw !== 'object' || !('budget' in raw)) return DEFAULT_AGENT_GOAL_BUDGET
  return normalizeGoalBudget((raw as AgentGoalDefaults).budget)
}

/** 读齐三个键（各自容错、各自回落默认）。任何失败都不抛。 */
export async function loadAgentSettings(): Promise<AgentSettings> {
  const [rawRunMode, rawNotify, rawGoal] = await Promise.all([
    readKvValue(AGENT_RUN_MODE_PATH),
    readKvValue(AGENT_NOTIFY_PATH),
    readKvValue(AGENT_GOAL_DEFAULTS_PATH),
  ])
  return {
    runMode: normalizeRunMode(rawRunMode),
    notify: normalizeNotify(rawNotify),
    goalBudget: budgetFromKv(rawGoal),
  }
}

/** 写一个 KV 键（体契约 { value }）。后台没起/写入失败 → 安静收场：内存里的值已生效，不该弹错打扰用户 */
async function putKvValue(path: string, value: unknown): Promise<void> {
  if (typeof fetch === 'undefined') return
  try {
    await fetch(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    })
  } catch {
    /* 后台没连：下次改再写 */
  }
}

export async function saveAgentRunMode(mode: AgentRunMode): Promise<void> {
  await putKvValue(AGENT_RUN_MODE_PATH, normalizeRunMode(mode))
}

export async function saveAgentNotify(notify: AgentNotifySettings): Promise<void> {
  await putKvValue(AGENT_NOTIFY_PATH, normalizeNotify(notify))
}

/** 存默认预算；返回归一化后的值（0 = 不限），调用方拿它回显输入框 */
export async function saveAgentGoalBudget(budget: unknown): Promise<number> {
  const n = normalizeGoalBudget(budget)
  await putKvValue(AGENT_GOAL_DEFAULTS_PATH, { budget: n })
  return n
}

/** 这三个键任一变了都要重读（别的 config 键与这个弹窗无关） */
const AGENT_KV_KEYS: readonly string[] = [AGENT_RUN_MODE_KEY, AGENT_NOTIFY_KEY, AGENT_GOAL_DEFAULTS_KEY]

/** 服务端 KV 变更广播的事件形状（cloud-server /api/kv/events） */
interface KvChangeEventLike {
  type: string
  key: string
}

/**
 * 订阅云端变更：别的标签页/别处改了这三个键，这里重读一份并回调（跨标签页同步）。
 * 无 EventSource（node 测试/极端环境）或后台没连 → 返回 no-op dispose，不抛错。
 */
export function watchAgentSettings(onChange: (settings: AgentSettings) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {}
  const es = new EventSource('/api/kv/events')
  let closed = false
  es.onmessage = (e: MessageEvent<string>): void => {
    if (closed) return
    try {
      const event = JSON.parse(e.data) as KvChangeEventLike
      if (event.type !== 'config' || !AGENT_KV_KEYS.includes(event.key)) return
      void loadAgentSettings().then((s) => {
        if (!closed) onChange(s)
      })
    } catch {
      /* 坏数据/断线：安静收场，下次广播再试 */
    }
  }
  return () => {
    closed = true
    es.close()
  }
}

/** 设置弹窗绑的就是它（响应式快照 + 三个写入口） */
export interface AgentSettingsStore {
  state: AgentSettings
  /** 重读一遍后台（启动时自动跑一次；弹窗想手动刷也可以调） */
  reload(): Promise<void>
  setRunMode(mode: AgentRunMode): Promise<void>
  /** 只传要翻的那一格：setNotify({ browser: false }) */
  setNotify(patch: Partial<AgentNotifySettings>): Promise<void>
  /** 传输入框的原始值（string/number 都收）；返回归一化后的预算（0 = 不限） */
  setGoalBudget(value: unknown): Promise<number>
  /** 停掉订阅（单测/宿主重建用；应用里长驻不必调） */
  dispose(): void
}

/** 造一份独立的 store（单测用；应用里请用下面的单例，别各造各的） */
export function createAgentSettingsStore(): AgentSettingsStore {
  const state = reactive<AgentSettings>({
    runMode: AGENT_SETTINGS_DEFAULTS.runMode,
    notify: { ...AGENT_SETTINGS_DEFAULTS.notify },
    goalBudget: AGENT_SETTINGS_DEFAULTS.goalBudget,
  })
  let disposed = false

  function apply(s: AgentSettings): void {
    if (disposed) return
    state.runMode = s.runMode
    state.notify.browser = s.notify.browser
    state.notify.sound = s.notify.sound
    state.goalBudget = s.goalBudget
  }

  async function reload(): Promise<void> {
    apply(await loadAgentSettings())
  }

  // 启动：先读一份（不 await —— 首个画面先用默认值，读到再覆盖），再订阅跨标签页变更
  void reload()
  const unwatch = watchAgentSettings(apply)

  return {
    state,
    reload,
    async setRunMode(mode) {
      state.runMode = normalizeRunMode(mode) // 界面立刻翻，不等后台往返
      await saveAgentRunMode(mode)
    },
    async setNotify(patch) {
      const next = normalizeNotify({ ...state.notify, ...patch })
      state.notify.browser = next.browser
      state.notify.sound = next.sound
      await saveAgentNotify(next)
    },
    async setGoalBudget(value) {
      const n = normalizeGoalBudget(value)
      state.goalBudget = n
      await saveAgentGoalBudget(n)
      return n
    },
    dispose() {
      disposed = true
      unwatch()
    },
  }
}

let singleton: AgentSettingsStore | null = null

/** 全应用共享同一份（弹窗与任何别的读者看到的必须是同一份，否则又会出现两套值） */
export function useAgentSettings(): AgentSettingsStore {
  if (!singleton) singleton = createAgentSettingsStore()
  return singleton
}
