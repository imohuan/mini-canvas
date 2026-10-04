/**
 * pluginLoader —— 后台插件加载器（Task 4）。
 *
 * 「丢一个 .js 进目录 = 多一个后台插件」。与 `providers/load.ts` 是同一手法，
 * 只是加载的对象不同：那边是"平台提供方"（submit/poll/cancel），
 * 这边是**任意后台插件**（{name, inject?, apply}，能注册路由/中间件/服务）。
 *
 * ## 加载方式：读文本 → `import(data:text/javascript,...)`
 *
 * 复用 providers/load.ts 的既有结论（那里有完整理由）：不用 `import(路径)`
 * （打包/测试运行器里会被改写），`data:` URL 形态在 Node 与浏览器两边都稳。
 * 代价同样是**插件必须是自包含单文件**（data: URL 没有基准目录解析相对 import）。
 *
 * ## 安全（明显的攻击面，别放松）
 *
 * 扫目录 `import()` 等于**把任意 JS 当服务端代码执行**。边界照抄 providers/load.ts：
 * - 只扫显式给的那个目录（默认 `<数据根>/server-plugins`）；
 * - **不跟随软链**（`withFileTypes` 判 `isFile`）；
 * - **不递归子目录**（一层，看得清）；
 * - 跳过 `_` / `.` 开头的文件；
 * - 单个文件失败**不影响其它**（记一条 failure，服务照常起）。
 *
 * 「谁能往这个目录写文件」就是信任边界 —— 与「谁能改服务器代码」等价。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PluginModule } from '@mini-canvas/kernel'

/** 默认的后台插件目录名（挂在数据根下，与 kv / canvases / providers 并列） */
export const DEFAULT_SERVER_PLUGINS_DIR = 'server-plugins'

export interface ServerPluginLoadResult {
  modules: PluginModule[]
  /** 逐个文件的加载情况（诊断用：哪个文件坏了、为什么） */
  failures: Array<{ file: string; error: string }>
}

/** 判一个来源不明的模块是不是合法后台插件（最少要有 name 与 apply/setup） */
export function isValidServerPlugin(v: unknown): v is PluginModule {
  if (!v || typeof v !== 'object') return false
  const m = v as Partial<PluginModule>
  if (typeof m.name !== 'string' || m.name === '') return false
  return typeof m.apply === 'function' || typeof m.setup === 'function'
}

/**
 * 扫一个目录，把里面每个 `.js` 当成后台插件加载。
 * @param dir 插件目录；不存在 → 返回空（不是错误：可以一个外挂都没有）
 */
export async function loadServerPluginsFromDir(dir: string): Promise<ServerPluginLoadResult> {
  const modules: PluginModule[] = []
  const failures: ServerPluginLoadResult['failures'] = []

  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (isNotFound(err)) return { modules, failures }
    throw err
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue // 软链/目录一律跳过
    if (!entry.name.endsWith('.js')) continue
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const file = path.join(dir, entry.name)
    try {
      const text = await fs.readFile(file, 'utf8')
      const mod = (await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text))) as Record<string, unknown>
      // 两种写法都认：具名导出（name/apply 在顶层），或 default 整体导出
      const candidate = mod.default ?? mod
      if (!isValidServerPlugin(candidate)) {
        // 帮作者区分"放错目录"：provider（平台提供方）有它自己的目录与加载器。
        // 把 provider 丢进 server-plugins 是常见混淆 —— 错误信息里直接指路。
        const looksLikeProvider =
          candidate &&
          typeof candidate === 'object' &&
          typeof (candidate as { id?: unknown }).id === 'string' &&
          Array.isArray((candidate as { actions?: unknown }).actions)
        failures.push({
          file: entry.name,
          error: looksLikeProvider
            ? '这看起来是「平台提供方(provider)」：它要放到 providers 目录（不是 server-plugins）。见 providers/load.ts'
            : '不是合法后台插件（需导出 name 与 apply/setup）',
        })
        continue
      }
      modules.push(candidate)
    } catch (err) {
      failures.push({ file: entry.name, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { modules, failures }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
