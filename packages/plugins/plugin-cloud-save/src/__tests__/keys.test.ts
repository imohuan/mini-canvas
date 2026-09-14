/**
 * key 一致性哨兵。
 *
 * 插件为了能作为"零 import 的单文件 js"加载，把 key 就地内联了（见 src/keys.ts）。
 * 内联的风险是"两边改岔了"：数据层把 GRAPH_KEY 改了，插件还在用老 key，
 * 表现是"云端的画布找不到了"——很难查。本测试把两边逐字比对，改岔立刻红。
 */
import { describe, it, expect } from 'vitest'
import { GRAPH_KEY, GRAPH_EDGES_KEY, GRAPH_VIEWPORT_KEY, SAVE_TYPES, scopedKey } from '@mini-canvas/canvas-data'
import * as local from '../keys'

describe('内联 key 与数据层一致', () => {
  it('GRAPH_KEY / GRAPH_EDGES_KEY / GRAPH_VIEWPORT_KEY 与 canvas-data 逐字相同', () => {
    expect(local.GRAPH_KEY).toBe(GRAPH_KEY)
    expect(local.GRAPH_EDGES_KEY).toBe(GRAPH_EDGES_KEY)
    expect(local.GRAPH_VIEWPORT_KEY).toBe(GRAPH_VIEWPORT_KEY)
  })

  it('插件换的两个域在 SAVE_TYPES 里（不然 useAdapter 会把 adapter 挂到不存在的域上）', () => {
    expect(SAVE_TYPES).toContain('canvas')
    expect(SAVE_TYPES).toContain('resource')
  })

  it('scopedKey 的产物与 HttpAdapter 摘前缀的假设一致（canvas:graph）', () => {
    expect(scopedKey('canvas', local.GRAPH_KEY)).toBe('canvas:graph')
  })
})
