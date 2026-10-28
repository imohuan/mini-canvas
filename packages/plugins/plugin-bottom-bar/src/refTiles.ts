/**
 * refTiles —— 参考区卡片行的**展示与校验**（纯函数，零 DOM、零 Vue）。
 *
 * 用户口径（2026-10-28 定案）：
 *
 *   - 一张卡片 = 正文里的一颗标签（`ref-node:<id>` 已绑定 / `ref-name:<名>` 待绑定）；
 *   - 已绑定卡片显示节点**名称**与真实类型图标，顺序由 `refOrder` 决定；
 *   - 待绑定卡片（空壳）显示名称 + 「待添加」，拖入节点即**添加**；
 *   - 有内容的卡片拖入节点即**替换**（换绑，标签名跟着新节点走）；
 *   - 序号角标只用来观察当前顺序，不参与任何判定（用户 2026-10-28 明确要求保留）；
 *   - 绑定失效（节点被删 / 连线断开 / 老格式）→ 卡片与标签显示失效，**禁止发送**。
 */

import { refNodeChipId, refNameChipId, nodeIdOfChip, nameOfChip, type RefChip } from './refSlots'

/** 参考区里的一张卡片 */
export interface RefTile {
  /** 稳定键 = 标签 id（ref-node:<id> / ref-name:<名> / ref-slot:*） */
  key: string
  /** 显示序号：只做观察，不参与判定（1..n） */
  index: number
  /** 卡片上显示的名称（已绑定 = 节点名称；待绑定 = 手打名称） */
  label: string
  /** 是否待绑定（空壳）：拖入即「添加」 */
  pending: boolean
  /** 是否失效：绑定的节点已经不在了 */
  invalid: boolean
  /** 绑定的节点 id（待绑定 / 失效 → null） */
  nodeId: string | null
  /** 节点真实类型（待绑定 / 失效 → null：统一资源图标） */
  kind: 'image' | 'video' | 'audio' | 'text' | null
  url?: string
  value?: string
  /** 视频帧图（mp4 不能直接当 <img>） */
  thumb?: string
}

/** 一条连线素材（= 已绑定到本节点的上游节点） */
export interface TileCardLike {
  id: string
  /** 节点名称（画布内唯一） */
  name: string
  kind: 'image' | 'video' | 'audio' | 'text'
  url?: string
  value?: string
}

/**
 * 把「正文标签」与「连线素材」合成卡片行。
 *
 * 规则（单一事实源，不要再在组件里另算一套）：
 * 1. **连线素材**决定哪些节点能绑定：标签指向的节点必须在素材里，否则算失效；
 * 2. 卡片顺序 = `displayOrder`（用户拖出来的标签 id 序列）→ 没列到的按正文出现顺序垫后；
 * 3. 有连线的节点如果没有对应标签，也补一张卡（参考区一直支持「连了就有卡」）；
 * 4. 待绑定标签（`ref-name:`）永远显示成空壳；
 * 5. 老格式标签（`ref-slot:`）显示失效，不猜它原来指向谁（用户拍板不兼容）。
 */
