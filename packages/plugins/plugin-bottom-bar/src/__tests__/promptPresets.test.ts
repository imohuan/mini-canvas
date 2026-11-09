/**
 * 预设提示词的数据逻辑（用户 2026-11-06）。
 *
 * 只测纯函数：坏存储不报错、空内容不入库、新建排最前、删除只删那一条、搜索命中名字和正文。
 * 面板长什么样由 Chrome 实测，这里不重复 UI 断言。
 */
import { describe, expect, it } from 'vitest'
import {
  addPreset,
  createPreset,
  createTypedPreset,
  filterPresets,
  loadPromptPresets,
  normalizePresets,
  presetBucketOf,
  presetEnabled,
  PROMPT_PRESETS_KEY,
  removePreset,
  savePromptPresets,
  type PromptPreset,
} from '../promptPresets'

function fakeStorage(seed?: string): Storage {
  let value = seed ?? null
  return {
    get length() { return value === null ? 0 : 1 },
    clear() { value = null },
    key: () => null,
    getItem: () => value,
    setItem: (_k: string, v: string) => { value = v },
    removeItem: () => { value = null },
  } as Storage
}

function preset(id: string, name: string, content: string): PromptPreset {
  return { id, name, content, createdAt: 1 }
}

describe('预设提示词：读盘', () => {
  it('没存过 → 空清单', () => {
    expect(loadPromptPresets(fakeStorage())).toEqual([])
  })

  it('坏 JSON / 坏形状 → 空清单，不抛错', () => {
    expect(loadPromptPresets(fakeStorage('{oops'))).toEqual([])
    expect(loadPromptPresets(fakeStorage('"字符串"'))).toEqual([])
    expect(loadPromptPresets(null)).toEqual([])
  })

  it('丢掉空内容、缺名字补正文前 12 字、重复 id 只留第一条', () => {
    const list = normalizePresets([
      { id: 'a', name: '  ', content: '一段很长的提示词正文' },
      { id: 'b', name: '空', content: '   ' },
      { id: 'a', name: '重复', content: '第二条' },
      { name: '没 id', content: '正文', createdAt: 3 },
    ])
    expect(list.map((p) => p.id)).toEqual(['a', 'preset-1'])
    expect(list[0].name).toBe('一段很长的提示词正文'.slice(0, 12))
    expect(list[1].name).toBe('没 id')
  })

  it('存读一轮后内容不变', () => {
    const storage = fakeStorage()
    const list = [preset('x', '小红书风格', '用轻松的口吻\\n写成三段')]
    expect(savePromptPresets(list, storage)).toBe(true)
    expect(storage.getItem(PROMPT_PRESETS_KEY)).toContain('小红书风格')
    expect(loadPromptPresets(storage)).toEqual(list)
  })

  it('带模型与参数的预设能存能读；脏参数被丢掉', () => {
    const list = normalizePresets([
      { id: 'a', name: 'A', content: '正文', actionId: ' demo:1 ', values: { ratio: '16:9', n: 2, bad: { x: 1 }, arr: [1] } },
      { id: 'b', name: 'B', content: '正文', values: '不是对象' },
    ])
    expect(list[0].actionId).toBe('demo:1')
    expect(list[0].values).toEqual({ ratio: '16:9', n: 2 })
    expect(list[1].values).toBeUndefined()
  })
})

describe('预设：分类与可用性', () => {
  /**
   * 应用方式（用户 2026-11-09）：默认追加；只有明确写 replace 才替换。
   * 旧数据没有这个字段 → 一律按追加，不改变既有行为。
   */
  it('applyMode：缺省/脏值按追加，replace 才替换', () => {
    const list = normalizePresets([
      { id: 'a', name: 'A', content: '正文' },
      { id: 'b', name: 'B', content: '正文', applyMode: 'replace' },
      { id: 'c', name: 'C', content: '正文', applyMode: 'nonsense' },
    ])
    expect(list[0].applyMode).toBeUndefined()
    expect(list[1].applyMode).toBe('replace')
    expect(list[2].applyMode).toBeUndefined()
  })

  it('createTypedPreset 带上 applyMode=replace', () => {
    const p = createTypedPreset({ content: '正文', applyMode: 'replace' })
    expect(p.applyMode).toBe('replace')
    expect(createTypedPreset({ content: '正文' }).applyMode).toBeUndefined()
  })

  it('provider / 通用 / 指定模型 三类', () => {
    expect(presetBucketOf({ id: 'a', name: 'a', content: 'x', createdAt: 0, source: 'provider' })).toBe('provider')
    expect(presetBucketOf({ id: 'b', name: 'b', content: 'x', createdAt: 0 })).toBe('general')
    expect(presetBucketOf({ id: 'c', name: 'c', content: 'x', createdAt: 0, actionId: 'm:1' })).toBe('model')
  })

  it('全局通用永远可用；指定模型看本节点有没有这个动作', () => {
    const available = new Set(['m:1'])
    expect(presetEnabled({ id: 'a', name: 'a', content: 'x', createdAt: 0 }, available)).toBe(true)
    expect(presetEnabled({ id: 'b', name: 'b', content: 'x', createdAt: 0, actionId: 'm:1' }, available)).toBe(true)
    expect(presetEnabled({ id: 'c', name: 'c', content: 'x', createdAt: 0, actionId: 'm:2' }, available)).toBe(false)
  })
})

describe('预设提示词：增删搜', () => {
  it('新建：名字留空时用正文开头，内容去首尾空白', () => {
    const p = createPreset('', '  写一段雪景描述  ', 1700000000000)
    expect(p.name).toBe('写一段雪景描述')
    expect(p.content).toBe('写一段雪景描述')
    expect(p.id).toContain('preset-')
  })

  it('新增排最前，同 id 覆盖', () => {
    const old = preset('a', 'A', 'aaa')
    const list = addPreset([old], preset('b', 'B', 'bbb'))
    expect(list.map((p) => p.id)).toEqual(['b', 'a'])
    expect(addPreset(list, { ...old, name: 'A2' }).map((p) => p.name)).toEqual(['A2', 'B'])
  })

  it('删除只删目标那条', () => {
    const list = [preset('a', 'A', 'aaa'), preset('b', 'B', 'bbb')]
    expect(removePreset(list, 'a').map((p) => p.id)).toEqual(['b'])
  })

  it('搜索命中名字或正文，忽略大小写与首尾空格', () => {
    const list = [preset('a', 'Snow', '冬季雪景'), preset('b', '人像', 'Soft light portrait')]
    expect(filterPresets(list, 'snow').map((p) => p.id)).toEqual(['a'])
    expect(filterPresets(list, '雪景').map((p) => p.id)).toEqual(['a'])
    expect(filterPresets(list, ' PORTRAIT ').map((p) => p.id)).toEqual(['b'])
    expect(filterPresets(list, '')).toHaveLength(2)
  })
})
