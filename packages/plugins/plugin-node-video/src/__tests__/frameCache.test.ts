/**
 * FrameCache —— 默认帧图与定格帧共用一张表时的所有权契约。
 *
 * 2026-10-30 用户实测：播放后移开鼠标，预览会闪成默认帧图，甚至变成破图。
 * 根因是两类缓存项没有分清“谁该释放”：
 *   - setFrozenFrames 把同一个源的所有 blob 都 revoke 了（包括正在显示的默认帧图，
 *     以及本次刚生成、马上要显示的新定格帧）；
 *   - 默认帧图的异步生成在定格之后才完成，又把旧图写回内存。
 * 这里锁住两条：只换定格项、只释放旧定格。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrameCache } from '../videoThumbCanvas'

const SRC = '/api/canvases/c1/resources/abc.mp4'
const frame = (tag: string) => ({ url: 'blob:' + tag, width: 8, height: 8 })

afterEach(() => vi.restoreAllMocks())

describe('FrameCache：默认帧图与定格帧的所有权', () => {
  it('写定格帧时不能释放默认帧图（否则正在显示的预览会变破图）', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const cache = new FrameCache()
    const def = await cache.resolveOrCreate({
      src: SRC,
      variant: 'vid-abc-t1',
      make: async () => new Blob(['default']),
    })
    expect(def).not.toBeNull()
    cache.setFrozenFrames(SRC, 'frz:100', new Map([[1, frame('frz-100')]]))
    expect(revoke).not.toHaveBeenCalledWith(def!.url)
    // 清掉定格后，默认帧图必须还在（证明它没被顺手删掉）
    cache.clearFrozen(SRC)
    const again = await cache.resolveOrCreate({
      src: SRC,
      variant: 'vid-abc-t1',
      make: async () => new Blob(['rebuilt']),
    })
    expect(again).toBe(def)
  })

  it('只释放被替换掉的旧定格，不释放刚生成、马上要显示的新定格', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const cache = new FrameCache()
    cache.setFrozenFrames(SRC, 'frz:100', new Map([[1, frame('old')]]))
    cache.setFrozenFrames(SRC, 'frz:200', new Map([[1, frame('new')]]))
    expect(revoke).toHaveBeenCalledWith('blob:old')
    expect(revoke).not.toHaveBeenCalledWith('blob:new')
  })

  it('clearFrozen 只清定格项，并释放它们的 blob', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const cache = new FrameCache()
    cache.setFrozenFrames(SRC, 'frz:100', new Map([[1, frame('frz')]]))
    cache.clearFrozen(SRC)
    expect(revoke).toHaveBeenCalledWith('blob:frz')
  })

  it('同一时刻重复定格：新图与旧图是同一批 URL 时不能被误释放', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const cache = new FrameCache()
    const same = new Map([[1, frame('same')]])
    cache.setFrozenFrames(SRC, 'frz:100', same)
    cache.setFrozenFrames(SRC, 'frz:100', same)
    expect(revoke).not.toHaveBeenCalledWith('blob:same')
  })
})
