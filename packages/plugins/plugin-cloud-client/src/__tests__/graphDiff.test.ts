import { describe, it, expect } from 'vitest'
import { diffGraph } from '../graphDiff'

/**
 * 本地删除 data 键必须显式传达（dataUnset）—— 服务端浅合并删不掉键，
 * 缺这个表达时「恢复整幅画面」这类清字段操作落盘后字段还在（2026-10-29 视频裁剪实测）。
 */
describe('diffGraph: data 键删除的表达', () => {
  it('本地删掉的 data 键进 dataUnset', () => {
    const base = [{ id: '2', type: 'video', position: { x: 0, y: 0 }, data: { label: 'v', cropRect: { x: 1, y: 2, width: 3, height: 4 } } }]
    const mine = [{ id: '2', type: 'video', position: { x: 0, y: 0 }, data: { label: 'v' } }]
    const ops = diffGraph(base, mine)
    expect(ops.update).toHaveLength(1)
    const entry = ops.update[0] as { dataUnset?: string[] }
    expect(entry.dataUnset).toEqual(['cropRect'])
  })

  it('新增的键与改值不产生 dataUnset；键没变也不产生', () => {
    const base = [{ id: '2', type: 'video', position: { x: 0, y: 0 }, data: { label: 'v', a: 1 } }]
    const mine = [{ id: '2', type: 'video', position: { x: 1, y: 0 }, data: { label: 'v2', a: 2, b: 3 } }]
    const ops = diffGraph(base, mine)
    expect(ops.update).toHaveLength(1)
    expect((ops.update[0] as { dataUnset?: string[] }).dataUnset).toBeUndefined()
  })

  it('键序不同但内容相同不误判（键删除判据不吃假信号）', () => {
    const base = [{ id: '2', type: 'video', position: { x: 0, y: 0 }, data: { a: 1, label: 'v' } }]
    const mine = [{ id: '2', type: 'video', position: { x: 0, y: 0 }, data: { label: 'v', a: 1 } }]
    const ops = diffGraph(base, mine)
    expect(ops.update).toHaveLength(0)
  })
})
