/**
 * refTiles —— 参考区的**展示与校验**（纯函数，零 DOM、零 Vue）。
 *
 * 唯一事实源 = **连线顺序**（collectUpstreamMaterials 按边收、按 refOrder 排、按顺序编号）：
 * 「图片1」= 连线顺序里的第 1 张图。正文里的 @标签只是**指向**某个序号，不产生新的参考。
 *
 * 用户口径（2026-10-25 / 2026-10-26）：
 *   ① 参考区只有一行；连了 3 条线就只有 3 格（不能凭空多出第 4、5 格）；
 *   ② 声明了 @图片2 但只有第 1 格有内容 → 那一格**显示为待输入**，内容不该跑到「图片3」去；
 *   ③ 上传 = 建参考节点 + 连线，连线归到用户点的那个序号；
 *   ④ 序号有缺时**不许发送**。
 */

/** 参考区里的一格 */
export interface RefTile {
  /** 稳定键：slot:image:2（正文声明）或 card:<节点id>（没被正文声明的连线素材） */
  key: string
  slotKey?: string
  index: number
  label: string
  pending: boolean
  name: string
  url?: string
  isText: boolean
  /** 有内容格对应的素材（卡片删除/预览要拿它找连线）；待输入格没有 */
  card?: TileCardLike
}

/** 正文槽位（@ 标签）的最小形状 */
export interface TileSlotLike {
  kind: 'image' | 'video' | 'audio' | 'av'
  index: number
}

/** 一条连线素材的最小形状（name = 图片1 这种按连线顺序编的名字） */
export interface TileCardLike {
  id: string
  name: string
  url?: string
  isText: boolean
}

/** 连线顺序编号（图片1 / 音频2 …）：住 UpstreamMaterial 上，卡片沿用 */
interface WithRefName {
  refName?: string
}

/** 素材名（图片2）→ 序号与种类 */
export function refNameToSlot(refName: string): { index: number; kind: 'image' | 'video' | 'audio'; label: string } | null {
  const m = /^(图片|视频|音频)(\d+)$/.exec(refName)
  if (!m) return null
  const kind = m[1] === '图片' ? 'image' : m[1] === '视频' ? 'video' : 'audio'
  return { index: Number(m[2]), kind, label: m[1] }
}

/** refName（图片2）+ 槽位种类 → 槽位键（image:2）。对不上（种类不同）→ null */
export function refNameToSlotKey(refName: string, slotKind: 'image' | 'video' | 'audio' | 'av'): string | null {
  const parsed = refNameToSlot(refName)
  if (!parsed) return null
  if (slotKind !== 'av' && parsed.kind !== slotKind) return null
  return parsed.kind + ':' + parsed.index
}

/**
 * 参考区**只排一行**，格子身份 = **连线的序号**。
 *
 * 规则（用户口径 2026-10-26）：
 * - 格子数量 = max(连线素材数， 正文声明的最大序号) —— 连了 3 条就最多 3 格；
 * - 第 N 格有内容 ⇔ 连线素材里存在序号 N（正文声明 @图片N **不**产生内容）；
 * - 第 N 格没内容 → 虚线「待输入」；
 * - 连线素材多于声明数时，多出来的照常显示（序号继续往后编）。
 */
export function mergeRefTiles(
  slots: ReadonlyArray<TileSlotLike>,
  cards: ReadonlyArray<TileCardLike>,
): RefTile[] {
  // 序号 → 素材（连线顺序里第 N 张图 / 第 N 段音频…）
  const seqOf = (kind: 'image' | 'video' | 'audio'): Map<number, TileCardLike> => {
    const map = new Map<number, TileCardLike>()
    for (const c of cards) {
      const parsed = refNameToSlot((c as TileCardLike & WithRefName).refName || c.name)
      if (!parsed || parsed.kind !== kind) continue
      // 用 **refName 自带的序号**（图片8 就是第 8 格），不再按出现顺序递增 ——
      // 否则「第 8 格上传」的素材会被排到第 1/2 格（真机踩过）。
      if (!map.has(parsed.index)) map.set(parsed.index, c)
    }
    return map
  }

  // 出现在参考区的种类：素材自己的种类 + 正文声明的种类
  const kinds = new Set<'image' | 'video' | 'audio'>()
  for (const c of cards) {
    const p = refNameToSlot((c as TileCardLike & WithRefName).refName || c.name)
    if (p) kinds.add(p.kind)
  }
  for (const s of slots) {
    if (s.kind === 'image' || s.kind === 'video' || s.kind === 'audio') kinds.add(s.kind)
  }

  const tiles: RefTile[] = []
  // 每个种类独立排：图片1/图片2…、音频1/音频2…（与 collectUpstreamMaterials 的编号同口径）
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (!kinds.has(kind)) continue
    const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'
    const bySeq = seqOf(kind)
    const declared = slots.filter((s) => s.kind === kind).map((s) => s.index)
    const maxSeq = Math.max(0, ...bySeq.keys())
    const max = Math.max(maxSeq, ...(declared.length ? declared : [0]), 0)
    for (let index = 1; index <= max; index++) {
      const card = bySeq.get(index)
      tiles.push({
        key: card ? 'card:' + card.id : 'slot:' + kind + ':' + index,
        slotKey: card ? undefined : kind + ':' + index,
        index,
        label: label + ' ' + index,
        pending: !card,
        name: card?.name ?? (label + ' ' + index),
        url: card?.url,
        isText: false,
        card,
      })
    }
  }
  // 没有可识别名字的素材（比如文本）照常补在最后（参考区一直支持显示它们）
  for (const card of cards) {
    if (refNameToSlot((card as TileCardLike & WithRefName).refName || card.name)) continue
    tiles.push({
      key: 'card:' + card.id,
      index: tiles.length + 1,
      label: card.name,
      pending: false,
      name: card.name,
      url: card.url,
      isText: card.isText,
      card,
    })
  }
  /**
   * 显示顺序（用户口径 2026-10-26：卡片可以拖到任意位置，排序必须生效）：
   * - **有内容的格子**按 cards 的出现顺序排（cards 已按 refOrder/连线顺序排好）；
   * - **待输入格**排在它们后面（按序号升序）—— 用户拖的只是有内容的那些。
   *
   * 为什么不能只按 index 排：序号是「正文里的引用位置」（图片3），排序不会改它；
   * 若显示顺序也按它，用户拖完立刻被拉回原样（真机踩过：拖到最后又弹回去）。
   */
  const orderOf = new Map<string, number>()
  cards.forEach((c, i) => orderOf.set(c.id, i))
  return tiles.sort((a, b) => {
    const ac = a.card ? orderOf.get(a.card.id) : undefined
    const bc = b.card ? orderOf.get(b.card.id) : undefined
    if (ac !== undefined && bc !== undefined) return ac - bc
    if (ac !== undefined) return -1
    if (bc !== undefined) return 1
    return a.index - b.index
  })
}

