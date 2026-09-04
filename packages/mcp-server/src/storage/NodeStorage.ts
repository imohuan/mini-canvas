/**
 * NodeStorage — Node 版画布存储（fs/promises）
 *
 * 接口对齐前端 StorageAPI 的多项目/多画布模型，但**按 taskId 参数化**（支持多画布并行）。
 * 落盘格式与前端共用：`./workspace/project-{taskId}/canvas.json`，
 * 复用 sanitizeForSave 保证前后端同构 JSON 互读。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { sanitizeForSave } from './sanitize'

/** 项目元数据（与前端 ProjectMeta 同构） */
export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/** 画布数据（与前端 CanvasData 同构） */
export interface CanvasData {
  nodes: any[]
  edges: any[]
}

const PROJECT_INDEX_FILE = 'canvas-ai-project-index.json'
const CANVAS_FILE = 'canvas.json'
const UPLOADS_DIR = 'uploads'

export class NodeStorage {
  private rootDir: string
  private projectIndex: ProjectMeta[] = []

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir)
  }

  /** 初始化：确保工作目录存在，加载项目索引 */
  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true })
    this.projectIndex = await this.readIndex()
  }

  // ==================== 内部辅助 ====================

  private projectDir(taskId: string): string {
    return path.join(this.rootDir, `project-${taskId}`)
  }

  private canvasFilePath(taskId: string): string {
    return path.join(this.projectDir(taskId), CANVAS_FILE)
  }

  private async readIndex(): Promise<ProjectMeta[]> {
    try {
      const raw = await fs.readFile(path.join(this.rootDir, PROJECT_INDEX_FILE), 'utf-8')
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  private async writeIndex(): Promise<void> {
    await fs.writeFile(
      path.join(this.rootDir, PROJECT_INDEX_FILE),
      JSON.stringify(this.projectIndex, null, 2),
      'utf-8',
    )
  }

  // ==================== 项目(画布) 管理 ====================

  /** 创建项目（taskId 即画布 id；未传则自动生成） */
  async createProject(name: string, taskId?: string): Promise<ProjectMeta> {
    const id = taskId ?? randomUUID()
    const now = Date.now()
    const meta: ProjectMeta = { id, name, createdAt: now, updatedAt: now }
    if (!this.projectIndex.find((p) => p.id === id)) {
      this.projectIndex.push(meta)
      await this.writeIndex()
    }
    await fs.mkdir(this.projectDir(id), { recursive: true })
    return meta
  }

  /** 删除项目 */
  async deleteProject(id: string): Promise<void> {
    this.projectIndex = this.projectIndex.filter((p) => p.id !== id)
    await this.writeIndex()
    await fs.rm(this.projectDir(id), { recursive: true, force: true })
  }

  /** 列出所有项目 */
  listProjects(): ProjectMeta[] {
    return [...this.projectIndex]
  }

  /** 获取项目是否存在 */
  hasProject(id: string): boolean {
    return this.projectIndex.some((p) => p.id === id)
  }

  // ==================== 画布读写 ====================

  /** 保存画布（taskId 指定画布，不依赖 currentProjectId） */
  async saveCanvas(taskId: string, nodes: any[], edges: any[]): Promise<void> {
    const meta = this.projectIndex.find((p) => p.id === taskId)
    if (!meta) throw new Error(`[NodeStorage] 项目不存在: ${taskId}`)
    const cleaned = sanitizeForSave(nodes, edges)
    const data: CanvasData = { nodes: cleaned.nodes, edges: cleaned.edges }
    await fs.mkdir(this.projectDir(taskId), { recursive: true })
    await fs.writeFile(this.canvasFilePath(taskId), JSON.stringify(data, null, 2), 'utf-8')
    meta.updatedAt = Date.now()
    await this.writeIndex()
  }

  /** 加载画布 */
  async loadCanvas(taskId: string): Promise<CanvasData> {
    try {
      const raw = await fs.readFile(this.canvasFilePath(taskId), 'utf-8')
      const data = JSON.parse(raw)
      return { nodes: data.nodes ?? [], edges: data.edges ?? [] }
    } catch {
      return { nodes: [], edges: [] }
    }
  }

  // ==================== 上传文件 / 静态托管 ====================

  /** uploads 目录绝对路径 */
  uploadsDir(): string {
    return path.join(this.rootDir, UPLOADS_DIR)
  }

  /** 保存上传文件（返回相对文件名，可直接用于 /api/files/:name） */
  async saveUpload(filename: string, data: Buffer | Uint8Array): Promise<string> {
    const dir = this.uploadsDir()
    await fs.mkdir(dir, { recursive: true })
    const safe = path.basename(filename).replace(/[^\w.\-]/g, '_') || 'file'
    const stored = `${Date.now()}-${safe}`
    await fs.writeFile(path.join(dir, stored), data)
    return stored
  }

  /** 读取上传文件（不存在返回 null） */
  async readUpload(storedName: string): Promise<Buffer | null> {
    const file = path.join(this.uploadsDir(), path.basename(storedName))
    try {
      return await fs.readFile(file)
    } catch {
      return null
    }
  }

  // ==================== 画布资源（每画布一文件夹 + 内容哈希去重） ====================
  // 供前端图片/视频等节点把资源字节真正存到后端：一个画布一个 assets 子文件夹，
  // 以字节 SHA-256 命名，同内容只存一份（去重）。节点只存 assetId(=sha256)，
  // 刷新时前端按 assetId 从后端取回 → 跨会话/跨浏览器不丢。

  /** 画布资源目录绝对路径 */
  private assetDir(canvasId: string): string {
    return path.join(this.projectDir(canvasId), 'assets')
  }

  /** 把上传名 + 扩展名清洗成纯扩展名片段（防路径穿越，仅取最后一个扩展名） */
  private extOf(filename: string): string {
    const base = path.basename(filename || '').replace(/[^\w.\-]/g, '_') || 'file'
    const ext = path.extname(base).toLowerCase()
    return ext
  }

  /**
   * 保存画布资源字节。按内容 SHA-256 命名去重：已存在则直接返回不重复写盘。
   * @returns { assetId, stored }  assetId=sha256；stored=磁盘文件名（含扩展名）
   */
  async saveResource(canvasId: string, filename: string, data: Buffer | Uint8Array): Promise<{ assetId: string; stored: string }> {
    const dir = this.assetDir(canvasId)
    await fs.mkdir(dir, { recursive: true })
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const assetId = createHash('sha256').update(buf).digest('hex')
    const stored = `${assetId}${this.extOf(filename)}`
    const file = path.join(dir, stored)
    try {
      await fs.access(file)
      // 已存在 → 去重，不重复写盘
    } catch {
      await fs.writeFile(file, buf)
    }
    return { assetId, stored }
  }

  /** 把 assetId（裸 hash 或带扩展 stored 名）解析成磁盘上的真实文件名；不存在返回 null */
  async resolveResourceName(canvasId: string, assetId: string): Promise<string | null> {
    const dir = this.assetDir(canvasId)
    const clean = path.basename(assetId)
    try {
      const entries = await fs.readdir(dir)
      // 先按 hash 前缀（内容寻址，扩展名在文件名里）
      const hit = entries.find((f) => f.startsWith(clean) && !f.startsWith(clean + '-'))
      if (hit) return hit
      // 带扩展名的精确文件名
      if (entries.includes(clean)) return clean
      return null
    } catch {
      return null
    }
  }

  /** 读取画布资源字节（assetId 裸 hash 或带扩展 stored 名均可；不存在返回 null） */
  async readResource(canvasId: string, assetId: string): Promise<Buffer | null> {
    const name = await this.resolveResourceName(canvasId, assetId)
    if (!name) return null
    try {
      return await fs.readFile(path.join(this.assetDir(canvasId), name))
    } catch {
      return null
    }
  }

  /** 删除画布资源（assetId 裸 hash 或带扩展 stored 名均可；不存在则返回 false） */
  async deleteResource(canvasId: string, assetId: string): Promise<boolean> {
    const name = await this.resolveResourceName(canvasId, assetId)
    if (!name) return false
    try {
      await fs.unlink(path.join(this.assetDir(canvasId), name))
      return true
    } catch {
      return false
    }
  }
}
