/**
 * 追加式 JSONL 审计日志 + 哈希链校验。
 *
 * 单写者：所有 append 进入同一条 promise 链，保证「读上一跳 hash → 算本轮 hash
 * → appendFile」不交错，否则并发请求会写出分叉的链。
 * 写失败只警告，不影响业务。这里也绝不写令牌原文，只记 token 状态。
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type AuditAction =
  | 'write'
  | 'canvas/write'
  | 'canvas/overwrite'
  | 'agent/session-write'
  | 'task/call'
  | 'server-plugin/install'
  | 'server-plugin/uninstall'
  | 'npm-plugin/install'
  | 'npm-plugin/update'
  | 'npm-plugin/uninstall'
  | 'agent/mcp-add'
  | 'agent/mcp-remove'
  | 'auth-failed'

export interface AuditEntry {
  at: string
  action: AuditAction
  method: string
  path: string
  id?: string
  sha256?: string
  size?: number
  origin?: string
  host?: string
  token: 'ok' | 'missing' | 'bad' | 'disabled'
  result: 'attempt' | 'ok' | 'rejected'
  reason?: string
  prev?: string
  hash?: string
}

type AppendInput = Omit<AuditEntry, 'at' | 'prev' | 'hash'>

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 固定键顺序，保证 hash 可复算。 */
function buildBody(e: AppendInput, at: string, prev: string | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {
    at,
    action: e.action,
    method: e.method,
    path: e.path,
  }
  if (e.id !== undefined) body.id = e.id
  if (e.sha256 !== undefined) body.sha256 = e.sha256
  if (e.size !== undefined) body.size = e.size
  if (e.origin !== undefined) body.origin = e.origin
  if (e.host !== undefined) body.host = e.host
  body.token = e.token
  body.result = e.result
  if (e.reason !== undefined) body.reason = e.reason
  if (prev !== undefined) body.prev = prev
  return body
}

export function createAuditLog(filePath: string): {
  append(e: AppendInput): Promise<void>
  verify(): Promise<{ ok: true } | { ok: false; line: number; reason: string }>
} {
  let lastHash: string | undefined
  let loadPromise: Promise<void> | null = null

  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        let text: string
        try {
          text = await fs.readFile(filePath, 'utf8')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
          console.warn('[audit] 读取已有审计日志失败，从空链开始：' + filePath)
          return
        }
        const lines = text.split(/\r?\n/).filter((line) => line !== '')
        const last = lines[lines.length - 1]
        if (!last) return
        try {
          const parsed = JSON.parse(last) as { hash?: unknown }
          if (typeof parsed.hash === 'string') lastHash = parsed.hash
        } catch {
          console.warn('[audit] 现有审计日志末行无法解析，从空链开始：' + filePath)
        }
      })()
    }
    return loadPromise
  }

  let tail: Promise<void> = Promise.resolve()

  function append(e: AppendInput): Promise<void> {
    const run = tail.then(async () => {
      await ensureLoaded()
      const at = new Date().toISOString()
      const body = buildBody(e, at, lastHash)
      const bodyText = JSON.stringify(body)
      const hash = sha256(bodyText)
      const line = JSON.stringify({ ...body, hash })
      await fs.appendFile(filePath, line + '\n', 'utf8')
      lastHash = hash
    }).catch((err: unknown) => {
      console.warn('[audit] 写审计日志失败（已忽略）：' + filePath, err)
    })
    tail = run
    return run
  }

  async function verify(): Promise<{ ok: true } | { ok: false; line: number; reason: string }> {
    let text: string
    try {
      text = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true }
      return { ok: false, line: 1, reason: '读取审计日志失败' }
    }
    const lines = text.split(/\r?\n/)
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

    let prevHash: string | undefined
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1
      const line = lines[i]
      if (line.trim() === '') return { ok: false, line: lineNo, reason: '空行' }
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        return { ok: false, line: lineNo, reason: 'JSON 解析失败' }
      }
      if (i === 0) {
        if (parsed.prev !== undefined) return { ok: false, line: lineNo, reason: '首条记录不应有 prev' }
      } else if (parsed.prev !== prevHash) {
        return { ok: false, line: lineNo, reason: 'prev 与上一行 hash 不衔接' }
      }
      const hash = parsed.hash
      if (typeof hash !== 'string' || hash === '') {
        return { ok: false, line: lineNo, reason: '缺少 hash' }
      }
      // 按解析后的键顺序去掉 hash 再算，键顺序被改也会被发现。
      const withoutHash = { ...parsed }
      delete withoutHash.hash
      if (sha256(JSON.stringify(withoutHash)) !== hash) {
        return { ok: false, line: lineNo, reason: 'hash 与内容不符' }
      }
      prevHash = hash
    }
    return { ok: true }
  }

  return { append, verify }
}
