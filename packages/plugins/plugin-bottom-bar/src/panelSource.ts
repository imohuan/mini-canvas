/**
 * panelSource —— 底栏「生成面板」的纯逻辑（零 DOM/零 Vue，node 可单测）。
 *
 * 面板要干三件事，全都只是「把画布上的东西翻译成工具能吃的形状」：
 * 1. 找上游素材：谁连进来了（图的 url / 文本的内容）→ 素材行 + @ 引用候选用它；
 * 2. 选工具、算参数：能产出的工具（ctx.tools.list）→ 模型下拉；工具自己声明的 params → 参数下拉；
 * 3. 组装请求：把用户写的 prompt + 素材 + 参数拼成一次 invoke 的输入。
 *
 * 放在组件外面是因为这三件事都不需要浏览器：放在这里能直接用普通数组断言，
 * 而组件只管渲染与交互（「算得对不对」与「画得对不对」分开，出问题时能立刻定位是哪一层）。
 */
import { resolveToolParams, resolveToolTemplates, type ToolDef, type ToolInput, type ToolResource, type ToolResourceKind } from '@mini-canvas/kernel'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import type { TagMatch, TagSpec } from 'prosemirror-editor-bundle'
import { h } from 'vue'
import { refNodeChipId, refNameChipId, normalizeRefName } from './refSlots'

/** 一条连进本节点的上游素材（面板素材行 / @ 引用 / 生成输入 共用同一份） */
export interface UpstreamMaterial {
  /** 上游节点 id：@ 引用与请求组装里的稳定身份 */
  id: string
  kind: ToolResourceKind
  /** 显示名（节点标题优先，回退文件名/默认名） */
  name: string
  /**
   * 引用名 = **节点名称**（用户 2026-10-28 定案：名称画布内唯一，直接拿来当显示名）。
   *
   * 不再有「图片1 / 音频2」这种按顺序编出来的名字：序号会随排序与增删变化，
   * 标签追着序号跑必然错位。名称是节点自己的属性，改名、排序、替换都跟得住。
   */
  refName: string
  /** 图片/视频类素材的地址 */
  url?: string
  /**
   * 持久资源引用（节点 data.resourceId）。
   *
   * 新节点只写这个字段；显示地址由调用方按当前环境 resolve 后补进 url。
   * 只认 url 会把「只有 resourceId 的图片/视频/音频」当成空素材。
   */
  resourceId?: string
  /** 文本类素材的内容 */
  value?: string
  /**
   * 视频时长（秒）。来自节点 data.videoDuration；图片/音频/文本没有。
   * 用户 2026-10-29：视频卡片右下角要显示「分:秒」，超过 60 秒要醒目提醒。
   */
  duration?: number
}

/** 上游节点在判断素材时用到的字段（只读，避免把整个内核节点类型拖进来） */
export interface UpstreamNodeLike {
  type?: string
  data?: Record<string, unknown>
}

/** 取字段里的非空字符串（不是字符串/空串都当作没有） */
function nonEmptyString(v: unknown): string {
  return typeof v === 'string' && v.trim() !== '' ? v : ''
}

/**
 * 从画布边里收集「连进本节点的上游素材」。
 *
 * 上移说明：原为 plugin-node-image/src/panelSource.ts（image 专用），textPanelSource 的
 * 文本侧校验（validateGenInput）已按「所有类型」泛化并入本文件。
 * 与 3D 预览的 textureSource 同思路（纯函数、不碰 Vue），但这里不只找图片：
 * 文本节点也收（文生图要把文字喂给模型），视频/音频同样不丢（面板要如实显示连了什么）。
 * 判定顺序 = 有图先用图，否则有视频算视频，否则 type==='text' 算文本 —— 与 v1 useUpstreamResources 一致。
 *
 * @param edges    画布的边（至少含 source/target）
 * @param targetId 本节点 id
 * @param getNode  按 id 取上游节点（渲染层用 renderNodes 查表）
 * @param refOrder 用户拖出来的素材顺序（节点 id 序列，可选）。见 resolveMaterialOrder。
 */
