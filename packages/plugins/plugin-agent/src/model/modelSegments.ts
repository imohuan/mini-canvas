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
  const byOrdinal = new Map(segments.map((s) => [s.fromUser, s]))
  let ordinal = -1
  for (const t of turns) {
    if (t.kind !== 'user') continue
    ordinal += 1
    const seg = byOrdinal.get(ordinal)
    if (seg) map.set(t.id, seg)
  }
  return map
}
