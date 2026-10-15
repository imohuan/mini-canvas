/**
 * [user_steering] 标记块的识别与剥离（纯函数，零依赖，可单测）。
 *
 * 背景（用户口径 2026-10-15）：后台队列自动发消息时，SDK 把它作为 steering 投进
 * 正在跑的那一轮 —— 请求体里正文被包成 [user_steering]\n…\n[/user_steering]。
 * 这份格式有两处要吃掉：
 *  1. 气泡渲染：对话里出现这个块 ⇒ 剥掉标记只显示内文（变成一条普通用户气泡）；
 *  2. 队列联动：块一出现 = 排队的那条真的发出去了 ⇒ 前端把 sending 条目从队列删掉。
 *
 * 与 SDK 的 STEERING_TEXT_RE 同形（tag= user_steering，方括号 + 换行包裹）；
 * 兼容尖括号变体（<user_steering>…</user_steering>）—— SDK 的 marker 家族两种都认。
 */

const RE_SQUARE = /^\[user_steering\]\n?([\s\S]*?)\n?\[\/user_steering\]\s*$/
const RE_ANGLE = /^<user_steering>\n?([\s\S]*?)\n?<\/user_steering>\s*$/

/** 文本是不是一个完整的 user_steering 块；是 ⇒ 返回内文，否 ⇒ null */
export function parseUserSteeringBlock(text: string): string | null {
  const s = String(text ?? '')
  const m = RE_SQUARE.exec(s) ?? RE_ANGLE.exec(s)
  return m ? m[1] : null
}

/** 剥掉整条 user_steering 块的标记，只留内文；不是块就原样返回 */
export function stripUserSteering(text: string): string {
  return parseUserSteeringBlock(text) ?? String(text ?? '')
}

/** 归一指纹：剥块 + 折空白 —— 队列条目与对话消息比对用（两边都过它再比） */
export function steeringFingerprint(text: string): string {
  return stripUserSteering(text).replace(/\s+/g, ' ').trim()
}

/**
 * 在队列里找「这条 user_message 对应的 sending 条目」：文本指纹一致 + 图片清单一致。
 * 返回命中的条目 id（没有则 null）。队列联动（块出现 = 已真实投递）的判定口。
 */
export function matchSendingQueueItem(
  items: Array<{ id: string; text: string; images?: string[]; state: string }>,
  text: string,
  images?: string[],
): string | null {
  const fp = steeringFingerprint(text)
  if (!fp) return null
  const imgs = JSON.stringify(images ?? [])
  const hit = items.find(
    (it) => it.state === 'sending' && steeringFingerprint(it.text) === fp && JSON.stringify(it.images ?? []) === imgs,
  )
  return hit ? hit.id : null
}
