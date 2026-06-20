import { reactive, computed, type Ref } from 'vue'
import type { PanelSettingDefinition, PanelRegistryAPI } from './types'

/**
 * Panel 设置项注册中心
 *
 * 注册全局设置项（JSON schema），值存储在 canvas.state.plugins.<source> 下。
 * useValue() 返回与 store 双向绑定的 Ref，插件和 Panel UI 共享同一份响应式数据。
 * 内部使用 reactive Map，注册变化时自动触发 Vue 重渲染。
 */
export class PanelRegistry implements PanelRegistryAPI {
  /** 设置项存储：id -> PanelSettingDefinition */
  private settings = reactive(new Map<string, PanelSettingDefinition>())

  /**
   * 注册设置项
   *
   * 同 id 后注册的覆盖先注册的。
   */
  registerSetting(source: string, setting: PanelSettingDefinition): void {
    const existing = this.settings.get(setting.id)
    if (existing) {
      console.warn(
        `[PanelRegistry] Setting "${setting.id}" is overridden: ` +
        `source "${existing.source}" -> "${source}"`,
      )
    }
    this.settings.set(setting.id, { ...setting, source })
  }

  /** 注销设置项 */
  unregisterSetting(id: string): void {
    this.settings.delete(id)
  }

  /** 注销某来源的所有设置项（插件卸载时调用） */
  unregisterSource(source: string): void {
    for (const [id, setting] of this.settings) {
      if (setting.source === source) this.settings.delete(id)
    }
  }

  /** 获取所有设置项，按 order 排序 */
  getAll(): PanelSettingDefinition[] {
    const result: PanelSettingDefinition[] = []
    for (const s of this.settings.values()) result.push(s)
    return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  /** 获取某来源的设置项 */
  getBySource(source: string): PanelSettingDefinition[] {
    const result: PanelSettingDefinition[] = []
    for (const s of this.settings.values()) {
      if (s.source === source) result.push(s)
    }
    return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  /**
   * 获取设置项的响应式值
   *
   * id 格式为 dotted path，如 'theme.accent' 或 'theme.colors.accent'。
   * 第一段是 plugins 下的命名空间（插件名），后续段是嵌套路径。
   * 如果 store 中无值，写入 defaultValue 后返回。
   *
   * @param id - 设置项 ID，如 'theme.accent'
   * @param store - canvas.state.plugins 的 ref
   * @param defaultValue - 默认值
   * @returns 与 store 双向绑定的 Ref
   */
  /**
   * 获取设置项的响应式值
   *
   * id 格式为 dotted path：
   *   - 'core.edgeColor' → 读写 canvas.state.core.edgeColor
   *   - 'theme.accent'   → 读写 canvas.state.plugins.theme.accent
   *
   * 第一段为 'core' 时走 core 命名空间，否则走 plugins 命名空间。
   * 如果目标路径无值，写入 defaultValue 后返回。
   *
   * @param id - 设置项 ID
   * @param store - canvas.state 的 ref（含 core + plugins）
   * @param defaultValue - 默认值
   * @returns 与 store 双向绑定的 Ref
   */
  useValue<T>(
    id: string,
    store: Ref<{ core: Record<string, unknown>; plugins: Record<string, Record<string, unknown>> }>,
    defaultValue: T,
  ): Ref<T> {
    const parts = id.split('.')
    const root = parts[0]
    const pathParts = parts.slice(1)

    // 判断走 core 还是 plugins
    const isCore = root === 'core'
    const namespace = isCore ? 'core' : root

    if (isCore) {
      // core 路径：直接读写 store.value.core.<path>
      // 如果路径不存在，写入 defaultValue
      if (pathParts.length > 0) {
        let obj: Record<string, unknown> = store.value.core
        for (let i = 0; i < pathParts.length - 1; i++) {
          const key = pathParts[i]
          if (obj[key] === undefined || obj[key] === null) {
            obj[key] = {}
          }
          obj = obj[key] as Record<string, unknown>
        }
        const leafKey = pathParts[pathParts.length - 1]
        if (obj[leafKey] === undefined) {
          obj[leafKey] = defaultValue
        }
      }

      return computed<T>({
        get: () => {
          let obj: Record<string, unknown> | undefined = store.value.core
          for (const p of pathParts) {
            if (obj === undefined || obj === null) return defaultValue
            obj = obj[p] as Record<string, unknown> | undefined
          }
          return (obj as T) ?? defaultValue
        },
        set: (val: T) => {
          let obj: Record<string, unknown> = store.value.core
          for (let i = 0; i < pathParts.length - 1; i++) {
            const key = pathParts[i]
            if (obj[key] === undefined || obj[key] === null) {
              obj[key] = {}
            }
            obj = obj[key] as Record<string, unknown>
          }
          obj[pathParts[pathParts.length - 1]] = val
        },
      }) as Ref<T>
    }

    // plugins 路径：确保命名空间存在
    if (!store.value.plugins[namespace]) {
      store.value.plugins[namespace] = {}
    }

    // 沿路径遍历/创建
    let current: Record<string, unknown> = store.value.plugins[namespace]
    for (let i = 0; i < pathParts.length - 1; i++) {
      const key = pathParts[i]
      if (current[key] === undefined || current[key] === null) {
        current[key] = {}
      }
      current = current[key] as Record<string, unknown>
    }

    const leafKey = pathParts[pathParts.length - 1]

    // 如果无值，写入默认值
    if (current[leafKey] === undefined) {
      current[leafKey] = defaultValue
    }

    // 返回 computed ref 实现双向绑定
    return computed<T>({
      get: () => {
        let obj: Record<string, unknown> | undefined = store.value.plugins[namespace]
        for (const p of pathParts) {
          if (obj === undefined || obj === null) return defaultValue
          obj = obj[p] as Record<string, unknown> | undefined
        }
        return (obj as T) ?? defaultValue
      },
      set: (val: T) => {
        let obj: Record<string, unknown> = store.value.plugins[namespace]
        if (!obj) {
          obj = {}
          store.value.plugins[namespace] = obj
        }
        for (let i = 0; i < pathParts.length - 1; i++) {
          const key = pathParts[i]
          if (obj[key] === undefined || obj[key] === null) {
            obj[key] = {}
          }
          obj = obj[key] as Record<string, unknown>
        }
        obj[pathParts[pathParts.length - 1]] = val
      },
    }) as Ref<T>
  }
}


