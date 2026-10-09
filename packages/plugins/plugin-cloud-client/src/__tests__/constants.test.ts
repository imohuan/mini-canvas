// 常量防漂移：这些字面量在本插件里是**就地内联**的（产物要自包含），
// 与数据层 / 后端各有一份。改了一边没改另一边，这里立刻红。
import { describe, it, expect } from 'vitest'
import {
  GRAPH_KEY,
  GRAPH_EDGES_KEY,
  GRAPH_VIEWPORT_KEY,
  PROVIDERS_VERSION_KEY,
  HISTORY_REV_KEY,
  CANVAS_ID,
  RESOURCE_URL_FIELDS,
} from '../keys'
import {
  GRAPH_KEY as DATA_GRAPH_KEY,
  GRAPH_EDGES_KEY as DATA_EDGES_KEY,
  GRAPH_VIEWPORT_KEY as DATA_VIEWPORT_KEY,
  SAVE_TYPES,
  scopedKey,
} from '@mini-canvas/canvas-data'

describe('与 canvas-data 逐字一致', () => {
  it('三个画布 key', () => {
    expect(GRAPH_KEY).toBe(DATA_GRAPH_KEY)
    expect(GRAPH_EDGES_KEY).toBe(DATA_EDGES_KEY)
    expect(GRAPH_VIEWPORT_KEY).toBe(DATA_VIEWPORT_KEY)
  })

  it('canvas 域在四类 type 里（不然 useAdapter 会挂到不存在的域上）', () => {
    expect(SAVE_TYPES).toContain('canvas')
  })

  it('scopedKey 的产物（adapter 摘前缀时按它算）', () => {
    expect(scopedKey('canvas', GRAPH_KEY)).toBe('canvas:graph')
  })
})

describe('自身约定', () => {
  it('默认画布 id 是 default', () => {
    expect(CANVAS_ID).toBe('default')
  })

  it('两个信号键落在 config 域（是"后台的元信息"，不是画布内容）', () => {
    expect(PROVIDERS_VERSION_KEY).toBe('providers-version')
    expect(HISTORY_REV_KEY).toBe('history-rev')
  })

  it('媒体字段清单覆盖九个（只写 imageUrl 会漏掉视频/音频/全景/对比图）', () => {
    expect([...RESOURCE_URL_FIELDS].sort()).toEqual(
      ['audioUrl', 'imageUrl', 'leftImageUrl', 'maskUrl', 'panoUrl', 'posterUrl', 'rightImageUrl', 'thumbUrl', 'videoUrl'].sort(),
    )
  })
})