export function collectUpstreamMaterials(
  edges: ReadonlyArray<{ source: string; target: string }>,
  targetId: string,
  getNode: (nodeId: string) => UpstreamNodeLike | undefined,
  refOrder?: readonly string[],
): UpstreamMaterial[] {
  const out: UpstreamMaterial[] = []
  // 同一个上游节点可能有多条边连过来（重复连），只算一次：素材行不该出现两张一样的卡片
  const seen = new Set<string>()

  for (const edge of edges) {
    if (edge.target !== targetId) continue
    if (seen.has(edge.source)) continue

    const node = getNode(edge.source)
    const data = node?.data
    if (!data) continue
    const label = nonEmptyString(data.label)

    const imageUrl = nonEmptyString(data.imageUrl) || nonEmptyString(data.panoUrl)
    if (imageUrl) {
      seen.add(edge.source)
      out.push({
        id: edge.source,
        kind: 'image',
        name: label || nonEmptyString(data.imageName) || '图片素材',
        // refName 在排完序之后统一取节点名称（见 nameRefNames）
        refName: '',
        url: imageUrl,
      })
      continue
    }

    const videoUrl = nonEmptyString(data.videoUrl)
    if (videoUrl) {
      seen.add(edge.source)
      out.push({
        id: edge.source,
        kind: 'video',
        name: label || nonEmptyString(data.videoName) || '视频',
        refName: '',
        url: videoUrl,
        ...(Number.isFinite(Number(data.videoDuration)) && Number(data.videoDuration) > 0
          ? { duration: Number(data.videoDuration) }
          : {}),
      })
      continue
    }

    // 音频节点：素材行要如实显示连了什么（用户要求音频也能预览，不能默默丢掉）
    const audioUrl = nonEmptyString(data.audioUrl)
    if (audioUrl) {
      seen.add(edge.source)
      out.push({
        id: edge.source,
        kind: 'audio',
        name: label || nonEmptyString(data.audioName) || '音频',
        refName: '',
        url: audioUrl,
      })
      continue
    }

    // 只有持久引用（新节点的标准形态）：类型由节点自己声明，这里按已知媒体类型认。
    // 地址不在这里猜 —— 调用方拿到 resourceId 后交给资源服务 resolve。
    const resourceId = nonEmptyString(data.resourceId)
    if (resourceId) {
      const kind: ToolResourceKind | '' =
        node?.type === 'video' ? 'video' : node?.type === 'audio' ? 'audio' : node?.type === 'image' ? 'image' : ''
      if (kind) {
        seen.add(edge.source)
        out.push({
          id: edge.source,
          kind,
          name: label || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片素材'),
          refName: '',
          resourceId,
        })
        continue
      }
    }

    // 文本：**按字段名认，与图片/视频/音频同一条规矩**（2026-10-13 统一）。
    //
    // 以前这里额外要求 `node.type === 'text'` —— 于是可视化节点（type='ui'）用
    // `ctx.save('正文', 'note.txt')` / `CanvasUI.save(正文, 'note.txt')` 交出来的文本
    // 下游**收不到**，而它交的图 / 视频 / 音频（走上面三条）却收得到。
    // 同一个节点的产物一半能连、一半连不上，是纯粹的坑。
    //
    // 文本节点仍走这条（它的 data.text 就是正文），内容为空也收 ——
    // 用户常是「先连上、再写内容」，@ 时先用名字占位。
    if (node?.type === 'text' || typeof data.text === 'string') {
      seen.add(edge.source)
      out.push({
        id: edge.source,
        kind: 'text',
        name: label || '文本',
        refName: '',
        value: typeof data.text === 'string' ? data.text : '',
      })
    }
    // 空媒体节点（图片/视频/音频但 url、resourceId 都还没有）也要收下（用户 2026-10-28 报：
    // 连了一个空视频节点，参考区出现一格「空白卡片」、正文标签缩略图空白）。
    // 为什么不能跳过：用户「先连线、后上传」是正常流程，连上就该占一个格子；
    // 跳过它会导致 displayOrder 里有它、tiles 里没有 → 后面格子的序号错位，
    // 且正文引用它的标签拿不到任何 item，缩略图渲染成空白。
    // 这里收下时 url 留空，卡片显示「待输入」样式，标签显示默认图标。
    if (node && ['image', 'video', 'audio'].includes(node.type ?? '')) {
      const kind: ToolResourceKind = node.type as ToolResourceKind
      seen.add(edge.source)
      out.push({
        id: edge.source,
        kind,
        name: label || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'),
        refName: '',
      })
      continue
    }
  }

  // 顺序由 refOrder 决定；引用名一律取节点名称（用户 2026-10-28：不再按顺序编号）
  return nameRefNames(resolveMaterialOrder(out, refOrder))
}

/**
 * 把只有 resourceId 的素材解析成当前可显示地址。
 *
 * - 已经有 url 的（旧存档 / 外部地址）原样保留，不重复请求；
 * - 没有资源服务、解析失败或解析结果为空 → 保留原素材（url 仍为空），
 *   不能因此把素材丢掉 —— 用户至少还能看到卡片名与引用名；
 * - 顺序与身份不变，解析只补 url 一个字段。
 */
export async function resolveMaterialUrls(
  materials: ReadonlyArray<UpstreamMaterial>,
  resolve: ((ref: string) => Promise<string | undefined>) | undefined,
): Promise<UpstreamMaterial[]> {
  if (typeof resolve !== 'function') return [...materials]
  return Promise.all(
    materials.map(async (m) => {
      if (m.url || !m.resourceId) return m
      try {
        const url = await resolve(m.resourceId)
        return url ? { ...m, url } : m
      } catch {
        return m
      }
    }),
  )
}

