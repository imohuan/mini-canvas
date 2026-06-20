import type { CanvasPlugin, PluginContext, CanvasConfig, Logger, PluginInstallResult } from './types'
import { PluginLifecycle } from './types'
import { EventBus } from './PluginContext'

/**
 * 插件管理器
 *
 * 负责插件的注册、卸载、依赖解析和生命周期管理。
 * 使用 Kahn 拓扑排序算法解析插件依赖关系，并检测循环依赖。
 *
 * @example
 * ```typescript
 * const manager = new PluginManager()
 * await manager.install({ plugins: [pluginA, pluginB] })
 * ```
 */
export class PluginManager {
  /** 已安装的插件映射：name → plugin 实例 */
  private plugins: Map<string, CanvasPlugin> = new Map()

  /** 插件对应的上下文映射 */
  private contexts: Map<string, PluginContext> = new Map()

  /** 插件 install() 返回的结果映射（api + uninstall 清理函数） */
  private installResults: Map<string, PluginInstallResult> = new Map()

  /** 插件生命周期状态映射 */
  private lifecycles: Map<string, PluginLifecycle> = new Map()

  /** 插件加载顺序（拓扑排序后的名称列表） */
  private loadOrder: string[] = []

  /** 日志记录器 */
  private logger: Logger

  /** 内部事件处理器 */
  private eventHandlers: Map<string, Array<(...args: unknown[]) => void>> = new Map()

  /** 可选：默认上下文工厂函数 */
  private contextFactory?: (pluginName: string) => PluginContext

  /** 共享事件总线，所有 PluginContext 共用此实例实现插件间通信 */
  readonly eventBus: EventBus

  /** 注册中心引用（用于插件卸载时清理） */
  private _registries: {
    command?: { unregisterSource(source: string): void }
    toolbar?: { unregisterSource(source: string): void }
    panel?: { unregisterSource(source: string): void }
  } | null = null

  setRegistries(regs: { commandRegistry?: { unregisterSource(source: string): void }; toolbarRegistry?: { unregisterSource(source: string): void }; panelRegistry?: { unregisterSource(source: string): void } }): void {
    this._registries = {
      command: regs.commandRegistry,
      toolbar: regs.toolbarRegistry,
      panel: regs.panelRegistry,
    }
  }

  /** 默认日志实现（使用 console） */
  private static readonly defaultLogger: Logger = {
    debug: (...args: unknown[]) => console.debug('[PluginManager]', ...args),
    info: (...args: unknown[]) => console.info('[PluginManager]', ...args),
    warn: (...args: unknown[]) => console.warn('[PluginManager]', ...args),
    error: (...args: unknown[]) => console.error('[PluginManager]', ...args),
  }

  /**
   * 创建 PluginManager 实例
   *
   * @param logger - 可选的日志记录器，不提供则使用 console
   * @param contextFactory - 可选的上下文工厂函数，用于为插件创建 PluginContext
   */
  constructor(
    logger?: Logger,
    contextFactory?: (pluginName: string) => PluginContext,
  ) {
    this.logger = logger ?? PluginManager.defaultLogger
    this.contextFactory = contextFactory
    this.eventBus = new EventBus()
  }

