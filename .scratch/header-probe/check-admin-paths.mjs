/**
 * 自检：文档第十三节的 42 条清单，是否每一条都被 isAdminPath 命中到。
 * 用法：tsx check-admin-paths.mjs
 */
import { readFileSync } from 'node:fs'
import { isAdminPath } from '../../packages/cloud-server/src/adminAuth.ts'

const file = 'D:/Code/Git/mini-canvas/docs/plan/2026-10-19-cloud-server-admin-security-plan.md'
const text = readFileSync(file, 'utf8')
const start = text.indexOf('### 首版受保护接口清单')
const end = text.indexOf('清单靠**「方法 + 路径前缀」匹配**')
const block = text.slice(start, end)

const rows = block
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => /^(POST|PUT|DELETE)/.test(l))
  .map((l) => {
    const clean = l.split(/\s{2,}#|\s+←/)[0].trim()
    const m = /^([A-Z]+(?:\/[A-Z]+)*)\s+(\S+)/.exec(clean)
    return m ? { methods: m[1].split('/'), path: m[2] } : null
  })
  .filter(Boolean)

let miss = 0
for (const r of rows) {
  for (const method of r.methods) {
    // 带 :param 的换成具体值；带 * 的取一个具体子路径
    const path = r.path.replace(/:[A-Za-z]+/g, 'x').replace(/\*$/, 'whatever')
    if (!isAdminPath(method, path)) {
      console.log('✗ 未保护:', method, r.path)
      miss++
    }
  }
}
console.log(`\n清单 ${rows.length} 行，未命中 ${miss} 条`)

// 反向：不该被保护的要放行
const shouldPass = [
  ['GET', '/api/canvases'],
  ['GET', '/api/canvases/default'],
  ['PUT', '/api/canvases/default'],
  ['GET', '/api/assets'],
  ['POST', '/api/assets'],
  ['POST', '/api/projects'],
  ['PUT', '/api/kv/config/x'],
  ['GET', '/api/task/events'],
  ['POST', '/health'],
]
for (const [m, p] of shouldPass) {
  const got = isAdminPath(m, p)
  const want = !['/api/canvases', '/api/canvases/default', '/api/assets', '/api/projects', '/api/kv/config/x'].includes(p) || m === 'POST' && p === '/api/assets'
  if (got !== want) console.log('⚠️ 放行表不一致:', m, p, '→', got)
}
