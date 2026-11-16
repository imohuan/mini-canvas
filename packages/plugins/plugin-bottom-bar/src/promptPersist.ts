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
export function initialPromptText(
  data: Record<string, unknown> | undefined | null,
  opts?: { preferBarPrompt?: boolean },
): string {
  const bar = asText(data?.barPrompt)
  //
  // 对话输入（文本节点 agent:chat）**优先 barPrompt**，绝不读 data.text：
  // data.text 是节点正文 = 模型答案。共用会让「发送后输入框被答案顶掉」，
  // 也会让占位符和正文叠在一起（用户 2026-11-10 的两条问题）。
  if (opts?.preferBarPrompt) return bar ?? ''
  const text = asText(data?.text)
  if (text !== undefined) return text
  return bar ?? ''
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
/**
 * 富文本快照的落盘字段名（存 ProseMirror doc JSON）。
 *
 * 为什么需要它（用户 2026-10-27 报）：只存纯文本 `@图片10` 时，重开底栏只能按文本重建，
 * 认不出那本来是「待输入」标签 → 标签退化成文字，还被当成声明了第 10 格、凭空长出一排空槽。
 * 存一份 doc JSON，重开时按节点原样恢复（标签还是标签）。
 */
export const PROMPT_DOC_FIELD = 'barPromptDoc'

/** 挂载时该拿哪份富文本快照（没有 / 形状不对 → undefined，调用方退回纯文本恢复） */
export function initialPromptDoc(data: Record<string, unknown> | undefined | null): unknown {
  const doc = data?.[PROMPT_DOC_FIELD]
  if (!doc || typeof doc !== 'object') return undefined
  const shaped = doc as { type?: unknown }
  return shaped.type === 'doc' ? doc : undefined
}

/** 要写回 data 的富文本字段（doc 为空 = 清掉旧快照，避免恢复出过期内容） */
export function promptDocPersistFields(doc: unknown): Record<string, unknown> {
  if (!doc) return { [PROMPT_DOC_FIELD]: undefined }
  return { [PROMPT_DOC_FIELD]: doc }
}

/**
 * AI 按钮把结果整段写回节点时要用的 data 补丁。
 *
 * 用户 2026-11-16 报：「点一下 AI 按钮，输入框里出现结果，但重新点开节点就没了。」
 * 根因不是没落盘 —— `barPrompt` 确实写进去了；是**旧的富文本快照没清**：
 * 流式写入只覆盖纯文本，`barPromptDoc` 还留着改写前那份；底栏重挂载时编辑器
 * 优先按快照恢复（见 useEditor 的 deserializeDoc），旧内容就把 AI 的结果盖回去，
 * 看起来像「只临时写了一下」。
 *
 * 所以 AI 结果必须「纯文本 + 明确删掉快照」一起写：AI 产出的是纯文字，
 * 没有标签，这一拍不该再有旧快照。用 dataUnset 而不是写 undefined，
 * 免得把占位键留在节点数据里。
 */
export function aiPromptDataPatch(
  binding: 'none' | 'text',
  value: string,
  opts?: { conversation?: boolean },
): { data: Record<string, unknown>; dataUnset: string[] } {
  // 对话模式（文本节点 agent:chat）：输入框里存的是**你的问题**（barPrompt），
  // data.text 是模型答案 —— AI 按钮是在改写提问，绝不能把答案顶掉。
  if (opts?.conversation) {
    return { data: promptPersistFields('none', value), dataUnset: [PROMPT_DOC_FIELD] }
  }
  return {
    // 'text' 绑定在这里要**自己写** data.text：promptPersistFields 对它是空对象
    // （平时每键入由 onPromptUpdate 即时写，避免返库两份），AI 一次性整体写回时没有那条通道。
    data: binding === 'text' ? { text: value } : promptPersistFields(binding, value),
    dataUnset: [PROMPT_DOC_FIELD],
  }
}