export function mergeRefTiles(
  chips: ReadonlyArray<RefChip>,
  cards: ReadonlyArray<TileCardLike>,
  /** 用户拖出来的完整顺序（标签 id 序列）。空 = 按正文顺序 */
  displayOrder?: readonly string[],
): RefTile[] {
  const byNodeId = new Map<string, TileCardLike>()
  for (const c of cards) if (!byNodeId.has(c.id)) byNodeId.set(c.id, c)

  const tiles: RefTile[] = []
  const usedCards = new Set<string>()
  const seenKeys = new Set<string>()

  for (const chip of chips) {
    if (seenKeys.has(chip.id)) continue
    seenKeys.add(chip.id)
    if (chip.legacy) {
      tiles.push({
        key: chip.id,
        index: 0,
        label: chip.name || '失效引用',
        pending: false,
        invalid: true,
        nodeId: null,
        kind: null,
      })
      continue
    }
    const nodeId = chip.nodeId
    if (!nodeId) {
      // 待绑定：统一资源图标，拖入即添加
      tiles.push({
        key: chip.id,
        index: 0,
        label: chip.pendingName || chip.name || '未命名',
        pending: true,
        invalid: false,
        nodeId: null,
        kind: null,
      })
      continue
    }
    const card = byNodeId.get(nodeId)
    if (!card) {
      // 绑定的节点不在连线里（被删 / 被断开）→ 失效，禁止发送
      tiles.push({
        key: chip.id,
        index: 0,
        label: chip.name || '失效引用',
        pending: false,
        invalid: true,
        nodeId,
        kind: null,
      })
      continue
    }
    usedCards.add(nodeId)
    tiles.push({
      key: chip.id,
      index: 0,
      // 名称永远以节点为准（标签只是指向它）——用户 2026-10-28：替换后名字要跟着换
      label: card.name,
      pending: false,
      invalid: false,
      nodeId,
      kind: card.kind,
      url: card.url,
      value: card.value,
    })
  }

  // 连了线但正文没写标签：也补一张卡（参考区不吞素材）
  for (const card of cards) {
    if (usedCards.has(card.id)) continue
    const key = refNodeChipId(card.id)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    tiles.push({
      key,
      index: 0,
      label: card.name,
      pending: false,
      invalid: false,
      nodeId: card.id,
      kind: card.kind,
      url: card.url,
      value: card.value,
    })
  }

  // 顺序：用户拖出来的序列优先；没列到的保持生成顺序
  const orderOf = new Map<string, number>()
  if (displayOrder && displayOrder.length > 0) {
    displayOrder.forEach((key, i) => {
      if (!key) return
      if (!orderOf.has(key)) orderOf.set(key, i)
    })
  }
  const ranked = tiles
    .map((tile, i) => ({ tile, i }))
    .sort((a, b) => {
      const ao = orderOf.get(a.tile.key)
      const bo = orderOf.get(b.tile.key)
      if (ao !== undefined && bo !== undefined) return ao - bo
      if (ao !== undefined) return -1
      if (bo !== undefined) return 1
      return a.i - b.i
    })
    .map((e) => e.tile)

  // 序号 = 显示位置（只做观察）
  return ranked.map((t, i) => ({ ...t, index: i + 1 }))
}

/**
 * 能不能发送：任何失效引用都拦住（用户 2026-10-28：失效标签禁止发送，不做兼容）。
 *
 * 待绑定卡片不算失效 —— 它是「还没拖东西进来」的正常状态，发送时按提示处理。
 */
export function invalidRefTiles(tiles: ReadonlyArray<RefTile>): RefTile[] {
  return tiles.filter((t) => t.invalid)
}

/** 失效引用的提示文案（给发送按钮旁的警告用） */
export function invalidRefHint(tiles: ReadonlyArray<RefTile>): string {
  const bad = invalidRefTiles(tiles)
  if (bad.length === 0) return ''
  const names = bad.slice(0, 3).map((t) => '「' + t.label + '」').join('、')
  const more = bad.length > 3 ? ' 等 ' + bad.length + ' 个' : ''
  return '有引用已失效：' + names + more + '，删掉或重新拖入后才能发送'
}

/**
 * 「标记」匹配：正文里的 `@名称` → 已连线素材。
 *
 * 名称画布内唯一（用户 2026-10-28 定案），所以按名字查只会命中一个；
 * 名称里可能有空格，优先匹配最长的那个（「天空之城」不会被「天空」抢走）。
 *
 * @returns 命中的素材（没命中 → null，调用方转成待绑定标签）
 */
export function matchMaterialByName(
  name: string,
  cards: ReadonlyArray<TileCardLike>,
): TileCardLike | null {
  const want = String(name ?? '').trim()
  if (!want) return null
  return cards.find((c) => c.name.trim() === want) ?? null
}

/** 卡片拖拽排序后要落盘的标签 id 序列（去掉重复与空值） */
export function nextChipOrder(
  current: readonly string[],
  currentTiles: ReadonlyArray<{ key: string }>,
  dragged?: ReadonlyArray<{ key?: string }>,
): string[] | null {
  const list = Array.isArray(dragged) && dragged.length === currentTiles.length ? dragged : currentTiles
  const ids = list.map((t) => String(t.key ?? '')).filter(Boolean)
  if (ids.length === 0) return null
  if (ids.length === current.length && ids.every((id, i) => id === current[i])) return null
  return ids
}

/** 参考格键（给上传/替换定位用）：已绑定 = 节点 id，待绑定 = 名称 */
export interface RefTarget {
  /** 要替换的旧标签 id（没有 = 添加） */
  previousChipId?: string
  /** 目标节点 id（替换时用来断开旧连线） */
  oldNodeId?: string
  /** 待绑定名称（空壳卡片的名称，替换成功后不再使用） */
  pendingName?: string
}

