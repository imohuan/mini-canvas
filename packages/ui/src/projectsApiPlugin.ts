/**
 * 项目数据服务（应用级）。
 *
 * 项目页上的插件面板如果要「新建项目 / 打开画布 / 列画布」，它不能反向 import
 * packages/ui 里的 fetch 函数（业务插件之间、插件对入口都按服务交互）。
 * 这里把同一个 projectsApi 收成一个插件，按名上架：
 *
 *   const api = ctx.tryGet('projectsApi')
 *   if (!api) return            // 独立宿主没装这项时自己降级
 *   const list = await api.listProjects()
 *
 * 作用域：整个应用常驻（inject: []），不随画布会话装卸；项目数据与画布无关。
 */
import type { Context, PluginModule } from '@plume-canvas/canvas-base'
import * as api from './composables/projectsApi'
import type {
  AssetFolderSummary,
  AssetSummary,
  CanvasSummary,
  ProjectSummary,
} from './composables/projectsApi'

export const name = 'projects-api'
export const inject = [] as string[]

/** 插件按名取到的那份服务（与宿主内部调用的是同一批函数）。 */
export interface ProjectsApiService {
  listProjects(): Promise<ProjectSummary[]>
  createProject(name: string): Promise<ProjectSummary>
  renameProject(id: string, name: string): Promise<ProjectSummary>
  deleteProject(id: string): Promise<void>
  listCanvases(projectId: string): Promise<CanvasSummary[]>
  createCanvas(projectId: string, name: string): Promise<CanvasSummary>
  renameCanvas(id: string, name: string): Promise<void>
  duplicateCanvas(id: string): Promise<CanvasSummary>
  deleteCanvas(id: string): Promise<void>
  listAssets(): Promise<AssetSummary[]>
  deleteAsset(id: string): Promise<void>
  renameAsset(id: string, name: string): Promise<void>
  setAssetTags(id: string, tags: string[]): Promise<void>
  moveAssets(ids: string[], folderId?: string): Promise<void>
  listAssetFolders(): Promise<AssetFolderSummary[]>
  createAssetFolder(name: string, parentId?: string): Promise<AssetFolderSummary>
  renameAssetFolder(id: string, name: string): Promise<AssetFolderSummary>
  setAssetFolderIcon(id: string, icon: string): Promise<AssetFolderSummary>
  moveAssetFolder(id: string, parentId?: string): Promise<AssetFolderSummary>
  deleteAssetFolder(id: string): Promise<void>
}

export function apply(ctx: Context): void {
  const service: ProjectsApiService = {
    listProjects: api.listProjects,
    createProject: api.createProject,
    renameProject: api.renameProject,
    deleteProject: api.deleteProject,
    listCanvases: api.listCanvases,
    createCanvas: api.createCanvas,
    renameCanvas: api.renameCanvas,
    duplicateCanvas: api.duplicateCanvas,
    deleteCanvas: api.deleteCanvas,
    listAssets: api.listAssets,
    deleteAsset: api.deleteAsset,
    renameAsset: api.renameAsset,
    setAssetTags: api.setAssetTags,
    moveAssets: api.moveAssets,
    listAssetFolders: api.listAssetFolders,
    createAssetFolder: api.createAssetFolder,
    renameAssetFolder: api.renameAssetFolder,
    setAssetFolderIcon: api.setAssetFolderIcon,
    moveAssetFolder: api.moveAssetFolder,
    deleteAssetFolder: api.deleteAssetFolder,
  }
  ctx.inject('projectsApi', service)
}

export const projectsApiPlugin: PluginModule = { name, inject, apply }
