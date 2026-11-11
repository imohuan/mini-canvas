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
  /** UMD 全局对象上哪一个导出才是插件模块（缺省 = 全局对象本身就是模块） */
  moduleExport?: string
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
  const bag = g ? (globalThis as unknown as Record<string, unknown>)[g] : undefined
  const mod = pickPluginModule(bag, entry.moduleExport)
  if (!mod) {
    throw new Error('加载 ' + entry.id + ' 后没在全局上找到插件模块（globalName=' + (g ?? '?') + '）')
  }
  install(mod)
}

/**
 * 从 UMD 全局对象里取出**插件模块**。
 *
 * 为什么需要这一步（2026-11-11 实测白屏）：插件产物把一堆组件和工具函数一起挂在
 * 全局上（`themeCanvasPlugin`、`NodeToolbarService`…），整个对象交给内核会报
 * `apply is not a function`。清单里的 `moduleExport` 指明该取哪个字段；
 * 没有时按形状兜底（同时有 name/apply 的那一项）。
 */
export function pickPluginModule(
  bag: unknown,
  moduleExport?: string,
): PluginModule | undefined {
  if (!bag || typeof bag !== 'object') return undefined
  const obj = bag as Record<string, unknown>
  const shapeOk = (v: unknown): v is PluginModule =>
    !!v && typeof v === 'object' && typeof (v as { apply?: unknown }).apply === 'function'
  if (moduleExport) {
    const picked = obj[moduleExport]
    if (shapeOk(picked)) return picked
  }
  // 兜底：全局对象自己就是模块
  if (shapeOk(obj)) return obj
  // 再兜底：扫自己这个全局对象的属性，取同时有 apply 的那一个。
  // 只在本对象里找 —— 绝不跨到 window 上别的插件（并发加载时那些正在陆续出现，
  // 扫全局会挑到邻座，装错插件）。
  const candidates = Object.entries(obj).filter(([, v]) => shapeOk(v))
  const picked = candidates.find(([k]) => /plugin/i.test(k))?.[1] ?? candidates[0]?.[1]
  return picked as PluginModule | undefined
}

/** 把清单里的插件全部装进内核（单条失败不影响其它） */
export async function installCatalogPlugins(
  catalog: RemoteCatalog,
  install: (mod: PluginModule) => void,
): Promise<Array<{ id: string; error: string }>> {
  const failures: Array<{ id: string; error: string }> = []
  // **并发下载、按序安装**：每个插件是一个独立的 <script> / fetch，串行等 21 个
  // 等于把首屏拖成 21 个来回（实测明显卡）。下载可以并行；install 仍按清单顺序串行，
  // 因为插件之间有先后依赖（manager 依赖内核、theme 依赖 render）。
  // 注意：UMD 的 <script> 是全局副作用（执行即挂 window），并发加载没问题；
  // 但 ESM 走 import(data:) 也是纯加载，不碰内核。
  const CONCURRENCY = 6
  const loaded: Array<PluginModule | undefined> = new Array(catalog.plugins.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < catalog.plugins.length) {
      const index = cursor++
      const entry = catalog.plugins[index]!
      try {
        // 先只把产物加载成模块（不装进内核），装的动作留到下面按序做
        let picked: PluginModule | undefined
        await loadOne(entry, (mod) => { picked = mod })
        loaded[index] = picked
      } catch (err) {
        failures.push({ id: entry.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, catalog.plugins.length) }, worker))
  for (const mod of loaded) if (mod) install(mod)
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

