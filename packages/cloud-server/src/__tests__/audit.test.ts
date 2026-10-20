import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAuditLog, type AuditEntry } from '../audit'

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-log-'))
  file = path.join(dir, 'nested', 'audit.log')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function readEntries(): Promise<AuditEntry[]> {
  const text = await fs.readFile(file, 'utf8')
  return text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as AuditEntry)
}

const base = {
  action: 'write' as const,
  method: 'POST',
  path: '/api/task/call',
  token: 'ok' as const,
  result: 'attempt' as const,
}

describe('append：JSONL 与哈希链', () => {
  it('目录不存在会自动创建，并按固定键顺序写一行 JSON', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    const text = await fs.readFile(file, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.startsWith('{"at":"')).toBe(true)
    expect(text).toContain('"action":"write"')
  })

  it('首条无 prev；后续 prev 等于上一条 hash，hash 可由内容复算', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await log.append({ ...base, action: 'task/call', result: 'ok' })
    const [a, b] = await readEntries()
    expect(a.prev).toBeUndefined()
    const { hash: ha, ...bodyA } = a
    expect(sha(JSON.stringify(bodyA))).toBe(ha)
    expect(b.prev).toBe(ha)
    const { hash: hb, ...bodyB } = b
    expect(sha(JSON.stringify(bodyB))).toBe(hb)
  })

  it('并发 append 串行落盘：50 条 prev 连成一条链', async () => {
    const log = createAuditLog(file)
    await Promise.all(Array.from({ length: 50 }, (_, i) => log.append({ ...base, id: 'n' + i })))
    const entries = await readEntries()
    expect(entries).toHaveLength(50)
    for (let i = 0; i < entries.length; i++) {
      expect(entries[i].prev).toBe(i === 0 ? undefined : entries[i - 1].hash)
    }
    expect(await log.verify()).toEqual({ ok: true })
  })

  it('重新打开同一个文件后继续追加，prev 仍接得上', async () => {
    const first = createAuditLog(file)
    await first.append(base)
    const firstHash = (await readEntries())[0].hash
    const second = createAuditLog(file)
    await second.append({ ...base, result: 'ok' })
    const entries = await readEntries()
    expect(entries[1].prev).toBe(firstHash)
    expect(await second.verify()).toEqual({ ok: true })
  })
})

