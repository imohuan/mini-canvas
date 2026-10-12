/**
 * uiConfig —— 本插件的配置读取（**单一来源**，插件主体与内容组件共用）。
 *
 * 为什么单独一个文件：内容组件渲染时要拿「后台地址」（决定生成页面能请求谁），
 * 插件主体生成时也要拿同一个值。两处各读一遍 settings 迟早漂移（一边改了键名、
 * 另一边没改），所以收在一处。
 *
 * 键名一律带 uiNode 前缀：内核 settings 是**全局同一张表、先声明者独占**。
 */

/** 本插件用到的配置（读出来的现成形态） */
export interface UiPluginConfig {
  /** 后台根地址。空串 = 与画布同源（cloud-server 托管界面时就是这样） */
  baseUrl: string
  /**
   * 生成页面能不能调后台接口。
   *
   * 默认开：这是这个节点的价值所在 —— 生成的界面可以**真的操作画布**（改数据、建节点、
   * 触发生成），而不只是画给人看。关掉 = 退回"纯展示"，生成的页面连不上任何网络。
   */
  netEnabled: boolean
}

/** 读一面 settings（缺省 / 未就绪都回落默认值） */
type SettingsLike = { get(key: string): unknown }

export function readUiConfig(settings: SettingsLike | undefined): UiPluginConfig {
  const str = (k: string, d: string): string => {
    const v = settings?.get(k)
    return typeof v === 'string' ? v : d
  }
  const bool = (k: string, d: boolean): boolean => {
    const v = settings?.get(k)
    return typeof v === 'boolean' ? v : d
  }
  return {
    baseUrl: str('uiNodeBaseUrl', ''),
    netEnabled: bool('uiNodeAllowNetwork', true),
  }
}

/**
 * 后台的**绝对**基地址。
 *
 * 为什么要绝对地址：沙箱 iframe 的文档地址是 `about:srcdoc`，相对地址（/api/…）
 * 在那里**解析不出来**（实测：直接 TypeError，不是被 CSP 拦）。所以生成页面里
 * 一切请求都必须写绝对地址 —— 这个函数就是那个绝对前缀。
 *
 * 配置留空时用当前页面的 origin：
 * - cloud-server 托管界面时，同源就是后台本体；
 * - ui dev（5288）时，vite 把 /api 代理给 8865，所以同源地址照样能打到后台。
 */
export function resolveBaseUrl(config: UiPluginConfig, pageHref?: string): string {
  if (config.baseUrl) return config.baseUrl.replace(/\/+$/, '')
  if (!pageHref) return ''
  try {
    return new URL(pageHref).origin
  } catch {
    return ''
  }
}

/**
 * 当前画布 id。
 *
 * 与 plugin-cloud-client 同一套判据（它那边是 keys.ts 的 canvasId()）：
 * URL 查询参数 `?canvas=` 优先，其次哈希路由 `#/canvas/<id>`，都没有就回落 default。
 * 不 import 那个插件（插件之间不互相依赖），就地照同一套规则读一次。
 */
export function currentCanvasId(pageHref?: string): string {
  const href = pageHref ?? (typeof location !== 'undefined' ? location.href : '')
  if (!href) return 'default'
  try {
    const u = new URL(href)
    const q = u.searchParams.get('canvas')
    if (q && /^[A-Za-z0-9_-]{1,64}$/.test(q)) return q
    const m = /\/canvas\/([A-Za-z0-9_-]{1,64})/.exec(u.hash)
    if (m) return m[1]!
  } catch {
    /* 取不到就回落默认 */
  }
  return 'default'
}

