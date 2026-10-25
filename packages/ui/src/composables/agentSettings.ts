/**
 * agentSettings —— TV DIRECTOR 全局设置里「后台对话 / 通知 / 目标预算」的读写入口。
 *
 * 三个键（设计 §3.6.3 / 实现计划 Task 5.1 已定死，别自创别的路径）：
 *   config/agentRunMode      'background' | 'followTab'  —— 「后台对话」开关
 *   config/agentNotify       { browser, sound }          —— 「浏览器通知 / 通知声音」
 *   config/agentGoalDefaults { budget }                  —— 「目标设置」的默认预算
 *   config/agentComposerPrefs { submitKeyMode }          —— 「发送键」Ctrl/Shift/裸回车（2026-10-25）
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
import { subscribeKvEvents } from './kvEvents'

/**
 * 发送键三种取值（与 plugin-agent 的 composerKeys.ts 是同一套语义）。
 *
 * 为什么在这里再声明一次：这个值要跨「设置页（ui）」和「Agent 面板（plugin-agent）」两个包，
 * 而 ui 包在单测环境里拿不到 plugin-agent 的运行时导出（只有类型）。判定函数仍由
 * plugin-agent 提供（唯一一份），这里只放**字面量联合 + 归一化**，并用测试钉死两边一致。
 */
export type SubmitKeyMode = 'ctrl-enter' | 'shift-enter' | 'enter'
export const DEFAULT_SUBMIT_KEY_MODE: SubmitKeyMode = 'ctrl-enter'
export function normalizeSubmitKeyMode(v: unknown): SubmitKeyMode {
  return v === 'shift-enter' || v === 'enter' || v === 'ctrl-enter' ? v : DEFAULT_SUBMIT_KEY_MODE
}

/** 三个键的裸 key（KV 路径由它拼出来，与 appTheme 同一套命名习惯） */
export const AGENT_RUN_MODE_KEY = 'agentRunMode'
export const AGENT_NOTIFY_KEY = 'agentNotify'
export const AGENT_GOAL_DEFAULTS_KEY = 'agentGoalDefaults'
/** 「发送中显示队列」开关的键（队列里 sending 条目要不要画出来；用户口径 2026-10-15） */
export const AGENT_QUEUE_PREFS_KEY = 'agentQueuePrefs'
/** 「发送键」设置：Ctrl+回车 / Shift+回车 / 回车（用户口径 2026-10-25） */
export const AGENT_COMPOSER_PREFS_KEY = 'agentComposerPrefs'
/** 云端 KV 路径：config 作用域，接口见 cloud-server 的 routes/kv.ts（GET/PUT /api/kv/:type/:key） */
export const AGENT_RUN_MODE_PATH = '/api/kv/config/' + AGENT_RUN_MODE_KEY
export const AGENT_NOTIFY_PATH = '/api/kv/config/' + AGENT_NOTIFY_KEY
export const AGENT_GOAL_DEFAULTS_PATH = '/api/kv/config/' + AGENT_GOAL_DEFAULTS_KEY
export const AGENT_QUEUE_PREFS_PATH = '/api/kv/config/' + AGENT_QUEUE_PREFS_KEY
export const AGENT_COMPOSER_PREFS_PATH = '/api/kv/config/' + AGENT_COMPOSER_PREFS_KEY
/** 设置页翻「发送中显示队列」后向同页其它读者（Agent 面板）广播的事件名 */
export const AGENT_QUEUE_PREFS_EVENT = 'mini-canvas:agent-queue-prefs-changed'
/** 设置页改「发送键」后向同页其它读者（Agent 面板）广播的事件名 */
export const AGENT_COMPOSER_PREFS_EVENT = 'mini-canvas:agent-composer-prefs-changed'
/**
 * config 作用域的**批量读**口（一次拿回该域全部 key/值）。
 *
 * 三个键逐条 GET 时，没保存过的会各回一个 404，浏览器控制台就多几条"加载资源失败"
 * （用户截图里报的就是它）。走批量口一次拿齐，既少两次往返，也不再刷无意义的 404。
 */
export const CONFIG_KEYS_PATH = '/api/kv/config?values=1'

