/**
 * 发布成功后退出切分模式（用户口径 2026-11-02）：
 * 「点击分镜组和发布到画布时，若创建节点成功，你需要退出当前模式，恢复到默认的状态栏模式。」
 *
 * 之前的发布只 notify：会话仍在，GridSplitOverlay 的遮罩/勾选层也仍在，
 * 用户看到的是「组已经建好，但底栏还是宫格切分」，要再点一次 × 才能回去。
 */
import { describe, it, expect } from 'vitest'
import { beginSplit, endSplit, isSplitting, splitState } from '../splitSession'
import { finishSplitPublish } from '../publish'

describe('finishSplitPublish：发布成功退出，失败留在原模式', () => {
  it('成功：会话清掉 + 调 toolbar.exit（底栏回默认）', () => {
    beginSplit('n1', 2, 2)
    const calls: string[] = []
    const toolbar = { exit: (id: string) => calls.push(id) }
    finishSplitPublish({ endSplit, toolbar }, 'n1', true)
    expect(isSplitting('n1')).toBe(false)
    expect(calls).toEqual(['n1'])
    endSplit('n1')
  })

  it('失败：会话保留、不退出（用户可继续改勾选重试）', () => {
    beginSplit('n2', 3, 3)
    const calls: string[] = []
    const toolbar = { exit: (id: string) => calls.push(id) }
    finishSplitPublish({ endSplit, toolbar }, 'n2', false)
    expect(isSplitting('n2')).toBe(true)
    expect(splitState('n2')?.rows).toBe(3)
    expect(calls).toEqual([])
    endSplit('n2')
  })
})
