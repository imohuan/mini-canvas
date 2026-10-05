/**
 * ProjectStore —— 项目注册表 + 画布索引（`projects.json` + `canvases/index.json`）。
 *
 * 语义：一个项目里有多张画布；画布文件夹路径**不变**（还在 canvases/<id>/），
 * 「属于哪个项目」记在画布索引里（projectId）。磁盘结构见 docs/design/project-canvas-assets.md。
 *
 * always 保证有一个 `default` 项目：老数据（画布没有索引、没归属）自动落在它下面，
 * 于是升级后「原来那张画布」不会凭空消失。
 */
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { atomicWriteJson } from './atomicWrite.js'
import { canvasDir, canvasIndexFile, isSafeEntityId, projectsFile } from './canvasPaths.js'

/** 默认项目 id（不可删；老画布都归到这里） */
export const DEFAULT_PROJECT_ID = 'default'
export const DEFAULT_PROJECT_NAME = '我的项目'

export interface Project {
  id: string
  name: string
  createdAt: number
}

/** 画布索引项（画布 id → 名字 / 所属项目 / 创建时间） */
export interface CanvasIndexEntry {
  id: string
  name: string
  projectId: string
  createdAt: number
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

export class ProjectStore {
  constructor(private readonly root: string) {}

  /** 读全部项目；文件不存在 / 坏掉 → 空数组（不抛） */
  async list(): Promise<Project[]> {
    const raw = (await readJson(projectsFile(this.root))) as { projects?: unknown } | undefined
    const arr = Array.isArray(raw?.projects) ? raw.projects : []
    return arr
      .filter((p): p is Project => !!p && typeof p === 'object' && typeof (p as Project).id === 'string')
      .map((p) => ({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id, createdAt: Number(p.createdAt) || 0 }))
  }

  private async write(projects: Project[]): Promise<void> {
    await atomicWriteJson(projectsFile(this.root), { projects })
  }

  /**
   * 列出项目，**保证 default 项目存在**（首次调用时补写）。
   * 为什么在这里补：用户可能从没建过项目（老库），但所有画布都得有归属。
   */
  async listOrSeed(): Promise<Project[]> {
    let projects = await this.list()
    if (!projects.some((p) => p.id === DEFAULT_PROJECT_ID)) {
      projects = [{ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, createdAt: Date.now() }, ...projects]
      await this.write(projects)
    }
    return projects
  }

  async get(id: string): Promise<Project | undefined> {
    return (await this.listOrSeed()).find((p) => p.id === id)
  }

  /** 新建项目（名字空则给个兜底名）；返回新项目 */
  async create(name: string): Promise<Project> {
    const projects = await this.listOrSeed()
    const p: Project = {
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      name: name.trim() || '未命名项目',
      createdAt: Date.now(),
    }
    await this.write([...projects, p])
    return p
  }

  /** 改名；找不到返回 undefined */
  async rename(id: string, name: string): Promise<Project | undefined> {
    const projects = await this.listOrSeed()
    const i = projects.findIndex((p) => p.id === id)
    if (i < 0) return undefined
    projects[i] = { ...projects[i], name: name.trim() || projects[i].name }
    await this.write(projects)
    return projects[i]
  }

  /** 删项目（含它的画布索引；default 不可删）。返回是否真删了 */
  async remove(id: string): Promise<boolean> {
    if (id === DEFAULT_PROJECT_ID) return false
    const projects = await this.listOrSeed()
    if (!projects.some((p) => p.id === id)) return false
    await this.write(projects.filter((p) => p.id !== id))
    // 连带删掉它名下画布的**索引项**（画布文件夹本身由 CanvasStore 的删除路径处理）
    const idx = await this.readIndex()
    await this.writeIndex(idx.filter((e) => e.projectId !== id))
    return true
  }

  // ==================== 画布索引 ====================

  /** 读画布索引（文件不存在 / 坏掉 → 空数组） */
  async readIndex(): Promise<CanvasIndexEntry[]> {
    const raw = await readJson(canvasIndexFile(this.root))
    const arr = Array.isArray(raw) ? raw : []
    return arr
      .filter((e): e is CanvasIndexEntry => !!e && typeof e === 'object' && typeof (e as CanvasIndexEntry).id === 'string')
      .map((e) => ({
        id: e.id,
        name: typeof e.name === 'string' && e.name ? e.name : e.id,
        projectId: typeof e.projectId === 'string' && e.projectId ? e.projectId : DEFAULT_PROJECT_ID,
        createdAt: Number(e.createdAt) || 0,
      }))
  }

  private async writeIndex(entries: CanvasIndexEntry[]): Promise<void> {
    await atomicWriteJson(canvasIndexFile(this.root), entries)
  }

  /**
   * 列出某项目的画布。
   * **兜底**：画布目录存在、但索引里没有的（老库 / 手工丢进来的）→ 归到 default 项目，
   * 名字回落成目录名。这样既有的 `default` 画布不会因为「没索引」而消失。
   */
  async listCanvases(projectId: string, existingCanvasIds: string[]): Promise<CanvasIndexEntry[]> {
    const idx = await this.readIndex()
    const byId = new Map(idx.map((e) => [e.id, e]))
    for (const id of existingCanvasIds) {
      if (!byId.has(id)) byId.set(id, { id, name: id, projectId: DEFAULT_PROJECT_ID, createdAt: 0 })
    }
    return [...byId.values()].filter((e) => e.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt)
  }

  /** 新建一张画布：建目录（写空的 canvas.json）+ 记索引。返回索引项 */
  async createCanvas(projectId: string, name: string): Promise<CanvasIndexEntry | { error: string }> {
    const projects = await this.listOrSeed()
    if (!projects.some((p) => p.id === projectId)) return { error: '项目不存在' }
    const id = randomUUID().replace(/-/g, '').slice(0, 16)
    if (!isSafeEntityId(id)) return { error: '生成的画布 id 不合法' }
    await fs.mkdir(canvasDir(this.root, id), { recursive: true })
    await atomicWriteJson(canvasDir(this.root, id) + '/canvas.json', { nodes: [], edges: [], name, createdAt: Date.now() })
    const entry: CanvasIndexEntry = { id, name: name.trim() || '未命名画布', projectId, createdAt: Date.now() }
    await this.writeIndex([...(await this.readIndex()), entry])
    return entry
  }

  /** 重命名画布（改索引；也回写 canvas.json 的 name，保持两份一致） */
  async renameCanvas(id: string, name: string): Promise<boolean> {
    const idx = await this.readIndex()
    const i = idx.findIndex((e) => e.id === id)
    const next = name.trim()
    if (!next) return false
    if (i >= 0) {
      idx[i] = { ...idx[i], name: next }
      await this.writeIndex(idx)
    } else {
      // 索引里还没有（老画布）：补一条，归 default
      await this.writeIndex([...idx, { id, name: next, projectId: DEFAULT_PROJECT_ID, createdAt: Date.now() }])
    }
    return true
  }

  /** 从索引里摘掉一张画布（删画布文件夹由调用方做） */
  async removeCanvas(id: string): Promise<void> {
    const idx = await this.readIndex()
    await this.writeIndex(idx.filter((e) => e.id !== id))
  }
}
