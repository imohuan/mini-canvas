/**
 * 真实「全部可安装插件」装配下的设置菜单体检。
 *
 * 为什么需要它：settingsCoverage 只装了 APP_PLUGINS 冷启动子集，
 * 用户真机装完插件后出现的重复「外观」「个人 → 集成 / 可视化节点」它抓不到。
 * 这里把本地所有带 Config 的插件都装上，钉死：
 * - 没有 auto 兜底（每个 group 都有显式 section）；
 * - 一级菜单 id / 标题不重复；
 * - 每个 group 恰好被一个 section 收编（合并展示算一次）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import type { PluginModule } from '@mini-canvas/kernel'

import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { nodeVideoPlugin } from '@mini-canvas/plugin-node-video'
import { nodeAudioPlugin } from '@mini-canvas/plugin-node-audio'
import { node3dPreviewPlugin } from '@mini-canvas/plugin-node-3d-preview'
import { nodeImageComparePlugin } from '@mini-canvas/plugin-node-image-compare'
import { nodeUiPlugin } from '@mini-canvas/plugin-node-ui'
import { nodeRotatePlugin } from '@mini-canvas/plugin-node-rotate'
import { gridSplitPlugin } from '@mini-canvas/plugin-image-grid-split'
import { alignArrangePlugin } from '@mini-canvas/plugin-align-arrange'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
import { autoLayoutPlugin } from '@mini-canvas/plugin-auto-layout'
import { canvasExportPlugin } from '@mini-canvas/plugin-canvas-export'
import { nodeFindPlugin } from '@mini-canvas/plugin-node-find'
import { miniMapPlugin } from '@mini-canvas/plugin-mini-map'
// 这两个插件由「插件管理」从清单安装，不在 ui 的依赖里；用相对路径直接读源码。
import { styleLibraryPlugin } from '../../../plugins/plugin-style-library/src/index'
import { web2apiToolsPlugin } from '@mini-canvas/plugin-web2api-tools'
import { pluginImageGenerationTools } from '@mini-canvas/plugin-tool-image-generation'
import { pluginTextGenerationTools } from '@mini-canvas/plugin-tool-text-generation'
import { cursorEffectPlugin } from '../../../plugins/plugin-cursor-effect/src/index'
import { pluginBottomBar } from '@mini-canvas/plugin-bottom-bar'
import { pluginManagerPlugin } from '@mini-canvas/plugin-manager'
import { agentPlugin } from '@mini-canvas/plugin-agent'
import { hotReloadPlugin } from '@mini-canvas/plugin-hot-reload'
import { showcasePlugin } from '../../../plugins/plugin-showcase/src/index'
import { demoKitPlugin } from '@mini-canvas/plugin-demo-kit'
import { shortcutManagerPlugin } from '@mini-canvas/plugin-shortcut-manager'
import { clipboardPlugin } from '@mini-canvas/plugin-clipboard'
import { contextMenuPlugin } from '@mini-canvas/plugin-context-menu'
import { fileDropPlugin } from '@mini-canvas/plugin-file-drop'
import { groupPlugin } from '@mini-canvas/plugin-group'
import { multiSelectPlugin } from '@mini-canvas/plugin-multi-select'
import { edgeCuttingPlugin } from '@mini-canvas/plugin-edge-cutting'
// 按运行环境选装、不在 ui 依赖里：同样走相对路径
import { autoSavePlugin } from '../../../plugins/plugin-auto-save/src/index'
import { historyPlugin } from '../../../plugins/plugin-history/src/index'

/** 本地全部插件（顺序无妨；settings 只按 Config 收分组） */
const ALL_PLUGINS = [
  themeDefaultPlugin,
  nodeTextPlugin,
  nodeImagePlugin,
  nodeVideoPlugin,
  nodeAudioPlugin,
  node3dPreviewPlugin,
  nodeImageComparePlugin,
  nodeUiPlugin,
  nodeRotatePlugin,
  gridSplitPlugin,
  alignArrangePlugin,
  alignGuidePlugin,
  autoLayoutPlugin,
  canvasExportPlugin,
  nodeFindPlugin,
  miniMapPlugin,
  styleLibraryPlugin,
  web2apiToolsPlugin,
  pluginImageGenerationTools,
  pluginTextGenerationTools,
  cursorEffectPlugin,
  pluginBottomBar,
  pluginManagerPlugin,
  agentPlugin,
  hotReloadPlugin,
  showcasePlugin,
  demoKitPlugin,
  shortcutManagerPlugin,
  // cloud-client 会把存档后端换成云端（单测没有后台会直接抛错），
  // 它的分组 '常规/云端客户端' 已由 defaultMenu 显式收编，这里不启动。
  clipboardPlugin,
  contextMenuPlugin,
  fileDropPlugin,
  groupPlugin,
  multiSelectPlugin,
  edgeCuttingPlugin,
  autoSavePlugin,
  historyPlugin,
] as unknown as PluginModule[]

interface MenuView {
  categories: Array<{ id: string; title: string; navs: Array<{ id: string; title: string; sections: Array<{ id: string; title: string; group: string; groups: string[]; auto?: boolean }> }> }>
  navs: Array<{ id: string; title: string; sections: Array<{ id: string; title: string; group: string; groups: string[]; auto?: boolean }> }>
  issues: Array<{ kind: string; title: string; group?: string; nav?: string }>
}

async function bootAll() {
  // cloud-client / shortcut-manager 会主动打后台；单测没有后台，返回 404 让它们安静降级。
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
  const { host } = await createMiniCanvasHost({
    adapter: new MemoryStorageAdapter(),
    coldPlugins: ALL_PLUGINS,
    persistSettings: false,
  })
  const settings = host.ctx.get<{ groups(): string[] }>('settings')
  const menu = host.ctx.get<{ resolve(groups: readonly string[]): MenuView }>('settingsMenu')
  return { host, settings, menu }
}

afterEach(() => vi.unstubAllGlobals())

describe('真实全插件装配：设置菜单', () => {
  it('每个分组都被显式 section 收编，没有 auto 兜底', async () => {
    const { host, settings, menu } = await bootAll()
    const groups = settings.groups()
    const view = menu.resolve(groups)
    // 诊断用：失败时能直接看到缺哪些
    const auto = view.navs.flatMap((n) => n.sections.filter((s) => s.auto))
    expect(auto.map((s) => s.group)).toEqual([])
    expect(view.issues).toEqual([])
    host.stop()
  })

  it('一级菜单 id 与标题都不重复', async () => {
    const { host, settings, menu } = await bootAll()
    const view = menu.resolve(settings.groups())
    const ids = view.navs.map((n) => n.id)
    const titles = view.navs.map((n) => n.title)
    expect(ids.filter((id) => id.startsWith('auto:'))).toEqual([])
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(titles).size).toBe(titles.length)
    host.stop()
  })

  it('每个分组恰好出现一次', async () => {
    const { host, settings, menu } = await bootAll()
    const groups = settings.groups()
    const view = menu.resolve(groups)
    const seen = view.navs.flatMap((n) => n.sections.flatMap((s) => s.groups))
    for (const group of groups) {
      expect(seen.filter((g) => g === group), group + ' 出现了多次').toHaveLength(1)
    }
    host.stop()
  })
})
