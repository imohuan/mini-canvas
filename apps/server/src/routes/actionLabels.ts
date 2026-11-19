/**
 * 动作文案（下拉标题 / 发送按钮文案）—— 让 provider 决定「显示什么字」。
 *
 * 契约：
 *   POST /api/actions/labels
 *     { items: [{ actionId, values, labels, summary, resources }] }
 *     → { ok, items: [{ actionId, selectLabel?, sendLabel? }] }
 *
 * 为什么要绕一趟后台：provider 写的是**函数**，函数过不了 JSON。
 * 前端只需要最终那段文字，于是由后台执行动作声明上的 selectLabel / sendLabel，
 * 把结果当字符串下发。provider 里怎么算（查价格表、读配置、发请求）前端都不用管。
 *
 * 安全与语义：
 * - 只读：不建任务、不写文件、不扣费；
 * - 未声明对应函数的动作直接跳过（前端回落默认摘要 / 只显示图标）；
 * - 单个动作抛错只让那一项为空，不影响其它项（底栏一屏可能问好几条）。
 */
import { Hono } from 'hono'
import type { ProviderRegistry } from '../providers/registry.js'
import type { ActionTextInput } from '../providers/types.js'

/** 一次请求最多问多少条：底栏只会问当前动作，留一点余量给多选场景 */
const MAX_ITEMS = 24

export interface ActionLabelItem {
  actionId: string
  values?: Record<string, unknown>
  labels?: Record<string, string>
  summary?: string
  resources?: { image?: number; video?: number; audio?: number; text?: number }
}

export interface ActionLabelResult {
  actionId: string
  selectLabel?: string
  sendLabel?: string
}

function plainObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function countOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/** 把一次请求归一成 provider 认的入参（脏数据一律兜底成空，不抛） */
function toInput(item: ActionLabelItem): ActionTextInput {
  const res = plainObject(item.resources)
  const labels: Record<string, string> = {}
  for (const [k, v] of Object.entries(plainObject(item.labels))) {
    if (typeof v === 'string') labels[k] = v
  }
  return {
    actionId: String(item.actionId ?? ''),
    values: plainObject(item.values),
    labels,
    summary: typeof item.summary === 'string' ? item.summary : '',
    resources: {
      image: countOf(res.image),
      video: countOf(res.video),
      audio: countOf(res.audio),
      text: countOf(res.text),
    },
  }
}

/** 结果只收字符串；其它类型当成「没有」 */
function textOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

export function actionLabelsRoutes(registry: ProviderRegistry): Hono {
  const app = new Hono()

  app.post('/api/actions/labels', async (c) => {
    let body: { items?: unknown }
    try {
      body = (await c.req.json()) as { items?: unknown }
    } catch {
      return c.json({ ok: false, error: '请求体不是合法 JSON' }, 400)
    }
    const raw = Array.isArray(body.items) ? body.items : []
    const items: ActionLabelItem[] = raw
      .filter((x): x is ActionLabelItem => Boolean(x) && typeof x === 'object')
      .slice(0, MAX_ITEMS)

    const out: ActionLabelResult[] = []
    for (const item of items) {
      const actionId = String(item.actionId ?? '')
      const action = actionId ? registry.getAction(actionId) : undefined
      if (!action) continue
      const input = toInput(item)
      const row: ActionLabelResult = { actionId }
      if (typeof action.selectLabel === 'function') {
        try {
          row.selectLabel = textOf(action.selectLabel(input))
        } catch (err) {
          console.warn('[actions/labels] selectLabel 失败 ' + actionId + '：' + (err instanceof Error ? err.message : String(err)))
        }
      }
      if (typeof action.sendLabel === 'function') {
        try {
          row.sendLabel = textOf(action.sendLabel(input))
        } catch (err) {
          console.warn('[actions/labels] sendLabel 失败 ' + actionId + '：' + (err instanceof Error ? err.message : String(err)))
        }
      }
      if (row.selectLabel !== undefined || row.sendLabel !== undefined) out.push(row)
    }
    return c.json({ ok: true, items: out })
  })

  return app
}
