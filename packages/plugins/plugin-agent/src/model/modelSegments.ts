// modelSegments - pure logic for the "switch model" separator (user 2026-10-11).
//
// Switching models in the SDK opens a NEW session (the model is pinned in
// session_meta and cannot be changed afterwards), so the backend copies the whole
// transcript into a branch and records one ModelSegment per "from here on, this
// model" boundary -- exactly the same mechanism as the "edit & resend" fork.
//
// This module holds the positioning rule only (no Vue): given the rendered turns
// and the segments, which user message carries the separator? Keeping it pure is
// what makes the ordinal arithmetic testable at all.

/** One model-usage span of a conversation (mirrors the backend ModelSegment). */
export interface ModelSegment {
  /** Index of the first user message of this span (0-based, counted over user turns) */
  fromUser: number
  provider: string
  modelId: string
}

/** Minimal shape this module needs from a rendered turn */
interface TurnLike {
  id: string
  kind: string
}

/**
 * Map segment -> the turn id it should render **before**.
 *
 * Returns turnId -> segment. The separator belongs to the first **user** message of
 * that span, so it reads as "from this message on, the model was X".
 *
 * Two deliberate rules:
 *   - segments whose ordinal is beyond the rendered turns are dropped (a stale
 *     segment must not paint a separator out of nowhere at the bottom);
 *   - ordinals are counted over **user** turns only -- assistant/tool/approval turns
 *     share the user turn they belong to (the same counting the fork pager uses).
 */
export function segmentAnchors<T extends TurnLike>(
  turns: readonly T[],
  segments: readonly ModelSegment[],
): Map<string, ModelSegment> {
  const map = new Map<string, ModelSegment>()
  if (!segments.length) return map

  /**
   * 用户口径（2026-11-07）：**只有真的切换过模型**才画这条线。
   * 一条消息、一个模型也冒出一段「切换模型」是噪音。
   *
   * 两条收敛：
   *   - fromUser = 0 的那段是「开头用的模型」：它不是切换，不画；
   *   - 与上一段同模型的段（重复写入）折掉，不留空切换。
   */
  const sorted = [...segments].sort((a, b) => a.fromUser - b.fromUser)
  const changed: ModelSegment[] = []
  /** 上一段的模型（含被跳过的第 0 段）：同一模型连续重复 = 没有切换 */
  let prevModel = ''
  for (const seg of sorted) {
    const key = seg.provider + '/' + seg.modelId
    const same = key === prevModel
    prevModel = key
    if (seg.fromUser <= 0 || same) continue
    changed.push(seg)
  }
  if (!changed.length) return map

  const byOrdinal = new Map(changed.map((s) => [s.fromUser, s]))
  let ordinal = -1
  for (const t of turns) {
    if (t.kind !== 'user') continue
    ordinal += 1
    const seg = byOrdinal.get(ordinal)
    if (seg) map.set(t.id, seg)
  }
  return map
}