/** 「后台对话」两种模式：background=开（连接断了这一轮也跑完）；followTab=关（旧行为，断线 abort） */
export type AgentRunMode = 'background' | 'followTab'
export interface AgentNotifySettings {
  browser: boolean
  sound: boolean
}
export interface AgentGoalDefaults {
  budget: number
}
/** 队列显示偏好：发送状态（sending）下的条目要不要显示在队列列表里 */
export interface AgentQueuePrefs {
  showSending: boolean
}
/** 发送键偏好：选哪一种回车提交 */
export interface AgentComposerPrefs {
  submitKeyMode: SubmitKeyMode
}
/** 一份完整设置快照（设置弹窗绑的就是它） */
export interface AgentSettings {
  runMode: AgentRunMode
  notify: AgentNotifySettings
  /** 目标默认预算；0 = 不限 */
  goalBudget: number
  /** 队列里「发送中」条目的显示开关（默认显示） */
  queueShowSending: boolean
  /** 发送键：ctrl-enter（默认）/ shift-enter / enter */
  submitKeyMode: SubmitKeyMode
}

/** 默认值：后台对话默认开（§3.2）；两个通知默认开；默认预算 50000 */
export const DEFAULT_AGENT_RUN_MODE: AgentRunMode = 'background'
export const DEFAULT_AGENT_NOTIFY: AgentNotifySettings = { browser: true, sound: true }
export const DEFAULT_AGENT_GOAL_BUDGET = 50000
export const DEFAULT_QUEUE_SHOW_SENDING = true
export const AGENT_SETTINGS_DEFAULTS: AgentSettings = {
  runMode: DEFAULT_AGENT_RUN_MODE,
  notify: { ...DEFAULT_AGENT_NOTIFY },
  goalBudget: DEFAULT_AGENT_GOAL_BUDGET,
  queueShowSending: DEFAULT_QUEUE_SHOW_SENDING,
  submitKeyMode: DEFAULT_SUBMIT_KEY_MODE,
}

/**
 * 读一个 KV 键的裸值。
 * 未保存过（404）/ 后台没起 / 坏数据 → undefined，由调用方各自回落默认值；
 * 任何情况下**不抛** —— 首屏不能因为后台没起就白屏。
 */
/**
 * 一次把 config 作用域整个读回来（服务端的批量口，见 cloud-server routes/kv.ts 的 ?values=1）。
 *
 * 为什么不是逐键 GET：这三个键**用户一次都没改过时全都从未保存过**，逐键读会各回一个 404 ——
 * 控制台里就是三条"加载资源失败：404"，而用户什么都没做错。批量口一次拿齐需要的那几把 key，
 * 少两次往返，也不再刷无意义的 404（那正是用户截图里报的错）。
 *
 * 后台没起 / 坏数据 → 空对象：所有键都回落各自默认值，绝不抛（首屏不能白屏）。
 */
