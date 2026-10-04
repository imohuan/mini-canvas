/**
 * 旧布局迁移 —— 换了磁盘布局，老文件不能让用户的设置凭空消失。
 *
 * 历史上 KV 一路演化出两种形态：
 *   1. {dir}/kv/{type}/{key}.json      —— 上一版（type 当目录）
 *   2. {dir}/kv/{type}%3A{key}.json    —— 最早那版（整串转义）
 * 现在统一折进 {dir}/settings.json。这里锁：老文件读得到、被折进新文件、旧目录改名备份。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KvStore, settingsFilePath } from '../store/kvStore'

let dir: string
let store: KvStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kv-legacy-'))
  store = new KvStore(dir)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const exists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

describe('旧布局迁移', () => {
  it('形态 2（config%3Asettings.json）读得到，并折进 settings.json', async () => {
    const kvDir = path.join(dir, 'kv')
    await fs.mkdir(kvDir, { recursive: true })
    await fs.writeFile(path.join(kvDir, 'config%3Asettings.json'), JSON.stringify({ theme: 'dark' }), 'utf8')

    // 老数据不丢
    expect(await store.get('config', 'settings')).toEqual({ theme: 'dark' })
    // 已折进新文件；旧文件不再原地存在
    const raw = JSON.parse(await fs.readFile(settingsFilePath(dir), 'utf8'))
    expect(raw.config.settings).toEqual({ theme: 'dark' })
    expect(await exists(path.join(kvDir, 'config%3Asettings.json'))).toBe(false)
  })

  it('形态 1（kv/config/settings.json）也读得到', async () => {
    const kvDir = path.join(dir, 'kv')
    await fs.mkdir(path.join(kvDir, 'config'), { recursive: true })
    await fs.writeFile(path.join(kvDir, 'config', 'settings.json'), JSON.stringify({ v: 'dir' }), 'utf8')
    await fs.writeFile(path.join(kvDir, 'config', 'plugin-manager%3Ainstalled.json'), JSON.stringify(['a']), 'utf8')

    expect(await store.get('config', 'settings')).toEqual({ v: 'dir' })
    expect(await store.get('config', 'plugin-manager:installed')).toEqual(['a'])
    const raw = JSON.parse(await fs.readFile(settingsFilePath(dir), 'utf8'))
    expect(raw.config['plugin-manager:installed']).toEqual(['a'])
  })

  it('只搬 config / shortcut；早已各有目录的 canvas / resource 不搬回来', async () => {
    const kvDir = path.join(dir, 'kv')
    await fs.mkdir(path.join(kvDir, 'canvas'), { recursive: true })
    await fs.writeFile(path.join(kvDir, 'canvas', 'graph.json'), JSON.stringify([{ id: '1' }]), 'utf8')
    await fs.writeFile(path.join(kvDir, 'shortcut%3Amap.json'), JSON.stringify({ save: 'Ctrl+S' }), 'utf8')

    // shortcut 搬了
    expect(await store.get('shortcut', 'map')).toEqual({ save: 'Ctrl+S' })
    const raw = JSON.parse(await fs.readFile(settingsFilePath(dir), 'utf8'))
    expect(raw.shortcut).toBeDefined()
    // canvas 没被塞回配置里
    expect(raw.canvas).toBeUndefined()
  })

  it('settings.json 已存在时不看旧文件（新的是正身）', async () => {
    await fs.writeFile(settingsFilePath(dir), JSON.stringify({ config: { v: 'new' } }), 'utf8')
    const kvDir = path.join(dir, 'kv')
    await fs.mkdir(kvDir, { recursive: true })
    await fs.writeFile(path.join(kvDir, 'config%3Av.json'), JSON.stringify('old'), 'utf8')
    expect(await store.get('config', 'v')).toBe('new')
  })

  it('全新安装（没有旧目录）→ undefined，不抛', async () => {
    expect(await store.get('config', 'nope')).toBeUndefined()
  })
})

