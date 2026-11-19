/**
 * 动作文案：参数下拉标题 + 发送按钮里的文字（用户 2026-11-17）。
 *
 * 用户口径：
 * 「比如我在下拉里显示当前花费」「发送按钮做成图标 + 文本，文本就是价格」。
 *
 * 为什么由后台算：provider 在 provider.js 里写的是**函数**，函数过不了 JSON。
 * 前端只把「当前选了哪些参数」送上去，后台执行 selectLabel / sendLabel 后回字符串。
 *
 * 三条硬要求：
 * 1. **没声明就别问**：动作没有 hasSelectLabel / hasSendLabel 时一个请求都不发；
 * 2. **失败不挡路**：网络错 / 后台没起 / 超时都当「没有自定义文案」，底栏回落默认摘要；
 * 3. **同一份输入不重复问**：参数没变就不重发（拖滑块时每帧一问会把后台打满）。
 */
import { registerEventName, withAdminToken } from '@plume-canvas/plugin-sdk'

/** 一次询问的输入（与后台 ActionTextInput 同形） */
export interface ActionLabelInput {
  actionId: string
  values?: Record<string, unknown>
  labels?: Record<string, string>
  summary?: string
  resources?: { image?: number; video?: number; audio?: number; text?: number }
}

/** 后台回的一段文案；没给就是「用默认」 */
export interface ActionLabelText {
  selectLabel?: string
  sendLabel?: string
}

export interface ActionLabelOptions {
  /** 后台根地址（空 = 同源） */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** 超时（默认 4 秒：这是悬停 / 改参数时的即时反馈，不能等太久） */
  timeoutMs?: number
  signal?: AbortSignal
}

/** 文案变更事件：后台重载 provider 后，底栏可以按需刷新（预留，当前不强制使用） */
export const ACTION_LABELS_CHANGED_EVENT = 'bottom-bar:action-labels-changed'

let registered = false
function ensureEventRegistered(): void {
  if (registered) return
  registered = true
  try {
    registerEventName(ACTION_LABELS_CHANGED_EVENT)
  } catch {
    /* 测试 / 非内核环境：没登记也不影响主流程 */
  }
}

/** 结果缓存键：同一份参数算出来的字一定一样，重复问没意义 */
export function labelCacheKey(input: ActionLabelInput): string {
  const res = input.resources ?? {}
  return JSON.stringify([
    input.actionId,
    input.values ?? {},
    input.labels ?? {},
    input.summary ?? '',
    [res.image ?? 0, res.video ?? 0, res.audio ?? 0, res.text ?? 0],
  ])
}

/**
 * 问一次文案。
 *
 * 永远 resolve：失败返回空对象（调用方据此回落默认），不抛异常 ——
 * 一个算价格的请求失败不该让整个底栏变红。
 */
export async function fetchActionLabels(
  items: ActionLabelInput[],
  opts: ActionLabelOptions = {},
): Promise<Record<string, ActionLabelText>> {
  const out: Record<string, ActionLabelText> = {}
  if (!Array.isArray(items) || items.length === 0) return out
  ensureEventRegistered()
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  if (!f) return out

  const ac = new AbortController()
  const timeout = Math.max(200, opts.timeoutMs ?? 4000)
  const timer = setTimeout(() => ac.abort(), timeout)
  const onOuterAbort = (): void => ac.abort()
  opts.signal?.addEventListener('abort', onOuterAbort)

  try {
    const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
    const res = await f(base + '/api/actions/labels', {
      method: 'POST',
      headers: withAdminToken({ 'content-type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify({ items }),
      signal: ac.signal,
    })
    if (!res.ok) return out
    const body = (await res.json()) as {
      items?: Array<{ actionId?: unknown; selectLabel?: unknown; sendLabel?: unknown }>
    }
    for (const row of body.items ?? []) {
      if (!row || typeof row.actionId !== 'string') continue
      const text: ActionLabelText = {}
      if (typeof row.selectLabel === 'string' && row.selectLabel.trim() !== '') text.selectLabel = row.selectLabel
      if (typeof row.sendLabel === 'string' && row.sendLabel.trim() !== '') text.sendLabel = row.sendLabel
      if (text.selectLabel !== undefined || text.sendLabel !== undefined) out[row.actionId] = text
    }
    return out
  } catch {
    // 超时 / 断网 / 后台没起：静默回落默认表现
    return out
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 一个只在输入变化时才发请求的小缓存（每个底栏实例一份）。
 *
 * 用「最后一次请求的键」判重：拖滑块会连续触发，键没变就直接返回上一份结果。
 */
export function createLabelMemo(): {
  get(key: string): ActionLabelText | undefined
  set(key: string, value: ActionLabelText): void
  clear(): void
} {
  let key = ''
  let value: ActionLabelText | undefined
  return {
    get(k: string) {
      return k === key ? value : undefined
    },
    set(k: string, v: ActionLabelText) {
      key = k
      value = v
    },
    clear() {
      key = ''
      value = undefined
    },
  }
}
