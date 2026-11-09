/**
 * 底栏「预设提示词」的纯数据逻辑（零 Vue / 零 DOM，Node 可单测）。
 *
 * 为什么存在本机 localStorage，而不是云端 KV：
 * 预设提示词是「我这台电脑上常用的几句话」，改起来很随意；
 * 走云端就要处理登录、同步冲突、后台没起时的加载失败。
 * 先用一个本地键存起来，行为最可预期，也不会影响别人那份配置。
 */

/** 一条预设：名字给人看，内容原样填进输入框 */
export interface PromptPreset {
  id: string
  name: string
  content: string
  createdAt: number
  /**
   * 针对哪个动作 / 模型（bar action id）。缺省 = 全局通用预设。
   * 应用时若这个动作在当前节点上不存在，预设显示为禁用。
   */
  actionId?: string
  /** 应用时一并写入的参数值（键 = ToolParamDef.key） */
  values?: Record<string, unknown>
  /**
   * 应用方式（用户 2026-11-09）：
   * - 'append'（默认）：接在输入框现有内容后面
   * - 'replace'：清空输入框，只留这条预设
   */
  applyMode?: PresetApplyMode
  /** 来源：user = 自己建的；provider = 后台动作自带的模板 */
  source?: 'user' | 'provider'
}

/** 预设的应用方式 */
export type PresetApplyMode = 'append' | 'replace'

/** 预设按「归属」分成三类展示（provider 带的自成一类） */
export type PresetBucket = 'provider' | 'general' | 'model'

/** 一条预设属于哪一类：provider 自带 / 全局通用 / 指定模型 */
export function presetBucketOf(p: PromptPreset): PresetBucket {
  if (p.source === 'provider') return 'provider'
  return p.actionId ? 'model' : 'general'
}

/** 存储键（只属于这个功能，不和其他底栏配置共用） */
export const PROMPT_PRESETS_KEY = 'mini-canvas:prompt-presets'

/**
 * 按节点类型分开存（用户 2026-11-07：不同平台的提示词预设是分开的）。
 *
 * 为什么不是一个大清单再加 type 字段：类型是「查哪一份」的键，
 * 分键之后读文本预设时不会把图片预设也读进来再筛一遍，
 * 删改也只碰当前那一份 —— 一份坏了不影响另一份。
 */
export function presetStorageKey(nodeType?: string): string {
  const type = String(nodeType ?? '').trim().toLowerCase()
  return type ? PROMPT_PRESETS_KEY + ':' + type : PROMPT_PRESETS_KEY
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 把存储里读出来的东西整理成合法清单。
 *
 * 坏数据一律丢掉（用户手改过 localStorage、旧版本字段不同、写入到一半断电），
 * 宁可少一条，也不要让面板渲染时报错。
 */
export function normalizePresets(raw: unknown): PromptPreset[] {
  if (!Array.isArray(raw)) return []
  const out: PromptPreset[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const content = textOf(rec.content)
    if (content.trim() === '') continue
    const name = textOf(rec.name).trim() || content.trim().slice(0, 12)
    const id = textOf(rec.id).trim() || 'preset-' + out.length
    if (seen.has(id)) continue
    seen.add(id)
    const createdAt = typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt)
      ? rec.createdAt
      : 0
    const actionId = textOf(rec.actionId).trim()
    const values = plainValues(rec.values)
    // 只有明确写了 'replace' 才算替换；其它（缺省 / 旧数据 / 脏值）一律按追加
    const applyMode: PresetApplyMode = rec.applyMode === 'replace' ? 'replace' : 'append'
    out.push({
      id,
      name,
      content,
      createdAt,
      ...(actionId ? { actionId } : {}),
      ...(values ? { values } : {}),
      ...(applyMode === 'replace' ? { applyMode } : {}),
      ...(rec.source === 'provider' ? { source: 'provider' as const } : {}),
    })
  }
  return out
}