  /**
   * 安装配置中指定的所有插件
   *
   * 安装流程：
   * 1. 验证重复插件名称
   * 2. 解析依赖 → 拓扑排序 → 检测循环依赖
   * 3. 按顺序逐个安装，失败时回滚已安装的插件
   * 4. 激活所有已安装的插件
   * 5. 触发 'plugins:ready' 事件
   *
   * @param config - Canvas 配置，包含要安装的插件列表
   * @throws 重复名称、缺失依赖、自依赖、循环依赖、安装失败时抛出
   */
  async install(config: CanvasConfig): Promise<void> {
    const { plugins: pluginList, createContext: cfgContextFactory } = config
    const effectiveContextFactory = cfgContextFactory ?? this.contextFactory

    // 0. 防止重复安装
    const alreadyInstalled = pluginList.filter((p) => this.plugins.has(p.name))
    if (alreadyInstalled.length > 0) {
      throw new Error(
        `[PluginManager] Plugins already installed: ${alreadyInstalled.map((p) => p.name).join(', ')}`,
      )
    }

    // 1. 验证重复插件名称
    this.validateDuplicateNames(pluginList)

    // 2. 解析依赖并拓扑排序
    const order = this.resolveOrder(pluginList)

    // 3. 按顺序安装
    const installed: string[] = []
    const nameToPlugin = new Map(pluginList.map((p) => [p.name, p] as const))

    try {
      for (const name of order) {
        const plugin = nameToPlugin.get(name)!
        this.setLifecycle(name, PluginLifecycle.INSTALLING)

        const context = this.createPluginContext(name, effectiveContextFactory)

        try {
          const result = await plugin.install(context, (plugin.options || {}) as Record<string, unknown>)
          // 捕获 install() 返回值（新 hooks 式）：{ api, uninstall }
          if (result && typeof result === 'object') {
            this.installResults.set(name, result as PluginInstallResult)
          }
          // 只有 install 成功才注册 context 和 plugin
          this.contexts.set(name, context)
          this.plugins.set(name, plugin)
          this.setLifecycle(name, PluginLifecycle.INSTALLED)
          installed.push(name)
          this.logger.debug(`[PluginManager] Installed plugin: "${name}"`)
        } catch (installErr) {
          this.logger.error(`[PluginManager] Plugin "${name}" install threw:`, installErr)
          this.setLifecycle(name, PluginLifecycle.ERROR)
          throw installErr
        }
      }
    } catch (err) {
      // 4. 回滚：反向顺序卸载已安装的插件
      await this.rollback([...installed].reverse())
      throw err
    }

    // 5. 激活所有插件，收集失败信息
    const activationErrors: Array<{ name: string; error: unknown }> = []
    for (const name of order) {
      try {
        await this.activatePlugin(name)
      } catch (err) {
        this.logger.error(`[PluginManager] Activation failed for "${name}":`, err)
        this.setLifecycle(name, PluginLifecycle.ERROR)
        activationErrors.push({ name, error: err })
      }
    }

    // 6. 记录加载顺序并触发就绪事件
    this.loadOrder = order
    this.emit('plugins:ready', { plugins: order, activationErrors })
    this.logger.info(`[PluginManager] All plugins ready. Load order: ${order.join(' → ')}`)
  }

  /**
   * 卸载指定插件
   *
   * 卸载前会检查是否有其他已安装插件依赖此插件，
   * 如有则抛出错误阻止卸载。
   *
   * @param pluginName - 要卸载的插件名称
   * @throws 插件未安装、存在依赖方时抛出
   */
  async uninstall(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName)
    if (!plugin) {
      throw new Error(`[PluginManager] Plugin "${pluginName}" is not installed`)
    }

    // 1. 检查是否有其他插件依赖此插件
    const dependents = this.getDependents(pluginName)
    if (dependents.length > 0) {
      throw new Error(
        `[PluginManager] Cannot uninstall "${pluginName}": still depended on by: ${dependents.join(', ')}`,
      )
    }

    // 2. 设置生命周期为卸载中
    this.setLifecycle(pluginName, PluginLifecycle.UNINSTALLING)

    // 清理该插件注册的所有注册项
    this._registries?.command?.unregisterSource(pluginName)
    this._registries?.toolbar?.unregisterSource(pluginName)
    this._registries?.panel?.unregisterSource(pluginName)

    // 3. 调用清理函数：优先使用 install() 返回的 uninstall，fallback 到 plugin.uninstall()
    const installResult = this.installResults.get(pluginName)
    if (installResult?.uninstall) {
      try {
        await installResult.uninstall()
      } catch (err) {
        this.logger.error(`[PluginManager] Plugin "${pluginName}" uninstall (from install result) threw:`, err)
        this.setLifecycle(pluginName, PluginLifecycle.ERROR)
        throw err
      }
    } else if (plugin.uninstall) {
      try {
        await plugin.uninstall()
      } catch (err) {
        this.logger.error(`[PluginManager] Plugin "${pluginName}" uninstall threw:`, err)
        this.setLifecycle(pluginName, PluginLifecycle.ERROR)
        throw err
      }
    }

