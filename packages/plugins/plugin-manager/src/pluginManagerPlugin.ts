/**
 * plugin-manager —— 插件管理插件：在设置面板里给出一个「插件」页，安装 / 卸载 / 重装第三方插件。
 *
 * 与 plugin-agent 同一条路（本仓库插件的标准做法）：
 * - **槽位**装 UI：左导航项注册进 `settings.nav`，正文注册进 `settingsGroup/集成/插件`
 *   （菜单把它挂到「集成 → 插件」）；
 * - **服务**持状态：`ctx.inject('plugin-manager', reactive(服务))`，页面读它、调它；
 *   安装句柄只从宿主 `host.manager` 取（旧 `pluginManager` 服务名已下线）；
 * - **配置**声明一个分组 `集成/插件`，由设置菜单收进「集成 → 插件」。
 *
 * 数据来源（用户口径）：请求一个 JSON 清单拿到每个插件的 js 地址，再按地址加载 ——
 * 清单由 **cloud-server** 提供（`/plugin-catalog.json`；mini-canvas-cloud serve 默认 8865）。
 * 真正的后台还没定放哪；将来只要发同形状清单，本插件一行不用改。
 */
import { markRaw, reactive } from 'vue'
import { Puzzle } from 'lucide-vue-next'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { DEFAULT_CATALOG_URL, createPluginManagerService } from './pluginManagerService'
import PluginManagerNav from './components/settings/PluginManagerNav.vue'
import PluginManagerPage from './components/settings/PluginManagerPage.vue'

export const name = 'plugin-manager'
/** 不写死依赖：宿主服务（manager / save）都做**可选探测** —— 缺了给清晰错误，不静默装死 */
export const inject = [] as string[]

export interface PluginManagerConfig {
  /** 中转后台清单地址 */
  catalogUrl?: string
}

/**
 * 设置面板里的配置分组 `集成/插件`。右侧整页由菜单的 nav.page 提供，
 * `settingsGroup/集成/插件` 仍保留给老皮与自绘页内容。
 */
export const Config = {
  pluginManagerCatalogUrl: {
    type: 'string' as const,
    default: DEFAULT_CATALOG_URL,
    label: '中转后台地址',
    group: '集成/插件',
    placeholder: '/plugin-catalog.json 或 http://127.0.0.1:{端口}/plugin-catalog.json',
    description:
      '插件清单地址。默认取同源的 /plugin-catalog.json（cloud-server 提供：mini-canvas-cloud serve）。' +
      '若画布界面与服务不同源（如 ui 单独 dev），在这里填服务的绝对地址，再点「刷新」重拉。',
  },
}

/** 设置面板左导航插槽的 id（旧兼容入口；新菜单用 nav/integration/plugins） */
export const MANAGER_NAV_ID = '集成/插件'

export function apply(
  ctx: Context,
  config?: PluginManagerConfig,
): void {
  // 宿主统一安装句柄由页面在渲染子树里经 `usePluginManager()` 绑定（host.manager）。
  // 内核只向 apply 传 config，拿不到 host；绑定前操作会给出清晰错误，而不是静默装死。
  const service = createPluginManagerService(ctx, {
    ...(config?.catalogUrl ? { catalogUrl: config.catalogUrl } : {}),
  })
  // 服务本身包成响应式：页面经它读 state，装卸变化能驱动重渲染（与 plugin-agent 同款）
  ctx.inject('plugin-manager', reactive(service))

  // 菜单：进「集成 → 插件」。引用默认树的 nav id，注册自己的整页。
  ctx.settingsMenu.nav({
    id: 'nav/integration/plugins',
    category: 'category/integration',
    title: '插件',
    icon: Puzzle,
    order: 20,
    page: markRaw(PluginManagerPage),
  })

  // ① 设置面板左导航项
  ctx.slots.register('settings.nav', {
    id: 'plugin-manager/nav',
    order: 6,
    component: markRaw(PluginManagerNav),
    // 只提供数据：外观由设置面板统一渲染，整页走 page（settingsGroup 仍保留给老皮）
    meta: {
      title: '插件',
      category: '集成',
      icon: Puzzle,
      page: markRaw(PluginManagerPage),
      pageGroup: MANAGER_NAV_ID,
    },
  })
  // ② 设置面板正文（一级分类「插件」的整页由本组件负责）
  ctx.slots.register('settingsGroup/' + MANAGER_NAV_ID, {
    id: 'plugin-manager/page',
    order: 6,
    component: markRaw(PluginManagerPage),
  })

  // ③ 一打开设置页就拉一次清单（失败不致命：页面会显示错误 + 刷新按钮）
  void service.refresh()
}

export const pluginManagerPlugin: PluginModule = { name, inject, Config, apply }
export type { PluginManagerService, PluginRow } from './pluginManagerService'
