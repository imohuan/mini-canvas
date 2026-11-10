/**
 * 点分隔 key 的配置模型（用户口径 2026-11-10）。
 *
 * 锁五条：
 * 1. `pid.field` 是平台通用值，所有账号都读到；
 * 2. `pid.field.[n]` 是第 n 个账号的值，覆盖通用值；
 * 3. 下标按顺序还原成数组，账号数与下标一致；
 * 4. 旧结构（files[文件名].accounts）仍然能读，新结构优先；
 * 5. 默认账号会随注入文本一起交给 provider。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  accountsForPlatform,
  fieldOfKey,
  platformOfKey,
  readProviderConfig,
  splitArrayKey,
  writeProviderConfig,
} from '../providers/configStore'
import { loadProvidersFromDir } from '../providers/load'

let dir = ''
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'provkeys-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) })

describe('key 拆解', () => {
  it('普通点分隔 key', () => {
    expect(splitArrayKey('token01.baseUrl')).toEqual({ base: 'token01.baseUrl' })
    expect(fieldOfKey('token01.baseUrl')).toBe('baseUrl')
    expect(platformOfKey('token01.baseUrl')).toBe('token01')
  })

  it('账号下标 key', () => {
    expect(splitArrayKey('token01.apiKey.[0]')).toEqual({ base: 'token01.apiKey', index: 0 })
    expect(splitArrayKey('token01.apiKey.[12]')).toEqual({ base: 'token01.apiKey', index: 12 })
    expect(fieldOfKey('token01.apiKey.[3]')).toBe('apiKey')
    expect(platformOfKey('token01.apiKey.[3]')).toBe('token01')
  })
})

describe('accountsForPlatform', () => {
  it('通用值所有账号都读到，账号级值只覆盖对应下标', () => {
    const config = {
      'token01.baseUrl': 'https://a',
      'token01.apiKey.[0]': 'sk-0',
      'token01.apiKey.[1]': 'sk-1',
    }
    const meta = { accounts: [{ id: 'main', name: '主号', default: true }, { id: 'backup', name: '备用' }] }
    const out = accountsForPlatform(config, meta, 'token01')
    expect(out.map((a) => a.id)).toEqual(['main', 'backup'])
    expect(out[0]!.values).toEqual({ baseUrl: 'https://a', apiKey: 'sk-0' })
    expect(out[1]!.values).toEqual({ baseUrl: 'https://a', apiKey: 'sk-1' })
    expect(out[0]!.default).toBe(true)
  })

  it('账号级项留空（下标缺省）时沿用通用值', () => {
    const out = accountsForPlatform({ 'p.baseUrl': 'x', 'p.apiKey.[1]': 'only-second' }, undefined, 'p')
    expect(out).toHaveLength(2)
    expect(out[0]!.values.apiKey).toBeUndefined()
    expect(out[1]!.values.apiKey).toBe('only-second')
  })

  it('别的平台的 key 不会串进来', () => {
    const out = accountsForPlatform({ 'a.baseUrl': 'A', 'b.baseUrl': 'B' }, { accounts: [{ id: 'main' }] }, 'a')
    expect(out[0]!.values.baseUrl).toBe('A')
  })

  it('手改 JSON 让下标超过账号数时，按下标补齐', () => {
    const out = accountsForPlatform({ 'p.k.[0]': 'a', 'p.k.[2]': 'c' }, { accounts: [{ id: 'main' }] }, 'p')
    expect(out).toHaveLength(3)
    expect(out[2]!.values.k).toBe('c')
  })
})

const P = `
export const id = 'kp'
export const config = [
  { key: 'baseUrl', label: '地址', type: 'string' },
  { key: 'apiKey', label: '密钥', type: 'secret' },
]
export const actions = [{ id: 'kp:a', title: 'A' }]
export async function submit() { return { done: true } }
export function readCfg() { return typeof __mcProviderConfig === 'undefined' ? null : __mcProviderConfig }
`

describe('装载时注入新结构', () => {
  it('点分隔 key 被还原成账号结构，交给 provider', async () => {
    await fs.mkdir(path.join(dir, 'providers'), { recursive: true })
    await fs.writeFile(path.join(dir, 'providers', 'kp.js'), P)
    const file = path.join(dir, 'providers-config.json')
    await writeProviderConfig(file, {
      version: 2,
      disabledFiles: [],
      deletedFiles: [],
      files: {},
      config: { 'kp.baseUrl': 'https://x', 'kp.apiKey.[0]': 'sk-a', 'kp.apiKey.[1]': 'sk-b' },
      platforms: { kp: { accounts: [{ id: 'main', name: '主号', default: true }, { id: 'second', name: '二号' }] } },
      defaults: { 图片: 'kp:a' },
    })
    const cfg = await readProviderConfig(file)
    expect(cfg.defaults).toEqual({ 图片: 'kp:a' })
    const r = await loadProvidersFromDir(path.join(dir, 'providers'), { config: cfg })
    expect(r.providers).toHaveLength(1)
    const injected = (r.providers[0] as unknown as { readCfg(): any }).readCfg()
    expect(injected.accounts.map((a: any) => a.id)).toEqual(['main', 'second'])
    expect(injected.values).toEqual({ baseUrl: 'https://x', apiKey: 'sk-a' })
    expect(injected.byId.second).toEqual({ baseUrl: 'https://x', apiKey: 'sk-b' })
    expect(injected.defaultId).toBe('main')
  })

  it('旧结构还能读：新结构缺这个平台时回落到 files', async () => {
    await fs.mkdir(path.join(dir, 'providers'), { recursive: true })
    await fs.writeFile(path.join(dir, 'providers', 'kp.js'), P)
    const file = path.join(dir, 'providers-config.json')
    await writeProviderConfig(file, {
      version: 2, disabledFiles: [], deletedFiles: [],
      files: { 'kp.js': { accounts: [{ id: 'main', values: { apiKey: 'legacy' } }] } },
    })
    const cfg = await readProviderConfig(file)
    const r = await loadProvidersFromDir(path.join(dir, 'providers'), { config: cfg })
    const injected = (r.providers[0] as unknown as { readCfg(): any }).readCfg()
    expect(injected.byId.main.apiKey).toBe('legacy')
  })
})
