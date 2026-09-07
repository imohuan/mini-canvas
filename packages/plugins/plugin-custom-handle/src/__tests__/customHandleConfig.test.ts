import { describe, expect, it } from 'vitest'
import { CUSTOM_HANDLE_DEFAULTS, customHandleConfig } from '../customHandlePlugin'

describe('customHandleConfig', () => {
  it('无 override 返回与默认一致的独立拷贝', () => {
    const cfg = customHandleConfig()
    expect(cfg).toEqual(CUSTOM_HANDLE_DEFAULTS)
    expect(cfg).not.toBe(CUSTOM_HANDLE_DEFAULTS)
  })

  it('部分 override 覆盖对应项、其余保留默认', () => {
    const cfg = customHandleConfig({ handleButtonSize: 40, portZoneWidth: 120 })
    expect(cfg.handleButtonSize).toBe(40)
    expect(cfg.portZoneWidth).toBe(120)
    expect(cfg.handleRestOffset).toBe(36)
    expect(cfg.portZoneShape).toBe('arc')
  })

  it('undefined override 忽略', () => {
    const cfg = customHandleConfig({ handleRestOffset: undefined })
    expect(cfg.handleRestOffset).toBe(36)
  })
})
