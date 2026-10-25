/**
 * refTiles —— 参考区的**展示与校验**（纯函数，零 DOM、零 Vue）。
 *
 * 用户口径（2026-10-25）：
 *   ① 参考区只有**一行**（从前槽位与素材卡各画一排，重复了）；
 *   ② 上传会建参考节点并连线，连线归到用户点的那个序号；
 *   ③ 序号有缺（声明了「图片2」却没有图片1）时**不许发送**。
 */

/** 参考区里的一格：来源可能是正文槽位，也可能是已连素材 */
export interface RefTile {
  key: string
  slotKey?: string
  index: number
  label: string
  pending: boolean
  name: string
  url?: string
  isText: boolean
}

/** 合成依据：一个槽位（正文 @）或一条素材（连线）的最小形状 */
interface TileSlotLike {
  key: string
  kind: 'image' | 'video' | 'audio' | 'av'
  index: number
  status: 'pending' | 'ready'
  name?: string
  url?: string
}
interface TileCardLike {
  id: string
  name: string
  url?: string
  isText: boolean
}

/** 素材名（图片2）→ 槽位键 + 中文标签 */
export function refNameToSlot(refName: string): { key: string; index: number; label: string } | null {
  const m = /^(图片|视频|音频)(\d+)$/.exec(refName)
  if (!m) return null
  const kind = m[1] === '图片' ? 'image' : m[1] === '视频' ? 'video' : 'audio'
  return { key: kind + ':' + Number(m[2]), index: Number(m[2]), label: m[1] }
}

/**
 * 参考区**只排一行**（用户口径 2026-10-25：「它只有一行的输入，你这边重复了」）。
 *
 * 从前「待输入槽位」一排 + 「已连素材卡」一排，同一个参考出现两次。
 * 现在按参考序号合并成一串：槽位优先（用户点的就是它），没被槽位覆盖的素材补在后面。
 */
export function mergeRefTiles(
  slots: ReadonlyArray<TileSlotLike>,
  cards: ReadonlyArray<TileCardLike>,
): RefTile[] {
  const tiles: RefTile[] = []
  const used = new Set<string>()
  for (const slot of slots) {
    const card = cards.find((c) => refNameToSlot(c.name)?.key === slot.key)
    if (card) used.add(card.id)
    const label = slot.kind === 'image' ? '图片' : slot.kind === 'video' ? '视频' : slot.kind === 'audio' ? '音频' : '音视频'
    tiles.push({
      key: 'slot:' + slot.key,
      slotKey: slot.key,
      index: slot.index,
      label: label + ' ' + slot.index,
      pending: slot.status !== 'ready',
      name: slot.name || card?.name || label + ' ' + slot.index,
      url: slot.url || card?.url,
      isText: false,
    })
  }
  for (const card of cards) {
    if (used.has(card.id)) continue
    const parsed = refNameToSlot(card.name)
    tiles.push({
      key: 'card:' + card.id,
      index: parsed?.index ?? tiles.length + 1,
      label: parsed ? parsed.label : card.name,
      pending: false,
      name: card.name,
      url: card.url,
      isText: card.isText,
    })
  }
  return tiles.sort((a, b) => a.index - b.index)
}

/**
 * 参考序号缺格的判定（用户口径 2026-10-25：「只传了一张图，并且声明的是\"图片 2\"…
 * 是不允许你点击发送按钮的」）。
 *
 * 每种类型（图片/视频/音频）各自从 1 数到最大序号，缺任何一格就返回它。
 * 返回 null = 不缺，可以发送。
 */
export function findRefGap(
  slots: ReadonlyArray<{ kind: 'image' | 'video' | 'audio' | 'av'; index: number; status: 'pending' | 'ready' }>,
): { kind: 'image' | 'video' | 'audio' | 'av'; missing: number[] } | null {
  const byKind = new Map<string, Set<number>>()
  for (const s of slots) {
    if (s.status !== 'ready') continue
    const set = byKind.get(s.kind) ?? new Set<number>()
    set.add(s.index)
    byKind.set(s.kind, set)
  }
  for (const s of slots) {
    const have = byKind.get(s.kind) ?? new Set<number>()
    // 规则：声明到第 N 格（正文里有 @图片N），1..N 就必须全有内容。
    // 「没有内容」= 报给用户要补的那一格（pending 的也算，因为它确实空着）。
    const max = Math.max(s.index, ...have)
    const missing: number[] = []
    for (let i = 1; i <= max; i++) if (!have.has(i)) missing.push(i)
    if (missing.length) return { kind: s.kind, missing }
  }
  return null
}

import { placeRefAtSlot } from './panelSource'

/**
 * 上传一个文件到某个参考槽位（用户口径 2026-10-25：「点击上传时，这 4 个上传你需要
 * 添加一个参考节点然后进行连接，这样进行上传」）。
 *
 * 顺序是有讲究的，缺一步都会坏：
 *   ① 建节点并落资源（file-drop，返回建了几个）；
 *   ② **把选中还给原节点** —— file-drop 建完会选中新节点，底栏挂在原选中节点上，
 *      不还回去底栏当场消失；
 *   ③ 等一拍再连线（节点没进 VueFlow store 时边会被丢掉）；
 *   ④ 按槽位序号把新素材排到对应位置（第 2 格 = 图片2）。
 *
 * 抽成注入式而不是写在组件里：这几步顺序正是最容易回归的地方，单测直接钉住调用次序。
 */
export interface UploadDeps {
  /** 落资源 + 建节点，返回建了几个（0 = 没建成） */
  addFiles(files: File[], at: { x: number; y: number }): Promise<number>
  /** 等一帧（节点进 VueFlow store） */
  waitTick(): Promise<unknown>
  /** 建完之后、连线之前调（组件用它把选中还给原节点） */
  afterCreate(): void
  /** 连边，返回边 id（不该连时返回 null） */
  addEdge(source: string, target: string): string | null
  /** 当前参考顺序 */
  refOrder(): string[]
  /** 写回参考顺序 */
  writeOrder(ids: string[]): void
  /** 建完之后取新素材（id / name / url）；拿不到 → null */
  pickCreated(before: ReadonlySet<string>): { id: string; name: string; url?: string } | null
  /** 建节点用的落点 */
  positionFor(index: number): { x: number; y: number }
}

export interface UploadResult {
  ok: boolean
  /** 失败原因（给用户看的一句话） */
  error?: string
  /** 新素材（成功了才有） */
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
  const edge = deps.addEdge(created.id, input.targetId)
  if (edge === null) return { ok: false, error: '当前宿主没有连线能力' }
  deps.writeOrder(placeRefAtSlot(deps.refOrder(), input.kind, input.index, created.id))
  return { ok: true, created }
}

