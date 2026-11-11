/**
 * remote-plugins —— build 版本从 cloud-server 的清单装载插件。
 *
 * dev 与 build 是两条路（用户口径）：
 * - dev：`assembly.ts` 直接 import 插件源码，改完立刻热更，方便调试；
 * - build：界面包**不含任何插件**，启动时拉 `/plugin-catalog.json`，按清单逐个装。
 *
 * 这份文件只在 build 分支被 `await import()` 进来，所以 dev 下它连打包都不会参与。
 */
import type { PluginModule } from '@plume-canvas/kernel'

/** 清单里我们关心的字段（其余字段由插件管理自己用） */
interface CatalogEntry {
  id: string
  name: string
  url?: string
  format?: 'umd' | 'esm'
  globalName?: string
  requiresGlobals?: string[]
  builtin?: boolean
}

export interface RemoteCatalog {
  ok?: boolean
  plugins: CatalogEntry[]
  builtinInstallIds?: string[]
  firstInstallIds?: string[]
}

/** 拉清单。失败时抛错，由调用方决定是拦住界面还是降级。 */
export async function fetchCatalog(url = '/plugin-catalog.json'): Promise<RemoteCatalog> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error('拉取插件清单失败：HTTP ' + res.status)
  const json = (await res.json()) as RemoteCatalog
  if (!Array.isArray(json.plugins)) throw new Error('插件清单格式不对：缺 plugins 数组')
  return json
}

/**
 * 把清单里一个插件装进内核。
 *
 * 两条加载路（与插件管理一致）：
 * - `esm`：自包含 ESM，fetch 文本后 `import(data:)`；
 * - `umd`：`<script>` 注入，从 window 全局取。
 */
async function loadOne(
  entry: CatalogEntry,
  install: (mod: PluginModule) => void,
): Promise<void> {
  if (!entry.url) return
  if (entry.format === 'esm') {
    const res = await fetch(entry.url)
    if (!res.ok) throw new Error('下载 ' + entry.id + ' 失败：' + res.status)
    const text = await res.text()
    const mod = (await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text))) as
      | (PluginModule & { default?: PluginModule })
      | { default: PluginModule }
    install(((mod as { default?: PluginModule }).default ?? mod) as PluginModule)
    return
  }
  // UMD：注入 script，等它执行完，从 window 全局取
  await new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = entry.url!
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('加载 ' + entry.id + ' 的脚本失败'))
    document.head.appendChild(el)
  })
  const g = entry.globalName
  const mod = g ? (globalThis as unknown as Record<string, PluginModule | undefined>)[g] : undefined
  if (mod) install(mod)
}

/** 把清单里的插件全部装进内核（单条失败不影响其它） */
export async function installCatalogPlugins(
  catalog: RemoteCatalog,
  install: (mod: PluginModule) => void,
): Promise<Array<{ id: string; error: string }>> {
  const failures: Array<{ id: string; error: string }> = []
  for (const entry of catalog.plugins) {
    try {
      await loadOne(entry, install)
    } catch (err) {
      failures.push({ id: entry.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return failures
}

/**
 * 从清单里挑出**首启要装的那些**：只装项目内置清单（builtinInstallIds）。
 *
 * 为什么不能全装：清单里既有自带件，也有"用户自己去面板挑"的可装卸件
 * （小地图、自动布局、画布导出、示例插件……）。全装等于替用户做了选择，
 * 用户卸掉后下次开页又回来。
 *
 * 顺序：firstInstallIds（cloud-client 必须先装，否则后台能力不可用）排最前，
 * 其余按清单原顺序 —— 清单顺序在服务端已按目录名排好，稳定可复现。
 */
export function pickBuiltinEntries(catalog: RemoteCatalog): CatalogEntry[] {
  const builtin = new Set(catalog.builtinInstallIds ?? [])
  if (builtin.size === 0) return []
  const first = (catalog.firstInstallIds ?? []).filter((id) => builtin.has(id))
  const byId = new Map(catalog.plugins.map((p) => [p.id, p]))
  const out: CatalogEntry[] = []
  const seen = new Set<string>()
  for (const id of first) {
    const entry = byId.get(id)
    if (entry) {
      out.push(entry)
      seen.add(id)
    }
  }
  for (const entry of catalog.plugins) {
    if (seen.has(entry.id)) continue
    if (!builtin.has(entry.id)) continue
    out.push(entry)
  }
  return out
}