async function readConfigBucket(): Promise<Record<string, unknown>> {
  if (typeof fetch === 'undefined') return {}
  try {
    const res = await fetch(CONFIG_KEYS_PATH, { headers: { accept: 'application/json' } })
    if (!res.ok) return {}
    const body = (await res.json()) as { values?: unknown }
    return body && typeof body.values === 'object' && body.values !== null
      ? (body.values as Record<string, unknown>)
      : {}
  } catch {
    return {}
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

/** 队列偏好归一：只认 boolean，缺/坏回落默认（显示） */
function queuePrefsFromKv(raw: unknown): boolean {
  const o = raw && typeof raw === 'object' ? (raw as Partial<AgentQueuePrefs>) : {}
  return typeof o.showSending === 'boolean' ? o.showSending : DEFAULT_QUEUE_SHOW_SENDING
}

/** 发送键偏好归一：缺 / 坏一律回落默认（Ctrl+回车） */
function submitKeyModeFromKv(raw: unknown): SubmitKeyMode {
  const o = raw && typeof raw === 'object' ? (raw as Partial<AgentComposerPrefs>) : {}
  return normalizeSubmitKeyMode(o.submitKeyMode)
}

/** 读齐三个键（各自容错、各自回落默认）。任何失败都不抛。 */
export async function loadAgentSettings(): Promise<AgentSettings> {
  const bucket = await readConfigBucket()
  return {
    runMode: normalizeRunMode(bucket[AGENT_RUN_MODE_KEY]),
    notify: normalizeNotify(bucket[AGENT_NOTIFY_KEY]),
    goalBudget: budgetFromKv(bucket[AGENT_GOAL_DEFAULTS_KEY]),
    queueShowSending: queuePrefsFromKv(bucket[AGENT_QUEUE_PREFS_KEY]),
    submitKeyMode: submitKeyModeFromKv(bucket[AGENT_COMPOSER_PREFS_KEY]),
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

/** 存队列显示偏好 */
export async function saveAgentQueuePrefs(prefs: AgentQueuePrefs): Promise<void> {
  await putKvValue(AGENT_QUEUE_PREFS_PATH, { showSending: prefs.showSending === true })
}

/** 存发送键偏好 */
export async function saveSubmitKeyMode(mode: unknown): Promise<void> {
  await putKvValue(AGENT_COMPOSER_PREFS_PATH, { submitKeyMode: normalizeSubmitKeyMode(mode) })
}

/** 这三个键任一变了都要重读（别的 config 键与这个弹窗无关） */
const AGENT_KV_KEYS: readonly string[] = [
  AGENT_RUN_MODE_KEY,
  AGENT_NOTIFY_KEY,
  AGENT_GOAL_DEFAULTS_KEY,
  AGENT_QUEUE_PREFS_KEY,
  AGENT_COMPOSER_PREFS_KEY,
]

/**
 * 订阅云端变更：别的标签页/别处改了这三个键，这里重读一份并回调（跨标签页同步）。
 *
 * 连接由 `subscribeKvEvents` 统一持有（全应用**共享一条**）：各读者自己 `new EventSource`
 * 会让每条订阅各占一条**永不关闭**的长连接，几条叠加就把浏览器对单个域名的并发额度
 * （Chrome 为 6）占满 —— 之后页面里所有普通请求都只能排队（用户报的"网页卡住、请求停在待处理"）。
 *
 * 无 EventSource（node 测试/极端环境）或后台没连 → 返回 no-op dispose，不抛错。
 */
export function watchAgentSettings(onChange: (settings: AgentSettings) => void): () => void {
  let closed = false
  const off = subscribeKvEvents((event): void => {
    if (closed) return
    if (event.type !== 'config' || !AGENT_KV_KEYS.includes(event.key)) return
    void loadAgentSettings().then((s) => {
      if (!closed) onChange(s)
    })
  })
  return () => {
    closed = true
    off()
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
  /** 「发送中显示队列」开关 */
  setQueueShowSending(show: boolean): Promise<void>
  /** 发送键：Ctrl+回车 / Shift+回车 / 回车 */
  setSubmitKeyMode(mode: unknown): Promise<void>
  /** 停掉订阅（单测/宿主重建用；应用里长驻不必调） */
  dispose(): void
}

/** 造一份独立的 store（单测用；应用里请用下面的单例，别各造各的） */
export function createAgentSettingsStore(): AgentSettingsStore {
  const state = reactive<AgentSettings>({
    runMode: AGENT_SETTINGS_DEFAULTS.runMode,
    notify: { ...AGENT_SETTINGS_DEFAULTS.notify },
    goalBudget: AGENT_SETTINGS_DEFAULTS.goalBudget,
    queueShowSending: AGENT_SETTINGS_DEFAULTS.queueShowSending,
    submitKeyMode: AGENT_SETTINGS_DEFAULTS.submitKeyMode,
  })
  let disposed = false

  function apply(s: AgentSettings): void {
    if (disposed) return
    state.runMode = s.runMode
    state.notify.browser = s.notify.browser
    state.notify.sound = s.notify.sound
    state.goalBudget = s.goalBudget
    state.queueShowSending = s.queueShowSending
    state.submitKeyMode = s.submitKeyMode
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
    async setQueueShowSending(show) {
      state.queueShowSending = show // 界面立刻翻，不等后台往返
      await saveAgentQueuePrefs({ showSending: show })
      // 同页其它读者（Agent 面板）立刻生效：它们不订阅 KV 事件，靠这条本地广播重读
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AGENT_QUEUE_PREFS_EVENT, { detail: { showSending: show } }))
    },
    async setSubmitKeyMode(mode) {
      const m = normalizeSubmitKeyMode(mode)
      state.submitKeyMode = m // 界面立刻翻，不等后台往返
      await saveSubmitKeyMode(m)
      // 同页其它读者（Agent 面板）立刻生效：它们不订阅 KV 事件，靠这条本地广播重读
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(AGENT_COMPOSER_PREFS_EVENT, { detail: { submitKeyMode: m } }))
      }
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
