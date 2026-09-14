/**
 * panelSource —— 图片节点底部「生成面板」的纯逻辑（零 DOM/零 Vue，node 可单测）。
 *
 * 面板要干三件事，全都只是「把画布上的东西翻译成工具能吃的形状」：
 * 1. 找上游素材：谁连进来了（图的 url / 文本的内容）→ 素材行 + @ 引用候选用它；
 * 2. 选工具、算参数：能出图的工具（ctx.tools.list）→ 模型下拉；工具自己声明的 params → 参数下拉；
 * 3. 组装请求：把用户写的 prompt + 素材 + 参数拼成一次 invoke 的输入。
 *
 * 放在组件外面是因为这三件事都不需要浏览器：放在这里能直接用普通数组断言，
 * 而组件只管渲染与交互（「算得对不对」与「画得对不对」分开，出问题时能立刻定位是哪一层）。
 */
import { resolveToolParams, resolveToolTemplates, type ToolDef, type ToolInput, type ToolResource, type ToolResourceKind } from '@mini-canvas/kernel'
import type { ResourceItem } from 'prosemirror-editor-bundle'

/** 一条连进本节点的上游素材（面板素材行 / @ 引用 / 生成输入 共用同一份） */
export interface UpstreamMaterial {
  /** 上游节点 id：@ 引用与请求组装里的稳定身份 */
  id: string
  kind: ToolResourceKind
  /** 显示名（节点标题优先，回退文件名/默认名） */
  name: string
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
        name: label || nonEmptyString(data.imageName) || '素材',
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
        url: videoUrl,
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
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><path d="M4 7V4h16v3"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="8" y1="20" x2="16" y2="20"/></svg>'

/** 文本素材插入编辑器后的 DOM 规格（@名字） */
function textResourceEditorSpec(self: ResourceItem): [string, Record<string, unknown>, ...unknown[]] {
  return [
    'span',
    {
      class: 'resource-node resource-node-text',
      'data-id': self.id,
      'data-name': self.name,
      'data-value': self.value || '',
      'data-category': self.category,
    },
    ['span', { class: 'label' }, '@' + self.name],
  ]
}

/** 图片/视频素材插入编辑器后的 DOM 规格（小缩略图） */
function imageResourceEditorSpec(self: ResourceItem): [string, Record<string, unknown>, ...unknown[]] {
  return [
    'span',
    {
      class: 'resource-node',
      'data-id': self.id,
      'data-url': self.url || '',
      'data-name': self.name,
      'data-category': self.category,
      style: 'display: inline-flex; align-items: center; gap: 4px; vertical-align: bottom',
    },
    [
      'img',
      {
        src: self.url || '',
        draggable: 'false',
        style: 'width: 16px; height: 16px; border-radius: 2px; object-fit: cover; pointer-events: none',
      },
    ],
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
    const base: ResourceItem = { id: m.id, name: m.name, category: '素材' }
    if (m.kind === 'text') {
      return {
        ...base,
        value: m.value,
        icon: TEXT_ICON,
        renderEditor: textResourceEditorSpec,
      }
    }
    const item: ResourceItem = {
      ...base,
      url: m.url,
      mediaType: m.kind === 'video' ? 'video' : m.kind === 'audio' ? 'audio' : 'image',
      renderEditor: imageResourceEditorSpec,
    }
    if (onPreview) item.onClick = () => onPreview(m)
    return item
  })
}

/**
 * @ 引用回查：富文本里的 @token 就是上游节点 id，据此找回资源项。
 * 找不到返回 null（编辑器会当作普通文字处理，不会炸）。
 */
export function makeResourceResolver(items: ReadonlyArray<ResourceItem>): (token: string) => ResourceItem | null {
  return (token: string) => items.find((it) => it.id === token) ?? null
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
