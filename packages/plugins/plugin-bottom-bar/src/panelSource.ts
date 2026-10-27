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

/** 一条连进本节点的上游素材（面板素材行 / @ 引用 / 生成输入 共用同一份） */
export interface UpstreamMaterial {
  /** 上游节点 id：@ 引用与请求组装里的稳定身份 */
  id: string
  kind: ToolResourceKind
  /** 显示名（节点标题优先，回退文件名/默认名） */
  name: string
  /**
   * **带序号的引用名**（图片1 / 视频1 / 文本1 …）。
   * 用户要的语义：连多个素材时按类型各自编号，@ 引用与纯文本里都用这个名字 ——
   * 而不是内部节点 id（那串用户看不懂）。序号只在 UI/提示词里用，节点 id 仍是身份。
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
  /**
   * 用户**指定**的槽位（上传/替换到第 N 格时写入）—— 决定该素材的 refName 序号。
   * 不给时行为与以前完全一致（按出现顺序从 1 编）。
   */
  slotHints?: RefSlotHints,
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
        // refName 由 numberRefNames 在**排完序之后**统一分配（角标/@ 名/纯文本 token 三处
        // 必须与最终顺序一致，否则「图片2」会指到另一张图）
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

  // 顺序 + 引用名：两件事必须一起做（引用名是按**最终顺序**编的）
  const ordered = resolveMaterialOrder(out, refOrder)
  return slotHints ? applySlotHints(ordered, slotHints) : numberRefNames(ordered)
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
 * 按**最终顺序**重编引用名：同类型各自从 1 开始（图片1 / 图片2 / 视频1 …）。
 *
 * 为什么必须在排完序之后才编：素材卡左下角的序号角标、@ 下拉/卡片上的名字、
 * 以及纯文本里序列化出来的 token，三处看到的都是这个 refName —— 顺序换了编号不换，
 * 用户写的「图片2」就会指到另一张图。
 */
export function numberRefNames(materials: ReadonlyArray<UpstreamMaterial>): UpstreamMaterial[] {
  const seq: Record<string, number> = { image: 0, video: 0, audio: 0, text: 0 }
  const CN: Record<string, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }
  return materials.map((m) => {
    seq[m.kind] = (seq[m.kind] ?? 0) + 1
    return { ...m, refName: (CN[m.kind] ?? '素材') + seq[m.kind] }
  })
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
 * 把「某个槽位要用的素材」排到它对应该有的位置（用户口径 2026-10-25：
 * 「点击第二个空区域进行上传，那么这个连接线就属于第二个参考」）。
 *
 * 背景：refName（图片1/图片2）是**按连线顺序**编的（numberRefNames）。
 * 用户在第二个空格上传时，这条新边天然排在最末 —— 名字就会变成「图片N」。
 * 这里把新素材插到 index 位置，其余顺延；于是「第 2 格」真的对应「图片2」。
 *
 * @param order  当前 refOrder（节点 id 序列）
 * @param kind   槽位种类（同类型内部编号；视频/音频各自独立）
 * @param index  目标序号（从 1 开始）
 * @param nodeId 新素材的节点 id
 * @returns 新的 refOrder（调用方写回节点 data.refOrder）
 */
export function placeRefAtSlot(
  order: ReadonlyArray<string>,
  kind: 'image' | 'video' | 'audio' | 'av',
  index: number,
  nodeId: string,
): string[] {
  // 同类型才能插位：图片2 的「位置」只在图片序列里有意义（视频/音频各自编号）。
  void kind
  const rest = order.filter((id) => id !== nodeId)
  // 「第 N 格」必须真的排在第 N 位 —— 当前素材比 N 少时补占位，
  // 否则会被压到第 1 位（真机踩过：8 格空着时点第 8 格上传，图出现在第 1 格）。
  const padded = [...rest]
  while (padded.length < index - 1) padded.push('__slot__' + padded.length)
  return [...padded.slice(0, index - 1), nodeId, ...padded.slice(index - 1)]
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
  // url 为空 = 该槽位现在是「待输入」：不给 <img>（空 src 会渲染成裂图/空白，
  // 用户看到的就是"删掉资源后标签图标不见了"），改走图标/占位分支。
  const isText = self.mediaType === undefined || !self.url
  return [
    'span',
    {
      class: 'resource-node resource-chip' + (isText ? ' resource-chip--text' : ''),
      'data-id': self.id,
      'data-url': self.url || '',
      'data-name': name,
      'data-value': self.value || '',
      'data-category': self.category,
      // 不设 title：原生 title 会弹浏览器默认 tooltip（用户口径 2026-10-27 不喜欢）
    },
    // 【修复】icon 不能走 innerHTML 属性 —— DOMOutputSpec 会把它当**普通属性**写上 DOM
    //（outerHTML 出现 innerhtml="<svg..."），浏览器不解析 → 视觉空白（用户 2026-10-28
    // 报「有些标签是空白」的真凶）。改为空占位 span + CSS mask 画图标（图标唯一，
    // 用 CSS 变量/伪元素最稳）。
    isText
      ? ['span', { class: 'resource-chip-icon', 'data-icon': 'text' }]
      : ['img', { class: 'resource-chip-thumb', src: self.url || '', draggable: 'false', alt: '' }],
    ['span', { class: 'resource-chip-name' }, name],
  ]
}
/**
 * 底栏自己的**标签规格**（用户口径 2026-10-27：标签实现交给插件）。
 *
 * 编辑器只提供「文字 → 标签」的通用通道；认什么写法、标签长什么样，由这里决定。
 * 现在这套规则与改造前完全一致：认 @图片N / @视频N / @音频N / @音视频N，
 * 生成 `ref-slot:<kind>:<N>` 的槽位标签。
 *
 * 想换成别的写法（比如 @角色1），只改这里的 scan 即可，不用碰编辑器。
 */
export const bottomBarTagSpec: TagSpec = {
  scan(text: string): TagMatch[] {
    const out: TagMatch[] = []
    const re = /@(图片|视频|音频|音视频|image|video|audio|media|av)\s*(\d{1,4})/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const kind = m[1].toLowerCase()
      const slotKind: 'image' | 'video' | 'audio' | 'av' =
        kind === '图片' || kind === 'image' ? 'image'
        : kind === '视频' || kind === 'video' ? 'video'
        : kind === '音频' || kind === 'audio' ? 'audio'
        : 'av'
      const label =
        slotKind === 'image' ? '图片' : slotKind === 'video' ? '视频' : slotKind === 'audio' ? '音频' : '音视频'
      const index = Number(m[2])
      if (!index) continue
      const item: ResourceItem = {
        id: 'ref-slot:' + slotKind + ':' + index,
        name: label + index,
        category: '素材',
        mediaType: slotKind === 'av' ? undefined : slotKind,
      }
      out.push({ from: m.index, to: m.index + m[0].length, item })
    }
    return out
  },
  // 标签外观沿用底栏卡片样式；冷启动缺注册表时也能画对
  render: (item) => resourceEditorSpec(item),
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
): ResourceItem[] {
  return materials.map((m) => {
    // name 用**带序号的引用名**（图片1 / 视频1）：它同时是 @ 下拉的显示名、
    // 插入后的卡片文案、以及纯文本序列化出来的 token —— 三处一致，用户看得懂。
    const base: ResourceItem = { id: m.id, name: m.refName, category: '素材' }
    if (m.kind === 'text') {
      return {
        ...base,
        value: m.value,
        icon: TEXT_ICON,
        renderEditor: resourceEditorSpec,
      }
    }
    const item: ResourceItem = {
      ...base,
      url: m.url,
      mediaType: m.kind === 'video' ? 'video' : m.kind === 'audio' ? 'audio' : 'image',
      // @ 下拉里给图片/视频带缩略图（编辑器默认只画 icon + 名字，看不出是哪张图）
      renderItem: (self) => h('span', { class: 'mention-resource' }, [
        h('img', { src: self.url ?? '', class: 'mention-thumb', draggable: false, alt: '' }),
        h('span', { class: 'mention-name' }, self.name),
      ]),
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

/**
 * 槽位提示：用户**指定**某素材放在第 N 格（上传/替换时写进节点 data.refSlot）。
 * 形状：{ [nodeId]: { kind, index } }
 */
export type RefSlotHints = Record<string, { kind: ToolResourceKind; index: number }>

/**
 * 把「用户指定的槽位」落到 refName 上 —— 这是「第 N 格上传就落在第 N 格」的唯一依据。
 *
 * 为什么不能只靠顺序：refName 是按素材出现顺序从 1 编的。8 个格子都空着时点第 8 格
 * 上传，素材序列里只有 1 张 → 编成「图片1」→ 于是显示在第 1 格（真机踩过的 bug）。
 * 有 hint 时按 hint 编号，同类型的其余素材填到空出来的位置（保持原有先后）。
 */
export function applySlotHints(
  materials: ReadonlyArray<UpstreamMaterial>,
  hints: RefSlotHints | undefined,
): UpstreamMaterial[] {
  if (!hints) return numberRefNames(materials)
  const CN: Record<string, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" }
  // 每个种类：已被 hint 占用的序号 → 素材；其余素材排队补空位
  const byKind = new Map<string, { taken: Map<number, UpstreamMaterial>; rest: UpstreamMaterial[] }>()
  for (const m of materials) {
    const bucket = byKind.get(m.kind) ?? { taken: new Map<number, UpstreamMaterial>(), rest: [] as UpstreamMaterial[] }
    const hint = hints[m.id]
    if (hint && hint.kind === m.kind && hint.index > 0 && !bucket.taken.has(hint.index)) {
      bucket.taken.set(hint.index, m)
    } else {
      bucket.rest.push(m)
    }
    byKind.set(m.kind, bucket)
  }
  const out: UpstreamMaterial[] = []
  for (const m of materials) {
    const bucket = byKind.get(m.kind)!
    // 本素材是否占着某个 hint 序号
    let slot = 0
    for (const [idx, item] of bucket.taken) if (item === m) slot = idx
    if (slot === 0) {
      // 找一个没被占用的序号（从 1 起）
      let i = 1
      while (bucket.taken.has(i)) i += 1
      slot = i
      bucket.taken.set(i, m)
    }
    out.push({ ...m, refName: (CN[m.kind] ?? "素材") + slot })
  }
  return out
}

