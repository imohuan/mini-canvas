import type { CanvasPlugin, PluginContext } from '../types'
import { registerBuiltinMenuItems } from './builtinMenuItems'

export const ContextMenuPlugin: CanvasPlugin = {
  name: 'context-menu',
  version: '1.0.0',

  install(context: PluginContext) {
    registerBuiltinMenuItems(context)
    return {
      uninstall() {
        context.menus.unregisterSource('context-menu')
      },
    }
  },
}
