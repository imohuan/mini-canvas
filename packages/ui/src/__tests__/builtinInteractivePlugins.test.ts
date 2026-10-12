/**
 * 「6 个基础交互插件作为自带件」的守卫。
 *
 * 用户口径（2026-10-12）：「把这几个插件作为自带插件：① 复制粘贴 ② 右键菜单 ③ 文件拖入分组
 * ④ 多选 ⑤ 连线切割」（「文件拖入分组」对应「文件拖入」与「分组」两个插件，故共 6 个）。
 *
 * 「自带」是**两个地方同时声明**才成立的，任何一处漏了都会静默出错：
 * 1. 插件的 package.json 写 miniCanvas.builtin: true —— 服务端清单据此把它列进「设置 → 插件」
 *    的「自带」页（只读展示、不给装卸按钮）；若还是 installable，它就会同时出现在「本地清单」
 *    页并带上安装/卸载按钮（同一插件两个身份）。
 * 2. ui 的 APP_PLUGINS 冷启动装配它 —— 光声明 builtin 而不装配，面板里显示「已装」但画布上
 *    其实没有这个能力（复制粘贴按了没反应），属于最难查的一类假绿灯。
 *
 * 所以要两边一起核，且两边必须**互相印证**（包声明 builtin 的就得在清单里，反之亦然）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { APP_PLUGINS } from '../assembly'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGINS_DIR = path.resolve(HERE, '../../../plugins')

/** 目录名 → 该插件在画布里的运行名（= 源码 export 的 name = package.json 的 pluginName） */
const BUILTIN_INTERACTIVE = {
  'plugin-clipboard': 'clipboard',
  'plugin-context-menu': 'context-menu',
  'plugin-file-drop': 'file-drop',
  'plugin-group': 'group',
  'plugin-multi-select': 'multi-select',
  'plugin-edge-cutting': 'edge-cutting',
} as const

interface MiniCanvas {
  pluginName?: string
  builtin?: boolean
  installable?: boolean
  defaultInstalled?: boolean
}

function miniCanvasOf(dir: string): MiniCanvas {
  const pkg = JSON.parse(readFileSync(path.join(PLUGINS_DIR, dir, 'package.json'), 'utf8')) as {
    miniCanvas?: MiniCanvas
  }
  return pkg.miniCanvas ?? {}
}

describe('6 个基础交互插件 = 自带件', () => {
  it('每个包的 package.json 声明 builtin（不是 installable）', () => {
    for (const [dir, pluginName] of Object.entries(BUILTIN_INTERACTIVE)) {
      const mc = miniCanvasOf(dir)
      expect(mc.builtin, dir + ' 应声明 miniCanvas.builtin: true').toBe(true)
      // installable 与 builtin 语义互斥：同时声明会让插件在"自带"与"本地清单"两页各出现一次
      expect(mc.installable, dir + ' 不该再声明 miniCanvas.installable').toBeUndefined()
      // pluginName 是面板「已装」判定与内核索引用的名字，两处对不上就会显示未装
      expect(mc.pluginName, dir + ' 的 pluginName 应为 ' + pluginName).toBe(pluginName)
    }
  })

  it('每个包都在 APP_PLUGINS 冷启动清单里（声明 builtin 却不装配 = 假绿灯）', () => {
    const names = new Set(APP_PLUGINS.map((p) => (p as { name?: string }).name))
    for (const [dir, pluginName] of Object.entries(BUILTIN_INTERACTIVE)) {
      expect(names.has(pluginName), dir + '（' + pluginName + '）不在 APP_PLUGINS 里').toBe(true)
    }
  })

  it('反向：冷启动清单里不该混进仍声明 installable 的插件（否则同一插件两个身份）', () => {
    // 判据：清单里每个插件只要能在插件目录里找到同名包，那它就必须**不是** installable。
    // 覆盖的是"清单里加了、包声明忘了从 installable 改成 builtin"这种反向漂移。
    // 显式标成 Map<string, string>：不写的话键会被推断成 BUILTIN_INTERACTIVE 那些字面量的联合，
    // 后面用清单里的任意字符串去 get，tsc 就会拦（拦得住，但不该拦在这）。
    const byPluginName = new Map<string, string>(
      Object.entries(BUILTIN_INTERACTIVE).map(([dir, name]) => [name, dir]),
    )
    for (const plugin of APP_PLUGINS) {
      const name = (plugin as { name?: string }).name
      const dir = name ? byPluginName.get(name) : undefined
      if (!dir) continue
      expect(miniCanvasOf(dir).installable, dir + ' 仍在冷启动清单里，不该声明 installable').toBeUndefined()
    }
  })
})