/**
 * 参考序号缺格的判定（用户口径 2026-10-25：「只传了一张图，并且声明的是"图片 2"…
 * 是不允许你点击发送按钮的」）。
 *
 * 判定只看**连线素材**（有内容的格子）：声明了 @图片N 且 1..N-1 里存在没内容的格子 → 报缺。
 * 正文没写任何 @ 时不受影响（普通参考图照旧）。
 */
export function findRefGap(
  slots: ReadonlyArray<{ kind: 'image' | 'video' | 'audio' | 'av'; index: number }>,
  cards: ReadonlyArray<TileCardLike>,
): { kind: 'image' | 'video' | 'audio' | 'av'; missing: number[] } | null {
  // 每种类型已就绪的序号集合（来自连线素材的名字）
  const haveBy = (kind: 'image' | 'video' | 'audio'): Set<number> => {
    const set = new Set<number>()
    let seq = 0
    for (const c of cards) {
      const p = refNameToSlot((c as TileCardLike & WithRefName).refName || c.name)
      if (!p || p.kind !== kind) continue
      seq += 1
      set.add(seq)
    }
    return set
  }
  for (const s of slots) {
    if (s.kind === 'av') continue
    const have = haveBy(s.kind)
    const missing: number[] = []
    // 「声明了但还没内容」的那一格本身也算缺（不然用户会发一个空引用给模型）
    for (let i = 1; i <= s.index; i++) if (!have.has(i)) missing.push(i)
    if (missing.length) return { kind: s.kind, missing }
  }
  return null
}

import { placeRefAtSlot } from './panelSource'

/**
 * 上传一个文件到某个参考槽位（用户口径 2026-10-25：「点击上传时，这 4 个上传你需要
 * 添加一个参考节点然后进行连接，这样进行上传」）。
 *
 * 顺序缺一不可（单测钉死）：
 *   ① 建节点并落资源（file-drop）；
 *   ② **把选中还给原节点** —— file-drop 建完会选中新节点，底栏挂在原节点上；
 *   ③ 等一拍再连线（节点没进 VueFlow store 时边会被丢掉）；
 *   ④ 连线（doc.addEdge）；
 *   ⑤ 把新素材排到该槽位对应的连线序号（第 2 格 = 连线序列里的第 2 张）。
 */
export interface UploadDeps {
  addFiles(files: File[], at: { x: number; y: number }): Promise<number>
  waitTick(): Promise<unknown>
  afterCreate(): void
  addEdge(source: string, target: string): string | null
  refOrder(): string[]
  writeOrder(ids: string[]): void
  /** 建完之后取新节点（id / name / url）；拿不到 → null */
  pickCreated(before: ReadonlySet<string>): { id: string; name: string; url?: string } | null
  positionFor(index: number): { x: number; y: number }
}

export interface UploadResult {
  ok: boolean
  error?: string
  created?: { id: string; name: string; url?: string }
}

export async function uploadToRefSlot(
  input: { file: File; kind: 'image' | 'video' | 'audio' | 'av'; index: number; targetId: string },
  deps: UploadDeps,
): Promise<UploadResult> {
  const before = new Set(deps.refOrder())
  const count = await deps.addFiles([input.file], deps.positionFor(input.index))
  if (!count) return { ok: false, error: '这个文件没建出节点（类型不支持？）' }
  // ② 先把选中还回去（必须早于连线：底栏一旦卸载，后面的状态就没人接了）
  deps.afterCreate()
  await deps.waitTick()
  const created = deps.pickCreated(before)
  if (!created) return { ok: false, error: '节点建好了但还没连上线，请稍后再试' }
  // ④ 连线（真实流程；上一次实现里这里少了，导致只建节点没连线）
  const edge = deps.addEdge(created.id, input.targetId)
  if (edge === null) return { ok: false, error: '当前宿主没有连线能力' }
  deps.writeOrder(placeRefAtSlot(deps.refOrder(), input.kind, input.index, created.id))
  return { ok: true, created }
}

