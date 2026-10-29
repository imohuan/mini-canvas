import { describe, expect, it } from 'vitest'
import { closeRotateMode, isRotateModeActive, openRotateMode, rotateMode } from '../rotateSession'

describe('rotateSession（旋转模式会话）', () => {
  it('进入 → 只有那个节点算活跃；退出 → 全部复位', () => {
    expect(rotateMode.value).toBeNull()
    openRotateMode('n1')
    expect(rotateMode.value).toBe('n1')
    expect(isRotateModeActive('n1')).toBe(true)
    expect(isRotateModeActive('n2')).toBe(false)
    closeRotateMode()
    expect(rotateMode.value).toBeNull()
    expect(isRotateModeActive('n1')).toBe(false)
  })

  it('重复进入同一节点 = 幂等（会话只存最后一次的 nodeId）', () => {
    openRotateMode('n1')
    openRotateMode('n1')
    expect(rotateMode.value).toBe('n1')
    // 切到另一个节点：会话跟着换（同一时刻只有一个节点在模式里，与 nodeToolbar 会话一致）
    openRotateMode('n2')
    expect(rotateMode.value).toBe('n2')
    expect(isRotateModeActive('n1')).toBe(false)
    closeRotateMode()
  })
})
