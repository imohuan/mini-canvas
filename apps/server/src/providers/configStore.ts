/**
 * provider 配置存储 —— <数据根>/providers-config.json 的读写（启停 / 配置 / 账号）。
 *
 * 为什么按**文件名**做 key（而不是 provider id）：装载器 import 之前拿不到 id，
 * 「注入已存值」必须发生在执行前 —— 只有文件名在那一刻是已知的。
 * seed 的「补缺失文件」、装载过滤、注入三件事共用这一个 key，鸡生蛋问题就没了。
 *
 * 结构（v2，多账号）：
 *   {
 *     version: 2,
 *     disabledFiles: ['web2api-image.js'],   // 停用的 provider 文件（装载时跳过）
 *     deletedFiles: ['web2api-video.js'],    // 用户删掉的默认文件（重启不再铺回）
 *     files: {                                // 每个文件：默认账号 + 账号清单
 *       'web2api-image.js': {
 *         accounts: [
 *           { id: 'main', name: '默认', values: { baseUrl: '…' } },
 *           { id: 'backup', name: '备用号', values: { apiKey: 'sk-…' } },
 *         ],
 *       },
 *     },
 *   }
 *
 * 旧结构兼容：v1 只有 values（单账号）→ 读进来展开成一个 main 账号。
 */
import { promises as fs } from 'node:fs'

/** 一个账号的一套配置值（key 与 provider 声明的 config[].key 对应） */
export interface ProviderAccount {
  id: string
  name?: string
  /** 默认账号：不选号时用它（用户口径 2026-11-10：要多账号里的默认号） */
  default?: boolean
  /** secret 只存明文在服务端；下发接口给掩码 */
  values: Record<string, string | number | boolean>
}

/** 一个 provider 文件的配置（账号清单） */
export interface ProviderFileConfig {
  accounts: ProviderAccount[]
}

/**
 * 新版「点分隔 key」配置：一个平铺对象，key 就是 `providerId.field` 或 `providerId.field.[n]`。
 *
 * 为什么要有它：用户口径 2026-11-10 —— 「所有 provider 的配置放在同一级别的 JSON 中，
 * key 支持点隔开；相同配置只需对应的 key 一样」。于是：
 * - `token01.baseUrl`           = 平台通用（所有账号共用一份）
 * - `token01.apiKey.[0]`        = 第 0 个账号的 apiKey（解析时还原成数组）
 * - `web2api.baseUrl`           = 另一个平台引用同一个 key 名前缀，值天然共用一份
 *
 * 账号清单（id / name / 默认）仍放在 `platforms` 里 —— 数组下标本身不携带名字。
 */
export interface ProviderPlatformMeta {
  accounts: Array<{ id: string; name?: string; default?: boolean }>
  /** 平台展示信息快照：停用后 import 不到文件了，靠这份继续显示名字/介绍/图标 */
  title?: string
  description?: string
  icon?: string
}

/** 一个生成类型的默认模型（图片 / 视频 / 音频 / 文本 / 以后可能有 3D） */
export type ModelDefaults = Record<string, string>

/** providers-config.json 的完整形状 */
export interface ProviderConfigFile {
  version: 2
  disabledFiles: string[]
  deletedFiles: string[]
  files: Record<string, ProviderFileConfig>
  /** 平铺的点分隔 key → 值（新结构；缺省 = 还没迁移过来，继续读旧 files） */
  config?: Record<string, string | number | boolean>
  /** platformId → 账号清单（名字、默认号） */
  platforms?: Record<string, ProviderPlatformMeta>
  /** 生成类型 → 默认模型 id（全局，不分平台） */
  defaults?: ModelDefaults
}

export function emptyProviderConfig(): ProviderConfigFile {
  return { version: 2, disabledFiles: [], deletedFiles: [], files: {}, config: {}, platforms: {}, defaults: {} }
}

/** 文件名白名单：只允许普通 .js 名（无路径分隔），杜绝路径穿越 */
export function isSafeFileName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(name) && !name.includes('..')
}

