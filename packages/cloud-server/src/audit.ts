/**
 * 追加式 JSONL 审计日志 + 哈希链校验。
 *
 * 单写者：所有 append 进入同一条 promise 链，保证「读上一跳 hash → 算本轮 hash
 * → appendFile」不交错，否则并发请求会写出分叉的链。
 * 写失败只警告，不影响业务。这里也绝不写令牌原文，只记 token 状态。
 *
 * 为什么还要一个「头文件」：hash 链只能证明「行与行之间接得上」。攻击者删掉最后
 * 几行（尤其是刚写下的成功记录）后，剩下的链依然自洽，单看日志发现不了。所以每次
 * 追加后把 { count, lastHash } 原子写到 `<audit>.head`，verify 再拿它和文件对数：
 * 行数少了、末行 hash 对不上，都能当场指出来。
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
  | 'mcp/call'
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

/** 头文件内容：日志应有的行数与末行 hash。 */
export interface AuditHead {
  count: number
  lastHash: string
}

/** append 的入参（时间、prev、hash 由日志自己补）。路由层也复用这个类型做审计。 */
export type AuditAppendInput = Omit<AuditEntry, 'at' | 'prev' | 'hash'>

type AppendInput = AuditAppendInput

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
  const headPath = filePath + '.head'
  let lastHash: string | undefined
  /** 已成功落盘的行数。和 head 里的 count 同步，保证并发 append 时不会落后。 */
  let count = 0
  let loadPromise: Promise<void> | null = null

  /** 读头文件；缺失、坏 JSON、字段不对都当作「没有头文件」。 */
  async function readHead(): Promise<AuditHead | undefined> {
    try {
      const parsed = JSON.parse(await fs.readFile(headPath, 'utf8')) as Partial<AuditHead>
      if (
        typeof parsed.count === 'number' &&
        Number.isInteger(parsed.count) &&
        parsed.count >= 0 &&
        typeof parsed.lastHash === 'string'
      ) {
        return { count: parsed.count, lastHash: parsed.lastHash }
      }
      return undefined
    } catch {
      return undefined
    }
  }

  /** 原子写头文件：先写临时文件再 rename，避免读者看到写了一半的 JSON。 */
  async function writeHead(next: AuditHead): Promise<void> {
    const tmp =
      headPath + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    try {
      await fs.writeFile(tmp, JSON.stringify(next), 'utf8')
      await fs.rename(tmp, headPath)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
  }

  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = (async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        const head = await readHead()

        // 无论有没有头文件都要数一遍日志：崩溃可能停在「日志已写、头文件没写」之间。
        let text: string | undefined
        try {
          text = await fs.readFile(filePath, 'utf8')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('[audit] 读取已有审计日志失败，从空链开始：' + filePath)
          }
        }
        const lines =
          text === undefined ? [] : text.split(/\r?\n/).filter((line) => line !== '')

        /** 取末行 hash；末行坏了就返回 undefined（不硬接一条断链）。 */
        const tailHash = (): string | undefined => {
          const last = lines[lines.length - 1]
          if (last === undefined) return undefined
          try {
            const parsed = JSON.parse(last) as { hash?: unknown }
            return typeof parsed.hash === 'string' ? parsed.hash : undefined
          } catch {
            console.warn('[audit] 现有审计日志末行无法解析：' + filePath)
            return undefined
          }
        }

        if (lines.length === 0) {
          // 空日志：头文件若记着旧行数，保留它 —— 让 verify 能发现「文件被清空」。
          if (!head) {
            await writeHead({ count: 0, lastHash: '' }).catch((err: unknown) => {
              console.warn('[audit] 重建空审计头文件失败（已忽略）：' + headPath, err)
            })
          } else {
            count = head.count
            lastHash = head.count === 0 ? undefined : head.lastHash
          }
          return
        }

        const fileHash = tailHash()
        if (!head) {
          // 头文件缺失（老版本日志 / 被删）：按日志末行 hash 和行数重建一份。
          count = lines.length
          lastHash = fileHash
          await writeHead({ count, lastHash: fileHash ?? '' }).catch((err: unknown) => {
            console.warn('[audit] 重建审计头文件失败（已忽略）：' + headPath, err)
          })
          return
        }

        if (lines.length > head.count) {
          // 崩溃留下的「头文件落后」：以日志为准补记，避免下次 append 接出分叉。
          count = lines.length
          lastHash = fileHash ?? head.lastHash
          await writeHead({ count, lastHash: lastHash ?? '' }).catch((err: unknown) => {
            console.warn('[audit] 修补落后的审计头文件失败（已忽略）：' + headPath, err)
          })
          return
        }

        // 剩下的两种：行数相等（正常），或日志反而更少（被截断）。
        // 链接续接一律用日志末行（否则写出一条 prev 对不上的链）。count 取头文件里的大数，
        // 让被截断这件事在 verify 里一直能被看见。
        count = head.count
        lastHash = fileHash ?? head.lastHash
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
      count += 1
      // 和日志写在同一条链里：并发 append 不会出现「日志已多一行、头文件还没跟上」。
      await writeHead({ count, lastHash: hash }).catch((err: unknown) => {
        console.warn('[audit] 更新审计头文件失败（已忽略）：' + headPath, err)
      })
    }).catch((err: unknown) => {
      console.warn('[audit] 写审计日志失败（已忽略）：' + filePath, err)
    })
    tail = run
    return run
  }

  async function verify(): Promise<{ ok: true } | { ok: false; line: number; reason: string }> {
    /** 读日志文件；不存在返回 undefined。 */
    async function readText(): Promise<string | undefined> {
      try {
        return await fs.readFile(filePath, 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw err
      }
    }

    // 服务还活着的时候也可能跑来 verify（CLI 对着正在写入的日志跑）。
    let text: string | undefined
    try {
      text = await readText()
    } catch {
      return { ok: false, line: 1, reason: '读取审计日志失败' }
    }
    const head = await readHead()

    const lines = text === undefined ? [] : text.split(/\r?\n/)
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

    // 链内自洽还不够：删掉末尾几行，剩下的链照样是自洽的。拿头文件对总数和末行 hash。
    // 文件根本不存在 = 从没记过审计，视为 ok；文件存在（哪怕是空的）却没有头文件，
    // 说明日志或头文件被单独动过，不能放过。
    if (!head) {
      if (text === undefined) return { ok: true }
      return { ok: false, line: 1, reason: '缺少头文件（日志可能被整体替换）' }
    }
    // 行数比头文件少 = 一定有记录被删（正常写入只会让日志变长）。
    if (lines.length < head.count) {
      return {
        ok: false,
        line: lines.length + 1,
        reason: '日志行数与头文件不符（少 ' + (head.count - lines.length) + ' 行）',
      }
    }
    // 行数比头文件多：多半是「日志已 append、头文件还没写完」的瞬间窗口，
    // 但也可能是有人往后面追加了记录。如实报出来，并提示停止服务后重跑。
    if (lines.length > head.count) {
      return {
        ok: false,
        line: head.count + 1,
        reason: '日志比头文件多 ' + (lines.length - head.count) + ' 行（服务正在写入时可能短暂出现，请停止服务后重跑）',
      }
    }
    if (head.count === 0) return { ok: true }
    // 行数相同但末行 hash 对不上：最后一行被换成了另一条自洽的假记录。
    if (prevHash !== head.lastHash) {
      return { ok: false, line: lines.length, reason: '末行被截断' }
    }
    return { ok: true }
  }

  return { append, verify }
}
