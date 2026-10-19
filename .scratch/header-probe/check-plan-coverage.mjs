/**
 * 一致性检查：文档第十三节「逐条清单」里的每条路由，是否都能被后面的「前缀表」覆盖。
 *
 * 只读文档，不改任何东西。
 */
import { readFileSync } from 'node:fs'

const FILE = 'D:/Code/Git/mini-canvas/docs/plan/2026-10-19-cloud-server-admin-security-plan.md'
const text = readFileSync(FILE, 'utf8')

const singleStart = text.indexOf('### 首版受保护接口清单')
const singleEnd = text.indexOf('清单靠**「方法 + 路径前缀」匹配**')
const singleBlock = text.slice(singleStart, singleEnd)

const routes = singleBlock
  .split('\n')
  .filter((l) => /^(POST|PUT|DELETE)/.test(l.trim()))
  .map((l) => {
    const clean = l.trim().split(/\s{2,}#|\s+←/)[0].trim()
    const m = /^(POST|PUT|DELETE)(\/PUT\/PATCH\/DELETE)?\s+(\S+)/.exec(clean)
    return m ? { methods: (m[1] + (m[2] ?? '')).split('/'), path: m[3] } : null
  })
  .filter(Boolean)

const prefixStart = text.indexOf('任意写方法：')
const prefixEnd = text.indexOf('> `/api/agent/canvases/` 与 `/api/canvases/`')
const prefixBlock = text.slice(prefixStart, prefixEnd)

const allWrite = []
const postOnly = []
let mode = 'all'
for (const line of prefixBlock.split('\n')) {
  if (line.includes('仅 POST')) mode = 'post'
  for (const m of line.matchAll(/\/api\/[\w\/-]+/g)) {
    (mode === 'post' ? postOnly : allWrite).push(m[0])
  }
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const covered = (r) => {
  const anyWrite = r.methods.some((m) => WRITE.has(m))
  const all = anyWrite && allWrite.some((p) => r.path === p.replace(/\/$/, '') || r.path.startsWith(p))
  const post = r.methods.includes('POST') && postOnly.some((p) => r.path === p.replace(/\/$/, '') || r.path.startsWith(p))
  return all || post
}

console.log('逐条路由:', routes.length)
console.log('任意写方法前缀:', allWrite.length, '| 仅 POST 前缀:', postOnly.length)

const missing = routes.filter((r) => !covered(r))
if (missing.length === 0) {
  console.log('✅ 每条都被前缀表覆盖')
} else {
  console.log('❌ 未被覆盖：')
  for (const r of missing) console.log('  ', r.methods.join('/'), r.path)
}

// 反向：前缀表里有没有文档没提到的（可能是多余，也可能是刻意整段保护）
const prefixPaths = [...new Set([...allWrite, ...postOnly])]
const uncoveredByPrefix = prefixPaths.filter((p) => !routes.some((r) => r.path === p.replace(/\/$/, '') || r.path.startsWith(p)))
if (uncoveredByPrefix.length) {
  console.log('\n前缀表里没有对应逐条路由的（整段保护，属预期）：')
  for (const p of uncoveredByPrefix) console.log('  ', p)
}
