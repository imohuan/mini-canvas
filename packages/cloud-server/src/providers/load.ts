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

/** 默认的 provider 目录名（挂在数据根下，与 kv / canvases 并列） */
export const DEFAULT_PROVIDERS_DIR = 'providers'

export interface LoadResult {
  providers: Provider[]
  /** 逐个文件的加载情况（诊断用：哪个文件坏了、为什么） */
  failures: Array<{ file: string; error: string }>
}

/**
 * 扫一个目录，把里面每个 `.js` 当成 provider 加载。
 *
 * @param dir provider 目录；不存在 → 返回空（不是错误：可以一个外挂都没有）
 */
export async function loadProvidersFromDir(dir: string): Promise<LoadResult> {
  const providers: Provider[] = []
  const failures: LoadResult['failures'] = []

  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (isNotFound(err)) return { providers, failures }
    throw err
  }

  for (const entry of entries) {
    // 只认普通文件（isFile 为 false 的软链/目录一律跳过 —— 别让软链把扫描带出这个目录）
    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.js')) continue
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const file = path.join(dir, entry.name)
    try {
      const text = await fs.readFile(file, 'utf8')
      const mod = (await import(
        /* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text)
      )) as Record<string, unknown>
      // 支持两种写法：具名导出，或 default 整体导出
      const candidate = mod.default ?? mod
      if (!isValidProvider(candidate)) {
        failures.push({ file: entry.name, error: '不是合法 provider（需导出 id / actions / submit）' })
        continue
      }
      providers.push(candidate)
    } catch (err) {
      // 坏文件不该把整个服务带崩 —— 记下来、继续扫下一个
      failures.push({ file: entry.name, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { providers, failures }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