/**
 * 把「连线顺序」按用户拖出来的顺序重排。
 *
 * 用户口径（2026-10-12）：「参考图的顺序是如何决定的？好像是根据连接的先后顺序来做的。
 * 我希望这个顺序可以进行拖拽改变。」
 *
 * 三条规则（都是「不给顺序时行为一个字不变」为前提）：
 * 1. 没给顺序 / 空顺序 → 原样返回（= 连线先后，老画布与从没拖过的节点都走这条）；
 * 2. 顺序里列到的排前面，按顺序里的位置；
 * 3. 顺序里没列到的（用户拖完之后新连进来的）垫在最后，**它们之间仍保持连线先后** ——
 *    新素材只会追加到末尾，不会插到中间乱跳。
 * 死 id（那条边已经被断开）与重复 id 自动忽略（重复只认第一次）。
 */
export function resolveMaterialOrder<T extends { id: string }>(
  materials: ReadonlyArray<T>,
  refOrder?: readonly string[],
): T[] {
  const list = [...materials]
  if (!refOrder || refOrder.length === 0) return list

  const rank = new Map<string, number>()
  for (let i = 0; i < refOrder.length; i++) {
    const id = refOrder[i]
    // 重复 id 只认第一次；空串不当 id（脏数据防御）
    if (typeof id === 'string' && id !== '' && !rank.has(id)) rank.set(id, i)
  }
  if (rank.size === 0) return list

  // 稳定排序：有名次的按名次，没名次的一律排到有名次的后面（相同名次/无名次时保持原序）
  const fallback = rank.size
  return list
    .map((item, index) => ({ item, index }))
    .sort((x, y) => {
      const rx = rank.get(x.item.id) ?? fallback
      const ry = rank.get(y.item.id) ?? fallback
      return rx - ry || x.index - y.index
    })
    .map((e) => e.item)
}

/**
 * 引用名 = **节点名称**（用户 2026-10-28 定案）。
 *
 * 以前这里按顺序编「图片1 / 视频2 …」；现在直接用节点名称：
 * 名称在画布内唯一，改名后标签自动跟着变，排序也不会让标签指错对象。
 * 保序、保身份，只补 refName 一个字段（节点名称为空时才退回「素材」）。
 */
export function nameRefNames(materials: ReadonlyArray<UpstreamMaterial>): UpstreamMaterial[] {
  return materials.map((m) => ({ ...m, refName: String(m.name ?? '').trim() || '素材' }))
}

/**
 * 拖拽结束后该把什么写进 `data.refOrder`（纯函数；写盘与否、怎么写盘由调用方决定）。
 *
 * 收下拖拽库回调给的新顺序 `dragged`（**排好的那份**），不自己去读「从 data 派生的 computed」——
 * 后者在这一帧还没回灌，读到的是旧顺序（实测：拖了不动、也不存盘）。
 * 拿不到合法数组时（库版本差异 / 异常 / 长度对不上）退回 `current`，至少不写坏。
 *
 * @returns 需要落盘的新顺序；**没有变化 / 空** → null（调用方据此跳过写盘，不进撤销栈）
 */
export function nextRefOrder<T extends { id: string }>(
  current: readonly string[],
  currentCards: ReadonlyArray<T>,
  dragged?: ReadonlyArray<T>,
): string[] | null {
  const list = Array.isArray(dragged) && dragged.length === currentCards.length ? dragged : currentCards
  const ids = list.map((c) => c.id)
  if (ids.length === 0) return null
  if (ids.length === current.length && ids.every((id, i) => id === current[i])) return null
  return ids
}

/**
 * 把新绑定的素材插到指定卡片位置（用户 2026-10-28：添加 / 替换都是「绑定到那张卡」）。
 *
 * 卡片身份是标签 id（`ref-node:<id>` / `ref-name:<名>`），所以这里排的是**标签 id**，
 * 不再是节点 id。原来那张卡的标签被新标签顶掉（替换），其余保持相对顺序。
 *
 * @param order         当前顺序（标签 id 序列）
 * @param replaceChipId 被替换的标签 id（添加时就是那张空壳卡；没有 → 追加到末尾）
 * @param newNodeId     新绑定到的节点 id
 * @returns 新的顺序（调用方写回节点 data.refOrder）
 */
export function placeChipAt(
  order: ReadonlyArray<string>,
  replaceChipId: string | undefined,
  newNodeId: string,
): string[] {
  const newChip = refNodeChipId(newNodeId)
  const rest = order.filter((id) => id !== newChip && id !== replaceChipId)
  const at = replaceChipId ? order.indexOf(replaceChipId) : -1
  if (at < 0) return [...rest, newChip]
  return [...rest.slice(0, at), newChip, ...rest.slice(at)]
}

