/**
 * umdLoader —— 把一个 UMD 插件 js 加载成插件模块。
 *
 * 为什么用 <script> 而不是 fetch + import()：
 * 仓库里多数插件打的是 **UMD**（`external: ['vue', '@mini-canvas/canvas-data', …]`）。
 * UMD 产物靠 window 上的全局（Vue / MiniCanvasCore / MiniCanvasRender / MiniCanvasBase）取依赖，
 * 不是 ES 模块 —— 用 `import(url)` 加载会直接抛错。`<script>` 才是 UMD 该走的路。
 *
 * 代价（说清楚）：脚本一执行就把插件对象挂到全局（如 `MiniCanvasPluginNodeImageCompare`），
 * 且**撤不掉**（script 无法卸载已执行的代码）；所以「卸载插件」靠的是内核的 uninstallPlugin
 * 回收注册，而不是把脚本删掉。重复装同一地址时给 url 加 `?t=` 破缓存。
 */

/** 从一个全局取值：找不到就 undefined（不抛，调用方给清晰错误） */
type GlobalBag = Record<string, unknown>

/** 一个可装载的插件模块：至少要有 name 与 apply/setup（与内核 PluginModule 同形） */
export interface LoadedPluginModule {
  name: string
  apply?: (...args: unknown[]) => unknown
  setup?: (...args: unknown[]) => unknown
  [k: string]: unknown
}

/** window 上 UMD 产物全局名的候选前缀 —— 用来在脚本执行后找出它新挂了什么 */
export const PLUGIN_GLOBAL_PREFIX = 'MiniCanvasPlugin'

/**
 * 从一个全局值（UMD 导出对象）里挑出插件模块。
 *
 * UMD 产物是一个「命名空间对象」（`{ name, nodeImageComparePlugin, IMAGE_COMPARE_NODE_TYPE, … }`），
 * 插件本体可能是对象里的**某个属性**（且命名不固定）。所以按这个顺序找：
 * 1. 全局值自己就长得像插件（有 name + apply/setup）；
 * 2. 全局值里任何带 name + apply/setup 的自有属性；
 * 找不到返回 undefined（调用方给清晰错误）。
 */
export function pickPluginModule(globalValue: unknown): LoadedPluginModule | undefined {
  if (!globalValue || typeof globalValue !== 'object') return undefined
  const looksLikePlugin = (v: unknown): v is LoadedPluginModule =>
    !!v && typeof v === 'object' && typeof (v as LoadedPluginModule).name === 'string' &&
    (typeof (v as LoadedPluginModule).apply === 'function' || typeof (v as LoadedPluginModule).setup === 'function')
  if (looksLikePlugin(globalValue)) return globalValue
  for (const value of Object.values(globalValue as GlobalBag)) {
    if (looksLikePlugin(value)) return value
  }
  return undefined
}

/**
 * 造一个 <script> 加载器。
 *
 * @param opts.document 注入 document（测试用假实现即可，不必真浏览器）
 * @param opts.window   注入 window（读全局 / 记录脚本执行前的全局快照）
 */
export function createUmdLoader(opts: {
  document: Document
  win: GlobalBag
}): (url: string, globalNameHint?: string) => Promise<LoadedPluginModule> {
  return (url: string, globalNameHint?: string) =>
    new Promise<LoadedPluginModule>((resolve, reject) => {
      const before = new Set(Object.keys(opts.win))
      const el = opts.document.createElement('script')
      el.type = 'text/javascript'
      el.src = url
      el.async = true
      el.onload = () => {
        // ① 清单给了全局名 → 直接按名取（最稳，重装/多插件并存时不会挑错）
        if (globalNameHint) {
          const mod = pickPluginModule(opts.win[globalNameHint])
          if (mod) {
            resolve(mod)
            return
          }
        }
        // ② 没给提示（或提示名取不到）→ 用脚本新挂上的全局
        const added = Object.keys(opts.win).filter((k) => !before.has(k) && k.startsWith(PLUGIN_GLOBAL_PREFIX))
        for (const key of added) {
          const mod = pickPluginModule(opts.win[key])
          if (mod) {
            resolve(mod)
            return
          }
        }
        // ③ 兜底：扫一遍全部 MiniCanvasPlugin* 全局 —— 只在清单没给 globalName、且脚本没挂新全局时走到这。
        //    注意这里是**有意的最后手段**：多个插件并存时可能挑错（谁先在前挑谁），所以①②能走通就不走这。
        for (const key of Object.keys(opts.win)) {
          if (!key.startsWith(PLUGIN_GLOBAL_PREFIX)) continue
          const mod = pickPluginModule(opts.win[key])
          if (mod) {
            resolve(mod)
            return
          }
        }
        reject(new Error(`[plugin-manager] 脚本已加载但没找到插件模块（全局名应以 ${PLUGIN_GLOBAL_PREFIX} 开头）：${url}`))
      }
      el.onerror = () => {
        reject(new Error(`[plugin-manager] 加载插件脚本失败：${url}`))
      }
      opts.document.head.appendChild(el)
    })
}

/** 破缓存：给 url 加一个 `?t=<时间戳>`（保留已有 query） */
export function bustCache(url: string, stamp: number): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}t=${stamp}`
}
