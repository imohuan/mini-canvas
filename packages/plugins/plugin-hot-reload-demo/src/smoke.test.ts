import { describe, expect, it } from 'vitest'
import { name, apply } from './index'

/** 最小冒烟：清单判定依赖的形状别被改坏（UMD 全局从产物扫，这里锁源码形状） */
describe('plugin-hot-reload-demo 冒烟', () => {
  it('插件名稳定（热重载按它卸旧装新）', () => {
    expect(name).toBe('hot-reload-demo')
  })
  it('apply 往 overlay 槽注册一张卡片', () => {
    const regs: Array<{ slot: string; req: { id: string } }> = []
    apply({
      slots: {
        register: (slot: string, req: { id: string }): string => {
          regs.push({ slot, req })
          return slot
        },
      },
    })
    expect(regs).toHaveLength(1)
    expect(regs[0]!.slot).toBe('overlay')
    expect(regs[0]!.req.id).toBe('hot-reload-demo/card')
  })
})
