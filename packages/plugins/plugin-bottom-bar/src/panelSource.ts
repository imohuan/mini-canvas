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
 */
export function collectUpstreamMaterials(
  edges: ReadonlyArray<{ source: string; target: string }>,
  targetId: string,
  getNode: (nodeId: string) => UpstreamNodeLike | undefined,
): UpstreamMaterial[] {
  const out: UpstreamMaterial[] = []
  // 同一个上游节点可能有多条边连过来（重复连），只算一次：素材行不该出现两张一样的卡片
  const seen = new Set<string>()
  // 按类型各自编号（图片1 / 图片2 / 视频1 …）—— 用户要的就是这种引用名
  const seq: Record<string, number> = { image: 0, video: 0, audio: 0, text: 0 }
  const CN: Record<string, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }
  const nextRef = (kind: ToolResourceKind): string => {
    seq[kind] = (seq[kind] ?? 0) + 1
    return (CN[kind] ?? '素材') + seq[kind]
  }

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
        refName: nextRef('image'),
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
        refName: nextRef('video'),
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
        refName: nextRef('audio'),
        url: audioUrl,
      })
      continue
    }

    // 文本节点：内容暂时为空也收（用户可能正打算先连再写），@ 时用名字占位
    if (node?.type === 'text') {
      seen.add(edge.source)
      out.push({
        id: edge.source,
        kind: 'text',
        name: label || '文本',
        refName: nextRef('text'),
        value: typeof data.text === 'string' ? data.text : '',
      })
    }
  }
  return out
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
  const isText = self.mediaType === undefined
  return [
    'span',
    {
      class: 'resource-node resource-chip' + (isText ? ' resource-chip--text' : ''),
      'data-id': self.id,
      'data-url': self.url || '',
      'data-name': name,
      'data-value': self.value || '',
      'data-category': self.category,
      title: name,
    },
    isText
      ? ['span', { class: 'resource-chip-icon', innerHTML: TEXT_ICON }]
      : ['img', { class: 'resource-chip-thumb', src: self.url || '', draggable: 'false', alt: '' }],
    ['span', { class: 'resource-chip-name' }, name],
  ]
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
        h('img', { src: self.url, class: 'mention-thumb', draggable: false, alt: '' }),
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
