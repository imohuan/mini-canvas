/**
 * provider 配置存储单测 —— 按**文件名**做 key 的启停 / 删除 / 账号存取。
 *
 * 锁四条：
 * 1. disabledFiles 里的文件装载时被跳过（启停的真实现）；
 * 2. deletedFiles 里的默认文件 seed 时不再铺回（不然「删了重启又回来」）；
 * 3. 账号值被注入成 __mcProviderConfig，provider 里读得到（多账号形状）；
 * 4. v1 旧结构（顶层 values）兼容读。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readProviderConfig,
  writeProviderConfig,
  injectTextFor,
  isSafeFileName,
} from '../providers/configStore'
import { loadProvidersFromDir, seedDefaultProviders } from '../providers/load'

let dir: string
let configFile: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'provcfg-'))
  configFile = path.join(dir, 'providers-config.json')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const GOOD = `
export const id = 'cfgp'
export const config = [{ key: 'apiKey', label: '密钥', type: 'secret' }]
export const actions = [{ id: 'cfgp:a', title: 'A' }]
export async function submit() { return { done: true } }
export function readCfg() { return typeof __mcProviderConfig === 'undefined' ? null : __mcProviderConfig }
`

describe('configStore 存取', () => {
  it('写读往返：disabled / deleted / files 三张表都保得住', async () => {
    const data = {
      version: 2 as const,
      disabledFiles: ['a.js'],
      deletedFiles: ['b.js'],
      files: { 'a.js': { accounts: [{ id: 'main', values: { apiKey: 'sk-1' } }] } },
    }
    await writeProviderConfig(configFile, data)
    const read = await readProviderConfig(configFile)
    expect(read.disabledFiles).toEqual(['a.js'])
    expect(read.deletedFiles).toEqual(['b.js'])
    expect(read.files['a.js']?.accounts[0]?.values.apiKey).toBe('sk-1')
  })

  it('v1 旧结构（顶层 values）→ 读成一个 main 账号', async () => {
    await fs.writeFile(configFile, JSON.stringify({ values: { baseUrl: 'http://x' } }))
    const read = await readProviderConfig(configFile)
    expect(read.files['*']?.accounts).toEqual([{ id: 'main', values: { baseUrl: 'http://x' } }])
  })

  it('文件名白名单：目录穿越 / 隐藏名被拒', () => {
    expect(isSafeFileName('web2api-image.js')).toBe(true)
    expect(isSafeFileName('my-provider_v2.js')).toBe(true)
    expect(isSafeFileName('../evil.js')).toBe(false)
    expect(isSafeFileName('a\\b.js')).toBe(false)
    expect(isSafeFileName('.hidden.js')).toBe(false)
    expect(isSafeFileName('_off.js')).toBe(false)
  })
})

describe('装载与注入', () => {
  it('disabledFiles 里的文件装载时跳过（文件还在目录里）', async () => {
    await fs.writeFile(path.join(dir, 'p.js'), GOOD)
    await writeProviderConfig(configFile, {
      version: 2,
      disabledFiles: ['p.js'],
      deletedFiles: [],
      files: {},
    })
    const cfg = await readProviderConfig(configFile)
    const r = await loadProvidersFromDir(dir, { config: cfg })
    expect(r.providers).toEqual([])
    expect(r.files).toEqual([])
  })

  it('账号值注入成 __mcProviderConfig：单账号 / 多账号都能读对', async () => {
    await fs.writeFile(path.join(dir, 'p.js'), GOOD)
    await writeProviderConfig(configFile, {
      version: 2,
      disabledFiles: [],
      deletedFiles: [],
      files: {
        'p.js': {
          accounts: [
            { id: 'main', name: '默认', values: { apiKey: 'sk-main' } },
            { id: 'backup', values: { apiKey: 'sk-b' } },
          ],
        },
      },
    })
    const cfg = await readProviderConfig(configFile)
    const r = await loadProvidersFromDir(dir, { config: cfg })
    expect(r.providers).toHaveLength(1)
    // provider 源码里那个 readCfg() 返回注入的常量
    const p = r.providers[0] as unknown as { readCfg(): unknown }
    const injected = p.readCfg() as {
      accounts: Array<{ id: string; values: Record<string, string> }>
      values: Record<string, string>
      byId: Record<string, Record<string, string>>
    }
    expect(injected.accounts.map((a) => a.id)).toEqual(['main', 'backup'])
    expect(injected.values.apiKey).toBe('sk-main')
    expect(injected.byId.backup.apiKey).toBe('sk-b')
  })

  it('没配过的 provider 也注入空结构（?. 兜底读法统一）', async () => {
    await fs.writeFile(path.join(dir, 'q.js'), GOOD)
    const r = await loadProvidersFromDir(dir, { config: await readProviderConfig(configFile) })
    expect(r.providers).toHaveLength(1)
    const p = r.providers[0] as unknown as { readCfg(): { accounts: unknown[] } }
    expect(p.readCfg().accounts).toEqual([])
  })
})

describe('seed 跳过 deletedFiles', () => {
  it('用户删掉的默认文件重启不再铺回', async () => {
    const src = path.join(dir, 'src')
    const dst = path.join(dir, 'dst')
    await fs.mkdir(src, { recursive: true })
    await fs.writeFile(path.join(src, 'gone.js'), 'export default {}')
    await fs.writeFile(path.join(src, 'keep.js'), 'export default {}')
    // 第一轮：两个都铺进去
    let copied = await seedDefaultProviders(src, dst)
    expect(copied.sort()).toEqual(['gone.js', 'keep.js'])
    // 用户删掉 gone.js 并记入 deletedFiles
    await fs.rm(path.join(dst, 'gone.js'))
    // 第二轮：skip 集合里有 gone.js → 不再铺回
    copied = await seedDefaultProviders(src, dst, { skip: ['gone.js'] })
    expect(copied).toEqual([])
    const files = await fs.readdir(dst)
    expect(files).toEqual(['keep.js'])
  })
})

describe('注入文本形状', () => {
  it('injectTextFor 输出合法 JS 且带三段结构', () => {
    const t = injectTextFor({ accounts: [{ id: 'a', name: '主号', values: { k: 1 } }] })
    expect(t.startsWith('const __mcProviderConfig = ')).toBe(true)
    const parsed = JSON.parse(t.slice('const __mcProviderConfig = '.length).replace(/;\n$/, ''))
    expect(parsed.accounts[0]).toEqual({ id: 'a', name: '主号', values: { k: 1 } })
    expect(parsed.values).toEqual({ k: 1 })
    expect(parsed.byId.a).toEqual({ k: 1 })
  })
})