/** 素材 → 生成请求里的资源（只带工具需要的字段，避免把 UI 用的东西塞进请求） */
export function toToolResources(materials: ReadonlyArray<UpstreamMaterial>): ToolResource[] {
  return materials.map((m) => {
    const res: ToolResource = { id: m.id, kind: m.kind, name: m.name }
    if (m.url) res.url = m.url
    if (m.value) res.value = m.value
    return res
  })
}

/**
 * 按工具声明的 accepts 过滤素材。
 * 工具没声明 accepts（= 不挑食）时全部保留 —— 与内核 ctx.tools.list 的「缺省即全收」同一套语义，
 * 避免节点这边写一套更严的规矩，把明明能用的素材挡在门外。
 */
export function toolResourcesFor(def: ToolDef | undefined, materials: ReadonlyArray<UpstreamMaterial>): ToolResource[] {
  const accepts = def?.accepts
  const kept = accepts && accepts.length > 0 ? materials.filter((m) => accepts.includes(m.kind)) : materials
  return toToolResources(kept)
}

/** 参数默认值：直接用内核的 resolveToolParams（同一口径，避免各处自己写「没有就取第一项」） */
export function paramsForTool(def: ToolDef | undefined, current?: Record<string, unknown>): Record<string, unknown> {
  // resolveToolParams 只遍历工具声明过的 key → 换模型时上一个模型的遗留参数自动消失
  return resolveToolParams(def, current)
}

/**
 * 生成前的最小校验：没有工具、或既没提示词也没素材 → 不该发起调用。
 * @returns 不通过时给用户看的文案；通过返回空串
 */
export function validateGenInput(prompt: string, def: ToolDef | undefined, resources: number): string {
  if (!def) return '没有可用的生成动作，请先安装提供该能力的插件'
  if (!(prompt || '').trim() && resources === 0) return '请先写下你的要求，或连一个素材进来'
  return ''
}

/** 组装一次工具调用的输入（面板点「发送」时用的就是这个） */
export function buildToolInput(
  prompt: string,
  def: ToolDef | undefined,
  materials: ReadonlyArray<UpstreamMaterial>,
  params?: Record<string, unknown>,
): ToolInput {
  return {
    prompt: (prompt || '').trim(),
    resources: toolResourcesFor(def, materials),
    params: { ...(params ?? {}) },
  }
}

/** 模型下拉里的一项 */
export interface ToolOption {
  label: string
  value: string
}

/** 会话可用的出图工具 → 下拉选项（显示名优先 title，回退 name） */
export function toolOptions(defs: ReadonlyArray<ToolDef>): ToolOption[] {
  return defs.map((d) => ({ label: d.title || d.name, value: d.name }))
}

/** 默认选中哪个工具：第一个（没有工具时返回空串，面板据此显示空态而不是一个空下拉） */
export function pickDefaultTool(defs: ReadonlyArray<ToolDef>): string {
  return defs[0]?.name ?? ''
}

/** 工具声明的参数定义（没有就是空数组，面板据此决定渲染几个下拉） */
export function paramDefs(def: ToolDef | undefined): NonNullable<ToolDef['params']> {
  return def?.params ?? []
}

/** 某参数的候选值 → 下拉选项形状（filter 掉 disabled 项，与 Select 组件契约一致） */
export function paramOptions(p: NonNullable<ToolDef['params']>[number]): Array<{ label: string; value: string }> {
  return (p.options ?? []).map((o) => ({ label: o.label, value: o.value }))
}

/**
 * 某工具可用的提示词模板 → 下拉选项。
 * 模板由工具声明（ToolDef.templates + 其它工具里 forTools 命中本工具的共享模板），
 * 面板只负责列出与填入，加模板不用改面板代码。
 */
export function templateOptions(
  def: ToolDef | undefined,
  all: ReadonlyArray<ToolDef> = [],
): Array<{ label: string; value: string }> {
  return resolveToolTemplates(def, all).map((t) => ({ label: t.name, value: t.id }))
}

/** 按 id 找模板正文（选中模板后要把它填进输入框） */
export function templatePrompt(
  def: ToolDef | undefined,
  all: ReadonlyArray<ToolDef>,
  id: string,
): string {
  return resolveToolTemplates(def, all).find((t) => t.id === id)?.prompt ?? ''
}

/** 把工具声明的某个参数收敛成一个用于显示的值 */
export function paramValue(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  return v === undefined || v === null ? '' : String(v)
}

/**
 * 取参数的**原值**（不做字符串化）。
 * 通用渲染器 ToolParamField 需要按参数类型拿正确类型的值（开关要是布尔、数字要是数值），
 * 一旦提前 String() 化，布尔 true 会变成 "true"，发给后台就是错的。
 */
