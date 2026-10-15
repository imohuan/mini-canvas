/**
 * 队列视图模型：顺序（G3 编辑不换位）、编辑阻塞、按钮三态、预算 / 目标文案。
 *
 * 这些口径大多来自设计 §3.6 与用户点名的 G1-G3；改这里的断言 = 改用户口径，先对设计。
 */
import { describe, it, expect } from 'vitest'
import {
  queuePanelView,
  sendButtonMode,
  budgetText,
  goalMarkText,
  usedText,
  goalEndedBadge,
  goalIsFinished,
} from '../queueModel'
import type { QueueItemView, QueueStateView } from '../agentApi'

/** 小工厂：造一条队列条目（只写关心的字段，其余走默认） */
function item(patch: Partial<QueueItemView> & { id: string }): QueueItemView {
  return { text: '', state: 'queued', createdAt: 0, ...patch }
}

/** 小工厂：造一个队列快照 */
function queueOf(items: QueueItemView[], paused = false): QueueStateView {
  return { paused, items }
}

describe('queuePanelView', () => {
  it('queue 为空 / undefined / 条目为空 ⇒ 空视图', () => {
    for (const q of [null, undefined, queueOf([])]) {
      const v = queuePanelView(q)
      expect(v.rows).toEqual([])
      expect(v.count).toBe(0)
      expect(v.paused).toBe(false)
      expect(v.editingId).toBeNull()
      expect(v.blocked).toBe(false)
      expect(v.hasItems).toBe(false)
      expect(v.pauseLabel).toBe('暂停')
      expect(v.pauseTitle).toBe('暂停队列自动发送')
    }
  })

  it('顺序原样，不 sort —— 编辑中的那条也保持原位置（G3）', () => {
    const v = queuePanelView(
      queueOf([
        item({ id: 'c', text: '第三' }),
        item({ id: 'a', text: '第一', state: 'editing' }),
        item({ id: 'b', text: '第二', state: 'sending' }),
      ]),
    )
    expect(v.rows.map((r) => r.id)).toEqual(['c', 'a', 'b'])
    expect(v.count).toBe(3)
    expect(v.hasItems).toBe(true)
  })

  it('有条目在编辑中 ⇒ blocked，editingId 指它那条', () => {
    const v = queuePanelView(queueOf([item({ id: 'q1' }), item({ id: 'q2', state: 'editing' })]))
    expect(v.blocked).toBe(true)
    expect(v.editingId).toBe('q2')
    expect(v.rows[1].editing).toBe(true)
  })

  it('没有条目在编辑 ⇒ 不阻塞，editingId 为 null（sending 不算编辑）', () => {
    const v = queuePanelView(queueOf([item({ id: 'q1' }), item({ id: 'q2', state: 'sending' })]))
    expect(v.blocked).toBe(false)
    expect(v.editingId).toBeNull()
    expect(v.rows[0].editing).toBe(false)
    expect(v.rows[0].sending).toBe(false)
    expect(v.rows[1].sending).toBe(true)
  })

  it('暂停按钮显隐（用户口径 2026-10-15）：过滤 sending 后还有排着的才显示', () => {
    // 只有一条且正在发送 ⇒ 不显示暂停按钮
    const only = queuePanelView(queueOf([item({ id: 'a', state: 'sending' })]))
    expect(only.hasItems).toBe(true)
    expect(only.pauseVisible).toBe(false)
    expect(only.pendingCount).toBe(0)
    // sending + queued ⇒ 显示，计数只算 queued
    const mix = queuePanelView(queueOf([item({ id: 'a', state: 'sending' }), item({ id: 'b', text: '排着' })]))
    expect(mix.pauseVisible).toBe(true)
    expect(mix.pendingCount).toBe(1)
    // 已暂停 ⇒ 按钮留着（恢复入口），哪怕队列里只剩 sending
    const paused = queuePanelView(queueOf([item({ id: 'a', state: 'sending' })], true))
    expect(paused.pauseVisible).toBe(true)
    // 全 queued ⇒ 显示
    const all = queuePanelView(queueOf([item({ id: 'a' }), item({ id: 'b' })]))
    expect(all.pauseVisible).toBe(true)
    expect(all.pendingCount).toBe(2)
  })

  it('sending / steered / goal 逐条透传；没有目标的那条 goal 为 null', () => {
    const v = queuePanelView(
      queueOf([
        item({ id: 'q1', text: '带目标', goal: { objective: '写一本书', budget: 50000 } }),
        item({ id: 'q2', text: '引导过', steered: true }),
      ]),
    )
    expect(v.rows[0].goal).toEqual({ objective: '写一本书', budget: 50000 })
    expect(v.rows[1].goal).toBeNull()
    expect(v.rows[1].steered).toBe(true)
    expect(v.rows[0].steered).toBe(false)
  })

  it('display：换行 / 连续空格折成一个空格 + 去首尾（text 原文不动，编辑回填要用）', () => {
    const v = queuePanelView(queueOf([item({ id: 'q1', text: 'a\n\nb  ' })]))
    expect(v.rows[0].display).toBe('a b')
    expect(v.rows[0].text).toBe('a\n\nb  ')
  })

  it("display：超过 300 字截断加 '…'；正好 300 字不动", () => {
    const exact = '字'.repeat(300)
    const long = '字'.repeat(400)
    expect(queuePanelView(queueOf([item({ id: 'q1', text: exact })])).rows[0].display).toBe(exact)
    expect(queuePanelView(queueOf([item({ id: 'q2', text: long })])).rows[0].display).toBe('字'.repeat(300) + '…')
  })

  it("images 原样带出、thumbs 最多前 3 张；纯图片条目 display 为 ''（「（图片）」兜底交给组件）", () => {
    const pics = [
      'data:image/png;base64,1',
      'data:image/png;base64,2',
      'data:image/png;base64,3',
      'data:image/png;base64,4',
    ]
    const v = queuePanelView(queueOf([item({ id: 'q1', text: '', images: pics })]))
    expect(v.rows[0].images).toEqual(pics)
    expect(v.rows[0].thumbs).toEqual(pics.slice(0, 3))
    expect(v.rows[0].display).toBe('')
  })

  it('没有图片 ⇒ images / thumbs 是空数组（不是 undefined）', () => {
    const v = queuePanelView(queueOf([item({ id: 'q1', text: 'hi' })]))
    expect(v.rows[0].images).toEqual([])
    expect(v.rows[0].thumbs).toEqual([])
  })

  it('paused ⇒ 按钮文案变「启动」，title 跟着变', () => {
    const v = queuePanelView(queueOf([item({ id: 'q1' })], true))
    expect(v.paused).toBe(true)
    expect(v.pauseLabel).toBe('启动')
    expect(v.pauseTitle).toBe('启动队列自动发送')

    const v2 = queuePanelView(queueOf([item({ id: 'q1' })]))
    expect(v2.pauseLabel).toBe('暂停')
    expect(v2.pauseTitle).toBe('暂停队列自动发送')
  })
})

