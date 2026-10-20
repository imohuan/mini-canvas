/**
 * 自检：并发 append 时审计链是否仍然串成一条线（不能分叉）。
 * 用法：tsx audit-concurrency.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAuditLog } from '../../packages/cloud-server/src/audit.ts'

const dir = mkdtempSync(path.join(os.tmpdir(), 'mc-audit-'))
const file = path.join(dir, 'audit.log')
const log = createAuditLog(file)

// 200 条并发 append（不给 await），模拟多个请求同时进来
const jobs = []
for (let i = 0; i < 200; i++) {
  jobs.push(log.append({ action: 'write', method: 'POST', path: '/api/x/' + i, token: 'ok', result: 'attempt' }))
}
await Promise.all(jobs)

const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
let broken = 0
for (let i = 1; i < lines.length; i++) {
  if (lines[i].prev !== lines[i - 1].hash) {
    broken++
    if (broken <= 3) console.log('断链 at line', i + 1, lines[i].prev, '!=', lines[i - 1].hash)
  }
}
console.log('条数:', lines.length, '断链:', broken)
console.log('verify():', JSON.stringify(await log.verify()))

rmSync(dir, { recursive: true, force: true })