/** 读配置文件；不存在 / 坏 JSON / v1 旧格式 → 尽量转换，绝不抛 */
export async function readProviderConfig(file: string): Promise<ProviderConfigFile> {
  try {
    const text = await fs.readFile(file, 'utf8')
    const raw = JSON.parse(text) as Record<string, unknown>
    if (!raw || typeof raw !== 'object') return emptyProviderConfig()
    const out = emptyProviderConfig()
    // emptyProviderConfig() 一定会给这三张表；这里重新取一次是为了让 TS 知道它们不是 undefined
    const config = (out.config ||= {})
    const platforms = (out.platforms ||= {})
    const defaults = (out.defaults ||= {})
    if (Array.isArray(raw.disabledFiles)) {
      out.disabledFiles = raw.disabledFiles.filter((n): n is string => typeof n === 'string')
    }
    if (Array.isArray(raw.deletedFiles)) {
      out.deletedFiles = raw.deletedFiles.filter((n): n is string => typeof n === 'string')
    }
    // 新结构：平铺的点分隔 key；值只收标量（数组由 `.[n]` 表达）
    if (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) {
      for (const [k, v] of Object.entries(raw.config as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') config[k] = v
      }
    }
    // platformId → 账号清单（名字与默认号；值在 config 里）
    if (raw.platforms && typeof raw.platforms === 'object' && !Array.isArray(raw.platforms)) {
      for (const [pid, v] of Object.entries(raw.platforms as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue
        const accounts = (v as { accounts?: unknown }).accounts
        if (!Array.isArray(accounts)) continue
        platforms[pid] = {
          accounts: accounts
            .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
            .map((a) => ({
              id: typeof a.id === 'string' ? a.id : '',
              ...(typeof a.name === 'string' && a.name !== '' ? { name: a.name } : {}),
              ...(a.default === true ? { default: true } : {}),
            }))
            .filter((a) => a.id !== ''),
          ...(typeof (v as { title?: unknown }).title === 'string' && (v as { title: string }).title !== ''
            ? { title: (v as { title: string }).title }
            : {}),
          ...(typeof (v as { description?: unknown }).description === 'string' &&
          (v as { description: string }).description !== ''
            ? { description: (v as { description: string }).description }
            : {}),
          ...(typeof (v as { icon?: unknown }).icon === 'string' && (v as { icon: string }).icon !== ''
            ? { icon: (v as { icon: string }).icon }
            : {}),
        }
      }
    }
    // 生成类型 → 默认模型
    if (raw.defaults && typeof raw.defaults === 'object' && !Array.isArray(raw.defaults)) {
      for (const [k, v] of Object.entries(raw.defaults as Record<string, unknown>)) {
        if (typeof v === 'string' && v !== '') defaults[k] = v
      }
    }
    // v2：files[文件名].accounts
    if (raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files)) {
      for (const [name, v] of Object.entries(raw.files as Record<string, unknown>)) {
        if (!isSafeFileName(name) || !v || typeof v !== 'object') continue
        const accounts = (v as { accounts?: unknown }).accounts
        if (!Array.isArray(accounts)) continue
        out.files[name] = {
          accounts: accounts
            .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
            .map((a) => ({
              id: typeof a.id === 'string' ? a.id : '',
              ...(typeof a.name === 'string' ? { name: a.name } : {}),
              values: normalizeValues((a as { values?: unknown }).values),
            }))
            .filter((a) => a.id !== ''),
        }
      }
    } else if (raw.values && typeof raw.values === 'object') {
      // v1 兼容：顶层 values = 单账号（main）
      out.files = {}
      const values = normalizeValues(raw.values)
      if (Object.keys(values).length > 0) {
        out.files['*'] = { accounts: [{ id: 'main', values }] }
      }
    }
    return out
  } catch {
    return emptyProviderConfig()
  }
}

function normalizeValues(v: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') out[k] = val
  }
  return out
}

/** `a.b.[0]` → `{ base: 'a.b', index: 0 }`；不是账号下标时 index 为 undefined */
export function splitArrayKey(key: string): { base: string; index?: number } {
  const m = /^(.*?)\.\[(\d+)\]$/.exec(key)
  if (!m) return { base: key }
  return { base: m[1]!, index: Number(m[2]) }
}

