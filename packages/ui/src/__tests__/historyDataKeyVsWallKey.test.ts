/**
 * 「数据签名」与「墙缓存 key」必须是两个东西（2026-10-30 扫描发现）。
 *
 * 背景：为了让「显示异常」开关生效，historyWallKey 多加了一维（e1/e0）。
 * 但 mountedWallKey 当时仍写 `s.histSignature || historyWallKey()`，而 hiSignature
 * 来自 ui.ts（不含这一维）—— 于是开关一开，两个字符串永远不相等：
 *   · 每次数据更新都被当成「换了筛选」→ 整墙重建；
 *   · 切页签备份的墙 key 也对不上，缓存形同虚设。
 * 表现就是「打开显示异常后视频卡一直重载」。这里用源码结构锁住两者的分工。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../components/areas/ModalsArea.vue', import.meta.url), 'utf-8')

describe('历史墙：数据签名 vs 墙 key', () => {
  it('分别定义了 historyDataKey（不含显示开关）与 historyWallKey（含）', () => {
    expect(src, '缺少 historyDataKey').toMatch(/function historyDataKey\(\)/)
    const wall = src.slice(src.indexOf('function historyWallKey'), src.indexOf('/** 最后一张卡可见'))
    expect(wall, '墙 key 不再由数据签名派生').toMatch(/historyDataKey\(\)/)
    expect(wall, '墙 key 少了显示开关 → 开关点了没反应').toMatch(/histShowError/)
  })

  it('挂载中/备份的墙 key 记的是 historyWallKey，不是数据签名', () => {
    expect(src, 'mountedWallKey 又记成数据签名了（开关一开就会反复整墙重建）')
      .not.toMatch(/mountedWallKey = s\.histSignature/)
    expect(src, '重建后没有记墙 key').toMatch(/mountedWallKey = historyWallKey\(\)/)
    expect(src, '备份时没有记墙 key').toMatch(/const key = mountedWallKey \|\| historyWallKey\(\)/)
  })

  it('判断「数据换了」时比数据签名（墙 key 多一维，拿它比永远不相等）', () => {
    expect(src, '仍在拿墙 key 比数据签名').not.toMatch(/s\.histSignature !== historyWallKey\(\)/)
    expect(src, '没有改成比 historyDataKey').toMatch(/s\.histSignature !== historyDataKey\(\)/)
  })
})
