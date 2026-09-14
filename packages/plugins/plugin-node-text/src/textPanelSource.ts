/**
 * textPanelSource —— 文本节点"生成控制栏"的纯逻辑（零 Vue / 零 DOM，Node 可单测）。
 *
 * 与图片节点的 panelSource 同思路，但产物是**文本**：
 * - 工具筛选按 `produces: 'text'`（谁能产出文本），并可按 `accepts` 过滤"能吃下当前素材的工具"；
 * - 参数/模板直接复用内核工具层的解析函数，别处不必再写一遍；
 * - 组装调用输入、把模板提示词填进输入框，也在这里（组件只负责接线与显示）。
 *
 * 为什么把"哪些工具能被文本节点用"写成纯函数：用户要的是"选模型 → 选思考程度 → 发送 → 结果回填"，
 * 这条链路的判断（能不能用、有哪些参数、请求带什么）全都可以脱离浏览器锁定，组件里只留交互。
 */
import { resolveToolParams, resolveToolTemplates, type ToolDef, type ToolInput, type ToolResource, type ToolResourceKind } from '@mini-canvas/kernel'
import type { ResourceItem } from 'prosemirror-editor-bundle'

/** 文本节点能吃/能产的资源类型（上游素材） */
export interface UpstreamMaterial {
  id: string
  kind: ToolResourceKind
  name: string
  url?: string
  value?: string
}

/**
 * 收集连进本节点的上游素材（图片取 imageUrl/panoUrl、视频取 videoUrl、文本取 text）。
 * 判定顺序与 v1 useUpstreamResources 一致：有图先用图，其次视频，最后按类型是 text 算文本。
 */
export function collectUpstreamMaterials(
  edges: ReadonlyArray<{ source: string; target: string }>,
  targetId: string,
  getNode: (nodeId: string) => { type?: string; data?: Record<string, unknown> } | undefined,
): UpstreamMaterial[] {
  const out: UpstreamMaterial[] = []
  const seen = new Set<string>()
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

  for (const e of edges) {
    if (e.target !== targetId || seen.has(e.source)) continue
    const node = getNode(e.source)
    const data = node?.data ?? {}
    const label = str(data.label)

    const imageUrl = str(data.imageUrl) || str(data.panoUrl)
    if (imageUrl) {
      seen.add(e.source)
      out.push({ id: e.source, kind: 'image', name: label || str(data.imageName) || '图片', url: imageUrl })
      continue
    }
    const videoUrl = str(data.videoUrl)
    if (videoUrl) {
      seen.add(e.source)
      out.push({ id: e.source, kind: 'video', name: label || str(data.videoName) || '视频', url: videoUrl })
      continue
    }
    if (node?.type === 'text') {
      seen.add(e.source)
      out.push({
        id: e.source,
        kind: 'text',
        name: label || '文本',
        value: typeof data.text === 'string' ? data.text : '',
      })
    }
  }
  return out
}

/** 素材 → 工具调用随行的资源（图片给 url、文本给 value） */
export function toolResourcesFor(
  def: ToolDef | undefined,
  materials: ReadonlyArray<UpstreamMaterial>,
): ToolResource[] {
  const accepts = def?.accepts
  const kept = accepts && accepts.length > 0 ? materials.filter((m) => accepts.includes(m.kind)) : materials
  return kept.map((m) => {
    const res: ToolResource = { id: m.id, kind: m.kind, name: m.name }
    if (m.url) res.url = m.url
    if (m.kind === 'text') res.value = m.value ?? ''
    return res
  })
}

/** 工具声明的参数默认值（换工具时用；上一个工具的遗留参数自动消失） */
export function paramsForTool(def: ToolDef | undefined, current?: Record<string, unknown>): Record<string, unknown> {
  return resolveToolParams(def, current)
}

/** 工具声明的参数定义（面板据此决定渲染几个下拉） */
export function paramDefs(def: ToolDef | undefined): NonNullable<ToolDef['params']> {
  return def?.params ?? []
}

/** 某参数的候选值 → 下拉选项 */
export function paramOptions(p: NonNullable<ToolDef['params']>[number]): Array<{ label: string; value: string }> {
  return (p.options ?? []).map((o) => ({ label: o.label, value: o.value }))
}

