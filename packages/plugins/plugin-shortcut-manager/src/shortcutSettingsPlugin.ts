/**
 * 设置页「快捷键」的独立插件（应用级，不依赖画布）。
 *
 * 为什么单独拆出来：成品应用的外壳已经自带快捷键帮助浮层，不需要再装完整的
 * shortcut-manager（它会再挂一个 overlay 与 Ctrl+/ 命令）；但设置页里的重映射
 * 配置面板必须有。这里只提供设置页需要的那三样：
 * - 建/复用快捷键管理器；
 * - 登记 settings.nav 配置页；
 * - 把面板按名放进 ui 目录（主题按名取，业务插件之间零引用）。
 */
import type { Context, PluginModule } from '@plume-canvas/canvas-base'
import { commandRuntime } from '@plume-canvas/canvas-data'
import SettingsShortcutPanel from './SettingsShortcutPanel.vue'
import { ensureShortcutManager } from './ensureShortcutManager'
import { onShortcutManager } from './shortcutState'
import type { V2ShortcutManager } from './v2ShortcutManager'

export const name = 'shortcut-settings'
export const inject = [] as string[]

export function apply(ctx: Context): void {
  const save = ctx.tryGet<{
    get<T>(key: string, type?: string): Promise<T | undefined>
    set(key: string, value: unknown, type?: string): void
    onAdapterChange?(cb: (type: string) => void): { dispose(): void }
  }>('save')
  // 主题设置页不 import 本包；管理器按名上架，缺它时面板显示空态。
  // 外壳自带帮助面板时，本插件可能后于画布启动；管理器一就绪就补上服务，
  // 否则设置面板会一直读到空态。
  const expose = (manager: V2ShortcutManager): void => {
    if (!ctx.tryGet('shortcut-manager')) ctx.inject('shortcut-manager', manager)
  }
  const off = onShortcutManager(expose)
  ctx.effect(() => () => off())
  ensureShortcutManager({ command: commandRuntime(), save })

  // 设置菜单按 id 命中这一页（默认菜单只登记 id，页面由这里提供）。
  ctx.slots.register('settings.nav', {
    id: 'nav/personal/shortcuts',
    order: 20,
    component: SettingsShortcutPanel,
    meta: { title: '快捷键', category: '常规' },
  })
  // 主题设置皮按名取这一件。
  ctx.registryOf<unknown>('ui').add('settingsShortcutPanel', SettingsShortcutPanel, {
    id: 'shortcut-settings',
  })
}

export const shortcutSettingsPlugin: PluginModule = { name, inject, apply }
