import type { CanvasPlugin, PluginContext } from '../types'
import { createBuiltinMenuItems } from './builtinMenuItems'

export const ContextMenuPlugin: CanvasPlugin = {
  name: 'context-menu',
  version: '1.0.0',

  install(context: PluginContext) {
    context.menus.register(createBuiltinMenuItems())
    return {
      uninstall() {
        context.menus.unregisterAll()
      },
    }
  },
}