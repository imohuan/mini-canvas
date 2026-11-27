/**
 * umdLoader —— 把一个 UMD 插件 js 加载成插件模块。
 *
 * 为什么用 <script> 而不是 fetch + import()：
 * 仓库里多数插件打的是 **UMD**（`external: ['vue', '@plume-canvas/canvas-data', …]`）。
 * UMD 产物靠 window 上的全局（Vue / PlumeCore / PlumeRender / PlumeBase）取依赖，
 * 不是 ES 模块 —— 用 `import(url)` 加载会直接抛错。`<script>` 才是 UMD 该走的路。
 *
 * 代价（说清楚）：脚本一执行就把插件对象挂到全局（如 `PlumePluginNodeImageCompare`），
 * 且**撤不掉**（script 无法卸载已执行的代码）；所以「卸载插件」靠的是内核的 uninstallPlugin
 * 回收注册，而不是把脚本删掉。重复装同一地址时给 url 加 `?t=` 破缓存。
 */

/** 从一个全局取值：找不到就 undefined（不抛，调用方给清晰错误） */
type GlobalBag = Record<string, unknown>

/** 一个可装载的插件模块：至少要有 name 与 apply（与内核 PluginModule 同形） */
export interface LoadedPluginModule {
  name: string
  apply?: (...args: unknown[]) => unknown
  [k: string]: unknown
}

/** window 上 UMD 产物全局名的候选前缀 —— 用来在脚本执行后找出它新挂了什么 */
export const PLUGIN_GLOBAL_PREFIX = 'PlumePlugin'

/**
 * 把「缺省前缀写重了」的全局名纠正回来（PlumePluginPluginManager → PlumePluginManager）。
 *
 * 为什么需要：热重载上报的插件名常是目录名（plugin-manager），调用方按
 * `PlumePlugin + PascalCase(名)` 拼出来就成了 PlumePluginPluginManager，永远取不到。
 * 2026-11-27 实测：取不到后加载器退回「扫全部全局」，挑到了 auto-layout，装错插件。
 * 这里在包内纠正，已发布的界面也能修好，不必等界面重新构建。
 */
export function normalizeGlobalName(name: string): string {
  if (!name.startsWith(PLUGIN_GLOBAL_PREFIX + 'Plugin')) return name
  return PLUGIN_GLOBAL_PREFIX + name.slice((PLUGIN_GLOBAL_PREFIX + 'Plugin').length)
}

/**
 * 从一个全局值（UMD 导出对象）里挑出插件模块。
 *
 * UMD 产物是一个「命名空间对象」（`{ name, nodeImageComparePlugin, IMAGE_COMPARE_NODE_TYPE, … }`），
 * 插件本体可能是对象里的**某个属性**（且命名不固定）。所以按这个顺序找：
 * 1. 全局值自己就长得像插件（有 name + apply）；
 * 2. 全局值里任何带 name + apply 的自有属性；
 * 找不到返回 undefined（调用方给清晰错误）。
 */
export function pickPluginModule(globalValue: unknown): LoadedPluginModule | undefined {
  if (!globalValue || typeof globalValue !== 'object') return undefined
  const looksLikePlugin = (v: unknown): v is LoadedPluginModule =>
    !!v && typeof v === 'object' && typeof (v as LoadedPluginModule).name === 'string' &&
    typeof (v as LoadedPluginModule).apply === 'function'
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
}): (url: string, globalNameHint?: string | string[], expectedName?: string) => Promise<LoadedPluginModule> {
  return (url: string, globalNameHint?: string | string[], expectedName?: string) =>
    new Promise<LoadedPluginModule>((resolve, reject) => {
      const before = new Set(Object.keys(opts.win))
      const el = opts.document.createElement('script')
      el.type = 'text/javascript'
      el.src = url
      el.async = true
      el.onload = () => {
        const hints = globalNameHint === undefined
          ? []
          : Array.isArray(globalNameHint)
            ? globalNameHint
            : [globalNameHint]
        /**
         * 取件的统一出口：给了名字期望时必须名字一致。
         *
         * 为什么不能"取到就用"（2026-11-27 实测）：热重载传 names 时可能只给到了目录名，
         * 推导出的全局名取不到，随后退回③扫 window 猜 —— 挑到 auto-layout，
         * 结果把插件管理重装成了自动布局，报 Duplicate plugin name: auto-layout。
         * 名字对不上就当这次没取到，继续按顺序尝试；全都对不上就明确报错。
         */
        const accept = (mod: LoadedPluginModule | undefined): boolean => {
          if (!mod) return false
          if (expectedName && mod.name !== expectedName) return false
          resolve(mod)
          return true
        }
        // ① 清单 / 调用方给了全局名 → 直接按名取（最稳，重装/多插件并存时不会挑错）
        for (const hint of hints) {
          if (!hint) continue
          if (accept(pickPluginModule(opts.win[hint]))) return
          const normalized = normalizeGlobalName(hint)
          if (normalized !== hint && accept(pickPluginModule(opts.win[normalized]))) return
        }
        /**
         * ①.5 只给了期望名、没给全局名 → 按 UMD 命名约定拼候选（PlumePlugin<Pascal>）。
         * 先去掉目录名前缀 plugin-（plugin-manager → PlumePluginManager），再试原名。
         */
        if (expectedName && hints.length === 0) {
          const pascal = (value: string): string =>
            value
              .split(/[-_]/)
              .filter(Boolean)
              .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
              .join('')
          const stripped = expectedName.replace(/^plugin[-_]/i, '')
          for (const guess of ['PlumePlugin' + pascal(stripped), 'PlumePlugin' + pascal(expectedName)]) {
            if (accept(pickPluginModule(opts.win[guess]))) return
          }
        }
        // 给了名字期望时，后面的"猜"全部不做：宁可直接失败，也不能装错插件
        if (expectedName) {
          reject(new Error(
            '[plugin-manager] 脚本已加载，但没找到名为「' + expectedName + '」的插件模块：' + url,
          ))
          return
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
        // ③ 兜底：扫一遍全部 PlumePlugin* 全局 —— 只在清单没给 globalName、且脚本没挂新全局时走到这。
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