describe('sendButtonMode', () => {
  it('有内容 ⇒ 永远「发送」（正在跑时点了 = 进队列，不丢消息）', () => {
    expect(sendButtonMode(true, false)).toBe('send')
    expect(sendButtonMode(true, true)).toBe('send')
  })

  it('空输入框 ⇒ 正在跑是「终止」，空闲是「禁用」', () => {
    expect(sendButtonMode(false, true)).toBe('stop')
    expect(sendButtonMode(false, false)).toBe('disabled')
  })
})

describe('budgetText', () => {
  it('千位以上：一位小数、去掉尾随 .0', () => {
    expect(budgetText(50000)).toBe('50k')
    expect(budgetText(12345)).toBe('12.3k')
    expect(budgetText(1000)).toBe('1k')
    expect(budgetText(1500)).toBe('1.5k')
  })

  it('千位以下：原样显示', () => {
    expect(budgetText(999)).toBe('999')
    expect(budgetText(1)).toBe('1')
  })

  it('0 / -1 / null / undefined ⇒ 不限', () => {
    expect(budgetText(0)).toBe('不限')
    expect(budgetText(-1)).toBe('不限')
    expect(budgetText(null)).toBe('不限')
    expect(budgetText(undefined)).toBe('不限')
  })
})

describe('usedText（目标状态条的「已用」）', () => {
  // 真机实测的显示 bug：tokensUsed=0 被 budgetText 显示成「不限」，
  // 于是「目标第 1 轮 · 不限 / 400k」看着像预算没设置。已用是**数字**，0 就是 0。
  it('0 ⇒ 0（不是「不限」）', () => {
    expect(usedText(0)).toBe('0')
  })
  it('千位以上仍按 k 缩写；负数/空按 0（已用不可能是负的）', () => {
    expect(usedText(12345)).toBe('12.3k')
    expect(usedText(2297)).toBe('2.3k')
    expect(usedText(null)).toBe('0')
    expect(usedText(-5)).toBe('0')
  })
})

