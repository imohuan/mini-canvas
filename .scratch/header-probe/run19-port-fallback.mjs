/**
 * 探针 AA：CLI 的「端口被占用自动顺延」时，服务自报的 origin 用的是哪个端口？
 *
 * 为什么关心：Host 白名单要按「实际端口」生成。如果 selfOrigin 用的是「请求端口」，
 * 那么顺延之后白名单与真实地址对不上，请求会被自己拒掉（或反过来，白名单放行了错的端口）。
 *
 * 做法：先占住 8865，再用默认端口起一个服务，读它注入的 selfOrigin（经 /api/node-ui/info 不行，
 * 那个要插件；改用 /plugin-manifest.json 无 origin。这里直接看启动日志与 /health）。
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 1. 占住默认端口
const blocker = http.createServer((req, res) => res.end('blocker'))
await new Promise((r) => blocker.listen(8865, '127.0.0.1', r))
console.log('已占住 8865')

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'mc-port-'))
const child = spawn(process.execPath, [
  'packages/cloud-server/dist/cli.js', 'serve',
  '-d', dataDir, '--no-open', '--no-mcp',
], { cwd: 'D:/Code/Git/mini-canvas', stdio: ['ignore', 'pipe', 'pipe'] })

let out = ''
child.stdout.on('data', (d) => { out += String(d) })
child.stderr.on('data', (d) => { out += String(d) })

// 等它打印「画布 http://…」
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout: ' + out)), 25000)
  const tick = setInterval(() => {
    const m = /画布\s+(http:\/\/[^\s]+)/.exec(out)
    if (m) { clearInterval(tick); clearTimeout(timer); resolve(m[1]) }
  }, 200)
})
console.log('实际访问地址:', url)
console.log('日志是否提示顺延:', /自动改用/.test(out))

// 2. 打两个只读接口，确认服务在真实端口上活着
const hit = (u) => new Promise((resolve, reject) => {
  http.get(u, (res) => { res.resume(); resolve(res.statusCode) }).on('error', reject)
})
console.log('健康检查:', await hit(url + '/health'))
console.log('插件清单:', await hit(url + '/plugin-manifest.json'))

child.kill()
blocker.close()
setTimeout(() => { try { rmSync(dataDir, { recursive: true, force: true }) } catch {} }, 500)
setTimeout(() => process.exit(0), 900)