describe('append：不泄露令牌、写失败不抛', () => {
  it('日志里不出现传入的令牌原文（未知字段也不会落盘）', async () => {
    const SECRET = 'f'.repeat(64)
    const log = createAuditLog(file)
    await log.append({ ...base, token: 'bad', result: 'rejected', reason: '令牌错误', adminToken: SECRET } as never)
    const text = await fs.readFile(file, 'utf8')
    expect(text).not.toContain(SECRET)
    expect(text).toContain('"token":"bad"')
  })

  it('appendFile 失败只 console.warn，Promise 正常完成', async () => {
    await fs.mkdir(file, { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = createAuditLog(file)
    await expect(log.append(base)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('verify', () => {
  it('文件不存在视为 ok', async () => {
    expect(await createAuditLog(path.join(dir, 'none.log')).verify()).toEqual({ ok: true })
  })

  it('删掉末行：行数与头文件对不上，verify 失败', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await log.append({ ...base, id: 'second' })
    const entries = await readEntries()
    await fs.writeFile(file, JSON.stringify(entries[0]) + '\n')
    expect(await log.verify()).toEqual({ ok: false, line: 2, reason: '日志行数与头文件不符' })
  })

  it('改掉末行（行数不变）：hash 对不上，verify 失败', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await log.append({ ...base, id: 'second' })
    const entries = await readEntries()
    entries[1].id = 'tampered'
    await fs.writeFile(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
    expect(await log.verify()).toEqual({ ok: false, line: 2, reason: 'hash 与内容不符' })
  })

  it('截断到 0 行：头文件还记着旧行数，verify 失败', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await fs.writeFile(file, '')
    expect(await log.verify()).toEqual({ ok: false, line: 1, reason: '日志行数与头文件不符' })
  })

  it('正常追加后 verify ok，头文件与日志行数一致', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await log.append({ ...base, id: 'second' })
    expect(await log.verify()).toEqual({ ok: true })
    const head = JSON.parse(await fs.readFile(file + '.head', 'utf8')) as { count: number; lastHash: string }
    const entries = await readEntries()
    expect(head.count).toBe(entries.length)
    expect(head.lastHash).toBe(entries[entries.length - 1].hash)
  })

  it('末尾被整体替换成另一条自洽的假记录：末行 hash 对不上头文件', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await log.append({ ...base, id: 'second' })
    const entries = await readEntries()
    // 攻击者把最后一行换成一条「自洽」的新记录（hash 由它自己的内容正确算出）
    const forgedBody = { ...entries[1] } as Record<string, unknown>
    delete forgedBody.hash
    forgedBody.id = 'forged'
    const forged = { ...forgedBody, hash: sha(JSON.stringify(forgedBody)) }
    await fs.writeFile(file, [entries[0], forged].map((e) => JSON.stringify(e)).join('\n') + '\n')
    expect(await log.verify()).toEqual({ ok: false, line: 2, reason: '末行被截断' })
  })

  it('并发 append 后头文件不落后（count/lastHash 与文件一致）', async () => {
    const log = createAuditLog(file)
    await Promise.all(Array.from({ length: 30 }, (_, i) => log.append({ ...base, id: 'c' + i })))
    const head = JSON.parse(await fs.readFile(file + '.head', 'utf8')) as { count: number; lastHash: string }
    const entries = await readEntries()
    expect(head.count).toBe(30)
    expect(entries).toHaveLength(30)
    expect(head.lastHash).toBe(entries[entries.length - 1].hash)
    expect(await log.verify()).toEqual({ ok: true })
  })

  it('头文件缺失但有日志：按末行 hash 重建，之后 verify 仍 ok', async () => {
    const first = createAuditLog(file)
    await first.append(base)
    await fs.rm(file + '.head')
    // 新实例读到无头文件 → 按末行重建
    const second = createAuditLog(file)
    await second.append({ ...base, result: 'ok' })
    const head = JSON.parse(await fs.readFile(file + '.head', 'utf8')) as { count: number }
    expect(head.count).toBe(2)
    expect(await second.verify()).toEqual({ ok: true })
  })

  it('有日志但头文件缺失：verify 直接报缺少头文件', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await fs.rm(file + '.head')
    expect(await log.verify()).toEqual({ ok: false, line: 1, reason: '缺少头文件（日志可能被整体替换）' })
  })

  it('崩在「日志已写、头文件没写」之间：新实例按日志修补头文件后继续接链', async () => {
    const first = createAuditLog(file)
    await first.append(base)
    await first.append({ ...base, id: 'second' })
    const entries = await readEntries()
    // 模拟头文件落后一行（日志已追加，进程在写 head 前退出）
    await fs.writeFile(file + '.head', JSON.stringify({ count: 1, lastHash: entries[0].hash }), 'utf8')

    const second = createAuditLog(file)
    await second.append({ ...base, id: 'third' })
    const after = await readEntries()
    expect(after[2].prev).toBe(entries[1].hash)
    const head = JSON.parse(await fs.readFile(file + '.head', 'utf8')) as { count: number }
    expect(head.count).toBe(3)
    expect(await second.verify()).toEqual({ ok: true })
  })

  it('内容被改：报告该行 hash 不符', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await log.append({ ...base, id: 'second' })
    const entries = await readEntries()
    entries[1].id = 'tampered'
    await fs.writeFile(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
    expect(await log.verify()).toEqual({ ok: false, line: 2, reason: 'hash 与内容不符' })
  })

  it('删掉中间一条：后一条 prev 不衔接，报告行号', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    await log.append({ ...base, id: 'second' })
    await log.append({ ...base, id: 'third' })
    const entries = await readEntries()
    await fs.writeFile(file, [entries[0], entries[2]].map((e) => JSON.stringify(e)).join('\n') + '\n')
    expect(await log.verify()).toEqual({ ok: false, line: 2, reason: 'prev 与上一行 hash 不衔接' })
  })

  it('首行带 prev（文件被截断重写）也会被指出', async () => {
    const log = createAuditLog(file)
    await log.append(base)
    const [e] = await readEntries()
    await fs.writeFile(file, JSON.stringify({ ...e, prev: 'x'.repeat(64) }) + '\n')
    expect(await log.verify()).toEqual({ ok: false, line: 1, reason: '首条记录不应有 prev' })
  })

  it('坏 JSON 行报告行号', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{bad json}\n')
    expect(await createAuditLog(file).verify()).toEqual({ ok: false, line: 1, reason: 'JSON 解析失败' })
  })
})
