/**
 * agentNotify —— 「Agent 跑完弹一条系统通知 / 响一声」的最小实现（设计 §3.5 / G11）。
 *
 * 为什么单独一个模块：弹通知与播音都只该在事件到来那一刻碰浏览器对象
 * （`Notification` / `AudioContext`），而这两样在 node 测试环境里不存在、
 * 在浏览器里也可能被拒绝（没授权 / 没用户手势）。把「读 KV + 判定 + 弹 / 响」
 * 抽出来、浏览器对象全部可注入，就能在 node 里单测；主组件
 * （AgentConversation.vue）只在 SSE 事件到来时调这里。
 *
 * 三条底线：
 *   1. 任何异常都吞掉 —— 通知失败绝不能影响对话本身；
 *   2. **缺省（用户从没动过开关）回落设置弹窗的同一份默认值** —— 两处默认值不一致，
 *      就是「设置里显示开着、实际一条都不弹」（见 DEFAULT_NOTIFY_PREFS 的说明）；
 *   3. 读不到 / 读失败（后台没起、网络错）当「关」—— 不知道用户设什么时不要乱弹。
 */

/** 通知的两个开关（KV 键 agentNotify 的值）；**用户从没动过（缺省）时与设置弹窗一致：都开** */
export interface AgentNotifyPrefs {
  /** 浏览器系统通知（走操作系统通知中心） */
  notify: boolean
  /** 页面自己播的短提示音（系统通知自带的提示音网页控制不了，所以独立开关） */
  sound: boolean
}

/**
 * 缺省（KV 里没这个键 / 字段不是布尔）时回落的默认值 —— **必须与设置弹窗对齐**。
 *
 * 对齐的是 packages/ui/src/composables/agentSettings.ts 的 `DEFAULT_AGENT_NOTIFY`：
 * 那个弹窗读不到键时显示的是「开」（绿色开关）。曾经这里回落「关」，于是用户看到
 * 开关本来就是开的、没有理由再去点它，后台就**永远**没有这个键，这里就**永远**读到关，
 * 通知一次都不弹（用户报的「通知没效果」正是它）。
 *
 * 跨包不能共享常量（依赖方向是 ui → plugins，插件反向 import 不到 ui），所以两处各写一份。
 * 为防止再次漂移，__tests__/agentNotify.test.ts 里有一条直接读 ui 源码比对的护栏测试。
 */
export const DEFAULT_NOTIFY_PREFS: AgentNotifyPrefs = { notify: true, sound: true }

