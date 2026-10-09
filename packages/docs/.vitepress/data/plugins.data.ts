import { defineLoader } from 'vitepress'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 构建期数据加载器：扫 packages/plugins，把每个插件的「声明」抽出来给文档用。
 *
 * 数据来源是各插件自己的 package.json（miniCanvas 字段），所以：
 * **装一个新插件 = 文档自动多一行**，不用手写目录。
 *
 * 这里只取「静态声明」（插件名、标题、说明、有没有前端半/后台半、权限、版本）。
 * 插件在运行期真正注册了哪些能力（槽位/路由/存储/定时/MCP/Agent），
 * 由后台接口下发，见 /plugins/runtime-capabilities 页面与 RuntimeCapabilities 组件。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 从 packages/docs/.vitepress/data 往上 4 层到仓库根，再进 packages/plugins */
const PLUGINS_DIR = path.resolve(HERE, '../../../..', 'packages/plugins')

export interface PluginDocEntry {
  /** 目录名，稳定身份 */
  id: string
  /** 插件在画布里的真实名字（miniCanvas.pluginName） */
  name: string
  /** 显示名（miniCanvas.title） */
  title: string
  description: string
  version: string
  /** npm 包名 */
  npmName: string
  /** 随应用冷启动装配、不可装卸 */
  builtin: boolean
  /** 可经插件管理装卸 */
  installable: boolean
  /** 声明了前端产物入口（可经插件管理从清单加载的 UMD 产物） */
  hasWeb: boolean
  /** 有后台半：外挂服务插件产物，或自带插件配套的后台内置半 */
  hasServer: boolean
  /** 后台插件声明的权限 */
  serverPermissions: string[]
  /** 文档站内的详情页链接（约定：/plugins/<name>） */
  link: string
}

interface MiniCanvasMeta {
  title?: string
  description?: string
  pluginName?: string
  builtin?: boolean
  installable?: boolean
  /** 自带插件配套的后台半（后台内置跑着，不单独产出文件） */
  serverBuiltin?: boolean
  /** 前端半的 UMD 产物入口（可经插件管理加载） */
  web?: { entry?: string }
  /** 后台半的产物入口（外挂服务插件） */
  server?: { entry?: string }
  serverPermissions?: string[]
}

declare const data: { plugins: PluginDocEntry[]; pluginsDir: string }
export { data }

export default defineLoader({
  async load(): Promise<{ plugins: PluginDocEntry[]; pluginsDir: string }> {
    const plugins: PluginDocEntry[] = []
    let names: string[] = []
    try {
      names = await fs.readdir(PLUGINS_DIR)
    } catch {
      return { plugins, pluginsDir: PLUGINS_DIR }
    }

    for (const dirName of names.sort()) {
      if (dirName.startsWith('_') || dirName.startsWith('.')) continue
      const pkgDir = path.join(PLUGINS_DIR, dirName)
      const st = await fs.stat(pkgDir).catch(() => null)
      if (!st?.isDirectory()) continue

      const raw = await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8').catch(() => '')
      if (!raw) continue
      let pkg: { name?: string; version?: string; miniCanvas?: MiniCanvasMeta }
      try {
        pkg = JSON.parse(raw)
      } catch {
        continue
      }
      const mc = pkg.miniCanvas ?? {}
      const builtin = mc.builtin === true
      const installable = mc.installable === true
      // 两个标记都没有 = 不是给文档展示的插件（与插件管理口径一致）
      if (!builtin && !installable) continue

      const name = mc.pluginName ?? (pkg.name ?? dirName).replace(/^@[^/]+[/]/, '')
      plugins.push({
        id: dirName,
        name,
        title: mc.title ?? dirName,
        description: mc.description ?? '',
        version: pkg.version ?? '',
        npmName: pkg.name ?? dirName,
        builtin,
        installable,
        hasWeb: Boolean(mc.web?.entry),
        hasServer: Boolean(mc.server?.entry) || mc.serverBuiltin === true,
        serverPermissions: mc.serverPermissions ?? [],
        link: '/plugins/' + name,
      })
    }

    plugins.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
    return { plugins, pluginsDir: PLUGINS_DIR }
  },
})
