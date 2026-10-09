/**
 * promptPersist —— 底栏输入框「内容不丢」的纯逻辑（零 Vue / 零 DOM，Node 可单测）。
 *
 * 用户报的两个 bug：
 * ① 输入内容在底栏**重新挂载**后消失（切画布、再点该节点、任务跑完再回来，都是重新挂载）；
 * ② 点发送之后内容也消失。
 *
 * 根因（真实浏览器实测）：`promptBinding:'none'` 的动作（图片生成等）从没把输入写进节点 data ——
 * 只有 'text' 绑定（文本节点）才写 data.text。于是底栏一重挂载，本地 ref 就没了，输入框从空重建。
 *
 * 修法：'none' 绑定的输入落 `data.barPrompt`（与 data.barValues 同属「我正在准备的作品」——
 * 参数一样是“下次点进来还是上次那套”，提示词自然也应该是）。挂载时优先 data.text（text 绑定）、
 * 其次 data.barPrompt。'text' 绑定不在这里写（由 onPromptUpdate 即时写 data.text，避免每键入返库两份）。
 */

/** 非空字符串才当有值（空串/非字符串都视为没有） */
function asText(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/**
 * 挂载时该从节点 data 的哪个字段恢复输入框内容。
 *
 * 优先 `data.text`（文本节点的 promptBinding:'text' 就地写在这里），
 * 其次 `data.barPrompt`（'none' 绑定的输入落这里）。
 * 注意：`data.text` 是**空串**时也要优先它 —— 那表示“文本节点内容就是空”，
 * 不该串去读一个可能残留的 barPrompt。
 */
export function initialPromptText(data: Record<string, unknown> | undefined | null): string {
  const text = asText(data?.text)
  if (text !== undefined) return text
  return asText(data?.barPrompt) ?? ''
}

/**
 * 本次输入要写回节点 data 的字段（空对象 = 这个绑定不落这里）。
 *
 * - 'none'：落 `data.barPrompt`；内容为空时置 `undefined`（把脏字段清掉，不留空串）。
 * - 'text'：**不写** —— 由 onPromptUpdate 即时写 data.text，避免每键入返库两份。
 */
export function promptPersistFields(
  binding: 'none' | 'text',
  value: string,
): Record<string, unknown> {
  if (binding === 'text') return {}
  return { barPrompt: value === '' ? undefined : value }
}
