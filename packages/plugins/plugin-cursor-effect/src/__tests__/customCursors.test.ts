/**
 * customCursors 单测 —— 自定义光标的数据层（含内存兜底、帧率）。
 *
 * 为什么在 node 里测：这些内置浏览器里 `localStorage` 常常不可用（`ls()` 返回 null），
 * 正是"内存兜底"这条路径 —— 上传→选中→显示整条链在那种环境下也必须通。
 */
import { describe, it, expect } from 'vitest'
import {
  loadCustomCursors, saveCustomCursors, addCustomCursor, removeCustomCursor, updateCustomCursor,
  newCustomId, CUSTOM_CHANGED_EVENT,
} from '../customCursors'

describe('customCursors：内存兜底', () => {
  it('localStorage 不可用时也能新增并读回（内存兜底）', () => {
    const start = loadCustomCursors().length
    const { item, list } = addCustomCursor(loadCustomCursors(), { name: 'a', frames: ['data:x'], fps: 12, hx: .5, hy: .5 })
    expect(item.id).toBeTruthy()
    expect(list).toHaveLength(start + 1)
    expect(loadCustomCursors().some((c) => c.id === item.id)).toBe(true)
    // 清理，避免影响其它用例
    removeCustomCursor(loadCustomCursors(), item.id)
  })

  it('save 带回 warning（说明刷新会丢）而不是报错', () => {
    const res = saveCustomCursors(loadCustomCursors())
    expect(res.ok).toBe(true)
    expect(typeof res.warning === 'string' || res.warning === undefined).toBe(true)
  })
})

describe('updateCustomCursor：改帧率', () => {
  it('改某条的 fps，其它条目不动', () => {
    const a = newCustomId()
    const b = newCustomId()
    saveCustomCursors([
      { id: a, name: 'a', frames: ['f1', 'f2', 'f3'], fps: 12, hx: .5, hy: .5 },
      { id: b, name: 'b', frames: ['g1'], fps: 8, hx: .5, hy: .5 },
    ])
    const next = updateCustomCursor(loadCustomCursors(), a, { fps: 3 })
    const ra = next.find((c) => c.id === a)
    const rb = next.find((c) => c.id === b)
    expect(ra?.fps).toBe(3)
    expect(ra?.frames).toEqual(['f1', 'f2', 'f3']) // 帧本身不动
    expect(rb?.fps).toBe(8) // 别的条不受影响
    // 读回来也是改后的值（已持久化/写入内存）
    expect(loadCustomCursors().find((c) => c.id === a)?.fps).toBe(3)
  })

  it('id 不可被 patch 覆盖', () => {
    const id = newCustomId()
    saveCustomCursors([{ id, name: 'x', frames: ['f'], fps: 12, hx: .5, hy: .5 }])
    const next = updateCustomCursor(loadCustomCursors(), id, { id: 'hacked', fps: 20 } as never)
    expect(next.find((c) => c.id === id)).toBeTruthy()
    expect(next.some((c) => c.id === 'hacked')).toBe(false)
  })
})

describe('removeCustomCursor', () => {
  it('删掉指定 id', () => {
    const id = newCustomId()
    saveCustomCursors([{ id, name: 'x', frames: ['f'], fps: 12, hx: .5, hy: .5 }])
    const next = removeCustomCursor(loadCustomCursors(), id)
    expect(next.some((c) => c.id === id)).toBe(false)
  })
})

describe('常量', () => {
  it('广播事件名稳定（设置页写、渲染层听，必须同一个）', () => {
    expect(CUSTOM_CHANGED_EVENT).toBe('mc-cursor-effect:custom-changed')
  })
})

