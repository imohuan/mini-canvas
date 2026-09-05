/**
 * baseManifest —— 一份"装配清单"(目标 D)：别的画布应用拿到后，用 manager.applyManifest 一行照单全装。
 *
 * 用法：
 *   import { baseManifest } from '…/baseManifest'
 *   import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
 *   const { manager } = await createMiniCanvasHost()
 *   await manager.applyManifest(baseManifest)   // 按序装 theme-default / node-text / image / commands(同 id 覆盖=换版本)
 *
 * 想换某插件的"默认配置"：在对应项加 config(经该插件导出的 Config schema 校验 + 补默认，apply(ctx,config) 收到)。
 * 想只装其中几个 / 换顺序 / 覆盖成自己版本：把这数组改成你那份即可(轻量分层)。
 */
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'
import type { PluginManifest } from '@mini-canvas/canvas-render'

/** 一份可直接给 manager.applyManifest 用的基础装配清单(按序装 + 可选 config 覆盖) */
export const baseManifest: PluginManifest = {
  plugins: [
    { id: 'theme-default', source: themeDefaultPlugin },
    { id: 'node-text', source: nodeTextPlugin },
    { id: 'node-image', source: nodeImagePlugin },
    { id: 'canvas-commands', source: canvasCommandsPlugin },
    // 换默认配色示例：给 theme-default 传 config，覆写它 settings 里声明的 edgeColor/edgeLineWidth
    // { id: 'theme-default', source: themeDefaultPlugin, config: { edgeColor: '#16a34a', edgeLineWidth: 3 } },
  ],
}
