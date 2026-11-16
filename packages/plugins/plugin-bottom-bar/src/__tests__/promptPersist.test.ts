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
import { aiPromptDataPatch, initialPromptText, promptPersistFields, PROMPT_DOC_FIELD } from '../promptPersist'

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

describe('initialPromptText：对话模式（文本节点 agent:chat，用户 2026-11-10）', () => {
  it('优先 barPrompt，绝不读 data.text（那是模型答案，会顶掉你的问题）', () => {
    expect(initialPromptText({ text: '模型的答案', barPrompt: '我提的问题' }, { preferBarPrompt: true })).toBe('我提的问题')
  })

  it('只有 data.text 时也不拿它当输入（答案不是你的输入）', () => {
    expect(initialPromptText({ text: '模型的答案' }, { preferBarPrompt: true })).toBe('')
  })

  it('数据都是空 / 缺失 → 空串', () => {
    expect(initialPromptText({}, { preferBarPrompt: true })).toBe('')
    expect(initialPromptText(undefined, { preferBarPrompt: true })).toBe('')
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

describe('aiPromptDataPatch：AI 结果必须顺手清掉旧的富文本快照（用户 2026-11-16）', () => {
  /**
   * 真实 bug：点 AI 按钮后输入框里出现结果，但重新点开节点又变回改写前的内容。
   * canvas.json 里 `barPrompt` 已经是 AI 的新结果，`barPromptDoc` 却还是旧快照；
   * 底栏重挂载时编辑器优先按快照恢复，旧内容把新结果盖回去。
   */
  it('图片节点（none 绑定）：写 barPrompt，同时要求删掉 barPromptDoc', () => {
    const patch = aiPromptDataPatch('none', '一个中国女孩')
    expect(patch.data).toEqual({ barPrompt: '一个中国女孩' })
    expect(patch.dataUnset).toContain(PROMPT_DOC_FIELD)
  })

  it('文本节点（text 绑定）：写 data.text，同样要求删掉旧快照', () => {
    const patch = aiPromptDataPatch('text', '改好的正文')
    expect(patch.data).toEqual({ text: '改好的正文' })
    expect(patch.dataUnset).toContain(PROMPT_DOC_FIELD)
  })

  /**
   * 对话模式（文本节点 agent:chat）与普通文本节点写法不同：
   * 输入框里的内容是「你的问题」，存在 barPrompt；`data.text` 是模型答案。
   * AI 按钮在这里是改写提问，写错字段就会把答案冲掉（用户 2026-11-10 报过同一处）。
   */
  it('对话模式：只写 barPrompt，绝不碰 data.text（那是模型答案）', () => {
    const patch = aiPromptDataPatch('text', '润色后的问题', { conversation: true })
    expect(patch.data).toEqual({ barPrompt: '润色后的问题' })
    expect((patch.data as { text?: unknown }).text).toBeUndefined()
    expect(patch.dataUnset).toContain(PROMPT_DOC_FIELD)
  })
})