/** 只认布尔：字符串 'true'、数字 1 这类「看着像」的值一律不算（宁可安静，不要误弹） */
function boolOf(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

/**
 * 读不到 / 读失败时的兜底：**全关**。
 * 与「缺省」刻意分开 —— 缺省有确定答案（用默认值）；这里是「后台没起 / 网络错」，
 * 压根不知道用户设的是什么，按「静默」处理（首屏也不能因为后台没起就报错）。
 */
function silent(): AgentNotifyPrefs {
  return { notify: false, sound: false }
}

/**
 * 解析 KV 值。接受三种形状，只认布尔字段：
 *   true                              → { notify: true, sound: true }（整键就是一个布尔的旧形状）
 *   { notify: boolean, sound: boolean }
 *   { browser: boolean, sound: boolean }（设置弹窗可能用 browser 这个词）
 * 显式 false 必须尊重（不能因为另一个字段就变 true）；
 * 缺省 / 非布尔值一律回落 DEFAULT_NOTIFY_PREFS —— 与设置弹窗的归一化口径逐字对齐。
 * 两个字段都没有时先看顶层布尔（老形状），再回落默认值。
 */
export function parseNotifyPrefs(raw: unknown): AgentNotifyPrefs {
  // 顶层布尔 = 老形状（整键就是一个 true/false）：一个值同时当两个开关
  const topLevel = boolOf(raw)
  const o: Record<string, unknown> = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  // notify / browser 是同一格的两种叫法；都没有就回落顶层布尔
  const notify = boolOf(o.notify) ?? boolOf(o.browser) ?? topLevel ?? DEFAULT_NOTIFY_PREFS.notify
  const sound = boolOf(o.sound) ?? topLevel ?? DEFAULT_NOTIFY_PREFS.sound
  return { notify, sound }
}

/** 通知开关的键名（与 packages/ui/src/composables/agentSettings.ts 钉死同一份，别自创） */
const NOTIFY_KEY = 'agentNotify'

/**
 * config 作用域的批量读口（cloud-server routes/kv.ts 的 ?values=1）。
 *
 * 为什么不用单项 GET /api/kv/config/agentNotify：这个开关**用户一次都没动过时从未保存过**，
 * 单项 GET 必然回一个 404 —— 控制台里就是一条“加载资源失败：404”，用户什么都没做错却看到报错。
 * 批量口一次拿回整个 config 域，缺键只是“桶里没有”，不再产生 404。
 */
const CONFIG_BUCKET_PATH = '/api/kv/config?values=1'

/**
 * 读后台 KV 里的通知开关（经 config 批量口）。
 * 两种「读不到」刻意分开处理：
 *   · **键不存在 / 字段不是布尔**（用户从没动过开关）→ 回落 DEFAULT_NOTIFY_PREFS
 *     （与设置弹窗显示的一致：都开）—— 这正是「显示开着却不弹」那个 bug 的修法；
 *   · **网络错 / 没 fetch / HTTP 不 ok**（不知道后台状态）→ 全关（silent），绝不抛。
 * 首屏不能因为后台没起就报错。
 */
export async function loadNotifyPrefs(opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): Promise<AgentNotifyPrefs> {
  if (!opts.fetchImpl && typeof fetch === 'undefined') return silent()
  const f = opts.fetchImpl ?? fetch
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  try {
    const res = await f(base + CONFIG_BUCKET_PATH, { headers: { accept: 'application/json' } })
    if (!res.ok) return silent()
    const body = (await res.json()) as unknown
    // 批量口的体是 { values: { key: value } }；缺这个键 = 从没保存过 → 回落默认值
    // （parseNotifyPrefs(undefined) 就是「缺省」那一支）。
    // 也接受“直接把值当体”的老形状（宿主/测试注入的替身可能这么给）。
    const values =
      body && typeof body === 'object' && 'values' in body
        ? (body as { values?: Record<string, unknown> }).values
        : undefined
    if (values && typeof values === 'object') return parseNotifyPrefs(values[NOTIFY_KEY])
    const raw = body && typeof body === 'object' && 'value' in body ? (body as { value: unknown }).value : body
    return parseNotifyPrefs(raw)
  } catch {
    return silent()
  }
}

/** 通知的两种时机：一轮结束 / 队列全部跑完（与后端 SSE 事件名同款） */
export type NotifyKind = 'round_done' | 'queue_idle'

/**
 * 拼通知文案：标题 = 会话名（没有就 'Agent'），正文 = 一句 kind 专属的话 + 最后一句摘要。
 * 两种 kind 的正文**必须不一样** —— 用户瞄一眼通知就知道是「这一轮完了」还是「队列全跑完了」。
 */
export function notifyPayload(kind: NotifyKind, opts: { title?: string; summary?: string }): { title: string; body: string } {
  const title = opts.title?.trim() || 'Agent'
  const summary = opts.summary?.trim()
  const head = kind === 'queue_idle' ? '队列已全部跑完' : '新一轮已完成'
  return { title, body: summary ? head + '：' + summary : head }
}

/**
 * 弹一条系统通知。
 * - prefs.notify 关 → 'skipped'（连 Notification 都不碰）；
 * - 环境没有 Notification 或 permission !== 'granted' → 'unsupported'；
 * - 否则 new Notification(title, { body }) → 'shown'。
 * 任何异常吞掉 → 'unsupported'。deps.Notification 可注入（测试用假对象）。
 */
export function showNotify(
  kind: NotifyKind,
  opts: { title?: string; summary?: string },
  prefs: AgentNotifyPrefs,
  deps: { Notification?: typeof Notification } = {},
): 'shown' | 'skipped' | 'unsupported' {
  if (!prefs.notify) return 'skipped'
  try {
    const Ctor = deps.Notification ?? (typeof Notification === 'undefined' ? undefined : Notification)
    if (!Ctor) return 'unsupported'
    if (Ctor.permission !== 'granted') return 'unsupported'
    const p = notifyPayload(kind, opts)
    new Ctor(p.title, { body: p.body })
    return 'shown'
  } catch {
    return 'unsupported'
  }
}

/**
 * 播一个很短的提示音（**页面自己播**）：WebAudio 现场合成一声
 * 880Hz 正弦、约 0.12s、指数衰减到听不见 —— 不引外部音频文件
 * （插件要能单文件分发，也不想为了「叮」一声多一个资源请求）。
 * sound 关 → false（连 AudioContext 都不构造）；没有 / 被拒 / 任何异常 → false，不抛。
 */
export function playNotifySound(
  prefs: AgentNotifyPrefs,
  deps: { audioContext?: typeof AudioContext } = {},
): boolean {
  if (!prefs.sound) return false
  try {
    const Ctor = deps.audioContext ?? (typeof AudioContext === 'undefined' ? undefined : AudioContext)
    if (!Ctor) return false
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t0 = typeof ctx.currentTime === 'number' ? ctx.currentTime : 0
    osc.type = 'sine'
    osc.frequency.value = 880
    osc.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.08, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12)
    osc.start(t0)
    osc.stop(t0 + 0.12)
    // 播完顺手关掉这个 AudioContext：浏览器对同时存在的音频上下文有上限，
    // 只开不关的话，某一天会静悄悄地没声音（还不报错）
    if (typeof ctx.close === 'function') {
      setTimeout(() => {
        try {
          void ctx.close()
        } catch {
          /* 关不掉就随它去 */
        }
      }, 200)
    }
    return true
  } catch {
    return false
  }
}
