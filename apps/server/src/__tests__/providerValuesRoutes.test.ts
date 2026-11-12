/**
 * 平台配置的「点分隔 key」端到端（用户口径 2026-11-10）。
 *
 * 覆盖四件事：
 * 1. 保存 shared + accountFields + accounts → 落盘成 `pid.field` / `pid.field.[n]`；
 * 2. 只有账号级字段才写下标；通用字段不重复；
 * 3. 默认账号随账号清单保存；
 * 4. 每次保存都会写 `config/providers-version`（前端靠它实时重拉，不再需要刷新按钮）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server.js'

let dir = ''
let srv: CloudServer

const P = `
export const id = 'v-test'
export const title = '测试平台'
export const description = '用于端到端测试'
export const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="red"/></svg>'
export const config = [
  { key: 'baseUrl', label: '地址', type: 'string' },
  { key: 'apiKey', label: '密钥', type: 'secret' },
]
export const actions = [{ id: 'v-test:a', title: 'A', nodeTypes: ['image'] }]
export async function submit() { return { done: true } }
export function readCfg() { return typeof __mcProviderConfig === 'undefined' ? null : __mcProviderConfig }
`

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'provvalues-'))
  await fs.mkdir(path.join(dir, 'providers'), { recursive: true })
  await fs.writeFile(path.join(dir, 'providers', 'v-test.js'), P)
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

const readFile = async (): Promise<any> =>
  JSON.parse(await fs.readFile(path.join(dir, 'providers-config.json'), 'utf8'))

describe('平台配置（点分隔 key）', () => {
  it('保存后落盘成 pid.field / pid.field.[n]，通用字段只写一份', async () => {
    const r = await call('PUT', '/api/providers/v-test.js/values', {
      platformId: 'v-test',
      shared: { baseUrl: 'https://shared' },
      accountFields: ['apiKey'],
      accounts: [
        { id: 'main', name: '主号', default: true, values: { apiKey: 'sk-main' } },
        { id: 'second', name: '备用', values: { apiKey: 'sk-second' } },
        { id: 'third', name: '第三', values: { apiKey: '' } },
      ],
    })
    expect(r.status).toBe(200)

    const saved = await readFile()
    expect(saved.config['v-test.baseUrl']).toBe('https://shared')
    expect(saved.config['v-test.apiKey.[0]']).toBe('sk-main')
    expect(saved.config['v-test.apiKey.[1]']).toBe('sk-second')
    // 留空的账号不写下标（读的时候回落通用值）
    expect(saved.config['v-test.apiKey.[2]']).toBeUndefined()
    // 通用字段不重复成每账号一份
    expect(saved.config['v-test.baseUrl.[0]']).toBeUndefined()

    expect(saved.platforms['v-test'].accounts.map((a: any) => a.id)).toEqual(['main', 'second', 'third'])
    expect(saved.platforms['v-test'].accounts[0].default).toBe(true)
  })

  it('GET /api/providers 带上名字/介绍/图标、账号级字段与通用值', async () => {
    await call('PUT', '/api/providers/v-test.js/values', {
      platformId: 'v-test',
      shared: { baseUrl: 'https://shared' },
      accountFields: ['apiKey'],
      accounts: [
        { id: 'main', name: '主号', default: true, values: { apiKey: 'sk-main-1234567890' } },
        { id: 'second', name: '备用', values: { apiKey: 'sk-second' } },
      ],
    })
    const res = await call('GET', '/api/providers')
    const row = res.json.providers.find((x: any) => x.id === 'v-test')
    expect(row.title).toBe('测试平台')
    expect(row.description).toBe('用于端到端测试')
    expect(row.icon).toContain('<svg')
    expect(row.accountFields).toEqual(['apiKey'])
    expect(row.shared.baseUrl).toBe('https://shared')
    expect(row.accounts).toHaveLength(2)
    expect(row.accounts[0].default).toBe(true)
    // secret 仍然只下发掩码
    expect(row.accounts[0].values.apiKey).toContain('…')
  })

  it('动作清单带上平台图标；多账号时带可选账号列表', async () => {
    await call('PUT', '/api/providers/v-test.js/values', {
      platformId: 'v-test',
      shared: { baseUrl: 'x' },
      accountFields: [],
      accounts: [
        { id: 'main', name: '主号', default: true, values: {} },
        { id: 'second', name: '备用', values: {} },
      ],
    })
    const res = await call('GET', '/api/actions')
    const action = res.json.actions.find((a: any) => a.id === 'v-test:a')
    expect(action.providerIcon).toContain('<svg')
    expect(action.accounts.map((a: any) => a.id)).toEqual(['main', 'second'])
    expect(action.defaultAccount).toBe('main')
  })

  it('保存默认模型：按生成类型存，并且是全局的那一份', async () => {
    const r = await call('PUT', '/api/providers/model-defaults', { defaults: { 图片: 'v-test:a', 视频: '' } })
    expect(r.status).toBe(200)
    const saved = await readFile()
    // 空串不落盘（没选就是没选，不写一个空字符串占位）
    expect(saved.defaults).toEqual({ 图片: 'v-test:a' })
    const list = await call('GET', '/api/providers')
    expect(list.json.defaults).toEqual({ 图片: 'v-test:a' })
  })

  it('启停 / 保存配置都会写 providers-version（前端实时重拉）', async () => {
    const before = await call('GET', '/api/kv/config/providers-version')
    // 第一次可能还没写过（404 也是合法起点）
    expect([200, 404]).toContain(before.status)

    await call('POST', '/api/providers/v-test.js/disable')
    const afterDisable = await call('GET', '/api/kv/config/providers-version')
    expect(afterDisable.status).toBe(200)
    expect(typeof afterDisable.json.value).toBe('number')

    await call('POST', '/api/providers/v-test.js/enable')
    const afterEnable = await call('GET', '/api/kv/config/providers-version')
    expect(afterEnable.json.value).toBeGreaterThanOrEqual(afterDisable.json.value)
  })

  /**
   * 掩码回传必须还原（用户 2026-11-10 实测：任务直接失败且没有原因）。
   *
   * 界面把 `shared` 里的 secret 显示成 `sk-Z…RQFG`，用户点保存时原样回传。
   * 之前只给账号级字段做了 sameMask 还原，通用值把真 key 覆盖成了带省略号的掩码；
   * 带 `…` 的字符串进不了 HTTP 头，请求当场抛异常 —— 卡片上只剩「任务失败」。
   */
  it('平台通用值里的 secret 掩码回传时还原真值，不会把 key 写成掩码', async () => {
    await call('PUT', '/api/providers/v-test.js/values', {
      platformId: 'v-test',
      shared: { baseUrl: 'https://shared', apiKey: 'sk-real-shared-1234567890' },
      accountFields: [],
      accounts: [{ id: 'main', name: '主号', values: {} }],
    })
    // 模拟界面：先读到掩码，再原样回传
    const first = await call('GET', '/api/providers')
    const masked = first.json.providers.find((x: any) => x.id === 'v-test').shared.apiKey as string
    expect(masked).toContain('…')

    await call('PUT', '/api/providers/v-test.js/values', {
      platformId: 'v-test',
      shared: { baseUrl: 'https://shared', apiKey: masked },
      accountFields: [],
      accounts: [{ id: 'main', name: '主号', values: {} }],
    })

    const saved = await readFile()
    expect(saved.config['v-test.apiKey']).toBe('sk-real-shared-1234567890')
    expect(saved.config['v-test.apiKey']).not.toContain('…')
  })
})
