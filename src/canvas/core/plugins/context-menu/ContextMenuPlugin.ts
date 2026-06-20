import type { CanvasPlugin, PluginContext, MenuItemDefinition } from '../types'
import { registerBuiltinMenuItems } from './builtinMenuItems'

export const ContextMenuPlugin: CanvasPlugin = {
  name: 'context-menu',
  version: '1.0.0',

  install(context: PluginContext) {
    registerBuiltinMenuItems(context)

    // 右键画布空白 → 打开"添加节点"菜单
    const offContextMenu = context.on("paneContextMenu", (payload: { clientX: number; clientY: number; flowPosition: { x: number; y: number } }) => {
      context.emit("canvas:showCreateMenu", {
        position: { x: payload.clientX, y: payload.clientY },
        mode: "pane",
        title: "添加节点",
        context: { flowPosition: payload.flowPosition },
      })
    })

    // 双击画布空白 → 打开"添加节点"菜单
    const offDblClick = context.on("paneDoubleClick", (payload: { clientX: number; clientY: number; flowPosition: { x: number; y: number } }) => {
      context.emit("canvas:showCreateMenu", {
        position: { x: payload.clientX, y: payload.clientY },
        mode: "pane",
        title: "添加节点",
        context: { flowPosition: payload.flowPosition },
      })
    })

    return {
      uninstall() {
        context.menus.unregisterSource('context-menu')
        offContextMenu()
        offDblClick()
      },
    }
  },
}
