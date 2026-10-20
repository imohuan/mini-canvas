/**
 * 审计「成对」小工具：进入路由记 attempt，结束时一定补一条 ok / rejected。
 *
 * 为什么需要它：审计链只能说明「记录没被改」，说明不了「一次操作有没有留下结局」。
 * 之前插件安装/卸载有几条分支：记了 attempt 就 return 400/404，或者中途抛异常，
 * 事后看日志会误判成「请求执行到一半崩了」。这里把 attempt 和结局锁在一起：
 *   - 正常返回 → 没显式标记就记 ok；
 *   - 分支里想写具体原因 → 调 settle({ result: 'rejected', reason });
 *   - 抛异常 → 记 rejected（带异常信息）再原样抛出。
 *
 * 没有任何审计出口（纯框架测试、没注入 auditLog）时是 no-op，不影响业务。
 */
import type { AuditAction } from './audit.js'

/** 一条审计的固定部分（action / 谁 / 哪个资源 / 令牌状态）。 */
export interface AuditBase {
  action: AuditAction
  method: string
  path: string
  id: string
  sha256?: string
  size?: number
  origin?: string
  host?: string
  token: 'ok' | 'missing' | 'bad' | 'disabled'
}

/** 结局：成功，或被拒（带人话原因）。可顺带补上算完才知道的字段（如 sha256、size）。 */
export interface AuditOutcome {
  result: 'ok' | 'rejected'
  reason?: string
  sha256?: string
  size?: number
}

/** 一条审计事件：固定字段 + （attempt 或 已定结局）。 */
export type AuditEvent<E extends AuditBase = AuditBase> = E &
  ({ result: 'attempt' } | AuditOutcome)

/** 审计出口：一般是 auditLog.append；缺省表示不记。 */
export type AuditSink<E extends AuditBase = AuditBase> = (e: AuditEvent<E>) => Promise<void>

/**
 * 跑一段路由逻辑，并保证 attempt 一定有结局。
 *
 * @param sink  审计出口；undefined 时全部跳过
 * @param base  本条审计的固定字段（id 可以先给空串，分支里再补不了，所以尽量在解析完 body 后调用）
 * @param run   真正的路由逻辑；想说明失败原因就调 settle(...)
 */
export async function withAudit<T, B extends AuditBase = AuditBase>(
  sink: AuditSink<B> | undefined,
  base: B,
  run: (settle: (o: AuditOutcome) => void) => Promise<T>,
): Promise<T> {
  await sink?.({ ...base, result: 'attempt' })

  // 用对象包一层：闭包里赋值，读的时候不会被 TS 当成「永远是 undefined」。
  const decided: { value?: AuditOutcome } = {}
  const settle = (o: AuditOutcome): void => {
    decided.value = o
  }

  try {
    const out = await run(settle)
    const final = decided.value ?? { result: 'ok' as const }
    await sink?.({
      ...base,
      result: final.result,
      ...(final.reason !== undefined ? { reason: final.reason } : {}),
      ...(final.sha256 !== undefined ? { sha256: final.sha256 } : {}),
      ...(final.size !== undefined ? { size: final.size } : {}),
    })
    return out
  } catch (err) {
    await sink?.({
      ...base,
      result: 'rejected',
      reason: '异常：' + (err instanceof Error ? err.message : String(err)),
    })
    throw err
  }
}
