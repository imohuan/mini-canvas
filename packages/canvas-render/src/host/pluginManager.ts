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
 * 定位：只操作 Context(host.ctx)的公开插件 API + 提供 config 装配，不新增内核逻辑、不依赖具体插件。
 * config 语义（P4）：per-plugin 装配 config，随 ctx.installPlugin(mod, config) 一起经插件 `Config` schema
 * 校验 + 补默认，apply(ctx, config) 收到；不做深度配置合并。
 */
import type { Context, PluginClassLike, PluginModule } from '@mini-canvas/canvas-core-v2'

/** 一个插件的来源：源码模块 / Service 类 / 懒加载源码 / 外部 URL / 单文件插件 js 文本 */
export type PluginEntrySource =
  | PluginModule
  | PluginClassLike
  | { module: () => PluginModule | Promise<PluginModule> }
  | { url: string }
  | { text: string }

/** 装配清单里的一项：给同一 id 一个稳定身份，便于"同 id 覆盖/换版本" */
export interface PluginManifestEntry {
  /** 稳定身份(推荐=插件 name；换实现时仍用同 id → 覆盖旧) */
  id: string
  /** 插件来源 */
  source: PluginEntrySource
  /** 可选 per-plugin 装配 config（经插件 Config schema 校验 + 补默认，apply(ctx,config) 收到） */
  config?: object
  /**
   * DSH/cordis Loader 语义：清单里登记但"关闭"的项 → applyManifest 跳过不装。
   * 常用来整组开关(如 `disabled: true` 的插件保留在清单便于日后打开)或同一 id 多实现里临时停用某版。
   */
  disabled?: boolean
  /** 可选的展示分组名(供宿主 UI 面板分组显示；不影响装载/卸载语义) */
  group?: string
}

/**
 * 来源分类（P1-16 安全边界的基础设施，供宿主实施自己的信任策略）：
 * - 'inline'：内存里的 PluginModule / Service 类（可信源码直连）；
 * - 'lazy'  ：懒加载 module()（源码内部，但延迟取）；
 * - 'url'   ：外部 URL 拉取（远程代码，风险最高）；
 * - 'text'  ：单文件插件 js 文本（外部注入代码）。
 * 宿主可据此决定是否放行（白名单域名/禁远程等），本函数只分类不决策。
 */
export type PluginSourceKind = 'inline' | 'lazy' | 'url' | 'text'

export function sourceKind(source: PluginEntrySource): PluginSourceKind {
  if (typeof (source as { module?: unknown }).module === 'function') return 'lazy'
  if (typeof (source as { url?: unknown }).url === 'string') return 'url'
  if (typeof (source as { text?: unknown }).text === 'string') return 'text'
  return 'inline'
}

/** 装配清单：按序装；后装的同 id 覆盖先装的(轻量分层) */
export interface PluginManifest {
  plugins: PluginManifestEntry[]
}

/** manifestReport 里清单一项的状态 */
export interface ManifestReportEntry {
  /** 清单声明的稳定 id */
  id: string
  /** 解析出的插件 name（id 缺省同 name） */
  name: string
  /** disabled=true → 'disabled'；清单里与已装同名重复(将被后者覆盖) → 'superseded'；否则 'will-install' */
  status: 'disabled' | 'will-install' | 'superseded'
  /** 装配 config（如有） */
  config?: object
}

/** list() 返回的已装插件条目 */
export interface InstalledPluginInfo {
  name: string
  config?: object
  /** fiber 运行时态名(pending/loading/active/failed/…)——P5：list 显 state 供宿主/console 诊断 */
  state?: string
  /** state!=='active' 时缺哪些依赖（回答"卡 PENDING 缺谁"） */
  missingDeps?: string[]
  /** FAILED 时的错误信息 message */
  error?: string
}

/**
 * 把"单文件插件 js 文本"加载成一个 PluginModule。
 * 约定该文件是一个 ESM 模块，导出 name/inject/apply(与仓库插件同款 Cordis 形态)。
 * 经 ESM data-URL import 执行(浏览器与 Node 皆可)，无需 eval/new Function。
 */
