/**
 * kvStore 单测 —— 纯逻辑（真实 fs，临时目录）。
 *
 * 布局：全部小数据装在一个 `{dir}/settings.json` 里，按 type 分桶。
 * 锁两件事：① `get` 未命中 = undefined（调用方靠它判"从未保存过"）；
 * ② 并发写不丢改动（全部落同一个文件，读-改-写必须整体串行）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KvStore, settingsFilePath, isKvType } from '../store/kvStore'

let dir: string
let store: KvStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kvstore-'))
  store = new KvStore(dir)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('KvStore 基本读写', () => {
  it('未保存过 → get 返回 undefined（不是 null）', async () => {
    expect(await store.get('config', 'theme')).toBeUndefined()
  })

  it('set 后 get 读回同一份值；磁盘上确实有 settings.json', async () => {
    await store.set('config', 'theme', { mode: 'dark' })
    expect(await store.get('config', 'theme')).toEqual({ mode: 'dark' })
    // 布局：所有小数据都在一个文件里，按 type 分桶
    const raw = JSON.parse(await fs.readFile(settingsFilePath(dir), 'utf8'))
    expect(raw).toEqual({ config: { theme: { mode: 'dark' } } })
  })

  it('保存空数组 → 读回 []（必须与"未保存过"区分开）', async () => {
    await store.set('config', 'list', [])
    const got = await store.get('config', 'list')
    expect(got).toEqual([])
    expect(got).not.toBeUndefined()
  })

  it('remove 后回到 undefined，重复 remove 返回 false', async () => {
    await store.set('config', 'list', [1])
    expect(await store.remove('config', 'list')).toBe(true)
    expect(await store.get('config', 'list')).toBeUndefined()
    expect(await store.remove('config', 'list')).toBe(false)
  })

  it('特殊字符 key 可安全落盘并读回', async () => {
    await store.set('config', 'theme/accent', '#fff')
    expect(await store.get('config', 'theme/accent')).toBe('#fff')
  })
})

describe('KvStore 作用域隔离与列举', () => {
  it('不同 type 互不干扰', async () => {
    await store.set('config', 'k', 1)
    await store.set('shortcut', 'k', 2)
    expect(await store.get('config', 'k')).toBe(1)
    expect(await store.get('shortcut', 'k')).toBe(2)
    // 两个 type 各占一个桶，都在同一个文件里
    const raw = JSON.parse(await fs.readFile(settingsFilePath(dir), 'utf8'))
    expect(Object.keys(raw).sort()).toEqual(['config', 'shortcut'])
  })

  it('keys 只列本作用域，且已排序', async () => {
    await store.set('config', 'b', 2)
    await store.set('config', 'a', 1)
    await store.set('shortcut', 'x', 9)
    expect(await store.keys('config')).toEqual(['a', 'b'])
    expect(await store.keys('shortcut')).toEqual(['x'])
    expect(await store.keys('config')).not.toContain('x')
  })

  it('删光一个作用域的 key → 空桶也一并清掉（文件不留空对象）', async () => {
    await store.set('config', 'only', 1)
    await store.remove('config', 'only')
    const raw = JSON.parse(await fs.readFile(settingsFilePath(dir), 'utf8'))
    expect(raw).toEqual({})
  })

  it('isKvType 只认四类作用域', () => {
    expect(isKvType('config')).toBe(true)
    expect(isKvType('canvas')).toBe(true)
    expect(isKvType('resource')).toBe(true)
    expect(isKvType('shortcut')).toBe(true)
    expect(isKvType('evil')).toBe(false)
    expect(isKvType('../etc')).toBe(false)
  })
})

describe('KvStore 健壮性', () => {
  it('接受 undefined 之外的任何可序列化值', async () => {
    await store.set('config', 's', 'text')
    await store.set('config', 'n', 42)
    await store.set('config', 'o', { a: [1, 2] })
    expect(await store.get('config', 's')).toBe('text')
    expect(await store.get('config', 'n')).toBe(42)
    expect(await store.get('config', 'o')).toEqual({ a: [1, 2] })
  })

  it('存 undefined → 明确报错（要删请用 remove）', async () => {
    await expect(store.set('config', 'bad', undefined)).rejects.toThrow(/undefined/)
  })

  it('文件内容坏掉（非法 JSON）→ get 降级为 undefined 并不抛', async () => {
    await fs.writeFile(settingsFilePath(dir), '{not json', 'utf8')
    expect(await store.get('config', 'x')).toBeUndefined()
  })
})

describe('KvStore 并发写：同一个文件不能互相盖', () => {
  /**
   * 这条锁的是一个真实风险：全部小数据落同一个文件，写是「读全量 → 改一项 → 写全量」。
   * 不串行的话两个并发写会各自读到同一份旧内容、各自写回 —— 后写的把先写的整段盖掉。
   */
  it('不同 key 并发写：一个都不能丢', { timeout: 30000 }, async () => {
    const rounds = 40
    for (let i = 0; i < rounds; i++) {
      await Promise.all([
        store.set('config', 'a', i),
        store.set('config', 'b', i),
        store.set('shortcut', 'c', i),
      ])
    }
    expect(await store.get('config', 'a')).toBe(rounds - 1)
    expect(await store.get('config', 'b')).toBe(rounds - 1)
    expect(await store.get('shortcut', 'c')).toBe(rounds - 1)
    // 文件仍是完整可解析的 JSON（不是半截）
    const raw = JSON.parse(await fs.readFile(settingsFilePath(dir), 'utf8'))
    expect(raw.config.a).toBe(rounds - 1)
  })

  // 超时给足：本用例是真实文件并发压力（160 次写），CPU 被别的进程抢时会超过默认 5s。
  // 这不是放宽断言（断言"一次都不能失败"原样保留），只是不让机器负载把它误判成失败。
  it('同一 key 上多轮并发写：一次都不能失败', { timeout: 30000 }, async () => {
    for (let i = 0; i < 40; i++) {
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, (_, j) => store.set('config', 'k', i * 10 + j)),
      )
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0)
    }
    expect(typeof (await store.get('config', 'k'))).toBe('number')
  })
})

describe('KvStore 变更订阅', () => {
  it('set / remove 各自触发，带 type + 裸 key；取消后不再触发', async () => {
    const seen: string[] = []
    const off = store.onChange((e) => seen.push(e.type + ':' + e.key))
    await store.set('config', 'theme', 1)
    await store.remove('config', 'theme')
    expect(seen).toEqual(['config:theme', 'config:theme'])
    off()
    await store.set('config', 'other', 2)
    expect(seen).toHaveLength(2)
  })
})
