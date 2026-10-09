/**
 * promptPersist —— 底栏输入框「内容不丢」的纯逻辑契约。
 *
 * 锁用户明确报的两件事：
 * ① 输入内容在底栏重新挂载后要能恢复（切画布/再点节点/任务跑完再回来，都是重新挂载）；
 * ② 发送之后内容也要留着。
 *
 * 根因（真实浏览器实测）：promptBinding:'none' 的动作（图片生成等）从没把输入写进节点 data，
 * 于是底栏一重挂载，本地 ref 就没了，输入框从空重建 —— 内容「一下就全消失」。
 * 修法：'none' 绑定的输入落 `data.barPrompt`（与 data.barValues 同属「我正在准备的作品」），
 * 挂载时再从它恢复；'text' 绑定仍是 data.text，不重复写。
 */
import { describe, it, expect } from 'vitest'
import { initialPromptText, promptPersistFields } from '../promptPersist'

describe('initialPromptText：挂载时从哪里恢复输入框内容', () => {
  it('text 绑定节点（有 data.text）→ 用 data.text', () => {
    expect(initialPromptText({ text: '文本节点的正文' })).toBe('文本节点的正文')
  })

  it("none 绑定节点（没有 data.text，只有 data.barPrompt）→ 用 barPrompt —— 这是用户报的'内容消失'场景", () => {
    expect(initialPromptText({ barPrompt: '我上次写的提示词' })).toBe('我上次写的提示词')
  })

  it('data.text 是空串（text 节点还没写内容）→ 优先它，不串到 barPrompt', () => {
    expect(initialPromptText({ text: '', barPrompt: '旧的东西' })).toBe('')
  })

  it('两个字段都没有 / data 缺失 / 字段不是字符串 → 空串（不抛错）', () => {
    expect(initialPromptText({})).toBe('')
    expect(initialPromptText(undefined)).toBe('')
    expect(initialPromptText(null)).toBe('')
    expect(initialPromptText({ barPrompt: 123 })).toBe('')
  })
})

describe('promptPersistFields：输入要写回哪些 data 字段', () => {
  it("none 绑定 → 写 data.barPrompt（与 barValues 同一次 updateNode 落盘）", () => {
    expect(promptPersistFields('none', '画一只猫')).toEqual({ barPrompt: '画一只猫' })
  })

  it('none 绑定 + 内容清空 → barPrompt 置 undefined（把脏字段清掉，不留空串）', () => {
    expect(promptPersistFields('none', '')).toEqual({ barPrompt: undefined })
  })

  it("text 绑定 → 不在这里写（由 onPromptUpdate 即时写 data.text，避免每键入返库两份）", () => {
    expect(promptPersistFields('text', '正文')).toEqual({})
  })
})
