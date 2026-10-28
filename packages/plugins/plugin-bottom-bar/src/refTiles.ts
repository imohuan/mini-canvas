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
  /** 资源类型（用户 2026-10-28：卡片空态要按类型出图标） */
  kind: 'image' | 'video' | 'audio' | 'text'
  /** 有内容格对应的素材（卡片删除/预览要拿它找连线）；待输入格没有 */
  card?: TileCardLike
  /**
   * 正文里的**槽位序号**（标签名中的序号）。
   *
   * 与 index 的区别（用户 2026-10-27 口径）：
   * - slotIndex 是「这条引用指向第几张」，拖拽**不会**改变它；
   * - index 是「显示在第几格」，排序后按位置重编。
   * 上传、报错、拼 ref-slot:kind:N 一律用 slotIndex，否则拖拽后点第 2 格会写到第 4 号去。
   */
  slotIndex: number
}

/** 正文槽位（@ 标签）的最小形状 */
export interface TileSlotLike {
  kind: 'image' | 'video' | 'audio' | 'av' | 'text'
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
export function refNameToSlot(refName: string): { index: number; kind: 'image' | 'video' | 'audio' | 'text'; label: string } | null {
  const m = /^(图片|视频|音频|文本)(\d+)$/.exec(refName)
  if (!m) return null
  const kind = m[1] === '图片' ? 'image' : m[1] === '视频' ? 'video' : m[1] === '音频' ? 'audio' : 'text'
  return { index: Number(m[2]), kind, label: m[1] }
}

/** refName（图片2）+ 槽位种类 → 槽位键（image:2）。对不上（种类不同）→ null */
export function refNameToSlotKey(refName: string, slotKind: 'image' | 'video' | 'audio' | 'text' | 'av'): string | null {
  const parsed = refNameToSlot(refName)
  if (!parsed) return null
  if (slotKind !== 'av' && parsed.kind !== slotKind) return null
  return parsed.kind + ':' + parsed.index
}

/**
 * 参考区**只排一行**，格子身份 = **连线的序号**。
 *
 * 规则（用户口径 2026-10-27，替换掉旧的「补齐到最大声明序号」）：
 * - 格子数量 = max(该类型连线数, 该类型声明数)。声明序号已由 normalizeRefSlots 归一化成 1..n，
 *   所以**不会**因为写了 `@图片44` 就铺出 44 格；
 * - 第 N 格有内容 ⇔ 连线素材里存在序号 N（正文声明 @图片N **不**产生内容）；
 * - 第 N 格没内容 → 虚线「待输入」；
 * - slotIndex = 正文序号（拖拽不变）；index = 显示位（排序后重编）。
 */
export function mergeRefTiles(
  slots: ReadonlyArray<TileSlotLike>,
  cards: ReadonlyArray<TileCardLike>,
  /** 用户拖出来的完整顺序（card:N 与 slot:kind:n 混排）。空 = 无自定义顺序 */
  displayOrder?: readonly string[],
): RefTile[] {
  // 序号 → 素材（连线顺序里第 N 张图 / 第 N 段音频…）
  const seqOf = (kind: 'image' | 'video' | 'audio' | 'text'): Map<number, TileCardLike> => {
    const map = new Map<number, TileCardLike>()
    for (const c of cards) {
      const withRef = c as TileCardLike & WithRefName
      // 优先 refName；没有时**只接受严格 `图片N` 形式**的 name（无空格）。
      // node 标题常是「图片 54」（带空格）或任意文案，解析成序号会错位
      //（用户 2026-10-28 报：格 1 空着却显示缩略图、正文图片1 反而不显示）。
      const parsed = refNameToSlot(withRef.refName || '') ?? refNameToSlot(String(c.name ?? '').trim())
      if (!parsed || parsed.kind !== kind) continue
      if (!map.has(parsed.index)) map.set(parsed.index, c)
    }
    return map
  }

  // 出现在参考区的种类：素材自己的种类 + 正文声明的种类
  const kinds = new Set<'image' | 'video' | 'audio' | 'text'>()
  for (const c of cards) {
    const withRef = c as TileCardLike & WithRefName
    const p = refNameToSlot(withRef.refName || '') ?? refNameToSlot(String(c.name ?? '').trim())
    if (p) kinds.add(p.kind)
  }
  for (const s of slots) {
    if (s.kind === 'image' || s.kind === 'video' || s.kind === 'audio' || s.kind === 'text') kinds.add(s.kind)
  }

  const tiles: RefTile[] = []
  // 每个种类独立排：图片1/图片2…、音频1/音频2…（与 collectUpstreamMaterials 的编号同口径）
  for (const kind of ['image', 'video', 'audio', 'text'] as const) {
    if (!kinds.has(kind)) continue
    const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文本'
    const bySeq = seqOf(kind)
    const declared = slots.filter((s) => s.kind === kind).map((s) => s.index)
    /**
     * 格数 = max(连线数, 声明数)（用户 2026-10-27 口径）。
     *
     * 为什么不再补齐 1..最大声明序号：正文里写了 `@图片44` 时，旧规则会把 1..44 全部铺满，
     * 界面上凭空长出一堆空格（用户截图：4 张图却出现 44 格）。
     * 归一化之后声明序号本来就是 1..n，这里只按数量取 max 即可。
     */
    /**
     * 格数 = max(最大序号, 声明数)（用户 2026-10-28 修错位）。
     *
     * 为什么不是 max(卡片数量, 声明数)：卡片带的序号可能不连续（hint 让某张图占第 2 格），
     * 按「数量」算格数会把序号 2 的卡片挤出格子外，掉进「无序号尾巴」分支 —— 表现就是
     * 「第 1 格是空壳、那张有图的卡跑到最后」（用户截图）。
     * 按**最大序号**算才能保证每张卡都在自己的位置上。
     */
    const maxCardIndex = bySeq.size ? Math.max(...bySeq.keys()) : 0
    const declaredCount = new Set(declared).size
    const total = Math.max(maxCardIndex, declaredCount)
    for (let slotIndex = 1; slotIndex <= total; slotIndex++) {
      const card = bySeq.get(slotIndex)
      tiles.push({
        key: card ? 'card:' + card.id : 'slot:' + kind + ':' + slotIndex,
        slotKey: card ? undefined : kind + ':' + slotIndex,
        slotIndex,
        index: slotIndex, // 临时值，排序后按显示位重编
        label: label + ' ' + slotIndex,
        pending: !card,
        name: card?.name ?? (label + ' ' + slotIndex),
        url: card?.url,
        isText: kind === 'text',
        kind,
        card,
      })
    }
  }
  // 没有可识别名字的素材（比如文本）照常补在最后（参考区一直支持显示它们）
  for (const card of cards) {
    if (refNameToSlot((card as TileCardLike & WithRefName).refName || '') ?? refNameToSlot(String(card.name ?? '').trim())) continue
    tiles.push({
      key: 'card:' + card.id,
      // 文本这类没有序号的素材：slotIndex 用 0 表示「没有槽位序号」，
      // 它们不参与 @图片N 引用，也不参与上传排位。
      slotIndex: 0,
      index: tiles.length + 1,
      label: card.name,
      pending: false,
      name: card.name,
      url: card.url,
      isText: card.isText,
      kind: card.isText ? 'text' : 'image',
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
  // 优先用 displayOrder（用户拖出来的完整序列）；没有时按 cards 出现顺序
  if (displayOrder && displayOrder.length > 0) {
    displayOrder.forEach((key, i) => {
      orderOf.set(key, i)
      // 兼容带前缀的键（card:N）
      if (key.startsWith('card:')) orderOf.set(key.slice(5), i)
      // 兼容不带前缀的键（refOrder 落盘时 card: 已剥掉）—— tiles 的 key 是 card:N
      else orderOf.set('card:' + key, i)
    })
  } else {
    /**
     * 没拖过（无 displayOrder）→ **按 slotIndex 排**（用户 2026-10-28 修错位）。
     *
     * 旧实现按 cards 数组顺序排，于是「hint 让它占第 2 格」的卡片被硬拉到第 1 位，
     * 正文「图片1」指向的那一格反而是空壳（用户截图：格 1 空着却显示缩略图）。
     * 有 displayOrder 时仍以用户拖出来的顺序为准（拖拽优先，那条不能破）。
     */
    ;(() => {
      /**
       * 按 **类型 + 序号** 排名（用户 2026-10-28 修错位）。
       *
       * 只按 slotIndex 全局排会跨类型交错（图片1、视频1、音频1 都从 1 开始）；
       * 期望是「图片类整体在前、按图片序号排，然后视频、音频」，与 tiles 生成顺序一致。
       * 无序号（文本等）排最后。
       */
      const kindOrder: Record<string, number> = { image: 0, video: 1, audio: 2, text: 3 }
      const kindOf = (key: string): string => (key.startsWith('slot:') ? key.split(':')[1] : 'image')
      const ranked = [...tiles].sort((a, b) => {
        const ka = kindOf(a.key)
        const kb = kindOf(b.key)
        const da = kindOrder[ka] ?? 9
        const db = kindOrder[kb] ?? 9
        if (da !== db) return da - db
        return (a.slotIndex || 9999) - (b.slotIndex || 9999)
      })
      ranked.forEach((t, i) => orderOf.set(t.key, i))
    })()
  }
  const sorted = tiles.sort((a, b) => {
    const ao = orderOf.get(a.key)
    const bo = orderOf.get(b.key)
    // 都在用户序列里 → 按用户顺序；都不在 → 按序号；一有一无 → 在序列的排前面
    if (ao !== undefined && bo !== undefined) return ao - bo
    if (ao !== undefined) return -1
    if (bo !== undefined) return 1
    return a.index - b.index
  })
  /**
   * 显示序号 = 显示位置（用户口径 2026-10-26）：排完序后从 1 重编。
   * 这样拖到哪就是第几格，索引永远 1,2,3…（之前拖完索引留在原素材上 → 3,2,1 的错乱）。
   * 正文 @图片N 的解析按「第 N 个 chip 的名字」匹配 —— 与此处的 index 无关。
   */
  return sorted.map((t, i) => ({ ...t, index: i + 1 }))
}

/**
 * 参考序号缺格的判定（用户口径 2026-10-25：「只传了一张图，并且声明的是"图片 2"…
 * 是不允许你点击发送按钮的」）。
 *
 * 判定只看**连线素材**（有内容的格子）：声明了 @图片N 且 1..N-1 里存在没内容的格子 → 报缺。
 * 正文没写任何 @ 时不受影响（普通参考图照旧）。
 */
export function findRefGap(
  slots: ReadonlyArray<{ kind: 'image' | 'video' | 'audio' | 'text' | 'av'; index: number }>,
  cards: ReadonlyArray<TileCardLike>,
): { kind: 'image' | 'video' | 'audio' | 'text' | 'av'; missing: number[] } | null {
    // 每种类型已就绪的序号集合（来自连线素材的真实序号）
    const haveBy = (kind: 'image' | 'video' | 'audio' | 'text'): Set<number> => {
      const set = new Set<number>()
      for (const c of cards) {
        const p = refNameToSlot((c as TileCardLike & WithRefName).refName || c.name)
        if (!p || p.kind !== kind) continue
        // 用 **refName 自带的序号**：以前是 seq += 1 按出现顺序数，
        // 于是「图片2 + 图片4」会被当成第 1、2 格，缺号判断整体错位（真机踩过）。
        set.add(p.index)
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
  input: { file: File; kind: 'image' | 'video' | 'audio' | 'text' | 'av'; index: number; targetId: string },
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

