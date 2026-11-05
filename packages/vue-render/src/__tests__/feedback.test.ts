/**
 * 统一反馈服务的契约。
 *
 * 背景（用户口径 2026-11-06）：项目里禁止再出现浏览器原生 confirm / prompt / alert，
 * 全部换成组件库的确认框。这条测试只盯服务层最容易出错的几件事：
 * - 结果必须是 Promise（调用方要能 await，不能像 confirm 那样同步返回值）；
 * - 同时来两条时排队，不能互相覆盖 —— 覆盖会让前一个 Promise 永远悬空；
 * - 取消要给「否定」结果（false / null），不能让调用方误以为是确认。
 */
import { describe, expect, it } from 'vitest'
import { computed } from 'vue'
import { createFeedbackService, splitDescription } from '../contracts/feedback'

describe('feedback：确认 / 输入 / 告知统一服务', () => {
  it('confirm 默认还没回答时不 resolve，点确认后给 true', async () => {
    const svc = createFeedbackService()
    const answer = svc.confirm({ title: '删除项目' })
    expect(svc.current?.kind).toBe('confirm')
    expect(svc.current?.kind === 'confirm' && svc.current.confirmText).toBe('确定')
    svc.accept()
    await expect(answer).resolves.toBe(true)
    expect(svc.current).toBeNull()
  })

  it('confirm 取消给 false，不是 undefined', async () => {
    const svc = createFeedbackService()
    const answer = svc.confirm({ title: '卸载插件', tone: 'destructive' })
    expect(svc.current?.kind === 'confirm' && svc.current.tone).toBe('destructive')
    svc.cancel()
    await expect(answer).resolves.toBe(false)
  })

  it('prompt 正常返回输入文本，取消返回 null', async () => {
    const svc = createFeedbackService()
    const first = svc.prompt({ title: '新建项目', defaultValue: '未命名项目' })
    expect(svc.current?.kind === 'prompt' && svc.current.defaultValue).toBe('未命名项目')
    svc.accept('我的项目')
    await expect(first).resolves.toBe('我的项目')

    const second = svc.prompt({ title: '重命名画布' })
    svc.cancel()
    await expect(second).resolves.toBeNull()
  })

  it('alert 点确定才结束', async () => {
    const svc = createFeedbackService()
    let done = false
    const wait = svc.alert({ title: '导入失败', description: 'JSON 格式无效' }).then(() => { done = true })
    expect(done).toBe(false)
    svc.accept()
    await wait
    expect(done).toBe(true)
  })

  it('同时来两条时排队：第二条在前一条结束后才出现', async () => {
    const svc = createFeedbackService()
    const a = svc.confirm({ title: '第一个' })
    const b = svc.confirm({ title: '第二个' })
    expect(svc.pending).toBe(1)
    expect(svc.current?.title).toBe('第一个')

    svc.accept()
    await expect(a).resolves.toBe(true)
    expect(svc.current?.title).toBe('第二个')
    expect(svc.pending).toBe(0)

    svc.accept()
    await expect(b).resolves.toBe(true)
    expect(svc.current).toBeNull()
  })

  it('description 用空行分段，面板按段落渲染', () => {
    expect(splitDescription('第一段\n\n第二段\n\n\n第三段')).toEqual(['第一段', '第二段', '第三段'])
    expect(splitDescription(undefined)).toEqual([])
  })

  /**
   * 面板按 `service.current` 渲染。这条锁住「服务里必须有响应式状态」：
   * 早期 current 是普通 let，调用方进得来、Vue 收不到变化，弹窗永远不出现
   * （2026-11-06 真机：点「新建项目」毫无反应，最后定位到这）。
   */
  it('current 是响应式的：面板的 computed 能跟着变化', async () => {
    const svc = createFeedbackService()
    const kind = computed(() => svc.current?.kind ?? 'none')
    expect(kind.value).toBe('none')
    const wait = svc.prompt({ title: '新建项目' })
    expect(kind.value).toBe('prompt')
    svc.accept('x')
    await wait
    expect(kind.value).toBe('none')
  })
})