export async function loadPluginFromText(text: string): Promise<PluginModule> {
  // 用 percent-encoded 的 data:text/javascript URL(不依赖 Buffer/base64；中文等任意字符都安全)
  const url = `data:text/javascript,${encodeURIComponent(text)}`
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
  /** 已装插件列表(名字 + 可选的装配 config + fiber 运行时态 state/missingDeps/error)。 */
  list(): InstalledPluginInfo[]
  /** 诊断：返回所有 state!=='active' 插件(卡 PENDING 缺谁 / FAILED 报错)，供宿主/console 查异常。 */
  diagnose(): InstalledPluginInfo[]
  /** 按装配清单按序装(后装同 id 覆盖先装)。返回实际装上的插件名(按顺序)。 */
  applyManifest(manifest: PluginManifest): Promise<string[]>
  /**
   * 只读分析一份清单：逐项登记 disabled / 将装(pending) / 同名重复(后覆盖先)，
   * 供宿主 UI/诊断展示"清单登记状态"（P1-7：disabled 项也可见，不再静默跳过）。
   * 不改动装载；实际装载请调 applyManifest。
   */
  manifestReport(manifest: PluginManifest): ManifestReportEntry[]
}


/** 建统一安装句柄。ctx 需已 start；manager 只经 ctx 公开插件 API + config 装配通道工作。 */
export function createPluginManager(ctx: Context): PluginManager {
  /** 已装插件的装配 config 快照(供 list() 显示与 reload 重放；插件卸载即清) */
  const configs = new Map<string, PluginManifestEntry['config']>()

  async function installOne(
    source: PluginEntrySource,
    config?: PluginManifestEntry['config'],
  ): Promise<string> {
    const mod = await resolveSource(source)
    const name = mod.name
    // 同 name(即同 id)覆盖：若已装过同名旧实现 → 先卸(回收副作用)再装新(轻量分层, 换版本即此)
    if (ctx.listPlugins().includes(name)) ctx.uninstallPlugin(name)
    // P4：装配 config 随 installPlugin 一起经插件 Config schema 校验 + 补默认，apply(ctx,config) 收到
    ctx.installPlugin(mod, config)
    configs.set(name, config)
    return name
  }

  /** 逐已装插件，把 ctx 只读查询的 fiber 状态(missingDeps/error)并入每行 → list/diagnose 共用 */
  function snapshotAll(): InstalledPluginInfo[] {
    const runtime = new Map(ctx.inspectPlugins().map((s) => [s.name, s]))
    return ctx.listPlugins().map((name) => {
      const st = runtime.get(name)
      return {
        name,
        ...(configs.get(name) ? { config: configs.get(name) } : {}),
        ...(st
          ? {
              state: st.state,
              missingDeps: st.missingDeps,
              ...(st.error !== undefined ? { error: st.error } : {}),
            }
          : {}),
      }
    })
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
      // 换版本：保留上次装配 config 以便新实现同样吃到覆盖(轻量分层语义)
      const prevConfig = configs.get(name)
      if (!next) {
        configs.delete(name)
        ctx.uninstallPlugin(name)
        return
      }
      const mod = await resolveSource(next)
      ctx.uninstallPlugin(name)
      ctx.installPlugin(mod, prevConfig)
      configs.set(name, prevConfig)
    },

    list() {
      return snapshotAll()
    },

    diagnose() {
      return snapshotAll().filter((p) => p.state !== 'active')
    },

    manifestReport(manifest) {
      const report: ManifestReportEntry[] = []
      for (const entry of manifest.plugins) {
        // 同步来源(PluginModule/Service 类)能取 name；懒加载/URL/文本来源只能给 id（name 需异步解析）
        const direct = entry.source as PluginModule
        const name = typeof direct.name === 'string' ? direct.name : entry.id
        report.push({
          id: entry.id,
          name,
          status: entry.disabled
            ? 'disabled'
            : report.some((r) => r.id === entry.id || r.name === name)
              ? 'superseded'
              : 'will-install',
          ...(entry.config ? { config: entry.config } : {}),
        })
      }
      return report
    },

    async applyManifest(manifest) {
      const installed: string[] = []
      for (const entry of manifest.plugins) {
        // DSH Loader 语义：disabled 项登记但关闭 → 跳过不装(清单里保留、便于日后打开)
        if (entry.disabled) continue
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






