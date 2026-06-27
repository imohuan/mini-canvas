import type { CanvasPlugin, PluginContext } from '../types'

export const CustomHandlePlugin: CanvasPlugin = {
  name: 'custom-handle',
  version: '1.0.0',
  install(context: PluginContext) {
    context.registerHandleConfig({ radius: 86, restOffset: 36, cursorGap: 24, buttonSize: 32, overlap: 16, snapOuterRatio: 0.75, snapInnerRatio: 0.6, snapHeightRatio: 1.35 })
  },
}