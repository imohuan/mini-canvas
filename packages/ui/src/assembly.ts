/**
 * @plume-canvas/ui 的装配清单。
 *
 * **dev 与 build 是两条路**（用户口径 2026-11-11）：
 * - dev：`dev-plugins.ts` 里直接 import 插件源码 —— 改完立刻热更，方便调插件；
 * - build：界面包不含任何插件，全部由 cloud-server 的清单在启动时装载（`remote-plugins.ts`）。
 *
 * 所以本文件（build 也会用到）刻意**不 import 任何 @plume-canvas/plugin-***；
 * 一旦这里出现插件 import，Rollup 就会把它们打进界面包，正是要避免的事。
 *
 * 插件是否「自带」由项目配置决定（cloud-server 的 `src/plugins/builtinPlugins.ts`），
 * 不由插件自己在 package.json 里写 `plume.builtin`。
 */
import type { CanvasNode, StorageAdapter } from '@plume-canvas/canvas-data'
import type { PluginModule } from '@plume-canvas/kernel'
import { LocalStorageAdapter } from '@plume-canvas/canvas-data'

export interface AppPluginEntry {
  plugin: PluginModule
  /** app = 应用级常驻；canvas = 进入画布才装 */
  kind: 'app' | 'canvas'
  /** 一句话理由，维护者与测试共读 */
  reason: string
}

/** dev 下的静态清单（build 下为空）。真实内容在 `dev-plugins.ts`。 */
export const APP_PLUGIN_REGISTRY: readonly AppPluginEntry[] = [] as const

/** 应用级插件（dev 由 resolveAppPlugins 填充；build 为空） */
export const APP_PLUGINS: PluginModule[] = []

/** 画布级插件（dev 由 resolveAppPlugins 填充；build 为空） */
export const CANVAS_PLUGINS: PluginModule[] = []

/**
 * 判断「这一版界面是不是被 cloud-server 托管的」。
 *
 * 判据是服务端注入的 `<meta name="plume-host" content="cloud-server">`：
 * 看 URL / 端口都不准（dev 走代理、端口会顺延），由发页面的人自己声明最可靠。
 * 单测 / SSR 里没有 document，读不到就当「不是托管」（保持本地行为）。
 */
export const CLOUD_HOST_FLAG = 'plume-host'

/** 读 cloud-server 注入的宿主标记（读不到 = 不是它托管的） */
export function isCloudServerHosted(): boolean {
  if (typeof document === 'undefined') return false
  const meta = document.querySelector('meta[name="' + CLOUD_HOST_FLAG + '"]')
  return meta?.getAttribute('content') === 'cloud-server'
}

/** dev 下按运行环境追加的自带件（目前只有 cloud-client） */
export function builtinPluginsForUiHost(): PluginModule[] {
  return []
}

/**
 * 最终装载清单。
 *
 * **dev**：返回 `dev-plugins.ts` 里的全部插件 —— 直接读源码，改完立刻热更；
 * **build**：返回空数组。插件由 cloud-server 的清单在运行期装载，界面包里没有它们。
 *
 * dev 清单用**动态 import** 取，build 分支不会被 Rollup 追踪到那份模块。
 */
export async function resolveAppPlugins(): Promise<PluginModule[]> {
  if (!import.meta.env.DEV) return []
  const dev = await import('./dev-plugins')
  const hosted = isCloudServerHosted() ? dev.devHostedExtras() : []
  return [...dev.DEV_APP_PLUGINS, ...hosted]
}

/** dev 下的画布级插件（build 返回空；由 remote-plugins 装载） */
export async function resolveCanvasPlugins(): Promise<PluginModule[]> {
  if (!import.meta.env.DEV) return []
  const dev = await import('./dev-plugins')
  return dev.DEV_CANVAS_PLUGINS
}

/** 建一份成品应用默认的存储后端（本地 localStorage）。要换存储就换这里的实现。 */
export function createDefaultStorageAdapter(): StorageAdapter {
  return new LocalStorageAdapter()
}

/** 示例图片（首次打开的空画布塞一个 image 节点，让人一眼知道能干什么） */
export const SAMPLE_IMAGE_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">' +
      '<rect width="320" height="240" fill="#dbeafe"/>' + // 主题色白名单: 示例图的 SVG 内容色（节点素材，非界面外观）
      '<text x="160" y="118" font-family="sans-serif" font-size="20" fill="#1d4ed8" text-anchor="middle">v2 image 节点</text>' + // 主题色白名单: 同上
      '<text x="160" y="142" font-family="sans-serif" font-size="13" fill="#64748b" text-anchor="middle">data.imageUrl</text>' + // 主题色白名单: 同上
      '</svg>',
  )

/** 示例文本（首次打开的空画布塞一个 text 节点） */
export const SAMPLE_TEXT =
  '双击我输入内容\n\n· 从左右圆点可拖出连线\n· 拖动节点可移动\n· 点节点再按 Delete 删除'

/** 首次(存储为空)的默认画布 */
export function seedDefaultCanvas(): CanvasNode[] {
  return [
    { id: '1', type: 'text', position: { x: 120, y: 120 }, data: { text: SAMPLE_TEXT } },
    { id: '2', type: 'image', position: { x: 560, y: 160 }, data: { imageUrl: SAMPLE_IMAGE_URL } },
  ]
}

