/**
 * catalogTypes —— 插件清单的形状（与 cloud-server 的 src/plugins/catalog.ts 的 PluginCatalogEntry 同形）。
 *
 * 为什么在这里**再声明一份**而不是 import relay 的类型：插件是给浏览器用的成品，
 * 不该把「服务器包」拖进前端依赖图。清单是一份**线上契约**（JSON），两边各写一份同形接口，
 * 由测试钉住关键字段。真正的后台将来也照这个形状发。
 */

/** 清单里的一项（服务器 /catalog.json 的 plugins[i]） */
export interface CatalogEntry {
  id: string
  name: string
  title?: string
  description?: string
  /** 浏览器可直接请求的 js 地址 */
  url: string
  /** UMD 产物在 window 上暴露的全局名 */
  globalName?: string
  /** 该产物运行时需要哪些 window 全局（Vue / MiniCanvasCore / …） */
  requiresGlobals?: string[]
  /** 是否默认安装 */
  defaultInstalled?: boolean
  /** 是否自带（随应用冷启动、只读展示，不给安装/卸载按钮） */
  builtin?: boolean
  /**
   * 后台插件产物（同一个包里若还有 dist/server.js 就有这一项）。
   *
   * 用户要的体验：**一个插件 = 前后端一起装**。前后端是同一个发布单元的两半，
   * 用同一个 id 配对 —— 界面上显示成一张卡片、两个状态灯（前端 ✓ / 后台 ✓）。
   * 只有一半也合法（另一半留空）。
   */
  server?: {
    /** 后台产物地址（相对本服务；跨源时按清单地址的 origin 补全） */
    url: string
    /**
     * 后台产物的 sha256（清单声明的）。安装时原样带给服务端 ——
     * **但服务端以自己扫出来的那份为准**（防止"调用方现算自洽"式的假校验）。
     */
    sha256?: string
    /** 声明的权限（如 net / store / fs）；目前只展示，不做强制 */
    permissions?: string[]
  }
  version?: string
}

/** 整份清单 */
export interface Catalog {
  ok?: boolean
  version?: number
  plugins?: CatalogEntry[]
}

/**
 * 把来源不明的 JSON 归一成一份干净的清单。
 *
 * 为什么必须做：清单来自网络（中转后台 / 将来的真后台），字段可能缺、可能是垃圾。
 * 直接拿去渲染会让界面炸在某个 undefined 上；这里逐条剔掉不合格的，返回能安全用的那份。
 * 判据只有一条：**有 id 且有 url** 才算一条可用插件。
 */
export function normalizeCatalog(raw: unknown): CatalogEntry[] {
  const list = (raw as Catalog)?.plugins
  if (!Array.isArray(list)) return []
  const out: CatalogEntry[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const e = item as Partial<CatalogEntry>
    if (typeof e.id !== 'string' || !e.id) continue
    // 自带插件没有 url（不经 URL 加载，只读展示）—— 不该因为它没有 url 就被剔掉。
    // 可装卸的必须有 url，否则装不上（宁可少列也不列装不上的）。
    if (e.builtin !== true && (typeof e.url !== 'string' || !e.url)) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push({
      id: e.id,
      name: typeof e.name === 'string' && e.name ? e.name : e.id,
      ...(typeof e.title === 'string' ? { title: e.title } : {}),
      ...(typeof e.description === 'string' ? { description: e.description } : {}),
      url: typeof e.url === 'string' ? e.url : '',
      ...(typeof e.globalName === 'string' ? { globalName: e.globalName } : {}),
      ...(Array.isArray(e.requiresGlobals)
        ? { requiresGlobals: e.requiresGlobals.filter((g): g is string => typeof g === 'string') }
        : {}),
      ...(typeof e.defaultInstalled === 'boolean' ? { defaultInstalled: e.defaultInstalled } : {}),
      ...(e.builtin === true ? { builtin: true } : {}),
      ...(e.server && typeof e.server === 'object' && typeof e.server.url === 'string' && e.server.url
        ? {
            server: {
              url: e.server.url,
              ...(typeof e.server.sha256 === 'string' ? { sha256: e.server.sha256 } : {}),
              ...(Array.isArray(e.server.permissions)
                ? { permissions: e.server.permissions.filter((p): p is string => typeof p === 'string') }
                : {}),
            },
          }
        : {}),
      ...(typeof e.version === 'string' ? { version: e.version } : {}),
    })
  }
  return out
}

/** 一条没有存档时该默认装哪些（用户要求：默认全部设为安装） */
export function defaultInstalledIds(entries: CatalogEntry[]): string[] {
  // 自带插件不算"要装"（它们由应用冷启动装配，插件管理不碰）—— 只列 installable 的那些。
  return entries.filter((e) => e.builtin !== true && e.defaultInstalled !== false).map((e) => e.id)
}

/**
 * 决定「这次该装哪些」。
 *
 * 规则：**有存档就用存档**（用户上次卸过的不再自动装回来）；**没存档（首次）就默认全装**。
 * 存档里的 id 也可能已经不在清单里了（后台撤了某插件）—— 按清单过滤，只留还在的。
 */
export function resolveDesiredIds(entries: CatalogEntry[], saved: string[] | undefined): string[] {
  // 只对"可装卸"的插件算意图；自带插件永不进这套（避免被当成待装项）。
  const ids = new Set(entries.filter((e) => e.builtin !== true).map((e) => e.id))
  const source = saved === undefined ? defaultInstalledIds(entries) : saved
  return source.filter((id) => ids.has(id))
}
