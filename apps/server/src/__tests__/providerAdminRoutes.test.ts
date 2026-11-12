/**
 * /api/providers 的端到端（用户实测踩到的三条）：
 *
 * 1. 保存一次账号配置，内置 agent-chat 不能从清单里消失
 *    （旧实现 reloadProviders 用 replaceAll 清空后没把内置 provider 补回来）；
 * 2. secret 下发掩码、原样回传时不能被当成新值写回（否则真实密钥被 "sk-Z…RQFG" 覆盖）；
 * 3. 删除 / 停用按文件名生效，agent-chat 这种没有文件的平台不给删。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server.js'

let dir = ''
let srv: CloudServer

const P = `
export const id = 'p-test'
export const config = [
  { key: 'baseUrl', label: '地址', type: 'string' },
  { key: 'apiKey', label: '密钥', type: 'secret' },
]
export const actions = [{ id: 'p-test:a', title: 'A' }]
export async function submit() { return { done: true } }
`

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'provadmin-'))
  // provider 文件住在 <数据根>/providers（不是数据根本身）
  await fs.mkdir(path.join(dir, 'providers'), { recursive: true })
  await fs.writeFile(path.join(dir, 'providers', 'p-test.js'), P)
  srv = await createCloudServer({ port: 0, dir, watchProviders: false })
})

afterEach(async () => {
  srv.stop()
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await srv.app.fetch(
    new Request('http://localhost' + url, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }),
  )
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any }
}

async function rows(): Promise<Array<{ id: string; file: string; enabled: boolean; accounts: any[] }>> {
  return (await call('GET', '/api/providers')).json.providers
}

describe('平台管理接口', () => {
  it('保存账号配置后，内置 agent-chat 仍在清单里', async () => {
    const before = await rows()
    expect(before.map((r) => r.id)).toContain('agent-chat')

    const saved = await call('PUT', '/api/providers/p-test.js/config', {
      accounts: [{ id: 'main', values: { baseUrl: 'http://x', apiKey: 'sk-real' } }],
    })
    expect(saved.status).toBe(200)

    const after = await rows()
    expect(after.map((r) => r.id)).toContain('agent-chat')
    expect(after.find((r) => r.id === 'agent-chat')?.enabled).toBe(true)
  })

  it('secret 掩码原样回传 = 不改；输入新值才覆盖', async () => {
    await call('PUT', '/api/providers/p-test.js/config', {
      accounts: [{ id: 'main', values: { baseUrl: 'http://x', apiKey: 'sk-1234567890' } }],
    })
    const mask = (await rows()).find((r) => r.id === 'p-test')!.accounts[0].values.apiKey as string
    expect(mask).toBe('sk-1…7890')

    // 回传掩码（用户只改了地址）
    await call('PUT', '/api/providers/p-test.js/config', {
      accounts: [{ id: 'main', values: { baseUrl: 'http://y', apiKey: mask } }],
    })
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'providers-config.json'), 'utf8'))
    expect(raw.files['p-test.js'].accounts[0].values.apiKey).toBe('sk-1234567890')
    expect(raw.files['p-test.js'].accounts[0].values.baseUrl).toBe('http://y')

    // 真输入新值
    await call('PUT', '/api/providers/p-test.js/config', {
      accounts: [{ id: 'main', values: { baseUrl: 'http://y', apiKey: 'sk-new-key-0001' } }],
    })
    const raw2 = JSON.parse(await fs.readFile(path.join(dir, 'providers-config.json'), 'utf8'))
    expect(raw2.files['p-test.js'].accounts[0].values.apiKey).toBe('sk-new-key-0001')
  })

  it('停用 / 删除按文件名生效；没有文件的平台删不掉', async () => {
    expect((await call('POST', '/api/providers/p-test.js/disable')).status).toBe(200)
    const off = await rows()
    expect(off.find((r) => r.id === 'p-test')?.enabled).toBe(false)
    expect(off.map((r) => r.id)).not.toContain('p-test:a')

    expect((await call('POST', '/api/providers/p-test.js/enable')).status).toBe(200)
    expect((await rows()).find((r) => r.id === 'p-test')?.enabled).toBe(true)

    expect((await call('DELETE', '/api/providers/p-test.js')).status).toBe(200)
    expect((await rows()).map((r) => r.id)).not.toContain('p-test')
    await expect(fs.access(path.join(dir, 'providers', 'p-test.js'))).rejects.toThrow()

    // 内置平台没有文件：删它必须是 4xx，不能 200 假装成功
    const del = await call('DELETE', '/api/providers/agent-chat.js')
    expect(del.status).toBeGreaterThanOrEqual(400)
  })
})