export function paramRaw(
  params: Record<string, unknown>,
  key: string,
  def?: { default?: string | number | boolean },
): string | number | boolean {
  const v = params[key]
  if (v === undefined || v === null) {
    return def?.default ?? ''
  }
  return typeof v === 'number' || typeof v === 'boolean' ? v : String(v)
}

/** 素材行渲染数据（图片给缩略图、文本给图标；顺序 = 连进来的顺序） */
export interface MaterialCard {
  id: string
  kind: ToolResourceKind
  name: string
  url?: string
  value?: string
  /** 是否为「文本」卡片（面板据此画图标而不是缩略图） */
  isText: boolean
}

/** 素材 → 素材行渲染数据 */
export function materialCards(materials: ReadonlyArray<UpstreamMaterial>): MaterialCard[] {
  return materials.map((m) => ({
    id: m.id,
    kind: m.kind,
    name: m.name,
    url: m.url,
    value: m.value,
    isText: m.kind === 'text',
  }))
}

/**
 * 点开一张素材卡时要交给全屏预览（MediaViewer）的 `list` / `index`。
 *
 * 用户口径（2026-10-12）：「我有多个图片，需要按左右快捷键进行切换。我这个组件本身是支持的
 * （useUiComponent("mediaViewer")）」—— MediaViewer 本来就认 `list` + `index`（← / → 键、
 * 左右按钮、页码，取模循环），此前底栏只传了单张，所以切不了。
 *
 * 只收**同一类、有地址**的卡：文本卡没有地址，混进 list 会切出一页空白。
 * 结果不足两张时返回 null —— 单张不必出翻页按钮与页码。
 */
export function previewListFor(
  cards: ReadonlyArray<MaterialCard>,
  card: MaterialCard,
): { list: string[]; index: number; ids: string[]; names: string[] } | null {
  const same = cards.filter((c) => !c.isText && c.kind === card.kind && !!c.url)
  const list = same.map((c) => c.url as string)
  if (list.length < 2) return null
  return {
    list,
    index: Math.max(list.indexOf(card.url ?? ''), 0),
    ids: same.map((c) => c.id),
    names: same.map((c) => c.name),
  }
}

/** 四种资源类型的默认图标（用户 2026-10-28：图片/视频/音频/文本各有自己的图标）。
 *
 * 为什么用 mask（而不是内联 svg 字符串）：标签走 ProseMirror 的 DOMOutputSpec，
 * 里面写 innerHTML 会被当普通属性写上 DOM、浏览器不解析 → 视觉空白（真机踩过）。
 * mask 只依赖 CSS，两条渲染路径（HTMLElement / spec）结果一致。
 */
export type MediaKind4 = 'image' | 'video' | 'audio' | 'text'

/**
 * 素材 → **唯一的标签身份**：`ref-node:<节点 id>`（用户 2026-10-28 定案）。
 *
 * 为什么不再用 `ref-slot:<kind>:<序号>`：序号会随排序/增删变化，标签就必然指错对象。
 * 节点 id 永远不变；显示名从节点名称取。
 */
export function refChipIdOf(m: { id?: string }): string | null {
  const id = String(m.id ?? '').trim()
  return id ? refNodeChipId(id) : null
}

/** 每种类型的 svg 路径（24 视图，stroke 风格与画布节点图标同一套） */
export const MEDIA_ICON_PATHS: Record<MediaKind4, string> = {
  image: 'M3 4h18v16H3z M3 17l5-5 4 4 3-3 6 6 M8.5 9.5a1.5 1.5 0 1 0 0-.001',
  video: 'M3 6h12v12H3z M15 10l6-4v12l-6-4z',
  audio: 'M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  text: 'M4 7V4h16v3 M12 4v16 M8 20h8',
}

/** 从 ResourceItem 推断 4 类型之一（无 mediaType → text） */
export function mediaKindOf(item: ResourceItem): MediaKind4 {
  /**
   * 用户 2026-10-28：mediaType 只存在运行时注册表里，组件刷新/底栏重开时会丢，
   * 于是所有标签退化成文本图标。名字（图片2 / 视频1 / 音频3 / 文本1）是节点属性，
   * 永远在 —— 所以 mediaType 缺失时**回退按名字判断**。
   *
   * 顺序很关键：**先看名字**。混合素材（kind `av`/`media`）在 toEditorResources 里会被
   * 兜底成 mediaType `image`，若先信 mediaType，就会把视频的 mp4 地址塞进 `<img>`
   * → 浏览器加载失败、整行空白（用户 2026-10-28 报的「@ 下拉里视频没有缩略图」）。
   */
  const n = String(item.name ?? '').trim()
  if (/^视频\s*\d+$/.test(n)) return 'video'
  if (/^音频\s*\d+$/.test(n)) return 'audio'
  if (/^图片\s*\d+$/.test(n)) return 'image'
  if (/^文本\s*\d+$/.test(n)) return 'text'
  /**
   * 地址兜底：名字认不出来、mediaType 又是兜底的 image，但地址本身是视频容器。
   * 为什么必须加（用户 2026-10-28 实测）：这类项会被当成图片，把 mp4 塞进 `<img>`
   * → 加载失败 → 那一行整段空白。
   */
  if (looksLikeVideoUrl(item.url)) return 'video'
  if (item.mediaType === 'video') return 'video'
  if (item.mediaType === 'audio') return 'audio'
  if (item.mediaType === 'image') return 'image'
  return 'text'
}

