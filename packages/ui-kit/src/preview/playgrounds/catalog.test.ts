import { describe, expect, it } from 'vitest'
import { CATALOG } from '../catalog'
import { PLAYGROUND_CATALOG, PLAYGROUND_IDS, findPlayground } from './catalog'

describe('试玩配置 catalog', () => {
  it('每个组件目录项都有试玩配置', () => {
    const ids = CATALOG.flatMap((group) => group.items.map((item) => item.id))
    const missing = ids.filter((id) => !PLAYGROUND_CATALOG[id])
    expect(missing).toEqual([])
    expect(ids.length).toBe(PLAYGROUND_IDS.length)
  })

  it('每条配置的 id 与注册表 key 一致', () => {
    for (const [key, config] of Object.entries(PLAYGROUND_CATALOG)) {
      expect(config.id).toBe(key)
    }
  })

  it('每条配置至少有一个可调控件，且默认值覆盖所有控件', () => {
    for (const [key, config] of Object.entries(PLAYGROUND_CATALOG)) {
      expect(config.fields.length, key + ' 没有可调控件').toBeGreaterThan(0)
      for (const field of config.fields) {
        expect(Object.prototype.hasOwnProperty.call(config.defaults, field.key), key + ' 缺少默认值：' + field.key).toBe(true)
      }
    }
  })

  it('每个预设都只写自己配置里有的键', () => {
    for (const [key, config] of Object.entries(PLAYGROUND_CATALOG)) {
      for (const preset of config.presets ?? []) {
        for (const patchKey of Object.keys(preset.patch)) {
          expect(Object.prototype.hasOwnProperty.call(config.defaults, patchKey), key + '/' + preset.id + ' 预设写了未知键：' + patchKey).toBe(true)
        }
      }
    }
  })

  it('summary 对默认值能给出非空文案', () => {
    for (const [key, config] of Object.entries(PLAYGROUND_CATALOG)) {
      if (!config.summary) continue
      expect(config.summary(config.defaults), key + ' 的 summary 为空').toBeTruthy()
    }
  })

  it('findPlayground 能取到单个配置', () => {
    expect(findPlayground('button')?.id).toBe('button')
    expect(findPlayground('not-exist')).toBeUndefined()
  })
})