/** 把某个参数的当前值收敛成用于显示/回填的字符串 */
export function paramValue(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  return v === undefined || v === null ? '' : String(v)
}

/**
 * 取参数的**原值**（不做字符串化）。
 * 通用渲染器 ToolParamField 要按参数类型拿到正确类型的值（开关必须是布尔、数字必须是数值）；
 * 提前 String() 化会把 true 变成 "true"，发给后台就是错的。
 */
export function paramRaw(
  params: Record<string, unknown>,
  key: string,
  def?: { default?: string | number | boolean },
): string | number | boolean {
  const v = params[key]
  if (v === undefined || v === null) return def?.default ?? ''
  return typeof v === 'number' || typeof v === 'boolean' ? v : String(v)
}

/** 工具列表 → 下拉选项（显示标题，值是工具名） */
export function toolOptions(defs: ReadonlyArray<ToolDef>): Array<{ label: string; value: string }> {
  return defs.map((d) => ({ label: d.title || d.name, value: d.name }))
}

/** 默认选中哪个工具：第一个（没有则空串，面板据此显示空态） */
export function pickDefaultTool(defs: ReadonlyArray<ToolDef>): string {
  return defs[0]?.name ?? ''
}

/** 某工具可用的模板 → 下拉选项 */
export function templateOptions(
  def: ToolDef | undefined,
  all: ReadonlyArray<ToolDef> = [],
): Array<{ label: string; value: string }> {
  return resolveToolTemplates(def, all).map((t) => ({ label: t.name, value: t.id }))
}

/** 按 id 取模板正文（选中模板后填进输入框） */
export function templatePrompt(def: ToolDef | undefined, all: ReadonlyArray<ToolDef>, id: string): string {
  return resolveToolTemplates(def, all).find((t) => t.id === id)?.prompt ?? ''
}

/** 组装一次工具调用（面板点「发送」时用的就是这个） */
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

/** 素材 → 编辑器的 @ 引用候选（图片/视频带 url，文本带 value） */
export function toEditorResources(
  materials: ReadonlyArray<UpstreamMaterial>,
  onPreview?: (m: UpstreamMaterial) => void,
): ResourceItem[] {
  return materials.map((m, i) => {
    const base = { id: m.id, name: m.name || `素材${i + 1}`, category: '素材' }
    if (m.kind === 'text') {
      return {
        ...base,
        value: m.value ?? '',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><path d="M4 7V4h16v3"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="8" y1="20" x2="16" y2="20"/></svg>',
      }
    }
    return {
      ...base,
      url: m.url,
      mediaType: m.kind === 'video' ? 'video' : m.kind === 'audio' ? 'audio' : 'image',
      onClick: onPreview ? () => onPreview(m) : undefined,
    }
  })
}

/** 编辑器用它把 @ 出来的资源还原成真实资源（编辑已有文档时用；按 id 优先、名字兜底） */
export function makeResourceResolver(
  items: ReadonlyArray<ResourceItem>,
): (name: string) => ResourceItem | null {
  return (token: string) => items.find((r) => r.id === token) ?? items.find((r) => r.name === token) ?? null
}

/**
 * 生成前的最小校验：没有工具、或既没提示词也没素材 → 不该发起调用。
 * @returns 不通过时给用户看的文案；通过返回空串
 */
export function validateGenInput(prompt: string, def: ToolDef | undefined, resources: number): string {
  if (!def) return '没有可用的生成工具，请先安装提供文本生成能力的工具插件'
  if (!(prompt || '').trim() && resources === 0) return '请先写下你的要求，或连一个素材进来'
  return ''
}

/** 面板状态区文案（把"跑没跑、跑到哪、错在哪"收敛成一句话 + 色调） */
export interface PanelStatus {
  text: string
  tone: 'idle' | 'busy' | 'error' | 'done'
}

export function panelStatusText(args: {
  running: boolean
  progressMessage?: string
  error?: string
  doneHint?: string
}): PanelStatus {
  if (args.error) return { text: args.error, tone: 'error' }
  if (args.running) return { text: args.progressMessage || '生成中…', tone: 'busy' }
  if (args.doneHint) return { text: args.doneHint, tone: 'done' }
  return { text: '', tone: 'idle' }
}
