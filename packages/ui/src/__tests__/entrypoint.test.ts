/**
 * 成品出口契约测试 —— 锁住"包根声明指向的东西真实存在且公开面是设计好的那几样"。
 *
 * 为什么值得单开一条：本包此前的 bug 正是"`package.json` 的 `main`/`types` 都指 `./src/index.ts`，
 * 而那个文件不存在"—— 安装方 `import '@mini-canvas/ui'` 会直接报模块找不到，
 * 但仓库内没有任何测试会红（没人从包根 import 自己）。这类"声明与实体脱节"的错，
 * 只能靠"读 package.json 再核对文件"来拦，功能测试永远碰不到。
 *
 * 同时钉住装配清单的可替换性：清单必须给出且自洽（无重名、含必备的基础件），
 * 这样"换一套插件组合只改清单、不改组件"这句话才有底线保障。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { APP_PLUGINS, SAMPLE_TEXT, createDefaultStorageAdapter, seedDefaultCanvas } from '../assembly'
import * as entry from '../index'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf-8')) as {
  main: string
  types: string
  exports: Record<string, Record<string, string> | string>
}

describe('@mini-canvas/ui 出口契约', () => {
  it('package.json 的 main / types / exports 指向的文件真实存在', () => {
    // 曾经的 bug：三者都指 ./src/index.ts，而该文件不存在 → 安装方 import 直接失败
    expect(existsSync(path.resolve(PKG_ROOT, pkg.main)), `main 指向的文件不存在: ${pkg.main}`).toBe(true)
    expect(existsSync(path.resolve(PKG_ROOT, pkg.types)), `types 指向的文件不存在: ${pkg.types}`).toBe(true)
    const root = pkg.exports['.'] as Record<string, string>
    expect(existsSync(path.resolve(PKG_ROOT, root.types))).toBe(true)
    expect(existsSync(path.resolve(PKG_ROOT, root.default))).toBe(true)
  })

  it('入口导出成品应用与装配决定（安装方拿得到的东西就是这几样）', () => {
    expect(entry.CanvasApp).toBeTruthy() // 应用本体（= App.vue）
    expect(typeof entry.mountCanvasApp).toBe('function') // 一行挂载
    expect(entry.APP_PLUGINS).toBe(APP_PLUGINS) // 装配清单同源
    expect(entry.seedDefaultCanvas).toBe(seedDefaultCanvas)
    expect(typeof entry.createDefaultStorageAdapter).toBe('function')
  })

  it('装配清单自洽：插件数、无重名、含画布基础件', () => {
    // 20 个源码插件（含音频节点插件）+ 本应用自己的一个（ui-settings-panel 设置面板换皮）= 24。
    // 2026-10-03：批量把插件改为经「插件管理」从云服务清单安装（默认已装），不再冷启动：
    //   image-compare / tool-image-generation / tool-text-generation / web2api-tools +
    //   edge-cutting / multi-select / align-guide / auto-layout / align-arrange /
    //   group / context-menu / clipboard / canvas-export / node-find / mini-map / file-drop。
    // 冷启动只剩画布骨架（主题皮 / 设置面板 / 下拉）+ 底栏 + 节点类型 + Agent + 插件管理本身。
    // 主题色配置**不在清单里**了：色板已上移进渲染层（canvas-render 的 themePalette），
    // 由宿主 createMiniCanvasHost 直接声明与落值，任一宿主都自带。
    // 不装 shortcut-manager：成品 UI 自带快捷键面板（DockArea 按钮 + ModalsArea 浮层），
    // 插件版 Ctrl+/ 帮助面板与之重复；键盘分发由 CanvasHost 按命令 keys 统一做，不依赖它。
    // 假后台插件（旧 plugin-mock-task-backend）已删：测试用的假动作不该以插件形式
    // 混进成品清单 —— 需要假后台的浏览器回归在测试里现场注册一条 e2e 动作。
    // +1：ui-dropdown（全局下拉注册件，order -1 顶替主题默认件）。
    // +1：ui-hot-reload（设置面板「热重载」分类：登记链接，产物变了自动重装）。
    // +1：ui-asset-upload（「加入资产库」：节点右键 + 多选上控制栏 → 贴进上传弹窗）。
    // 注：「引用标签被点了」走的是**系统事件**（agent:ref-click），没有对应的插件/服务 ——
    //     监听与浮层都在 AssetUiSlot（挂在 CanvasHost #ui 槽里），故不占清单名额。
    expect(APP_PLUGINS).toHaveLength(13)
    // 第一项必须是默认主题皮：它提供节点壳 / 边 / 背景 / 设置面板默认皮，缺了画布就是白屏
    expect(APP_PLUGINS[0]).toBeTruthy()
    // 无重名：同名插件装两次会让注册表后装者覆盖先装者，症状极难查
    const names = APP_PLUGINS.map((p) => (p as { name?: string }).name).filter(Boolean) as string[]
    expect(new Set(names).size).toBe(names.length)
    // 每个条目都得是可装载形态（对象带 apply，或类）
    for (const p of APP_PLUGINS) {
      const ok = typeof p === 'function' || typeof (p as { apply?: unknown }).apply === 'function'
      expect(ok, `清单里有一项不是可装载的插件形态: ${JSON.stringify(p)}`).toBe(true)
    }
  })

  it('默认画布样例仍是 text + image 两个节点（换种子不该悄悄改变成品首屏）', () => {
    const nodes = seedDefaultCanvas()
    expect(nodes.map((n) => n.type)).toEqual(['text', 'image'])
    expect(nodes.map((n) => n.id)).toEqual(['1', '2'])
    expect(nodes[0].data.text).toBe(SAMPLE_TEXT)
    expect(String(nodes[1].data.imageUrl).startsWith('data:image/svg+xml')).toBe(true)
  })
})