/**
 * 参数快照：只收「普通对象」，值也必须是标量。
 * 预设来自浏览器存储 / 网络，脏数据（数组、嵌套对象、函数）直接丢掉，别让面板渲染时炸。
 */
function plainValues(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 当前环境能不能用 localStorage（SSR / 隐私模式下没有） */
function defaultStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** 读预设清单；没存过 / 坏了 / 读不到一律当空清单 */
export function loadPromptPresets(
  storage: Storage | null = defaultStorage(),
  nodeType?: string,
): PromptPreset[] {
  if (!storage) return []
  const read = (key: string): PromptPreset[] => {
    try {
      const raw = storage.getItem(key)
      if (!raw) return []
      return normalizePresets(JSON.parse(raw))
    } catch {
      return []
    }
  }
  const typed = read(presetStorageKey(nodeType))
  if (typed.length > 0) return typed
  // 老数据迁移：以前的单一清单当作「通用」，第一次读某个类型时复制过去，
  // 之后各类型独立增删，不再受那份旧清单影响。
  return read(PROMPT_PRESETS_KEY)
}

/** 整包写回；写不进去（配额满 / 禁用存储）返回 false，由调用方提示 */
export function savePromptPresets(
  list: PromptPreset[],
  storage: Storage | null = defaultStorage(),
  nodeType?: string,
): boolean {
  if (!storage) return false
  try {
    storage.setItem(presetStorageKey(nodeType), JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/** 新建一条（id 由时间戳 + 随机段组成，够用且不会和旧条目撞） */
export function createPreset(name: string, content: string, now = Date.now()): PromptPreset {
  const body = content.trim()
  return {
    id: 'preset-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    name: name.trim() || body.slice(0, 12) || '未命名预设',
    content: body,
    createdAt: now,
  }
}

/**
 * 新建一条预设（带模型与参数）。
 *
 * 与 createPreset 分开而不是加一堆可选参数：老调用点还在用「只存一句提示词」的形状，
 * 保持它不变，新增的入口走这一条。
 */
export function createTypedPreset(input: {
  name?: string
  content: string
  actionId?: string
  values?: Record<string, unknown>
  applyMode?: PresetApplyMode
  now?: number
}): PromptPreset {
  const now = input.now ?? Date.now()
  const base = createPreset(input.name ?? '', input.content, now)
  const actionId = input.actionId?.trim()
  const values = input.values && Object.keys(input.values).length > 0 ? { ...input.values } : undefined
  const applyMode = input.applyMode === 'replace' ? 'replace' : 'append'
  return {
    ...base,
    ...(actionId ? { actionId } : {}),
    ...(values ? { values } : {}),
    ...(applyMode === 'replace' ? { applyMode } : {}),
  }
}

/**
 * 当前节点能用哪些预设：
 * - 全局通用（没有 actionId）永远可用；
 * - 指定模型的，只有该模型在当前节点可用时才行。
 *
 * `availableIds` 是本节点可选的动作 id 集合（含后台 provider 与本插件）。
 */
export function presetEnabled(p: PromptPreset, availableIds: ReadonlySet<string>): boolean {
  if (!p.actionId) return true
  return availableIds.has(p.actionId)
}

/** 按关键词过滤：名字和内容都能搜，忽略大小写与首尾空格 */
export function filterPresets(list: PromptPreset[], query: string): PromptPreset[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (p) => p.name.toLowerCase().includes(q) || p.content.toLowerCase().includes(q),
  )
}

/** 新条目放最前面：刚建的那条立刻能看到 */
export function addPreset(list: PromptPreset[], preset: PromptPreset): PromptPreset[] {
  return [preset, ...list.filter((p) => p.id !== preset.id)]
}

/** 删除一条 */
export function removePreset(list: PromptPreset[], id: string): PromptPreset[] {
  return list.filter((p) => p.id !== id)
}
