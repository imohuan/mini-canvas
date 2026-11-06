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
}

/** 存储键（只属于这个功能，不和其他底栏配置共用） */
export const PROMPT_PRESETS_KEY = 'mini-canvas:prompt-presets'

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
    out.push({ id, name, content, createdAt })
  }
  return out
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
export function loadPromptPresets(storage: Storage | null = defaultStorage()): PromptPreset[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(PROMPT_PRESETS_KEY)
    if (!raw) return []
    return normalizePresets(JSON.parse(raw))
  } catch {
    return []
  }
}

/** 整包写回；写不进去（配额满 / 禁用存储）返回 false，由调用方提示 */
export function savePromptPresets(
  list: PromptPreset[],
  storage: Storage | null = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(PROMPT_PRESETS_KEY, JSON.stringify(list))
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
