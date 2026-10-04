/**
 * jobs 路由 —— 下单 / 查单 / 撤单。
 *
 * 契约：
 *   POST /api/jobs                ← { canvasId, nodeId, actionId, prompt?, values?, resources? }
 *                                → { ok, jobId }
 *   GET  /api/jobs/:jobId        → { ok, job }
 *   POST /api/jobs/:jobId/cancel → { ok, cancelled }
 *
 * 为什么前端要轮询：SSE 是主路（后台每写一帧节点都会推过去），
 * 但**兜底**不能少 —— 通道断了、推送丢了，轮询这一拍仍能把状态问回来。
 * 前端拿到的是同一个 Job 形状，翻译成底栏认识的 running/done 即可。
 */
import { Hono } from 'hono'
import type { TaskManager } from '../tasks/taskManager.js'
import type { JobInput } from '../providers/types.js'
import { DEFAULT_CANVAS_ID, isSafeCanvasId } from '../store/canvasPaths.js'

export function jobsRoutes(tasks: TaskManager): Hono {
  const app = new Hono()

  app.post('/api/jobs', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ ok: false, error: 'body 必须是对象' }, 400)
    }
    const o = body as Record<string, unknown>
    const actionId = typeof o.actionId === 'string' ? o.actionId : ''
    const nodeId = typeof o.nodeId === 'string' ? o.nodeId : ''
    if (!actionId) return c.json({ ok: false, error: '缺少 actionId' }, 400)
    if (!nodeId) return c.json({ ok: false, error: '缺少 nodeId' }, 400)
    // 画布 id：前端还没多画布，缺省就是默认那张；给了就必须合法（挡路径穿越）
    const canvasId = typeof o.canvasId === 'string' && o.canvasId ? o.canvasId : DEFAULT_CANVAS_ID
    if (!isSafeCanvasId(canvasId)) return c.json({ ok: false, error: '非法画布 id' }, 400)

    const input: JobInput = {
      canvasId,
      nodeId,
      actionId,
      ...(typeof o.prompt === 'string' ? { prompt: o.prompt } : {}),
      ...(o.values && typeof o.values === 'object' ? { values: o.values as Record<string, unknown> } : {}),
      ...(Array.isArray(o.resources) ? { resources: o.resources as JobInput['resources'] } : {}),
    }

    const job = await tasks.createJob(input)
    if ('error' in job) return c.json({ ok: false, error: job.error }, 400)
    return c.json({ ok: true, jobId: job.id, status: job.status })
  })

  app.get('/api/jobs/:jobId', (c) => {
    const job = tasks.getJob(c.req.param('jobId'))
    if (!job) return c.json({ ok: false, error: '任务不存在' }, 404)
    return c.json({ ok: true, job })
  })

  app.post('/api/jobs/:jobId/cancel', async (c) => {
    const ok = await tasks.cancel(c.req.param('jobId'))
    if (!ok) return c.json({ ok: false, error: '任务不存在' }, 404)
    return c.json({ ok: true, cancelled: true })
  })

  return app
}
