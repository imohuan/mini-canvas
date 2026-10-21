/**
 * 托管页的令牌注入。
 *
 * 为什么要有这个能力：后台给写入口加了管理令牌，而令牌原本要用户自己去
 * 「设置 → 插件」粘贴一次。同机打开画布的人本来就能从启动日志看到那串，
 * 让他再抄一遍纯属多余；忘了抄的表现是「所有写操作 403」，界面上只写着执行失败。
 *
 * 边界：**只在本机回环访问时注入**。远程（局域网 / 反代）访问一概不注，
 * 否则等于把管理令牌发给任何能打开这个页面的人。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uiRoutes } from '../static.js'

let dir = ''

async function bootIndex(html = '<!doctype html><html><head><title>t</title></head><body></body></html>') {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-routes-'))
  await fs.writeFile(path.join(dir, 'index.html'), html, 'utf8')
  return dir
}

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
  dir = ''
})

const TOKEN = 'a'.repeat(64)

async function fetchIndex(dist: string, host: string, token?: string) {
  const app = uiRoutes(dist, () => token)
  const res = await app.request('http://' + host + '/', { headers: { host } })
  return { status: res.status, text: await res.text() }
}

describe('托管页：管理令牌注入（判定逻辑）', () => {
  /**
   * 本文件用的是 `app.request(...)`（没有真实 TCP 连接），拿不到对端地址。
   * 按「拿不到对端地址 → 当作不是本机」的保守策略，这里**不注入** ——
   * 这是有意为之：宁可让用户手填一次令牌，也不要把令牌发给身份不明的一方。
   *
   * 真正的「本机注入」由 `uiTokenRealConn.test.ts` 用真 socket 覆盖。
   */
  it('★ 没有真实对端地址（裸 request）→ 不注入', async () => {
    const dist = await bootIndex()
    const r = await fetchIndex(dist, '127.0.0.1:8865', TOKEN)
    expect(r.status).toBe(200)
    expect(r.text).not.toContain('__MC_ADMIN_TOKEN__')
    expect(r.text).not.toContain(TOKEN)
    // 页面本身照常返回，并且仍带宿主标记（cloud-client 靠它开机直接启动）
    expect(r.text).toContain('name="mini-canvas-host"')
  })

  it('★ 远程 Host → 不注入（令牌不能发给能打开这个页面的任何人）', async () => {
    const dist = await bootIndex()
    for (const host of ['192.168.1.9:8865', 'evil.example:8865']) {
      const r = await fetchIndex(dist, host, TOKEN)
      expect(r.status).toBe(200)
      expect(r.text, host).not.toContain('__MC_ADMIN_TOKEN__')
      expect(r.text, host).not.toContain(TOKEN)
      // 页面本身仍然要正常打开
      expect(r.text, host).toContain('mini-canvas-host')
    }
  })

  it('没给令牌（鉴权关闭）时也不注入', async () => {
    const dist = await bootIndex()
    const r = await fetchIndex(dist, '127.0.0.1:8865', undefined)
    expect(r.status).toBe(200)
    expect(r.text).not.toContain('__MC_ADMIN_TOKEN__')
  })

  /**
   * ★ noTokenInjection 开关：反代被配成透传 Host / 删转发头时，三个判定会被骗过，
   * 部署者声明后要一刀切不注入。
   */
  it('★ noTokenInjection=true 时本机也不注入（一刀切）', async () => {
    const dist = await bootIndex()
    const app = uiRoutes(dist, () => TOKEN, true)
    const res = await app.request('http://127.0.0.1:8865/', { headers: { host: '127.0.0.1:8865' } })
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain(TOKEN)
  })

  it('幂等：index.html 里已经有这个变量时不再插第二次', async () => {
    const dist = await bootIndex(
      '<!doctype html><html><head><script>window.__MC_ADMIN_TOKEN__="x"</script></head><body></body></html>',
    )
    const r = await fetchIndex(dist, '127.0.0.1:8865', TOKEN)
    const hits = r.text.split('__MC_ADMIN_TOKEN__').length - 1
    expect(hits).toBeGreaterThan(0)
    // 只出现一次（第二次没被插进去）
    expect(r.text).not.toContain(TOKEN)
  })
})