describe('goalMarkText', () => {
  it('正常：目标内容 · 预算 文案', () => {
    expect(goalMarkText('写一本书', 50000)).toBe('写一本书 · 预算 50k')
  })

  it('目标内容为空 ⇒ 占位「输入目标内容」，预算照常渲染', () => {
    expect(goalMarkText('', 0)).toBe('输入目标内容 · 预算 不限')
    expect(goalMarkText(null, null)).toBe('输入目标内容 · 预算 不限')
    expect(goalMarkText('   ', 12345)).toBe('输入目标内容 · 预算 12.3k')
  })
})

describe('goalEndedBadge：按真实结束原因给徽章（不再一律「已完成」）', () => {
  it('complete ⇒ 已完成', () => {
    expect(goalEndedBadge('complete')).toEqual({ text: '已完成', cls: 'is-done' })
  })

  /**
   * 真缺陷（代码审查）：用户点「终止」时 stop hook 写 status:'aborted' + ended:true，
   * 界面此前一律显示「已完成」—— 把中止谎报成完成。
   */
  it('aborted ⇒ 已中止（不是「已完成」）', () => {
    expect(goalEndedBadge('aborted')).toEqual({ text: '已中止', cls: 'is-paused' })
  })

  it('budget_limited / blocked / 其它 status 各有说法', () => {
    expect(goalEndedBadge('budget_limited').text).toBe('预算用尽')
    expect(goalEndedBadge('blocked')).toEqual({ text: '受阻', cls: 'is-paused' })
    // 协议外的 status / 老数据：中性的「已结束」，不谎报完成
    expect(goalEndedBadge('weird').text).toBe('已结束')
    expect(goalEndedBadge(undefined).text).toBe('已结束')
  })
})

/**
 * 真 bug（用户实测 2026-10-11）：点「终止」后暂停/播放按钮消失，目标看起来「无法恢复」。
 *
 * 根因：插件的 stop hook 把两种完全不同的情形都写成 `ended: true` ——
 *   · 真完成 / 受阻 / 预算用尽 ⇒ 确实完了；
 *   · **只是这一轮被中止**（status='aborted'）⇒ 目标还在、文件也在，用户必须还能点播放接着跑。
 * 早先界面的按钮条件是 `!ended`，于是中止之后按钮被藏掉。
 */
describe('goalIsFinished：只有真收尾才算完（被中止不算）', () => {
  it('complete / blocked / budget_limited ⇒ 真完了（收按钮）', () => {
    expect(goalIsFinished('complete')).toBe(true)
    expect(goalIsFinished('blocked')).toBe(true)
    expect(goalIsFinished('budget_limited')).toBe(true)
  })

  it('**aborted 不算完** ⇒ 仍要给暂停/播放键（用户口径：没完成就显示按钮）', () => {
    expect(goalIsFinished('aborted')).toBe(false)
  })

  it('active / wrapping_up / 协议外的 status / 空 ⇒ 一律当没完（宁可不收按钮）', () => {
    expect(goalIsFinished('active')).toBe(false)
    expect(goalIsFinished('wrapping_up')).toBe(false)
    expect(goalIsFinished('weird')).toBe(false)
    expect(goalIsFinished(null)).toBe(false)
    expect(goalIsFinished(undefined)).toBe(false)
  })
})
