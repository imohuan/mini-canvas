/**
 * pluginManager —— 画布宿主的"统一安装句柄"(目标 D)。
 *
 * 把散在 api/ctx 上的装/卸/换版本收成一个 manager：
 *   install(source) / uninstall(name) / reload(name, next?) / list()
 * 并支持从**外部来源**装插件(不只收内存里的 PluginModule)：
 *   - 源码 import 来的 PluginModule(最常见)
 *   - 单文件插件 js 文本 / URL(经 ESM data-URL import 加载出 {name,apply,...})
 * 以及一份**装配清单(manifest)**：声明"装哪些、什么顺序、每插件 config"，按序装、同 id 覆盖。
 *
 * 定位：只操作 Context(host.ctx)的公开插件 API + settings，不新增内核逻辑、不依赖具体插件。
 * config 语义：可选的 per-plugin 配置，用作"装配覆盖插件默认配置"——装完某插件后，若某 key 已被该插件
 * ctx.settings.define 声明，则覆写其当前值(单一数据源仍归 settings)。不做深度配置合并。
 */
import type { Context, PluginModule } from '@mini-canvas/canvas-core-v2'

/** 一个插件的来源：源码模块 / 懒加载源码 / 外部 URL / 单文件插件 js 文本 */
export type PluginEntrySource =
  | PluginModule
  | { module: () => PluginModule | Promise<PluginModule> }
  | { url: string }
  | { text: string }

/** 装配清单里的一项：给同一 id 一个稳定身份，便于"同 id 覆盖/换版本" */
export interface PluginManifestEntry {
  /** 稳定身份(推荐=插件 name；换实现时仍用同 id → 覆盖旧) */
  id: string
  /** 插件来源 */
  source: PluginEntrySource
  /** 可选 per-plugin 配置(覆写该插件已声明 settings 的当前值) */
  config?: Record<string, string | number | boolean>
}

/** 装配清单：按序装；后装的同 id 覆盖先装的(轻量分层) */
export interface PluginManifest {
  plugins: PluginManifestEntry[]
}

/** list() 返回的已装插件条目 */
export interface InstalledPluginInfo {
  name: string
  config?: Record<string, string | number | boolean>
}

/**
 * 把"单文件插件 js 文本"加载成一个 PluginModule。
 * 约定该文件是一个 ESM 模块，导出 name/inject/apply(与仓库插件同款 Cordis 形态)。
 * 经 ESM data-URL import 执行(浏览器与 Node 皆可)，无需 eval/new Function。
 */
export async function loadPluginFromText(text: string): Promise<PluginModule> {
  const url = `data:text/javascript;base64,${Buffer.from(text, 'utf8').toString('base64')}`
  const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>
  // 支持 named export(name/apply…) 或 default 整体导出两种写法
  const m = (mod.default && typeof mod.default === 'object' ? mod.default : mod) as PluginModule
  if (!m || typeof m.name !== 'string') {
    throw new Error('[pluginManager] 单文件插件需导出 name(与 apply/…)。')
  }
  return m
}

/** 把 URL 对应的单文件插件 js 抓下来并加载成 PluginModule(浏览器 fetch)。 */
export async function loadPluginFromUrl(url: string): Promise<PluginModule> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`[pluginManager] 拉取插件 URL 失败: ${url} (${res.status})`)
  return loadPluginFromText(await res.text())
}

/** 把"来源"归一成一个 PluginModule(懒加载/外部来源则异步取)。 */
export async function resolveSource(source: PluginEntrySource): Promise<PluginModule> {
  if ('module' in source) return (source as { module(): PluginModule | Promise<PluginModule> }).module()
  if ('url' in source) return loadPluginFromUrl((source as { url: string }).url)
  if ('text' in source) return loadPluginFromText((source as { text: string }).text)
  return source as PluginModule
}

/** 目标 D 统一安装句柄。基于一个已 start 的 Context(宿主 ctx)操作。 */
export interface PluginManager {
  /** 装一个来源(PluginModule / 懒加载 / URL / 单文件文本)。返回插件名。 */
  install(source: PluginEntrySource, opts?: { config?: PluginManifestEntry['config'] }): Promise<string>
  /** 卸一个插件(副作用/注册/UI 自动回收)。返回是否真卸到。 */
  uninstall(name: string): boolean
  /** 换版本：卸旧装新(同 name 更新实现)。 */
  reload(name: string, next?: PluginEntrySource): Promise<void>
  /** 已装插件列表(名字 + 可选的装配 config)。 */
  list(): InstalledPluginInfo[]
  /** 按装配清单按序装(后装同 id 覆盖先装)。返回实际装上的插件名(按顺序)。 */
  applyManifest(manifest: PluginManifest): Promise<string[]>
}

/** 建统一安装句柄。ctx 需已 start；manager 只经 ctx 公开 API + ctx.get('settings') 工作。 */
export function createPluginManager(ctx: Context): PluginManager {
  /** 已装插件的装配 config 快照(供 list() 显示；插件卸载即清) */
  const configs = new Map<string, PluginManifestEntry['config']>()

  function applyConfig(pluginName: string, config?: PluginManifestEntry['config']): void {
    if (!config) return
    for (const [key, value] of Object.entries(config)) {
      const settings = ctx.get<{ has(k: string): boolean; set(k: string, v: unknown): boolean }>('settings')
      if (settings.has(key)) settings.set(key, value) // 覆写已声明项；未声明项忽略(不做深合并)
    }
  }

  async function installOne(
    source: PluginEntrySource,
    config?: PluginManifestEntry['config'],
  ): Promise<string> {
    const mod = await resolveSource(source)
    const name = mod.name
    // 同 name(即同 id)覆盖：若已装过同名旧实现 → 先卸(回收副作用)再装新(轻量分层, 换版本即此)
    if (ctx.listPlugins().includes(name)) ctx.uninstallPlugin(name)
    ctx.installPlugin(mod)
    applyConfig(name, config)
    configs.set(name, config)
    return name
  }

  return {
    async install(source, opts) {
      return installOne(source, opts?.config)
    },

    uninstall(name) {
      configs.delete(name)
      return ctx.uninstallPlugin(name)
    },

    async reload(name, next) {
      if (!next) {
        configs.delete(name)
        ctx.uninstallPlugin(name)
        return
      }
      const mod = await resolveSource(next)
      ctx.uninstallPlugin(name)
      ctx.installPlugin(mod)
      configs.set(name, undefined)
    },

    list() {
      return ctx.listPlugins().map((name) => ({
        name,
        ...(configs.get(name) ? { config: configs.get(name) } : {}),
      }))
    },

    async applyManifest(manifest) {
      const installed: string[] = []
      for (const entry of manifest.plugins) {
        // 装配清单的 id 建议 = 插件 name；同 name 后装会覆盖先装(installOne 内处理)
        const name = await installOne(entry.source, entry.config)
        // 被覆盖的旧名若在 installed 里则移除，只保留最新一次
        const prev = installed.indexOf(name)
        if (prev >= 0) installed.splice(prev, 1)
        installed.push(name)
      }
      return installed
    },
  }
}
