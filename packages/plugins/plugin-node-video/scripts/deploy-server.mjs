/**
 * deploy-server —— 把视频插件的后台半（dist/server.js）装进跑着的 cloud-server。
 *
 * 为什么需要脚本：后台插件从 <数据根>/server-plugins/*.js 加载，手工拷贝要重启；
 * 而走安装接口要带管理令牌 + confirm + 与清单一致的可信 sha256。
 * 少一步的表现都是「路由 404 / 仍报源视频不是画布资源」，很难看出是哪一步。
 *
 * 用法（默认 http://127.0.0.1:8865，数据目录 packages/cloud-server/.mini-canvas）：
 *   node scripts/deploy-server.mjs
 *   MINI_CANVAS_URL=http://127.0.0.1:8866 node scripts/deploy-server.mjs
 *
 * 前置：先跑一次 build（build 脚本里已包含 build:server）。
 */
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 后台地址 */
const base = (process.env.MINI_CANVAS_URL ?? 'http://127.0.0.1:8865').replace(/\/+$/, '')

/** 安装后的文件名（也是清单里的插件 id） */
const id = 'plugin-node-video'

/**
 * 读管理令牌：先环境变量，再 <数据目录>/admin-token。
 * 默认数据目录按「从仓库根跑」与「在包目录里跑」两种姿势都试一下。
 */
async function readAdminToken() {
  const fromEnv = (process.env.MINI_CANVAS_ADMIN_TOKEN ?? '').trim()
  if (fromEnv) return fromEnv
  const roots = [
    process.env.MINI_CANVAS_DATA_DIR,
    'packages/cloud-server/.mini-canvas',
    path.resolve(PKG, '../../cloud-server/.mini-canvas'),
    '.mini-canvas',
  ].filter((v) => typeof v === 'string' && v.length > 0)
  for (const dir of roots) {
    try {
      const raw = (await readFile(path.resolve(dir, 'admin-token'), 'utf8')).trim()
      if (/^[0-9a-f]{64}$/i.test(raw)) return raw
    } catch {
      /* 继续试下一个 */
    }
  }
  return ''
}

const file = path.join(PKG, 'dist/server.js')

async function main() {
  try {
    await stat(file)
  } catch {
    console.error('[deploy] 没有 ' + file + '，先跑 pnpm build（含 build:server）')
    process.exitCode = 1
    return
  }
  const code = await readFile(file, 'utf8')

  let trusted
  try {
    const catalog = await (await fetch(base + '/plugin-catalog.json')).json()
    trusted = catalog.plugins.find((p) => p.id === id)?.server?.sha256
  } catch (err) {
    console.error('[deploy] 连不上后台 ' + base + '：' + err.message)
    process.exitCode = 1
    return
  }
  if (!trusted) {
    console.error('[deploy] 清单里没有 ' + id + ' 的后台产物。确认 dist/server.js 已生成，再刷新清单。')
    process.exitCode = 1
    return
  }

  const token = await readAdminToken()
  if (!token) {
    console.error('[deploy] 没找到管理令牌：设 MINI_CANVAS_ADMIN_TOKEN，或指定 MINI_CANVAS_DATA_DIR。')
    process.exitCode = 1
    return
  }

  const res = await fetch(base + '/api/server-plugins/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ id, code, confirm: true, sha256: trusted, origin: base }),
  })
  const out = await res.json()
  if (!out.ok) {
    console.error('[deploy] 失败：' + out.error)
    process.exitCode = 1
    return
  }
  console.log('[deploy] ' + JSON.stringify(out))
  if (out.hotError) console.log('[deploy] 热装没成功 → 重启后台后生效')
}

await main()