/** 地址看起来是视频（扩展名判断；blob:/data: 看不出来，交给 mediaType） */
export function looksLikeVideoUrl(url: string | undefined): boolean {
  if (!url) return false
  return /\.(mp4|webm|mov|m4v|ogv|mkv)(\?|#|$)/i.test(url)
}

/** 文本素材在 @ 引用里的图标（插入后显示的小图标） */
const TEXT_ICON =
  // v-html 进 DOM 的 SVG 字符串：用 currentColor + 内联 color 变量，才能跟着主题走
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="color:var(--ui-ink-dim, #6b7280)" stroke-width="2"><path d="M4 7V4h16v3"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="8" y1="20" x2="16" y2="20"/></svg>'

/**
 * 素材插入编辑器后的 DOM 规格：**卡片式**（用户要求，替换原来"缩略图 + 下划线"）。
 *
 * 一个「卡片」= 圆角小框 + 里面缩略图（文本类用图标）+ 右侧名字。
 * 名字用 **refName**（图片1 / 视频2 这种带序号的名字）——@ 引用与纯文本里也是它，
 * 用户和后端看到的是同一个可读名，而不是内部节点 id。
 *
 * 注意：class 里仍保留 `resource-node`（编辑器靠它绑定点击/悬停预览，
 *   并把 data-* 当序列化身份）；`resource-chip` 是卡片外观，纯装饰。
 */
function resourceEditorSpec(self: ResourceItem): [string, Record<string, unknown>, ...unknown[]] {
  const name = self.name || ''
  /**
   * 类型只认 `chipKind`（用户 2026-10-28 定案）：
   * - 有值 = 已绑定节点，按节点真实类型画图标；
   * - 没值 = 待绑定（手打的 @名字），统一「资源」图标，**不猜类型**。
   */
  const kind4 = self.chipKind
  /**
   * 能不能把 url 当**图片**画：只有图片可以。
   *
   * 音频/视频的 url 是 mp3/mp4，塞进 `<img>` 必然加载失败 —— 编辑器再把失败的元素
   * 设成 `display:none`，标签就只剩名字、没有图标（用户 2026-10-28 报「音频标签没有图标」）。
   * 视频存的 url 是帧图（data:image/…）所以例外；音频没有封面，一律走类型图标。
   */
  const canShowThumb =
    !!self.url && !!kind4 && kind4 !== 'audio' && (kind4 === 'image' || self.url.startsWith('data:image/'))
  const isText = !canShowThumb
  return [
    'span',
    {
      class:
        'resource-node resource-chip'
        + (isText ? ' resource-chip--text' : '')
        + (kind4 ? '' : ' resource-chip--unbound')
        + (self.invalid ? ' resource-chip--invalid' : '')
        // 可替换标记（用户 2026-10-29）：hover 时左侧图标变「替换」键。
        // 这条渲染路径（底栏资源项）与编辑器 renderRefChip 是两份实现，两边都要带。
        + (self.onReplaceClick && !self.invalid ? ' resource-chip--replaceable' : ''),
      'data-id': self.id,
      'data-url': self.url || '',
      'data-name': name,
      'data-value': self.value || '',
      'data-category': self.category,
      ...(kind4 ? { 'data-kind': kind4 } : {}),
      ...(self.invalid ? { 'data-invalid': '1' } : {}),
      // 不设 title：原生 title 会弹浏览器默认 tooltip（用户口径 2026-10-27 不喜欢）
    },
    // 【修复】icon 不能走 innerHTML 属性 —— DOMOutputSpec 会把它当**普通属性**写上 DOM
    //（outerHTML 出现 innerhtml="<svg..."），浏览器不解析 → 视觉空白（用户 2026-10-28
    // 报「有些标签是空白」的真凶）。改为空占位 span + CSS mask 画图标。
    // 用户 2026-10-28 追加：图片/视频/音频/文本 **各有自己的默认图标**（data-icon=kind）；
    // 未绑定 = data-icon="resource"（统一资源图标）。
    // 图标永远在（用户 2026-10-29：标签左侧的图/图标会莫名不见）。
    // 旧写法二选一：能画图就只出 img —— 图 404 / 还没 resolve 时左边就是空白。
    // 现在底图固定是类型图标，图片加载成功才盖上去（CSS 控制显示）。
    ['span', { class: 'resource-chip-icon', 'data-icon': kind4 ?? 'resource' }],
    ...(canShowThumb
      ? [['img', { class: 'resource-chip-thumb', src: self.url || '', draggable: 'false', alt: '' }]]
      : []),
    ['span', { class: 'resource-chip-name' }, name],
  ]
}
/**
 * 底栏自己的**标签规格**（用户口径 2026-10-27：标签实现交给插件）。
 *
 * 新规则（用户 2026-10-28 定案）：正文里写 `@名称`，名称 = 画布上的节点名称。
 *
 * - 名称命中了**已连线**的素材 → 生成已绑定标签 `ref-node:<id>`（带真实类型图标）；
 * - 没命中 → 生成待绑定标签 `ref-name:<名>`（统一资源图标，拖入节点即完成添加）。
 *
 * 为什么按名称而不是按序号：名称在画布内唯一，用户和 AI 都能直接读懂
 * （`@场景:天空之城` 一眼知道是什么，`@音频1` 不知道）。
 */
export function bottomBarTagSpecFor(getMaterials: () => ReadonlyArray<UpstreamMaterial>): TagSpec {
  return {
    scan(text: string): TagMatch[] {
      const out: TagMatch[] = []
      /**
       * `@` 后面到分隔符之间算名称。名称可能带空格（「天空 之城」），
       * 所以先按分隔符切段，再在段内用「最长名称优先」匹配已连线素材，
       * 剩下的段落按整段当待绑定名称。
       */
      const materials = getMaterials()
      // 长名优先：避免「天空」把「天空之城」截走
      const sorted = [...materials]
        .filter((m) => m.name.trim())
        .sort((a, b) => normalizeRefName(b.name).length - normalizeRefName(a.name).length)
      // 名称到空白 / 中英文标点 / 换行 / 下一个 @ 为止
      const re = /@([^\s@，。,.、；;：:！!？?（）()【】\[\]"'“”‘’]{1,80})/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const raw = m[1]
        const hit = sorted.find((mat) => {
          const norm = normalizeRefName(mat.name)
          return raw === norm || raw.startsWith(norm)
        })
        const name = hit?.name ?? raw.trim()
        if (!name) continue
        const len = hit ? normalizeRefName(hit.name).length : name.length
        const material = hit
        const item: ResourceItem = material
          ? {
              id: refNodeChipId(material.id),
              name: material.name,
              category: '素材',
              chipKind: material.kind,
              ...(material.url ? { url: material.url } : {}),
              ...(material.value ? { value: material.value } : {}),
            }
          : {
              id: refNameChipId(name),
              name,
              category: '素材',
            }
        out.push({ from: m.index, to: m.index + 1 + len, item })
      }
      return out
    },
    // 标签外观沿用底栏卡片样式；冷启动缺注册表时也能画对
    render: (item) => resourceEditorSpec(item),
  }
}


/**
 * 素材 → 编辑器资源项（ProseMirrorEditor 的 resources）。
 *
 * 图片给 url + mediaType（编辑器据此渲染缩略图与悬停预览），文本给 value + 图标。
 * 点击回调交给调用方（面板负责弹全屏预览），本模块不碰 DOM。
 */
export function toEditorResources(
  materials: ReadonlyArray<UpstreamMaterial>,
  onPreview?: (material: UpstreamMaterial) => void,
  /**
   * 可选的「视频取帧」回调（由底栏从 ctx.get('video') 拿，模块本身不碰插件）。
   *
   * 为什么需要（用户 2026-10-28 报）：@ 下拉里视频那一行原来是空白 —— mp4 地址塞进
   * `<img src>` 什么也不显示。给了它就用帧图当缩略图；没给就退回类型图标。
   */
  videoThumbOf?: (url: string) => string | undefined,
): ResourceItem[] {
  return materials.map((m) => {
    /**
     * 三处共用一份身份（用户 2026-10-28 定案）：@ 下拉、卡片、正文标签。
     *
     * id = `ref-node:<节点 id>`（永不随排序变化），name = 节点名称，chipKind = 真实类型。
     */
    const base: ResourceItem = {
      id: refNodeChipId(m.id),
      name: m.refName || m.name,
      category: '素材',
      ...(m.kind === 'image' || m.kind === 'video' || m.kind === 'audio' || m.kind === 'text'
        ? { chipKind: m.kind }
        : {}),
    }
    if (m.kind === 'text') {
      return {
        ...base,
        value: m.value,
        icon: TEXT_ICON,
        /**
         * 文本也要走**同一套行渲染**（用户 2026-10-28 报：「文本图标只有 16px，对不上」）。
         *
         * 为什么必须给 renderItem：不给时编辑器走默认分支 —— 左侧是 `<span class="item-icon">`
         * 里塞 16×16 的 svg，而图片/视频/音频那几行走的是 22×22 的 `mention-kind`。
         * 两套尺寸混在一列里，左边永远对不齐。
         */
        renderItem: (self) =>
          h('span', { class: 'mention-resource' }, [
            h('span', { class: 'mention-kind', 'data-kind': 'text' }),
            h('span', { class: 'mention-name' }, self.name),
          ]),
        renderEditor: resourceEditorSpec,
      }
    }
    const item: ResourceItem = {
      ...base,
      url: m.url,
      mediaType: m.kind === 'video' ? 'video' : m.kind === 'audio' ? 'audio' : 'image',
      /**
       * @ 下拉里的行：**按类型**决定左边画什么（用户 2026-10-28 报：音频/视频那一行是空白）。
       *
       * - 图片：缩略图（原图）。
       * - 视频：帧图（mp4 不能当 `<img>` 用，否则空白）；帧还没取到就先出类型图标。
       * - 音频 / 文本：没有可视化封面，出各自的类型图标（不再输出一个空 img）。
       */
      renderItem: (self) => {
        /**
         * 类型从**素材本身**算（不是从 item）：`item.mediaType` 对混合类型（av）会兜底成
         * image，拿它判断会把视频当图片（用户 2026-10-28 实测的那条空行）。
         * `m.kind` 是上游素材的真实类型，名字又是第二道保险。
         */
        const kind4: MediaKind4 =
          m.kind === 'video' ? 'video'
          : m.kind === 'audio' ? 'audio'
          : m.kind === 'image' ? 'image'
          : m.kind === 'text' ? 'text'
          : mediaKindOf(self)
        /**
         * 视频地址**绝不能**直接进 `<img src>`（浏览器加载失败 → 整行空白）。
         * 所以视频只认帧图；拿不到帧图就出类型图标，宁可没图也不要 0×0 的隐形行。
         * `looksLikeVideoUrl` 再兜一层：万一上游把 kind 标成了图片，也不会漏。
         */
        const videoish = kind4 === 'video' || looksLikeVideoUrl(self.url)
        const src = videoish
          ? (videoThumbOf?.(self.url ?? '') ?? '')
          : kind4 === 'image' ? (self.url ?? '') : ''
        return h('span', { class: 'mention-resource' }, [
          /**
           * 视频帧图用**背景图**画，不用 `<img>`。
           *
           * 为什么（2026-10-28 实测）：`<img>` 一旦先用过 mp4 地址（浏览器判失败），
           * 后续即使把 src 换成帧图，元素也可能保留 `display:none`，那一行永远是空的。
           * 背景图没有「加载失败就隐藏」这套逻辑，换图立刻生效。
           */
          videoish && src
            ? h('span', {
                class: 'mention-thumb mention-thumb--bg',
                'data-kind': 'video',
                style: { backgroundImage: 'url("' + src + '")' },
              })
            : src
              ? h('img', { src, class: 'mention-thumb', 'data-kind': kind4, draggable: false, alt: '' })
              : h('span', { class: 'mention-kind', 'data-kind': videoish ? 'video' : kind4 }),
          h('span', { class: 'mention-name' }, self.name),
        ])
      },
      renderEditor: resourceEditorSpec,
    }
    if (onPreview) item.onClick = () => onPreview(m)
    return item
  })
}

/**
 * @ 引用回查：富文本里的 token 可能是**引用名**（图片1）也可能是老的节点 id，
 * 两种都认（改了名字的老文档也不至于回查不到）。找不到返回 null，编辑器当普通文字处理。
 */
export function makeResourceResolver(items: ReadonlyArray<ResourceItem>): (token: string) => ResourceItem | null {
  return (token: string) => items.find((it) => it.name === token || it.id === token) ?? null
}

/** 面板底部一句话状态（发送按钮旁边 / 进度区显示什么） */
export interface PanelStatusText {
  tone: 'idle' | 'running' | 'error'
  text: string
}

/**
 * 面板状态文案（纯函数，方便直接断言「用户到底看到什么字」）。
 * 优先级：失败 > 生成中 > 空态 > 就绪（就绪时为空串，不占地方）。
 */
export function panelStatusText(input: {
  running: boolean
  error?: string
  message?: string
  progress?: number
  toolCount: number
}): PanelStatusText {
  if (input.error) return { tone: 'error', text: input.error }
  if (input.running) {
    const hasPct = typeof input.progress === 'number' && Number.isFinite(input.progress)
    const msg = input.message || '生成中…'
    return { tone: 'running', text: hasPct ? msg + ' ' + Math.round(input.progress as number) + '%' : msg }
  }
  if (input.toolCount === 0) {
    return { tone: 'idle', text: '没有可用的生成工具：请先安装提供图片生成能力的工具插件' }
  }
  return { tone: 'idle', text: '' }
}