/** 从卡片推出替换目标 */
export function targetOfTile(tile: RefTile): RefTarget {
  if (tile.pending) {
    return { previousChipId: tile.key, pendingName: nameOfChip(tile.key) ?? tile.label }
  }
  return {
    previousChipId: tile.key,
    oldNodeId: tile.nodeId ?? nodeIdOfChip(tile.key) ?? undefined,
  }
}

/** 待绑定标签的 id（空壳卡片「添加」成功后，正文里那颗标签要换成 ref-node:<id>） */
export function boundChipIdOf(nodeId: string): string {
  return refNodeChipId(nodeId)
}

/** 待绑定名称 → 标签 id */
export function pendingChipIdOf(name: string): string {
  return refNameChipId(name)
}

/**
 * 文件名 → 节点名称（用户 2026-10-28：新素材用真实文件名当名字，别再叫「图片 3」）。
 *
 * 去掉扩展名（「天空之城.png」→「天空之城」）：标签上显示扩展名既占地方又没信息量。
 * 去掉后为空（例如只有 .gitignore）→ 原样保留。
 */
export function nameFromFileName(fileName: string | null | undefined): string {
  const base = String(fileName ?? '').trim()
  if (!base) return '素材'
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot).trim() : base
  return stem || base
}

/**
 * 画布内名称唯一（用户 2026-10-28：节点名称不允许重复）。
 *
 * 撞名时追加「 2」「 3」……（与画布自动命名的形态一致）；名字本身带序号就从那个号往上找。
 */
export function uniqueNodeName(base: string, taken: Iterable<string>): string {
  const want = String(base ?? '').trim()
  if (!want) return '素材'
  const used = new Set<string>()
  for (const t of taken) {
    const s = String(t ?? '').trim()
    if (s) used.add(s)
  }
  if (!used.has(want)) return want
  const m = /^(.*?\D)?\s*(\d+)$/.exec(want)
  const stem = m && m[1] !== undefined && m[1].trim() ? m[1].trim() : m ? '' : want
  let n = m ? Number.parseInt(m[2], 10) + 1 : 2
  if (!Number.isFinite(n) || n < 2) n = 2
  for (; n < 100000; n++) {
    const cand = stem ? stem + ' ' + n : String(n)
    if (!used.has(cand)) return cand
  }
  return want + ' ' + Date.now()
}

/**
 * 上传一个文件到某张卡片（用户口径 2026-10-25 / 2026-10-28）：
 * 「点击上传时，这 4 个上传你需要添加一个参考节点然后进行连接，这样进行上传」。
 *
 * 顺序缺一不可（单测钉死）：
 *   ① 建节点并落资源（file-drop）；
 *   ② **把选中还给原节点** —— file-drop 建完会选中新节点，底栏挂在原节点上；
 *   ③ 等一拍再连线（节点没进 VueFlow store 时边会被丢掉）；
 *   ④ 连线（doc.addEdge）；
 *   ⑤ 调用方把正文里那颗标签换成 `ref-node:<新节点id>`（添加 / 替换同一条路）。
 */
export interface UploadDeps {
  addFiles(files: File[], at: { x: number; y: number }): Promise<number>
  waitTick(): Promise<unknown>
  afterCreate(): void
  addEdge(source: string, target: string): string | null
  /** 建完之后取新节点（id / name / url）；拿不到 → null */
  pickCreated(): { id: string; name: string; url?: string } | null
  /** 新节点的落点（卡片位置只影响摆放，不影响身份） */
  positionFor(): { x: number; y: number }
}

export interface UploadResult {
  ok: boolean
  error?: string
  created?: { id: string; name: string; url?: string }
}

export async function uploadToRefSlot(
  input: { file: File; targetId: string },
  deps: UploadDeps,
): Promise<UploadResult> {
  const count = await deps.addFiles([input.file], deps.positionFor())
  if (!count) return { ok: false, error: '这个文件没建出节点（类型不支持？）' }
  // ② 先把选中还回去（必须早于连线：底栏一旦卸载，后面的状态就没人接了）
  deps.afterCreate()
  await deps.waitTick()
  const created = deps.pickCreated()
  if (!created) return { ok: false, error: '节点建好了但还没连上线，请稍后再试' }
  // ④ 连线（真实流程；少了这一步就只建节点、不连线）
  const edge = deps.addEdge(created.id, input.targetId)
  if (edge === null) return { ok: false, error: '当前宿主没有连线能力' }
  return { ok: true, created }
}
