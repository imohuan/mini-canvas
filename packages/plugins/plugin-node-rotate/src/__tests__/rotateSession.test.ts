import { describe, expect, it } from 'vitest'
import {
  bumpRotateAngle,
  closeRotateMode,
  isRotateModeActive,
  openRotateMode,
  rotateAngle,
  rotateMode,
} from '../rotateSession'

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

  it('展示角度：进入归 0，右转 +90，满 360 归零，退出也归零', () => {
    closeRotateMode()
    expect(rotateAngle.value).toBe(0)
    openRotateMode('n1')
    expect(rotateAngle.value).toBe(0)
    bumpRotateAngle()
    expect(rotateAngle.value).toBe(90)
    bumpRotateAngle()
    expect(rotateAngle.value).toBe(180)
    bumpRotateAngle()
    bumpRotateAngle()
    expect(rotateAngle.value).toBe(0)
    closeRotateMode()
    expect(rotateAngle.value).toBe(0)
  })

  it('展示角度只在模式里累计：退出后调用不会留下脏数字', () => {
    closeRotateMode()
    bumpRotateAngle()
    expect(rotateAngle.value).toBe(0)
  })
})
