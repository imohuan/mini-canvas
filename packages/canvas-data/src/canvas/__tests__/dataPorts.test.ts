import { describe, expect, it } from 'vitest'
import {
  DataPortError,
  assertDataPortDef,
  assertDataPorts,
  isResourceRefValue,
  readDataPort,
} from '../dataPorts'

describe('dataPorts · 三选一校验', () => {
  it('refField 合法', () => {
    expect(assertDataPortDef('image', { kind: 'image', refField: 'resourceId' })).toBeTruthy()
  })

  it('valueField 合法', () => {
    expect(assertDataPortDef('text', { kind: 'text', valueField: 'text' })).toBeTruthy()
  })

  it('externalUrlField 合法', () => {
    expect(assertDataPortDef('link', { kind: 'file', externalUrlField: 'externalUrl' })).toBeTruthy()
  })

  it('一个都没给 → 抛错', () => {
    expect(() => assertDataPortDef('image', { kind: 'image' })).toThrow(DataPortError)
  })

  it('给了两个 → 抛错', () => {
    expect(() => assertDataPortDef('image', { kind: 'image', refField: 'a', valueField: 'b' })).toThrow(
      DataPortError,
    )
  })

  it('缺 kind → 抛错', () => {
    expect(() => assertDataPortDef('x', { kind: '', refField: 'r' })).toThrow(DataPortError)
  })

  it('整表校验带槽名', () => {
    expect(() => assertDataPorts('produces', { image: { kind: 'image' } })).toThrow(/produces\.image/)
  })
})

describe('dataPorts · 投影', () => {
  it('按 refField/valueField/externalUrlField 读值', () => {
    expect(readDataPort({ data: { resourceId: 'res-1' } }, { kind: 'image', refField: 'resourceId' })).toBe('res-1')
    expect(readDataPort({ data: { text: 'hi' } }, { kind: 'text', valueField: 'text' })).toBe('hi')
    expect(
      readDataPort({ data: { externalUrl: 'https://x' } }, { kind: 'file', externalUrlField: 'externalUrl' }),
    ).toBe('https://x')
  })

  it('缺字段返回 undefined', () => {
    expect(readDataPort({ data: {} }, { kind: 'image', refField: 'resourceId' })).toBeUndefined()
  })
})

describe('dataPorts · 引用判定', () => {
  it('逻辑 ID 是引用，URL/blob/data 不是', () => {
    expect(isResourceRefValue('res-1')).toBe(true)
    expect(isResourceRefValue('hash-abc')).toBe(true)
    expect(isResourceRefValue('https://x/a.png')).toBe(false)
    expect(isResourceRefValue('blob:abc')).toBe(false)
    expect(isResourceRefValue('data:image/png;base64,xx')).toBe(false)
    expect(isResourceRefValue('')).toBe(false)
  })
})
