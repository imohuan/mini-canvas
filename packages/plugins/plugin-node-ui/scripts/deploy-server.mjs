/**
 * deploy-server —— 把本插件的后台半（dist/server.js）装到跑着的后台。
 *
 * ## 为什么需要它（2026-10-13 踩到的坑）
 *
 * 「源码里写完」不等于「后台在跑」：后台插件是**启动时从
 * <数据根>/server-plugins/*.js 加载**的，不重启不生效；而手工调安装接口要自己算 sha、
 * 自己传 confirm/origin，容易漏一步，然后表现为「路由 404 / 手册里没有那一段」，
 * 查起来像前端坏了。
 *
 * 这个脚本把那条路走完：
 *   1. 读本地 dist/server.js
 *   2. 从后台清单拿它的**可信 sha256**（服务端信任源，不是我们现算的）
 *   3. POST /api/server-plugins/install（confirm + origin 都带上）
 *   4. 报出结果：热装成功 / 落盘待重启
 *
 * 用法：
 *   node scripts/deploy-server.mjs                    # 默认 http://127.0.0.1:8865
 *   MINI_CANVAS_URL=http://127.0.0.1:9000 node scripts/deploy-server.mjs
 *   MINI_CANVAS_ADMIN_TOKEN=<64 位 hex> node scripts/deploy-server.mjs   # 后台开了鉴权时
 */
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 后台地址（默认本机 8865，也就是 pnpm -C packages/cloud-server serve 的默认口） */
const base = (process.env.MINI_CANVAS_URL ?? 'http://127.0.0.1:8865').replace(/\/+$/, '')

/** 插件 id = 插件目录名（清单里的 id / 安装时的文件名的来源） */
const id = 'plugin-node-ui'

/**
 * 管理令牌：`POST /api/server-plugins/install` 在受保护清单里，没有它必 403。
 *
 * 取法与环境变量一致：先看 `MINI_CANVAS_ADMIN_TOKEN`，再读 `<数据目录>/admin-token`。
 * 数据目录默认是 `./.mini-canvas`（与 `serve` 的默认一致），可以用 `MINI_CANVAS_DATA_DIR` 覆盖。
 */
async function readAdminToken() {
  const fromEnv = (process.env.MINI_CANVAS_ADMIN_TOKEN ?? '').trim()
  if (fromEnv) return fromEnv
  const dir = path.resolve(process.env.MINI_CANVAS_DATA_DIR ?? '.mini-canvas')
  try {
    const raw = (await readFile(path.join(dir, 'admin-token'), 'utf8')).trim()
    if (/^[0-9a-f]{64}$/i.test(raw)) return raw
  } catch {
    /* 没有文件就走下面的报错 */
  }
  return ''
}

const file = path.join(PKG, 'dist/server.js')

async function main() {
  try {
    await stat(file)
  } catch {
    console.error('[deploy] 没有 ' + file + '，先跑 pnpm build:server')
    process.exitCode = 1
    return
  }
  const code = await readFile(file, 'utf8')

  // 可信哈希从**后台清单**取：安装路由只认它，调用方自己算的哈希不算数（见 serverPlugins.ts）
  let trusted
  try {
    const res = await fetch(base + '/plugin-catalog.json')
    const catalog = await res.json()
    trusted = catalog.plugins.find((p) => p.id === id)?.server?.sha256
  } catch (err) {
    console.error('[deploy] 连不上后台 ' + base + '：' + err.message)
    process.exitCode = 1
    return
  }
  if (!trusted) {
    console.error(
      '[deploy] 清单里没有 ' + id + ' 的后台产物哈希。' +
        '先跑 pnpm -C packages/cloud-server bundle（清单由后台现扫磁盘生成）。',
    )
    process.exitCode = 1
    return
  }

  // 安装接口要管理令牌：没有它只会拿到一句 403，而且要等到最后一步才发现
  const token = await readAdminToken()
  if (!token) {
    console.error(
      '[deploy] 没找到管理令牌。设置 MINI_CANVAS_ADMIN_TOKEN，或把数据目录里的 admin-token 指对：\n' +
        '         MINI_CANVAS_ADMIN_TOKEN=<64 位 hex> node scripts/deploy-server.mjs\n' +
        '         MINI_CANVAS_DATA_DIR=<数据目录> node scripts/deploy-server.mjs',
    )
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
  if (out.hotError) {
    console.log('[deploy] 热装没成功（常见原因：同名插件已在跑）→ 重启后台后生效：')
    console.log('         pnpm -C packages/cloud-server serve')
  }
}

await main()

