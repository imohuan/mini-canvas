/**
 * 对话模式的输入持久化（用户 2026-11-10：发送后输入框内容被清空）。
 *
 * 根因：persistValues 用 showEditor（底栏动作的输入框开关）当闸门，
 * 而对话模式没有动作 → 恒为 false → barPrompt 从来没落盘 → 重挂载按空重建。
 */
import { describe, it, expect } from 'vitest'
import { useBottomBarPersistence } from '../node-bottom-bar/useBottomBarPersistence'

describe('persistValues：对话模式必须落 barPrompt（用户 2026-11-10 输入框被清空）', () => {
  /**
   * 真实 bug：对话模式没有底栏动作，showEditor 恒为 false，
   * 于是 persistValues 提前 return，barPrompt 从来没被写进节点 ——
   * 底栏一重挂载就按空值重建，表现就是「发送后输入框内容没了」。
   */
  function harness(conversation: boolean) {
    const writes: Array<Record<string, unknown>> = []
    /** 节点里已经存过的 barValues（对话模式正常情况下只有 actionId） */
    const stored: Record<string, unknown> = conversation ? { actionId: 'agent:chat' } : {}
    const deps = {
      ctx: {
        tryGet: (n: string) =>
          n === 'doc'
            ? {
                getNode: () => ({ data: { barValues: stored } }),
                updateNode: (_id: string, patch: { data: Record<string, unknown> }) => writes.push(patch.data),
              }
            : undefined,
        get: (n: string) => deps.ctx.tryGet(n),
      },
      props: { id: 'n1', data: {} },
      currentId: { value: conversation ? 'agent:chat' : '' },
      values: { value: {} },
      storedActionId: { value: conversation ? 'agent:chat' : undefined },
      showEditor: { value: false },
      promptBinding: { value: 'text' as const },
      conversation: { value: conversation },
      prompt: { value: '我问的问题' },
      promptDoc: { value: undefined },
    }
    return { deps, writes }
  }

  it('对话模式：即使 showEditor=false 也要写 barPrompt', async () => {
    const { deps, writes } = harness(true)
    const { persistValues } = useBottomBarPersistence(deps as never)
    persistValues()
    expect(writes).toHaveLength(1)
    expect((writes[0] as { barPrompt?: string }).barPrompt).toBe('我问的问题')
    // 绝不能顺手把答案字段也写了
    expect((writes[0] as { text?: string }).text).toBeUndefined()
  })

  /**
   * 这是用户实测暴露的那一版 bug：对话模式的 barValues 只有 actionId，
   * 「参数没变就早退」的判断恒为真，于是 barPrompt 一直写不进去。
   * 现在早退只对非对话模式生效。
   */
  it('对话模式：动作没变（barValues 只有 actionId）时仍然要落 barPrompt', async () => {
    const { deps, writes } = harness(true)
    const { persistValues } = useBottomBarPersistence(deps as never)
    persistValues()
    expect(writes).toHaveLength(1)
    expect((writes[0] as { barPrompt?: string }).barPrompt).toBe('我问的问题')
  })

  it('非对话模式且 showEditor=false：保持老行为（什么都不写）', async () => {
    const { deps, writes } = harness(false)
    const { persistValues } = useBottomBarPersistence(deps as never)
    persistValues()
    expect(writes).toHaveLength(0)
  })
})
