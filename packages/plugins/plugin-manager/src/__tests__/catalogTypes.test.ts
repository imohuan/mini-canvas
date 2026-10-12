import { describe, it, expect } from 'vitest'
import { defaultInstalledIds, normalizeCatalog, resolveDesiredIds } from '../catalogTypes'

describe('normalizeCatalog —— 把来源不明的 JSON 归一成干净清单', () => {
  it('剔掉没有 id/url 的条目，保留合格项', () => {
    const out = normalizeCatalog({
      plugins: [
        { id: 'a', name: 'a', url: '/plugins/a/a.js' },
        { name: 'no-id', url: '/x.js' },
        { id: 'no-url' },
        null,
        'garbage',
      ],
    })
    expect(out.map((e) => e.id)).toEqual(['a'])
  })

  it('id 重复只留第一条；name 缺省回落到 id', () => {
    const out = normalizeCatalog({
      plugins: [
        { id: 'a', url: '/1.js' },
        { id: 'a', url: '/2.js' },
      ],
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('a')
  })

  it('非数组 / 空 → 空清单（不抛）', () => {
    expect(normalizeCatalog(null)).toEqual([])
    expect(normalizeCatalog({})).toEqual([])
    expect(normalizeCatalog({ plugins: 'nope' })).toEqual([])
  })
})

describe('resolveDesiredIds —— 「这次该装哪些」', () => {
  const entries = [
    { id: 'a', name: 'a', url: '/a.js' },
    { id: 'b', name: 'b', url: '/b.js', defaultInstalled: false },
    { id: 'c', name: 'c', url: '/c.js' },
  ]

  it('首次（没有存档）→ 一个都不自动装（用户要求：全部由用户在面板里自己挑）', () => {
    // 默认策略是**显式 opt-in**：只有作者写了 defaultInstalled: true 才自动装。
    // 这三条都没写 → 首次为空。旧的"没写就装"会让用户在自己没点过的情况下被装上插件。
    expect(defaultInstalledIds(entries)).toEqual([])
    expect(resolveDesiredIds(entries, undefined)).toEqual([])
  })

  it('显式声明 defaultInstalled: true 的才进"首次默认装"（opt-in）', () => {
    const optIn = [
      { id: 'a', name: 'a', url: '/a.js', defaultInstalled: true },
      { id: 'b', name: 'b', url: '/b.js' },
      { id: 'c', name: 'c', url: '/c.js', defaultInstalled: false },
    ]
    expect(defaultInstalledIds(optIn)).toEqual(['a'])
    expect(resolveDesiredIds(optIn, undefined)).toEqual(['a'])
  })

  it('有存档 → 用存档（用户卸过的不自动装回来）', () => {
    expect(resolveDesiredIds(entries, ['a'])).toEqual(['a'])
    expect(resolveDesiredIds(entries, [])).toEqual([])
  })

  it('存档里已不在清单的 id 被过滤（后台撤了某插件）', () => {
    expect(resolveDesiredIds(entries, ['a', 'gone'])).toEqual(['a'])
  })

  it('自带插件（builtin）不进"待装"集合 —— 插件管理不碰它们', () => {
    const withBuiltin = [
      { id: 'a', name: 'a', url: '/a.js', defaultInstalled: true },
      { id: 'b', name: 'b', url: '/b.js', builtin: true, defaultInstalled: true },
      { id: 'c', name: 'c', url: '/c.js', defaultInstalled: true },
    ]
    // builtin 即使声明了 defaultInstalled 也不进（它由应用冷启动装配，插件管理不碰）
    expect(defaultInstalledIds(withBuiltin)).toEqual(['a', 'c'])
    expect(resolveDesiredIds(withBuiltin, undefined)).toEqual(['a', 'c'])
    // 存档里即便写了 builtin 的 id，也不认（它不可装卸）
    expect(resolveDesiredIds(withBuiltin, ['b'])).toEqual([])
  })

  it('normalizeCatalog 保留 builtin 标记', () => {
    const out = normalizeCatalog({ plugins: [{ id: 'x', url: '/x.js', builtin: true }] })
    expect(out[0]?.builtin).toBe(true)
    const out2 = normalizeCatalog({ plugins: [{ id: 'y', url: '/y.js' }] })
    expect(out2[0]?.builtin).toBeUndefined()
  })
})

describe('前后端成对（Task 7）：清单项带 server 时归一保留', () => {
  it('server.url 保留，permissions 过滤非字符串', () => {
    const out = normalizeCatalog({
      plugins: [
        {
          id: 'pair',
          url: '/plugins/pair/t.js',
          server: { url: '/plugins/pair/server.js', permissions: ['net', 123, 'store'] },
        },
      ],
    })
    expect(out[0]?.server?.url).toBe('/plugins/pair/server.js')
    expect(out[0]?.server?.permissions).toEqual(['net', 'store'])
  })

  it('server 缺 url / 不是对象 → 该字段被丢掉（其余照常保留）', () => {
    const out = normalizeCatalog({
      plugins: [
        { id: 'a', url: '/a.js', server: { permissions: ['net'] } },
        { id: 'b', url: '/b.js', server: 'nope' },
        { id: 'c', url: '/c.js' },
      ],
    })
    expect(out.map((e) => e.server)).toEqual([undefined, undefined, undefined])
    expect(out).toHaveLength(3)
  })
})
