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
  /** secret 只存明文在服务端；下发接口给掩码 */
  values: Record<string, string | number | boolean>
}

/** 一个 provider 文件的配置（账号清单） */
export interface ProviderFileConfig {
  accounts: ProviderAccount[]
}

/** providers-config.json 的完整形状 */
export interface ProviderConfigFile {
  version: 2
  disabledFiles: string[]
  deletedFiles: string[]
  files: Record<string, ProviderFileConfig>
}

export function emptyProviderConfig(): ProviderConfigFile {
  return { version: 2, disabledFiles: [], deletedFiles: [], files: {} }
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
    if (Array.isArray(raw.disabledFiles)) {
      out.disabledFiles = raw.disabledFiles.filter((n): n is string => typeof n === 'string')
    }
    if (Array.isArray(raw.deletedFiles)) {
      out.deletedFiles = raw.deletedFiles.filter((n): n is string => typeof n === 'string')
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
  accounts: Array<{ id: string; name?: string; values: Record<string, string | number | boolean> }>
}): string {
  const accounts = values.accounts.map((a) => ({
    id: a.id,
    ...(a.name ? { name: a.name } : {}),
    values: a.values,
  }))
  const first = accounts[0]?.values ?? {}
  const byId: Record<string, Record<string, string | number | boolean>> = {}
  for (const a of accounts) byId[a.id] = a.values
  return 'const __mcProviderConfig = ' + JSON.stringify({ accounts, values: first, byId }) + ';\n'
}
