/**
 * 预设的落点：**后台 KV 优先**，后台不可用再退回本机 localStorage。
 *
 * 为什么要后台（用户 2026-11-07）：换台机器、换个浏览器，自己攒的预设应该还在。
 * 为什么还要本地兜底：后台没起 / 离线调试时，预设面板不能变成一片空白。
 *
 * 契约与 /api/kv/:type/:key 一致（见 cloud-server routes/kv.ts）：
 *   GET  → 200 { value } / 404（从未保存过）
 *   PUT  body { value }
 * 落点用 `config` 作用域下的一个 key，和 AI 动作清单同一个桶。
 */
import {
  loadPromptPresets,
  normalizePresets,
  savePromptPresets,
  type PromptPreset,
} from './promptPresets'

/** KV 里的 key（type=config） */
export const PRESET_KV_KEY = 'bottom-bar-presets'

/**
 * 按节点类型分开存（用户 2026-11-07：不同平台 / 类型的提示词预设是分开的）。
 * 不传 nodeType = 老的通用那一份，老数据继续可读。
 */
export function presetPathOf(nodeType?: string): string {
  const type = String(nodeType ?? '').trim().toLowerCase()
  const key = type ? PRESET_KV_KEY + ':' + type : PRESET_KV_KEY
  return '/api/kv/config/' + key
}

/** 读一次失败的常见原因 -> 一句人话（面板上直接显示） */
function readable(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg || '后台不可用'
}

/**
 * 读预设：先问后台，拿不到就用本机那份。
 *
 * 返回 `fromCloud` 让调用方能显示「存在哪」—— 用户在设置里改了一个开关却不知道存哪，
 * 这是最容易困惑的一点。
 */
export async function loadPresets(opts: {
  baseUrl?: string
  fetchImpl?: typeof fetch
  storage?: Storage | null
  /** 节点类型：文本 / 图片 / 视频 / 音频各存一份 */
  nodeType?: string
} = {}): Promise<{ list: PromptPreset[]; fromCloud: boolean; error?: string }> {
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  const local = loadPromptPresets(opts.storage, opts.nodeType)
  if (!f) return { list: local, fromCloud: false, error: '当前环境没有可用的 fetch' }
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  try {
    const res = await f(base + presetPathOf(opts.nodeType), { headers: { accept: 'application/json' } })
    // 404 = 后台没存过：不是错误，用本地那份（首次从本地搬上云由 savePresets 完成）
    if (res.status === 404) return { list: local, fromCloud: false }
    if (!res.ok) return { list: local, fromCloud: false, error: '读取预设失败 ' + res.status }
    const body = (await res.json()) as { value?: unknown }
    // 云端有值就以云端为准（哪怕是空数组：用户可能把预设全删了）
    return { list: normalizePresets(body.value), fromCloud: true }
  } catch (err) {
    return { list: local, fromCloud: false, error: readable(err) }
  }
}

/**
 * 写预设：先写后台，成功就不动本机；失败则写本机并回报原因。
 *
 * 为什么失败也写本机：预设是用户自己敲的，不能因为后台暂时没起就丢掉。
 */
export async function savePresets(
  list: PromptPreset[],
  opts: { baseUrl?: string; fetchImpl?: typeof fetch; storage?: Storage | null; nodeType?: string } = {},
): Promise<{ ok: boolean; where: 'cloud' | 'local'; error?: string }> {
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  if (f) {
    try {
      const res = await f(base + presetPathOf(opts.nodeType), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: list }),
      })
      if (res.ok) return { ok: true, where: 'cloud' }
      const localOk = savePromptPresets(list, opts.storage, opts.nodeType)
      return {
        ok: localOk,
        where: 'local',
        error: localOk ? '后台写入失败 ' + res.status + '，已暂存在本机' : '后台与本机都写入失败',
      }
    } catch (err) {
      const localOk = savePromptPresets(list, opts.storage, opts.nodeType)
      return {
        ok: localOk,
        where: 'local',
        error: localOk ? '后台不可用（' + readable(err) + '），已暂存在本机' : '后台与本机都写入失败',
      }
    }
  }
  const localOk = savePromptPresets(list, opts.storage, opts.nodeType)
  return {
    ok: localOk,
    where: 'local',
    ...(localOk ? { error: '当前环境没有可用的 fetch，已存在本机' } : { error: '本机存储不可用' }),
  }
}
