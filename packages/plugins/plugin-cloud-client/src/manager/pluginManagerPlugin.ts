/**
 * plugin-manager —— 插件管理插件：在设置面板里给出一个「插件」页，安装 / 卸载 / 重装第三方插件。
 *
 * 与 plugin-agent 同一条路（本仓库插件的标准做法）：
 * - **槽位**装 UI：左导航项注册进 `settingsNav`，正文注册进 `settingsGroup/插件`
 *   （设置面板据此把「插件」当成一个一级分类渲染）；
 * - **服务**持状态：`ctx.inject('plugin-manager', reactive(服务))`，页面读它、调它；
 * - **配置**声明一个**扁平分组** `插件`，设置面板才会长出这一页的入口。
 *
 * 数据来源（用户口径）：请求一个 JSON 清单拿到每个插件的 js 地址，再按地址加载 ——
 * 清单由 **cloud-server** 提供（`/plugin-catalog.json`；mini-canvas-cloud serve 默认 8865）。
 * 真正的后台还没定放哪；将来只要发同形状清单，本插件一行不用改。
 */
import { markRaw, reactive } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { DEFAULT_CATALOG_URL, createPluginManagerService } from './pluginManagerService'
import PluginManagerNav from './components/settings/PluginManagerNav.vue'
import PluginManagerPage from './components/settings/PluginManagerPage.vue'

export const name = 'plugin-manager'
/** 不写死依赖：宿主服务（pluginManager / save）都做**可选探测** —— 缺了给清晰错误，不静默装死 */
export const inject = [] as string[]

export interface PluginManagerConfig {
  /** 中转后台清单地址 */
  catalogUrl?: string
}

/**
 * 设置面板里的一个**扁平分组** `插件` —— 这正是「本插件有自定义设置页」的入口。
 * 分组名不带 `/`：面板把「一个只有自己这一格的一级分类」直接当这一页的正文渲染
 * （与 plugin-agent 的 `group: 'Agent'` 同款，见其注释里的实测教训）。
 */
export const Config = {
  pluginManagerCatalogUrl: {
    type: 'string' as const,
    default: DEFAULT_CATALOG_URL,
    label: '中转后台地址',
    group: '插件',
    description:
      '插件清单地址。默认取同源的 /plugin-catalog.json（cloud-server 提供：mini-canvas-cloud serve）。' +
      '若画布界面与服务不同源（如 ui 单独 dev），在这里填服务的绝对地址，再点「刷新」重拉。',
  },
}

/** 设置面板左导航插槽的 id（= 一级名，命中即顶替默认项；这里没有同名分组导航，故为新增项） */
export const MANAGER_NAV_ID = '插件'

export function apply(ctx: Context, config?: PluginManagerConfig): void {
  const service = createPluginManagerService(ctx, {
    ...(config?.catalogUrl ? { catalogUrl: config.catalogUrl } : {}),
  })
  // 服务本身包成响应式：页面经它读 state，装卸变化能驱动重渲染（与 plugin-agent 同款）
  ctx.inject('plugin-manager', reactive(service))

  // ① 设置面板左导航项
  ctx.slots.register('settingsNav', {
    id: MANAGER_NAV_ID,
    order: 6,
    component: markRaw(PluginManagerNav),
    meta: { title: '插件' },
  })
  // ② 设置面板正文（一级分类「插件」的整页由本组件负责）
  ctx.slots.register('settingsGroup/' + MANAGER_NAV_ID, {
    id: 'plugin-manager-page',
    order: 6,
    component: markRaw(PluginManagerPage),
  })

  // ③ 一打开设置页就拉一次清单（失败不致命：页面会显示错误 + 刷新按钮）
  void service.refresh()
}

export const pluginManagerPlugin: PluginModule = { name, inject, Config, apply }
export type { PluginManagerService, PluginRow } from './pluginManagerService'
