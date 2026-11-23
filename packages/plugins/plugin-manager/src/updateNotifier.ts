/**
 * updateNotifier —— 应用级更新通知（用户口径 2026-11-23）。
 *
 * 流程：后台启动即检查（异步，不阻塞页面）。前端轮询 /api/updates：
 * - pending（报告还没算完）→ 每 5 秒继续拉，等报告就绪；
 * - 就绪 → 把「未读」的更新合并成一条通知弹一次（点「已读」才标记，
 *   没点的话刷新页面还会再弹）；然后按服务端 nextCheckInSeconds 排下一轮。
 * - 到点后报告没换新（服务端定时器有秒级延迟）→ 短重试几次，防漏报。
 * - 没有 SSE 也能覆盖「页面先开、报告后到」：轮询就是那条通道。
 */
import type { Context } from '@plume-canvas/plugin-sdk'
import type { NotifyContract } from '@plume-canvas/canvas-data'
import { baseOfCatalogUrl, type PluginManagerService } from './pluginManagerService'

interface NotifyInfo {
  pending?: boolean
  nextCheckInSeconds?: number | null
  read?: Record<string, boolean>
}

interface ReportItem { pkg: string; local: string; latest: string; builtin?: boolean }

const POLL_PENDING_MS = 5000
/** 到点后报告没换新时的重试间隔（服务端定时器可能有秒级延迟） */
const RETRY_LAG_MS = 10000
const MAX_LAG_RETRIES = 3

export function startUpdateNotifier(ctx: Context, svc: PluginManagerService): void {
  const maybeNotify = ctx.tryGet<NotifyContract>('notify')
  if (!maybeNotify) return
  const notify: NotifyContract = maybeNotify

  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  /** 本次页面生命周期里已弹过的报告（checkedAt）：开着页面不重复弹同一条 */
  let lastToastedCheckedAt = ''
  let lagRetries = 0

  async function fetchOnce(): Promise<{ report?: { plugins?: ReportItem[]; checkedAt?: string | null }; notify?: NotifyInfo } | null> {
    try {
      const res = await fetch(baseOfCatalogUrl(svc.state.catalogUrl) + '/api/updates', { headers: { accept: 'application/json' } })
      if (!res.ok) return null
      return (await res.json()) as { ok?: boolean; report?: { plugins?: ReportItem[]; checkedAt?: string | null }; notify?: NotifyInfo }
    } catch { return null }
  }

  function schedule(ms: number): void {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void tick(), ms)
  }

  /** pkg -> 中文标题（清单 rows 里有 entry.title；查不到退回去 scope 包名） */
  function titleOf(pkg: string): string {
    const id = pkg.replace(/^@[^/]+\//, '')
    const row = svc.state.rows.find((r) => r.entry.id === id)
    return row?.entry.title || id
  }

  async function tick(): Promise<void> {
    if (stopped) return
    const data = await fetchOnce()
    if (!data) { schedule(POLL_PENDING_MS); return }
    const info = data.notify ?? {}
    const checkedAt = data.report?.checkedAt
    if (info.pending || !checkedAt) { schedule(POLL_PENDING_MS); return }

    if (checkedAt !== lastToastedCheckedAt) {
      lastToastedCheckedAt = checkedAt
      const read = info.read ?? {}
      const unread = (data.report?.plugins ?? []).filter((p) => read[p.pkg + '@' + p.latest] !== true)
      if (unread.length > 0) {
        const lines = unread.map((p) => titleOf(p.pkg) + ' → v' + p.latest).join('；')
        const label = unread.length === 1 ? '1 个插件有新版本' : unread.length + ' 个插件有新版本'
        notify.warning(label, {
          description: lines,
          duration: Infinity,
          // vue-sonner 的 cancel 按钮只在 dismissible 时才触发 onClick（源码 719-724 行）。
          // ✕ 关闭不标已读 —— 未读口径下下次还会弹，行为一致。
          dismissible: true,
          action: {
            label: '去更新',
            onClick: () => ctx.emit('settings:ui-open', { nav: 'nav/integration/plugins' }),
          },
          cancelAction: {
            label: '已读',
            onClick: () => {
              void fetch(baseOfCatalogUrl(svc.state.catalogUrl) + '/api/updates/read', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ checkedAt, pkgs: unread.map((p) => ({ pkg: p.pkg, latest: p.latest })) }),
              }).catch(() => {})
            },
          },
        })
      }
      lagRetries = 0
    } else if (lagRetries < MAX_LAG_RETRIES) {
      // 报告没换新：可能是服务端定时器还没跑完，短重试几次
      lagRetries++
      schedule(RETRY_LAG_MS)
      return
    }

    const wait = Math.max(5, info.nextCheckInSeconds ?? 1800)
    lagRetries = 0
    schedule(wait * 1000)
  }

  void tick()
  ctx.effect(() => () => {
    stopped = true
    if (timer) clearTimeout(timer)
  })
}