    // 4. 清理上下文和插件映射
    this.contexts.delete(pluginName)
    this.plugins.delete(pluginName)
    this.installResults.delete(pluginName)

    // 5. 删除生命周期记录（而非设为 UNINSTALLED），
    //    这样同一插件可以后续重新安装
    this.lifecycles.delete(pluginName)
    this.loadOrder = this.loadOrder.filter((name) => name !== pluginName)

    this.logger.info(`[PluginManager] Uninstalled plugin: "${pluginName}"`)
  }

  /**
   * 按名称获取插件实例
   *
   * @param name - 插件名称
   * @returns 插件实例，未找到则返回 null
   */
  getPlugin<T = CanvasPlugin>(name: string): T | null {
    return (this.plugins.get(name) as T) ?? null
  }

  /**
   * 按名称获取插件的公共 API（类型安全，无需 as any）
   *
   * @param name - 插件名称
   * @returns 插件 API 实例，未找到则返回 null
   *
   * @example
   * ```typescript
   * const historyApi = manager.getPluginAPI<HistoryAPI>('history')
   * if (historyApi) { historyApi.undo() }
   * ```
   */
  getPluginAPI<API = unknown>(name: string): API | null {
    const result = this.installResults.get(name)
    return (result?.api as API) ?? null
  }

  /**
   * 获取插件的上下文对象
   *
   * @param name - 插件名称
   * @returns PluginContext 实例，未找到则返回 null
   */
  getContext(name: string): PluginContext | null {
    return this.contexts.get(name) ?? null
  }

  /**
   * 获取插件的生命周期状态
   *
   * @param name - 插件名称
   * @returns PluginLifecycle 值，未找到则返回 null
   */
  getLifecycle(name: string): PluginLifecycle | null {
    return this.lifecycles.get(name) ?? null
  }

  /**
   * 检查插件是否已安装（在 plugins map 中存在即为已安装）
   *
   * @param name - 插件名称
   * @returns 是否已安装
   */
  isInstalled(name: string): boolean {
    return this.plugins.has(name)
  }

  /**
   * 获取按依赖拓扑排序的插件加载顺序
   *
   * 顺序保证：若 A 依赖 B，则 B 在 A 之前。
   * 反向遍历可安全卸载（先卸载依赖方，再卸载被依赖方）。
   *
   * @returns 插件名称数组（安装顺序）
   */
  getLoadOrder(): string[] {
    return [...this.loadOrder]
  }

  // ===================== 私有方法 =====================

  /** 验证插件列表中是否有重复名称 */
  private validateDuplicateNames(plugins: CanvasPlugin[]): void {
    const seen = new Set<string>()
    for (const p of plugins) {
      if (seen.has(p.name)) {
        throw new Error(`[PluginManager] Duplicate plugin name: "${p.name}"`)
      }
      seen.add(p.name)
    }
  }

  /**
   * 解析插件依赖并返回拓扑排序后的安装顺序
   *
   * 使用 Kahn 算法进行拓扑排序：
   * 1. 构建邻接表（依赖 → 被依赖方列表）
   * 2. 计算入度（每个插件的依赖项数量）
   * 3. 将入度为 0 的插件入队
   * 4. 依次处理队列中的插件，减少其被依赖方的入度
   * 5. 若处理数量 < 总数，则存在循环依赖
   *
   * @param plugins - 待排序的插件列表
   * @returns 按依赖顺序排列的插件名称数组
   * @throws 缺失依赖、自依赖、循环依赖时抛出
   */
  private resolveOrder(plugins: CanvasPlugin[]): string[] {
    const names = new Set(plugins.map((p) => p.name))

    // 邻接表：依赖插件 → 依赖它的插件列表（反向依赖图）
    // 若 A 依赖 B，则有边 B → A（B 必须先于 A 安装）
    const dependentsOf = new Map<string, string[]>()
    const inDegree = new Map<string, number>()

    // 初始化
    for (const plugin of plugins) {
      if (!inDegree.has(plugin.name)) {
        inDegree.set(plugin.name, 0)
      }
      if (!dependentsOf.has(plugin.name)) {
        dependentsOf.set(plugin.name, [])
      }
    }

    // 构建依赖图
    for (const plugin of plugins) {
      if (!plugin.dependencies || plugin.dependencies.length === 0) {
        continue
      }

      for (const dep of plugin.dependencies) {
        // 检查自依赖
        if (dep === plugin.name) {
          throw new Error(`[PluginManager] Plugin "${plugin.name}" cannot depend on itself`)
        }

        // 检查缺失依赖
        if (!names.has(dep)) {
          throw new Error(
            `[PluginManager] Plugin "${plugin.name}" depends on "${dep}" which is not registered`,
          )
        }

        // 依赖 dep → 当前插件（dep 必须先安装）
        inDegree.set(plugin.name, (inDegree.get(plugin.name) || 0) + 1)

        // 记录 dep 到当前插件的边
        if (!dependentsOf.has(dep)) {
          dependentsOf.set(dep, [])
        }
        dependentsOf.get(dep)!.push(plugin.name)
      }
    }

    // Kahn 算法
    const queue: string[] = []
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name)
      }
    }

    const sorted: string[] = []
    while (queue.length > 0) {
      const current = queue.shift()!
      sorted.push(current)

      for (const dependent of dependentsOf.get(current) || []) {
        const newDegree = inDegree.get(dependent)! - 1
        inDegree.set(dependent, newDegree)
        if (newDegree === 0) {
          queue.push(dependent)
        }
      }
    }

    // 检测循环依赖
    if (sorted.length !== plugins.length) {
      const remaining = new Set(names)
      for (const name of sorted) {
        remaining.delete(name)
      }
      const cyclePath = this.buildCyclePath(plugins, remaining)
      throw new Error(`[PluginManager] Circular dependency detected: ${cyclePath}`)
    }

    return sorted
  }

  /**
   * 构建循环依赖的可读路径
   *
   * 在依赖图中执行 DFS，追踪依赖方向（A → B 表示 A 依赖 B），
   * 构建用户可读的循环链描述。
   *
   * @param plugins - 所有插件列表
   * @param remaining - 循环中的插件名称集合
   * @returns 格式化的循环路径字符串（如 "A → B → A"）
   */
  private buildCyclePath(plugins: CanvasPlugin[], remaining: Set<string>): string {
    // 为每个插件建立其直接依赖列表（A 依赖 B）
    const dependsOn = new Map<string, string[]>()
    for (const p of plugins) {
      dependsOn.set(p.name, p.dependencies || [])
    }

    const visited = new Set<string>()
    const inStack = new Set<string>()
    const stack: string[] = []

    function dfs(node: string): string[] | null {
      visited.add(node)
      inStack.add(node)
      stack.push(node)

      for (const dep of dependsOn.get(node) || []) {
        // 只追踪在循环中的节点
        if (!remaining.has(dep)) continue

        if (!visited.has(dep)) {
          const result = dfs(dep)
          if (result) return result
        } else if (inStack.has(dep)) {
          // 检测到回边，找到循环
          const startIdx = stack.indexOf(dep)
          return [...stack.slice(startIdx), dep]
        }
      }

      stack.pop()
      inStack.delete(node)
      return null
    }

    const start = remaining.values().next().value
    if (!start) return Array.from(remaining).join(' → ')
    const cycle = dfs(start)

    if (cycle && cycle.length > 0) {
      return cycle.join(' → ')
    }

    // 兜底：简单列出剩余节点
    return Array.from(remaining).join(' → ')
  }

  /**
   * 为插件创建 PluginContext
   *
   * 优先使用外部提供的 contextFactory，否则创建桩实现。
   * 桩实现的 API 方法在真实环境集成前会输出警告日志。
   *
   * @param pluginName - 插件名称
   * @param contextFactory - 可选的上下文工厂
   * @returns PluginContext 实例
   */
  private createPluginContext(
    pluginName: string,
    contextFactory?: (pluginName: string) => PluginContext,
  ): PluginContext {
    if (contextFactory) {
      return contextFactory(pluginName)
    }
    return this.createStubContext(pluginName)
  }

  /**
   * 创建桩（stub）PluginContext
   *
   * 提供带有默认空实现或警告日志的上下文对象，
   * 用于在真实 PluginContext 不可用时的开发/测试场景。
   */
  private createStubContext(pluginName: string): PluginContext {
    const logger = this.logger
    const stubWarn = (method: string) => {
      logger.debug(`[PluginManager] ${method} not yet implemented (plugin: "${pluginName}")`)
    }

    return {
      canvasId: pluginName,
      store: {
        get: <T = unknown>(_key: string) => undefined as unknown as T,
        set: (_key: string, _value: unknown) => stubWarn('store.set'),
        watch: (_key: string, _callback: (val: unknown) => void) => {
          stubWarn('store.watch')
          return () => {}
        },
        getState: () => {
          stubWarn('store.getState')
          return {}
        },
      },
      actions: {
        addNodes: (_nodes) => stubWarn('actions.addNodes'),
        removeNodes: (_ids) => stubWarn('actions.removeNodes'),
        addEdges: (_edges) => stubWarn('actions.addEdges'),
        removeEdges: (_ids) => stubWarn('actions.removeEdges'),
        updateNode: (_id, _data) => stubWarn('actions.updateNode'),
        updateEdge: (_id, _data) => stubWarn('actions.updateEdge'),
        getNodes: () => {
          stubWarn('actions.getNodes')
          return []
        },
        getEdges: () => {
          stubWarn('actions.getEdges')
          return []
        },
        addSelectedNodes: (_nodes) => stubWarn('actions.addSelectedNodes'),
        removeSelectedNodes: (_nodes) => stubWarn('actions.removeSelectedNodes'),
        removeSelectedElements: () => stubWarn('actions.removeSelectedElements'),
        getAllNodes: () => { stubWarn('actions.getAllNodes'); return [] },
      },
      selection: {
        getSelectedNodeIds: () => new Set<string>(),
        getSelectedEdgeIds: () => new Set<string>(),
        setSelectedNodeIds: (_ids, _opts) => stubWarn('selection.setSelectedNodeIds'),
        setSelectedEdgeIds: (_ids, _opts) => stubWarn('selection.setSelectedEdgeIds'),
        setSelection: (_payload, _opts) => stubWarn('selection.setSelection'),
        clearSelection: (_opts) => {
          stubWarn('selection.clearSelection')
          return false
        },
      },
      viewport: {
        zoomIn: () => stubWarn('viewport.zoomIn'),
        zoomOut: () => stubWarn('viewport.zoomOut'),
        zoomTo: (_level) => stubWarn('viewport.zoomTo'),
        fitView: () => stubWarn('viewport.fitView'),
        setCenter: (_x, _y, _zoom) => stubWarn('viewport.setCenter'),
        setViewport: (_viewport) => stubWarn('viewport.setViewport'),
        screenToFlowCoordinate: (position) => {
          stubWarn('viewport.screenToFlowCoordinate')
          return position
        },
        getViewport: () => {
          stubWarn('viewport.getViewport')
          return { x: 0, y: 0, zoom: 1 }
        },
      },
      logger,
      registerNodeType: (_name, _component) => stubWarn('registerNodeType'),
      registerEdgeType: (_name, _component) => stubWarn('registerEdgeType'),
      registerComponent: (_name, _component) => stubWarn('registerComponent'),
      dom: {
        getPane: () => null,
        getViewport: () => null,
        onDocument: (_type, _handler, _opts) => { stubWarn('dom.onDocument'); return () => {} },
        onWindow: (_type, _handler, _opts) => { stubWarn('dom.onWindow'); return () => {} },
      },
      menus: {
        register: (_source, _item) => stubWarn('menus.register'),
        unregister: (_id) => stubWarn('menus.unregister'),
        unregisterSource: (_source) => stubWarn('menus.unregisterSource'),
        getAll: () => [],
        getByArea: (_area) => [],
      },
      registerHandleConfig: (_config) => stubWarn('registerHandleConfig'),
      canvasNodes: {
        register: (_definition) => stubWarn('canvasNodes.register'),
        unregister: (_type) => stubWarn('canvasNodes.unregister'),
        get: (_type) => null,
        getMenuItems: () => [],
      },
      commands: {
        register: (_cmd: any) => stubWarn('commands.register'),
        unregister: (_id: string) => stubWarn('commands.unregister'),
        unregisterSource: (_source: string) => stubWarn('commands.unregisterSource'),
        execute: async <T = void>(_id: string) => { stubWarn('commands.execute'); return undefined as T | undefined },
        canExecute: () => false,
        has: () => false,
        get: () => null,
        getPublic: () => [],
        getAll: () => [],
      },
      toolbars: {
        register: (_source: string, _button: any) => stubWarn('toolbars.register'),
        unregister: (_id: string) => stubWarn('toolbars.unregister'),
        unregisterSource: (_source: string) => stubWarn('toolbars.unregisterSource'),
        getByPosition: () => [],
        getAll: () => [],
      },
      panels: {
        registerSetting: (_source: string, _setting: any) => stubWarn('panels.registerSetting'),
        unregisterSetting: (_id: string) => stubWarn('panels.unregisterSetting'),
        unregisterSource: (_source: string) => stubWarn('panels.unregisterSource'),
        getAll: () => [],
        getBySource: () => [],
        useValue: () => null,
      },
      on: (_event, _handler) => {
        stubWarn('on')
        return () => {}
      },
      off: (_event, _handler) => stubWarn('off'),
      emit: (_event, _payload) => stubWarn('emit'),
      mountOverlay: (_el, _target) => stubWarn('mountOverlay'),
      unmountOverlay: (_el) => stubWarn('unmountOverlay'),
      registerShortcut: (_keys, _handler, _description) => stubWarn('registerShortcut'),
      unregisterShortcut: (_keys) => stubWarn('unregisterShortcut'),
      getPluginAPI: <T = unknown>(_name: string): T | null => null,
      getPlugin: <T = CanvasPlugin>(name: string): T | null => {
        return this.getPlugin(name) as T | null
      },
    }
  }

  /**
   * 获取依赖指定插件名的已安装插件列表
   *
   * @param pluginName - 被依赖的插件名称
   * @returns 依赖于 pluginName 的已安装插件名称数组
   */
  private getDependents(pluginName: string): string[] {
    const dependents: string[] = []
    for (const [name, plugin] of this.plugins) {
      if (plugin.dependencies && plugin.dependencies.includes(pluginName)) {
        dependents.push(name)
      }
    }
    return dependents
  }

  /**
   * 设置插件生命周期状态，验证状态转换合法性
   *
   * 合法转换：
   * - INSTALLING → INSTALLED
   * - INSTALLED → ACTIVATING
   * - ACTIVATING → ACTIVE
   * - ACTIVE → DEACTIVATING → INACTIVE → ACTIVATING
   * - ACTIVE / INACTIVE / INSTALLED → UNINSTALLING → UNINSTALLED
   * - 任意状态 → ERROR
   * - ERROR → UNINSTALLING
   *
   * @param name - 插件名称
   * @param lifecycle - 目标生命周期状态
   * @throws 状态转换不合法时抛出
   */
  private setLifecycle(name: string, lifecycle: PluginLifecycle): void {
    const current = this.lifecycles.get(name)

    // 首次设置或任意状态 → ERROR 总是允许
    if (current === undefined || lifecycle === PluginLifecycle.ERROR) {
      this.lifecycles.set(name, lifecycle)
      return
    }

    // 合法转换映射
    const validTransitions: Partial<Record<PluginLifecycle, PluginLifecycle[]>> = {
      [PluginLifecycle.INSTALLING]: [PluginLifecycle.INSTALLED],
      [PluginLifecycle.INSTALLED]: [PluginLifecycle.ACTIVATING, PluginLifecycle.UNINSTALLING],
      [PluginLifecycle.ACTIVATING]: [PluginLifecycle.ACTIVE],
      [PluginLifecycle.ACTIVE]: [PluginLifecycle.DEACTIVATING, PluginLifecycle.UNINSTALLING],
      [PluginLifecycle.DEACTIVATING]: [PluginLifecycle.INACTIVE],
      [PluginLifecycle.INACTIVE]: [PluginLifecycle.ACTIVATING, PluginLifecycle.UNINSTALLING],
      [PluginLifecycle.UNINSTALLING]: [PluginLifecycle.UNINSTALLED],
      [PluginLifecycle.ERROR]: [PluginLifecycle.UNINSTALLING],
    }

    const allowed = validTransitions[current]
    if (!allowed || !allowed.includes(lifecycle)) {
      throw new Error(
        `[PluginManager] Invalid lifecycle transition for "${name}": ${current} → ${lifecycle}`,
      )
    }

    this.lifecycles.set(name, lifecycle)
  }

  /**
   * 激活指定插件
   *
   * 将插件从 INSTALLED 或 INACTIVE 状态转换为 ACTIVE。
   * 若插件定义了 activate 方法则调用之。
   * 激活失败时设置状态为 ERROR。
   *
   * @param name - 插件名称
   */
  private async activatePlugin(name: string): Promise<void> {
    const current = this.lifecycles.get(name)

    // 跳过已激活的插件
    if (current === PluginLifecycle.ACTIVE) return

    this.setLifecycle(name, PluginLifecycle.ACTIVATING)
    const plugin = this.plugins.get(name)

    if (plugin?.activate) {
      try {
        await plugin.activate()
      } catch (err) {
        this.logger.error(`[PluginManager] Plugin "${name}" activate threw:`, err)
        this.setLifecycle(name, PluginLifecycle.ERROR)
        throw err
      }
    }

    this.setLifecycle(name, PluginLifecycle.ACTIVE)
  }

  /**
   * 安装失败时回滚已安装的插件
   *
   * 按反向顺序依次调用已安装插件的 uninstall 方法，
   * 并清理相应的上下文、插件映射和生命周期记录。
   * 单个插件的回滚失败不影响其他插件的回滚。
   *
   * @param installed - 已安装的插件名称列表（安装顺序）
   */
  private async rollback(installed: string[]): Promise<void> {
    this.logger.warn(`[PluginManager] Rolling back ${installed.length} plugin(s)...`)

    for (const name of installed) {
      try {
        // 优先使用 install() 返回的 uninstall
        const installResult = this.installResults.get(name)
        if (installResult?.uninstall) {
          await installResult.uninstall()
        } else {
          const plugin = this.plugins.get(name)
          if (plugin?.uninstall) {
            await plugin.uninstall()
          }
        }
      } catch (err) {
        this.logger.error(`[PluginManager] Rollback uninstall failed for "${name}":`, err)
      }

      // 无论 uninstall 是否成功，都清理状态
      this.contexts.delete(name)
      this.plugins.delete(name)
      this.installResults.delete(name)
      this.setLifecycle(name, PluginLifecycle.UNINSTALLED)
    }
  }

  // ===================== 内部事件系统 =====================

  /**
   * 触发事件
   *
   * 同步调用所有注册的事件处理函数。
   * 单个处理函数的异常会被捕获并记录，不影响其他处理函数。
   *
   * @param event - 事件名称
   * @param payload - 事件负载数据
   */
  private emit(event: string, payload?: unknown): void {
    const handlers = this.eventHandlers.get(event)
    if (!handlers || handlers.length === 0) return

    for (const handler of handlers) {
      try {
        handler(payload)
      } catch (err) {
        this.logger.error(`[PluginManager] Event handler error for "${event}":`, err)
      }
    }
  }
}


