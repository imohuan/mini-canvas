/**
 * plugin-demo-kit —— **一个插件，四套演示**。
 *
 * 为什么合并：以前它们是四个独立包（theme-gallery / ui-demo / shell-slots-demo /
 * hot-reload-demo）。用户口径 2026-11-01：「我的项目提供了很多 demo 插件，没有实际意义的，
 * 你把他们整理整理放在一个插件里面」。四个包各自有 package.json、构建配置、清单身份，
 * 装的时候还要在面板里找四次 —— 而它们其实都只是「开发时看看某个机制长什么样」。
 *
 * 合并后仍然是**可安装件**（不是自带件）：默认不随产品冷启动装配，
 * 到「设置 → 插件 → 本地清单」装一次就能看到全部四套演示。
 *
 * 每套演示保留自己的 id 前缀（demo-kit/gallery、demo-kit/ui-slots…），
 * 卸载插件时内核按归属统一回收，不会留半截浮层。
 */
import { markRaw } from 'vue'
import { Palette } from 'lucide-vue-next'
import type { PluginModule } from '@mini-canvas/canvas-base'
import { apply as applyGallery } from './gallery'
import { apply as applyUiSlots } from './ui-slots'
import { apply as applyShellSlots } from './shell-slots'
import { apply as applyHotReload } from './hot-reload'
import ThemeLabNav from './theme-lab/ThemeLabNav.vue'
import ThemeLabSettingsPage from './theme-lab/ThemeLabSettingsPage.vue'
import { Config, THEME_LAB_NAV_ID } from './theme-lab/config'

export { Config }
export { THEME_LAB_NAV_ID }

export const name = 'demo-kit'

/**
 * 四套演示都只消费可选服务（主题没装也能登记，只是少了默认件），所以合集没有硬依赖。
 * 将来某个子件要加硬依赖时写在这里。
 */
export const inject: string[] = []

export function apply(ctx: Parameters<typeof applyGallery>[0]): void {
  // 顺序只影响同一槽里 order 相同的条目的先后；各子件都带自己的 order，故这里按
  // 「先展厅、再插槽、最后热重载靶子」排 —— 热重载靶子的 order 最大，永远垫底。
  applyGallery(ctx)
  applyUiSlots(ctx as never)
  applyShellSlots(ctx as never)
  applyHotReload(ctx as never)

  // 设置面板：左导航「外观 → 主题工作台」+ 整页正文。
  // 颜色格来自真实 settings 中已声明的 color 字段，插件没装就没有对应的项。
  ctx.slots.register('settings.nav', {
    id: 'demo-kit/theme-lab-nav',
    order: 6,
    component: markRaw(ThemeLabNav),
    // pageGroup：这一整页属于 Config.group「主题工作台」；设置菜单把它挂到
    // 「外观 → 主题 → 主题工作台」这个二级节，不再长成一个并列的一级入口。
    meta: {
      title: THEME_LAB_NAV_ID,
      category: '外观',
      icon: Palette,
      page: markRaw(ThemeLabSettingsPage),
      pageGroup: THEME_LAB_NAV_ID,
    },
  })
  ctx.slots.register('settingsGroup/' + THEME_LAB_NAV_ID, {
    id: 'demo-kit/theme-lab-page',
    order: 6,
    component: markRaw(ThemeLabSettingsPage),
    meta: { mode: 'replace' },
  })
}

export const demoKitPlugin: PluginModule = { name, inject, Config, apply }
export default demoKitPlugin