/** 点分隔 key 的最后一段就是字段名（`token01.baseUrl` → `baseUrl`；`token01.apiKey.[0]` → `apiKey`） */
export function fieldOfKey(key: string): string {
  const base = splitArrayKey(key).base
  const parts = base.split('.')
  return parts[parts.length - 1] ?? base
}

/** key 的前缀（平台部分）：`token01.apiKey.[0]` → `token01` */
export function platformOfKey(key: string): string {
  return splitArrayKey(key).base.split('.')[0] ?? ''
}

/**
 * 把「平铺的点分隔 key」还原成 provider 运行期读的账号结构。
 *
 * 规则（用户口径 2026-11-10）：
 *   `pid.field`      → 平台通用值，写进每个账号的 values（账号自己覆盖过才不同）
 *   `pid.field.[n]`  → 第 n 个账号的值，覆盖通用值
 * 账号 id / name / 默认号来自 `platforms[pid].accounts`（顺序即下标）。
 */
export function accountsForPlatform(
  config: Record<string, string | number | boolean>,
  meta: ProviderPlatformMeta | undefined,
  pid: string,
): Array<{ id: string; name?: string; default?: boolean; values: Record<string, string | number | boolean> }> {
  /** 通用值：任何不带 `.[n]` 且前缀是 pid 的 key */
  const shared: Record<string, string | number | boolean> = {}
  /** 账号级：field → (index → value) */
  const perAccount = new Map<string, Map<number, string | number | boolean>>()

  for (const [key, value] of Object.entries(config)) {
    if (platformOfKey(key) !== pid) continue
    const { index } = splitArrayKey(key)
    const field = fieldOfKey(key)
    if (index === undefined) {
      shared[field] = value
    } else {
      let byIndex = perAccount.get(field)
      if (!byIndex) perAccount.set(field, (byIndex = new Map()))
      byIndex.set(index, value)
    }
  }

  const declared = meta?.accounts ?? []
  // 下标比声明的账号多（用户手改过 JSON）也要能读出来：按最大下标补齐
  let count = declared.length
  for (const byIndex of perAccount.values()) {
    for (const idx of byIndex.keys()) count = Math.max(count, idx + 1)
  }
  if (count === 0) return []

  const out = []
  for (let i = 0; i < count; i++) {
    const acc = declared[i]
    const values: Record<string, string | number | boolean> = { ...shared }
    for (const [field, byIndex] of perAccount) {
      const v = byIndex.get(i)
      if (v !== undefined) values[field] = v
    }
    out.push({
      id: acc?.id ?? 'account-' + (i + 1),
      ...(acc?.name ? { name: acc.name } : {}),
      ...(acc?.default ? { default: true } : {}),
      values,
    })
  }
  return out
}

/** 原子写（先写临时再改名，半截写入不会把配置打坏） */
export async function writeProviderConfig(file: string, data: ProviderConfigFile): Promise<void> {
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, file)
}

/**
 * 生成注入 provider 源码的 `__mcProviderConfig` 常量文本。
 *
 * 形状（provider 里这样读）：
 *   typeof __mcProviderConfig === 'undefined' 兜底；
 *   __mcProviderConfig.accounts  — 账号清单 [{id, name, values}]
 *   __mcProviderConfig.values    — 第一账号的 values（单账号场景最常用）
 *   __mcProviderConfig.byId      — { 账号id → values }
 */
export function injectTextFor(values: {
  accounts: Array<{ id: string; name?: string; default?: boolean; values: Record<string, string | number | boolean> }>
}): string {
  const accounts = values.accounts.map((a) => ({
    id: a.id,
    ...(a.name ? { name: a.name } : {}),
    ...(a.default ? { default: true } : {}),
    values: a.values,
  }))
  const first = accounts[0]?.values ?? {}
  /** 默认账号：没标默认时就是第一个 */
  const defaultId = values.accounts.find((a) => a.default)?.id ?? accounts[0]?.id ?? ''
  const byId: Record<string, Record<string, string | number | boolean>> = {}
  for (const a of accounts) byId[a.id] = a.values
  return (
    'const __mcProviderConfig = ' +
    JSON.stringify({ accounts, values: first, byId, defaultId }) +
    ';\n'
  )
}
