/**
 * pluginLoader —— 后台插件加载器。
 *
 * 插件只有**一种布局**（用户口径 2026-11-12）：
 *
 *   <数据根>/plugins/<插件目录名>/
 *   ├── package.json      ← plume.web.entry / plume.server.entry 是唯一事实源
 *   └── dist/{web.js, server.js}
 *
 * 后台半读 `package.json` 里**声明的** `plume.server.entry`，不是写死 `server.js`；
 * 作者写 `dist/my-server.js` 也照样能装、能加载。
 *
 * 加载方式沿用既有结论：读文本 → `import(data:text/javascript,…)`。
 * 不用 `import(路径)`（打包/测试运行器里会被改写），data: URL 在 Node 与浏览器两边都稳；
 * 代价是插件必须是**自包含单文件**（data: URL 没有基准目录解析相对 import）。
 *
 * 安全：扫目录等于「把 JS 当服务端代码执行」，边界是**谁能写数据根下的插件目录**。
 * 这里只读、只扫一层插件目录，不跟随软链、不递归、单个失败不影响其它。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PluginModule } from '@plume-canvas/kernel'
import { listPluginIds, resolvePluginDirWithServer, type PluginRoots } from '../plugins/pluginRoots.js'

export interface ServerPluginLoadResult {
  modules: PluginModule[]
  /** 逐个文件的加载情况（诊断用：哪个插件坏了、为什么） */
  failures: Array<{ file: string; error: string }>
  /** 每个成功加载的模块来自哪个插件目录；与 modules 同序 */
  sources: string[]
}

/** 判一个来源不明的模块是不是合法后台插件（最少要有 name 与 apply） */
export function isValidServerPlugin(v: unknown): v is PluginModule {
  if (!v || typeof v !== 'object') return false
  const m = v as Partial<PluginModule>
  if (typeof m.name !== 'string' || m.name === '') return false
  return typeof m.apply === 'function'
}

/**
 * 扫插件根，把每个带后台半的插件加载成后台插件。
 *
 * 位置：`<pluginsDir>/<插件目录名>/<package.json 里 plume.server.entry 声明的相对路径>`。
 * 目录不存在 / 没声明后台入口 → 跳过（正常情况，不是错误）。
 */
export async function loadServerPluginsFromPluginDirs(
  pluginsDir: string | PluginRoots | undefined,
): Promise<ServerPluginLoadResult> {
  const modules: PluginModule[] = []
  const failures: ServerPluginLoadResult['failures'] = []
  const sources: string[] = []
  if (!pluginsDir) return { modules, failures, sources }

  // 两层根：全局优先、随包兜底（按插件解析，见 plugins/pluginRoots.ts）
  const roots: PluginRoots = typeof pluginsDir === 'string' ? { global: pluginsDir } : pluginsDir
  const names = await listPluginIds(roots)

  for (const name of names.sort()) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    // 只认**真带后台入口**的那一份：旧版全局副本没有 server 段时会回落到随包那份
    const resolved = await resolvePluginDirWithServer(roots, name)
    if (!resolved) continue
    const dir = resolved
    let entry: string | undefined
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as {
        plume?: { server?: { entry?: unknown } }
      }
      const declared = pkg.plume?.server?.entry
      if (typeof declared !== 'string' || declared.trim() === '') continue
      entry = declared.trim().replace(/\\/g, '/')
      // 只收包内相对路径（拒绝绝对路径与 .. 穿越）
      if (path.isAbsolute(entry) || entry.split('/').includes('..')) {
        failures.push({ file: name + '/package.json', error: 'plume.server.entry 必须是包内相对路径：' + declared })
        continue
      }
    } catch {
      continue // 没 package.json / 读不了：不是插件目录，跳过
    }

    const file = path.join(dir, entry)
    let text: string
    try {
      text = await fs.readFile(file, 'utf8')
    } catch {
      failures.push({ file: name + '/' + entry, error: '声明的后台入口不存在' })
      continue
    }

    try {
      const mod = (await importPluginModule(file, text)) as Record<string, unknown>
      const candidate = mod.default ?? mod
      if (!isValidServerPlugin(candidate)) {
        failures.push({ file: name + '/' + entry, error: '不是合法后台插件（需导出 name 与 apply）' })
        continue
      }
      modules.push(candidate)
      sources.push(name)
    } catch (err) {
      failures.push({ file: name + '/' + entry, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { modules, failures, sources }
}

/**
 * 把一个插件产物加载成模块。
 *
 * 用**真实文件路径**（`import(fileUrl)`）：这样 `import.meta.url` 是 file 方案，
 * 依赖树里的 `createRequire(import.meta.url)` 才能正常工作（Agent 的 SDK 就这么用）。
 * data: URL 留给退化路径：某些打包/测试运行器会拦路径 import。
 */
async function importPluginModule(file: string, text: string): Promise<unknown> {
  try {
    // 破缓存：同一路径换了内容时要重新加载（开发期常见）
    return await import(/* @vite-ignore */ pathToFileURL(file).href + '?t=' + Date.now())
  } catch (err) {
    try {
      return await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text))
    } catch {
      throw err
    }
  }
}

