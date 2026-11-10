/**
 * 从目录装载 provider —— 「后台的投递箱」。
 *
 * 与前端「丢插件进目录」是**对称**的：cloud-server 本来就在扫 packages/plugins 给前端用，
 * 现在再扫一个目录给后端用。区别只是那边加载到浏览器、这边加载到进程里。
 *
 * 加载方式：**读出文件文本 → 用 `data:` URL 导入**（与前端加载插件的 `loadPluginFromText`
 * 同一手法）。为什么不用 `import(路径)`：路径式动态导入在打包/测试运行器里会被改写，
 * 而 `data:` URL 形态在 Node 与浏览器两边都稳。
 *
 * 代价与前端一致：**provider 必须是自包含的单文件**（相对 import 在 data: URL 里没有基准目录）。
 * 这本来就是"丢一个 js 进目录"的承诺，不算限制。
 *
 * ## 安全（必须说清，这是明确的攻击面）
 * 扫目录 `import()` 等于**把任意 JS 当服务端代码执行**。所以：
 * - 只扫显式给的那个目录（默认 `<数据根>/providers`），**不跟随软链**（用 `withFileTypes` 判 isFile）；
 * - 不递归子目录（一层，看得清）；
 * - 单个文件加载失败**不影响其它**（坏文件只记一条日志，服务照常起）。
 * “谁能往这个目录写文件”就是信任边界 —— 与「谁能改服务器代码」等价。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isValidProvider, type Provider } from './types.js'
import { injectTextFor, accountsForPlatform, platformOfKey, type ProviderConfigFile } from './configStore.js'

/** 默认的 provider 目录名（挂在数据根下，与 kv / canvases 并列） */
export const DEFAULT_PROVIDERS_DIR = 'providers'

export interface LoadResult {
  providers: Provider[]
  /** 逐个文件的加载情况（诊断用：哪个文件坏了、为什么） */
  failures: Array<{ file: string; error: string }>
  /** 成功装载的文件名（按装载顺序）—— 管理接口据此把 id 映射回文件 */
  files: string[]
}

/**
 * 扫一个目录，把里面每个 `.js` 当成 provider 加载。
 *
 * @param dir provider 目录；不存在 → 返回空（不是错误：可以一个外挂都没有）
 */
export async function loadProvidersFromDir(
  dir: string,
  opts?: { config?: ProviderConfigFile },
): Promise<LoadResult> {
  const providers: Provider[] = []
  const failures: LoadResult['failures'] = []
  const files: string[] = []
  // 没传 config（旧调用 / 单测）= 全部装载、不注入 —— 行为与从前一致。
  const cfg: ProviderConfigFile = opts?.config ?? EMPTY_CONFIG
  const disabled = new Set(cfg.disabledFiles)

  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (isNotFound(err)) return { providers, failures, files }
    throw err
  }

  for (const entry of entries) {
    // 只认普通文件（isFile 为 false 的软链/目录一律跳过 —— 别让软链把扫描带出这个目录）
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.js')) continue
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    if (disabled.has(entry.name)) continue
    const file = path.join(dir, entry.name)
    try {
      const text = await fs.readFile(file, 'utf8')
      // 已存配置注入源码最前面（import 都在后面也没关系：provider 读值发生在函数调用时，
      // 模块求值期先把 const 赋好即可）。没配过也注入空结构，provider 里 ?. / ?? 兜底统一。
      const injected = injectTextFor({ accounts: accountsForFile(cfg, entry.name) }) + text
      const mod = (await import(
        /* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(injected)
      )) as Record<string, unknown>
      // 支持两种写法：具名导出，或 default 整体导出
      const candidate = mod.default ?? mod
      if (!isValidProvider(candidate)) {
        failures.push({ file: entry.name, error: '不是合法 provider（需导出 id / actions / submit）' })
        continue
      }
      providers.push(candidate)
      files.push(entry.name)
    } catch (err) {
      // 坏文件不该把整个服务带崩 —— 记下来、继续扫下一个
      failures.push({ file: entry.name, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { providers, failures, files }
}

const EMPTY_CONFIG: ProviderConfigFile = {
  version: 2, disabledFiles: [], deletedFiles: [], files: {}, config: {}, platforms: {}, defaults: {},
}

/**
 * 取某个 provider 文件的账号配置。
 *
 * 两步合并，保证旧数据还能用：
 *   1. 旧结构 `files[文件名].accounts`（值直接写在账号里）；
 *   2. 新结构 `config` 里点分隔 key（`pid.field` / `pid.field.[n]`）。
 * 新结构优先：同一个字段两边都有时，以点分隔 key 为准（它才是界面正在编辑的那份）。
 */
function accountsForFile(
  cfg: ProviderConfigFile,
  file: string,
): Array<{ id: string; name?: string; default?: boolean; values: Record<string, string | number | boolean> }> {
  const legacy = cfg.files[file]?.accounts ?? []
  // 新结构按 provider id 分组；文件 → id 的映射在装载阶段才知道，这里两种都试：
  // 文件名去掉 .js 恰好就是历史约定（token01.js → token01），够用且不需要先 import。
  const guessId = file.replace(/\.js$/, '')
  const cfgPlatforms = cfg.platforms ?? {}
  const cfgConfig = cfg.config ?? {}
  const hasNew =
    Object.keys(cfgPlatforms).includes(guessId) ||
    Object.keys(cfgConfig).some((k) => platformOfKey(k) === guessId)
  if (!hasNew) return legacy

  const merged = accountsForPlatform(cfgConfig, cfgPlatforms[guessId], guessId)
  if (merged.length === 0) return legacy
  // 旧结构里可能有新结构还没搬过来的字段：只补缺，不覆盖
  for (let i = 0; i < merged.length; i++) {
    const old = legacy[i]
    if (!old) continue
    if (!merged[i]!.name && old.name) merged[i]!.name = old.name
    for (const [k, v] of Object.entries(old.values)) {
      if (merged[i]!.values[k] === undefined) merged[i]!.values[k] = v
    }
  }
  return merged
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

/**
 * 把随包自带的 provider（本包 providers/*.js）铺到数据根的 providers 目录。
 *
 * 只会写目标不存在 的文件 —— 用户改过 / 自己写的同名文件绝不被覆盖。
 * 目录不存在就建（缺目录本身等价于没有 provider，建出来才能放东西）。
 *
 * 为什么需要它：provider 是外挂文件，装包的人不会手写。随包带一份默认的，
 * 启动时铺好，装完就能生成 才成立。返回值是复制了哪些文件名（给启动日志用）。
 */
export async function seedDefaultProviders(
  sourceDir: string,
  targetDir: string,
  opts?: { skip?: readonly string[] },
): Promise<string[]> {
  let names: string[]
  try {
    names = await fs.readdir(sourceDir)
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const copied: string[] = []
  try {
    await fs.mkdir(targetDir, { recursive: true })
  } catch {
    return []
  }
  for (const name of names) {
    if (!name.endsWith('.js')) continue
    if (name.startsWith('_') || name.startsWith('.')) continue
    // 用户删过的（deletedFiles）不再铺回 —— 不然「删了重启又回来」
    if (opts?.skip?.includes(name)) continue
    const target = path.join(targetDir, name)
    try {
      // 已存在（用户可能改过）→ 不动它
      await fs.access(target)
      continue
    } catch {
      // 不存在：可以复制
    }
    try {
      await fs.copyFile(path.join(sourceDir, name), target)
      copied.push(name)
    } catch {
      // 单个文件失败不影响启动
    }
  }
  return copied
}

