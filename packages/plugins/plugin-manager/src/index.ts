// plugin-manager —— 插件管理插件包统一出口。
export { pluginManagerPlugin, name, inject, Config, MANAGER_NAV_ID } from './pluginManagerPlugin'
export type { PluginManagerService, PluginRow } from './pluginManagerService'
export {
  createPluginManagerService,
  DEFAULT_CATALOG_URL,
  INSTALLED_KEY,
  baseOfCatalogUrl,
  absolutize,
} from './pluginManagerService'
export {
  normalizeCatalog,
  defaultInstalledIds,
  resolveDesiredIds,
  type Catalog,
  type CatalogEntry,
} from './catalogTypes'
export {
  createUmdLoader,
  pickPluginModule,
  bustCache,
  PLUGIN_GLOBAL_PREFIX,
  type LoadedPluginModule,
} from './umdLoader'
