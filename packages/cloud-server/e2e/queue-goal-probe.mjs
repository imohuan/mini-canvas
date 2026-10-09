/**
 * 探针：验证「后台对话 + 队列 + 目标」三件事的接线在真服务上成立。
 *
 * 只查"有没有、对不对"（HTTP 形状与磁盘产物），不跑真模型 —— 没有 API key 也能跑。
 * 用法：node e2e/queue-goal-probe.mjs <数据目录>
 */
// 直接跑源码（tsx）：dist 可能落后于工作区（本项目多个会话并行改，构建时机不可控）
import { createCloudServer } from '../src/index.ts'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const dataDir = process.argv[2]
if (!dataDir) throw new Error('用法: node e2e/queue-goal-probe.mjs <数据目录>')

// 注意：数据目录的参数名是 dir（不是 dataDir）；port 传 0 由系统分配，
// createCloudServer 会等到 listen 完成才 resolve，回来的 port 就是真实端口。
const srv = await createCloudServer({ dir: dataDir, port: 0, hostname: '127.0.0.1' })
const { url: base } = await srv.start()
let failed = 0
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : ''))
  if (!cond) failed += 1
}

try {
  // 1) goal hook 包已装（设计 §3.4.1）
  const hooksDir = path.join(dataDir, 'agent', 'mini-canvas', 'agents', 'canvas-agent', 'agent_state', 'hooks', 'goal')
  const files = await fs.readdir(hooksDir).catch(() => [])
  check('goal hook 包装上了', files.includes('hooks.json') && files.includes('start.mjs') && files.includes('stop.mjs'), files.join(','))
  const manifest = JSON.parse(await fs.readFile(path.join(hooksDir, 'hooks.json'), 'utf8').catch(() => '{}'))
  check('user_prompt 带 trigger:host', manifest.user_prompt?.[0]?.trigger === 'host')
  check('stop 命令保留', manifest.stop?.[0]?.command === 'stop.mjs')

  // 2) 建会话（不跑模型：只建）
  const created = await fetch(base + '/api/agent/canvases/default/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }).then((r) => r.json())
  // 没有模型凭据时建会话会失败（SDK 拒绝空密钥）—— 那是环境限制，不是代码缺陷：
  // 后面的检查全部改成"手动建一个空会话记录"继续跑（队列/目标/流不需要真模型）。
  const noCreds = !created.id && /credential|apiKey/i.test(String(created.error ?? ''))
  if (noCreds) {
    console.log('SKIP  建会话成功（本机没配模型凭据；用空会话继续验后面的接线）')
  } else {
    check('建会话成功', !!created.id, JSON.stringify(created).slice(0, 120))
  }
  const sid = created.id ?? 'session-probe-' + Date.now()
  if (!created.id) {
    // 手工落一份空会话（等价于"界面刚建好、还没发第一条"）
    await fs.mkdir(path.join(dataDir, 'canvases', 'default', 'agent', 'sessions'), { recursive: true })
    await fs.writeFile(
      path.join(dataDir, 'canvases', 'default', 'agent', 'sessions', sid + '.json'),
      JSON.stringify({ id: sid, title: '探针', createdAt: Date.now(), updatedAt: Date.now(), provider: 'p', modelId: 'm', turns: [] }),
    )
  }

  // 3) 会话详情带 queue / seq（刷新恢复的那一条）
  const full = await fetch(base + '/api/agent/canvases/default/sessions/' + sid).then((r) => r.json())
  check('会话详情含 queue', full.queue && Array.isArray(full.queue.items) && full.queue.paused === false)
  check('会话详情含 seq（重连坐标）', typeof full.seq === 'number' && typeof full.lastSeq === 'number')
  check('会话详情含 running', full.running === false)

  // 4) 队列：加一条 → 读回 → 暂停 → 删除
  const added = await fetch(base + '/api/agent/canvases/default/sessions/' + sid + '/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'add', text: '排队的第一条', images: ['data:image/png;base64,AAA'] }),
  }).then((r) => r.json())
  check('加队列条目成功', added.ok === true && added.queue.items.length === 1, JSON.stringify(added.queue?.items?.[0] ?? {}).slice(0, 140))
  const itemId = added.queue.items[0].id
  check('条目带图片落盘', Array.isArray(added.queue.items[0].images) && added.queue.items[0].images.length === 1)

  const list = await fetch(base + '/api/agent/canvases/default/sessions/' + sid + '/queue').then((r) => r.json())
  check('队列能读回（刷新恢复）', list.queue.items.length === 1)

  const paused = await fetch(base + '/api/agent/canvases/default/sessions/' + sid + '/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'pause' }),
  }).then((r) => r.json())
  check('暂停生效', paused.queue.paused === true)

  // 5) 磁盘上真落了（队列随会话文件存）
  const rec = JSON.parse(
    await fs.readFile(path.join(dataDir, 'canvases', 'default', 'agent', 'sessions', sid + '.json'), 'utf8'),
  )
  check('队列写进了会话文件（刷新/重启都在）', rec.queue?.items?.length === 1 && rec.queue?.paused === true)

  // 6) 目标端点（没有目标时改预算 ⇒ 404，不是 500）
  const goalRes = await fetch(base + '/api/agent/canvases/default/sessions/' + sid + '/goal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'update', budget: 50000 }),
  })
  const goalBody = await goalRes.json()
  check('没有目标时改预算 ⇒ 404 且带说明', goalRes.status === 404 && !!goalBody.error, JSON.stringify(goalBody))

  // 7) 重连端点存在（SSE：拿到 200 与 text/event-stream 就算通）
  const streamRes = await fetch(base + '/api/agent/canvases/default/sessions/' + sid + '/stream?since=0')
  check('stream 端点返回 SSE', streamRes.status === 200 && (streamRes.headers.get('content-type') ?? '').includes('text/event-stream'))
  await streamRes.body?.cancel()

  // 8) 删除条目
  const removed = await fetch(base + '/api/agent/canvases/default/sessions/' + sid + '/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'remove', itemId }),
  }).then((r) => r.json())
  check('删除条目成功', removed.queue.items.length === 0)

  // 9) 未知 op ⇒ 400（不是静默成功）
  const bad = await fetch(base + '/api/agent/canvases/default/sessions/' + sid + '/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'nonsense' }),
  })
  check('未知队列 op ⇒ 400', bad.status === 400)
} finally {
  srv.stop()
  await new Promise((r) => setTimeout(r, 300))
}

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' FAILED')
process.exit(failed === 0 ? 0 : 1)
