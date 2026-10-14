/**
 * AssetStore —— **资产目录**（`assets/index.json` + `assets/files/`）。
 *
 * 用户口径：资产 = 所有生成过的产物 + 自己上传的资源，单独一个目录存放。
 *
 * 两条来源：
 * - `generated`：生成任务的产物。按**引用登记**（url 指回画布资源 `/api/canvases/<id>/resources/<hash>`），
 *   **不复制字节** —— 同一份产物存两遍纯属浪费，而且画布删了引用会悬空，所以登记时带上 canvasId。
 * - `upload`   ：用户自己上传的素材。字节落在 `assets/files/<hash><ext>`，url 是 `/api/assets/files/<hash>`。
 *
 * 两条来源共用一张登记表；同 url 幂等（重复登记同一份产物不会出现两遍）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { atomicWriteJson } from './atomicWrite.js'
import { ALLOWED_EXT } from './mime.js'
import { assetsFilesDir, assetsIndexFile, canvasResourcesDir, isSafeAssetName, isSafeCanvasId } from './canvasPaths.js'

/**
 * 资产类型。
 *
 * node-package 是**节点包**（可视化节点 + 它依赖的后台脚本打成一个 .mcnode）。
 * 单独一类而不是丢进 other：左侧抽屉据此知道它是"能拖出节点的东西"，
 * 拖到画布时的落点是"还原节点 + 写脚本"，而不是"建一个媒体节点"。
 */
export type AssetKind = 'image' | 'video' | 'audio' | 'node-package' | 'other'
export interface Asset {
  id: string
  name: string
  kind: AssetKind
  /** 可加载的地址（生成的指回画布资源；上传的指 assets/files） */
  url: string
  /**
   * **本机绝对路径**（有字节落盘时才有；外部地址 / 字节不在本机 → 无此字段）。
   *
   * 为什么要有它（用户口径）：引用要能**复制到本机 Agent**（Codex 等）直接用 ——
   * 给相对 URL 的话对方得先猜 base、再下载到本地才能读，绕好几步；
   * 绝对路径一步 readFile 到位。与「技能引用给 SKILL.md 绝对路径」同一条规矩。
   */
  path?: string
  /** 所属文件夹（undefined = 根目录「个人资产库」） */
  folderId?: string
  /** 标签（固定清单：角色/场景/物品/风格/音效） */
  tags?: string[]
  /** 来源画布（生成产物才有；用于溯源，也便于画布删除时清理） */
  canvasId?: string
  size?: number
  source: 'generated' | 'upload'
  createdAt: number
}

/** 资产文件夹：树形（parentId 指向父文件夹，根为 undefined） */
export interface AssetFolder {
  id: string
  name: string
  parentId?: string
  /** 图标（图标选择器选的名字；空 = 默认文件夹图标） */
  icon?: string
  createdAt: number
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

function foldersFile(root: string): string {
  return path.join(root, 'assets', 'folders.json')
}

/** 由扩展名 / MIME 猜资产类型 */
export function kindOfName(name: string): AssetKind {
  const ext = (name.split('?')[0].split('.').pop() ?? '').toLowerCase()
  if (ext === 'mcnode') return 'node-package'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio'
  return 'other'
}

/** 资产文件地址里那一段（`/api/assets/files/<hash>`） */
const ASSET_FILES_MARKER = '/api/assets/files/'

/**
 * 从「资产地址」里取文件名。地址可带 origin（如 http://127.0.0.1:8865/api/assets/files/x.jpeg）。
 *
 * 为什么单独做成导出的纯函数：生成任务要按这个地址把字节找回来（见 tasks/resourceResolver），
 * 资产面板那边也要按同一套规则推本机路径 —— 两边各写一份解析迟早会飘。
 * 名字必须过 isSafeAssetName：带子路径（`../`）/ 怪名字一律 undefined，不认。
 */
export function parseAssetNameFromUrl(url: string): string | undefined {
  const clean = (url || '').split('?')[0].split('#')[0]
  const filesAt = clean.indexOf(ASSET_FILES_MARKER)
  if (filesAt < 0) return undefined
  const name = clean.slice(filesAt + ASSET_FILES_MARKER.length)
  return isSafeAssetName(name) ? name : undefined
}

export class AssetStore {
  constructor(private readonly root: string) {}

  /**
   * 本店所有「读—改—写」的串行链。
   *
   * 为什么必须有（用户报的现场 2026-10-14）：「批量删除之后刷新页面，又会出现一些内容」。
   * 前端「全选删除」的形状是 `for (id of ids) void deleteAssetById(id)` —— **并发**发 N 个 DELETE，
   * 每个请求各自「读整张 index.json → 去掉一条 → 整份写回」。读改写不串行时，N 个请求读到的是
   * **同一份旧账**，各自写回，后写的把先写的整条覆盖掉 —— 实测 12 条并发删只剩 1 条真被删掉
   * （真机 HTTP 复现：5 条并发删只删掉 1 条）。
   *
   * 与 KvStore 的 `runExclusive` / CanvasStore 的 `writeChains` 同款解法（那边是为「写同一份配置」、
   * 这边是为「同一份资产账」）。区别只在粒度：资产登记表 + 文件夹表都是小文件、都参与同一批
   * 批量操作，合成**一条**链最简单也最不容易漏（按文件分链反而会漏掉「移文件夹同时改条目归属」
   * 这种跨两个文件的组合操作）。
   */
  private chain: Promise<unknown> = Promise.resolve()

  /** 把一次读改写排进链尾（链上任务抛错不卡住后面的） */
  private runExclusive<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job, job)
    this.chain = next.catch(() => undefined)
    return next
  }

  /**
   * 读整张登记表（**链内**用）。
   *
   * 名字带 Locked 是提醒：只能从 `runExclusive` 的任务里调。链内再调一次 `runExclusive` 会在等
   * 自己那条链 —— 直接死锁（job 等自己）。所以对内一律用这一份，对外才用 `list()`。
   */
  private async listLocked(): Promise<Asset[]> {
    const raw = await readJson(assetsIndexFile(this.root))
    const arr = Array.isArray(raw) ? raw : []
    const assets = arr
      .filter((a): a is Asset => !!a && typeof a === 'object' && typeof (a as Asset).id === 'string')
      .sort((a, b) => b.createdAt - a.createdAt)
    // 惰性迁移：老登记表没有 path 字段（那时还没这个概念），按 url 推一次补上、写回。
    // 不做的话老资产永远「不可用」—— 菜单里「添加到 Agent / 添加到画布」不出现（用户报过）。
    const missing = assets.filter((a) => !a.path)
    if (missing.length) {
      for (const a of missing) {
        const p = this.localPathFromUrl(a.url)
        if (p) a.path = p
      }
      await this.write(assets)
    }
    return assets
  }

  async list(): Promise<Asset[]> {
    return this.runExclusive(() => this.listLocked())
  }
  // ===== 文件夹（树形，存 assets/folders.json）=====

  /** 读文件夹表（**链内**用；只能从 runExclusive 的任务里调） */
  private async listFoldersLocked(): Promise<AssetFolder[]> {
    const raw = await readJson(foldersFile(this.root))
    const arr = Array.isArray(raw) ? raw : []
    return arr.filter(
      (f): f is AssetFolder =>
        !!f && typeof (f as AssetFolder).id === 'string' && typeof (f as AssetFolder).name === 'string',
    )
  }

  async listFolders(): Promise<AssetFolder[]> {
    return this.runExclusive(() => this.listFoldersLocked())
  }

  private async writeFolders(folders: AssetFolder[]): Promise<void> {
    await atomicWriteJson(foldersFile(this.root), folders)
  }

  async createFolder(name: string, parentId?: string): Promise<AssetFolder> {
    return this.runExclusive(async () => {
      const clean = name.trim() || '新建文件夹'
      const folder: AssetFolder = { id: randomUUID(), name: clean, createdAt: Date.now() }
      if (parentId) folder.parentId = parentId
      await this.writeFolders([...(await this.listFoldersLocked()), folder])
      return folder
    })
  }

  async renameFolder(id: string, name: string): Promise<AssetFolder | undefined> {
    return this.runExclusive(async () => {
      const folders = await this.listFoldersLocked()
      const target = folders.find((f) => f.id === id)
      if (!target) return undefined
      target.name = name.trim() || target.name
      await this.writeFolders(folders)
      return target
    })
  }

  /** 更新文件夹图标（图标选择器「应用」；空串 = 清除回默认） */
  async setFolderIcon(id: string, icon: string): Promise<AssetFolder | undefined> {
    return this.runExclusive(async () => {
      const folders = await this.listFoldersLocked()
      const target = folders.find((f) => f.id === id)
      if (!target) return undefined
      const clean = icon.trim()
      if (clean) target.icon = clean
      else delete target.icon
      await this.writeFolders(folders)
      return target
    })
  }

  /** 移动文件夹（检查环：不能挪进自己的子孙里） */
  async moveFolder(id: string, newParentId?: string): Promise<AssetFolder | undefined> {
    return this.runExclusive(async () => {
      const folders = await this.listFoldersLocked()
      const target = folders.find((f) => f.id === id)
      if (!target) return undefined
      if (newParentId) {
        // 沿 newParentId 往上爬，爬到自己 = 成环，拒绝
        let cur: string | undefined = newParentId
        const seen = new Set<string>()
        while (cur) {
          if (cur === id || seen.has(cur)) return undefined
          seen.add(cur)
          cur = folders.find((f) => f.id === cur)?.parentId
        }
        target.parentId = newParentId
      } else {
        delete target.parentId
      }
      await this.writeFolders(folders)
      return target
    })
  }

  /** 删文件夹：里面的资产和子文件夹都上移到它的父级（不销毁数据） */
  async removeFolder(id: string): Promise<boolean> {
    // 文件夹表与资产登记表**一起改**，所以必须在同一次链内任务里完成 ——
    // 分两次拿链会让中间插进来一个写，把上移结果盖掉。
    return this.runExclusive(async () => {
      const folders = await this.listFoldersLocked()
      const target = folders.find((f) => f.id === id)
      if (!target) return false
      const parentId = target.parentId
      const kept = folders
        .filter((f) => f.id !== id)
        .map((f) => {
          if (f.parentId !== id) return f
          const moved = { ...f }
          if (parentId) moved.parentId = parentId
          else delete moved.parentId
          return moved
        })
      await this.writeFolders(kept)
      const assets = await this.listLocked()
      await this.write(
        assets.map((a) => {
          if (a.folderId !== id) return a
          const moved = { ...a }
          if (parentId) moved.folderId = parentId
          else delete moved.folderId
          return moved
        }),
      )
      return true
    })
  }

  private async write(assets: Asset[]): Promise<void> {
    await atomicWriteJson(assetsIndexFile(this.root), assets)
  }

  /**
   * 登记一条**已有地址**的资产（生成产物走这条）。同 url 幂等。
   * @returns 新登记 / 已存在的那条
   */
  async addByUrl(input: {
    url: string
    name?: string
    canvasId?: string
    source?: Asset['source']
    folderId?: string
    /** 本机绝对路径（有字节落盘时传；外部地址不传） */
    path?: string
  }): Promise<Asset> {
    return this.runExclusive(async () => {
      const assets = await this.listLocked()
      const dup = assets.find((a) => a.url === input.url)
      if (dup) return dup
      const name = input.name?.trim() || (input.url.split('/').pop() ?? 'asset')
      // 本机绝对路径：调用方直接给了就用；没给但地址指向本机画布资源
      // （/api/canvases/<id>/resources/<hash>）也从 url 推出来 —— 字节确实在那里
      // （用户口径：与技能引用给 SKILL.md 绝对路径同一条规矩）。
      const localPath = input.path ?? this.localPathFromUrl(input.url)
      const asset: Asset = {
        id: randomUUID(),
        name,
        kind: kindOfName(name),
        url: input.url,
        ...(localPath ? { path: localPath } : {}),
        ...(input.folderId ? { folderId: input.folderId } : {}),
        ...(input.canvasId ? { canvasId: input.canvasId } : {}),
        source: input.source ?? 'generated',
        createdAt: Date.now(),
      }
      await this.write([asset, ...assets])
      return asset
    })
  }

  /**
   * 从「本机可定位的 url」推出绝对路径；外部地址（别的服务的 http://）→ undefined（不瞎编）。
   *
   * 认两种形态：
   *   - /api/assets/files/<hash>                   → <root>/assets/files/<hash>
   *   - /api/canvases/<canvasId>/resources/<hash>  → <root>/canvases/<canvasId>/resources/<hash>
   */
  private localPathFromUrl(url: string): string | undefined {
    const clean = (url || '').split('?')[0].split('#')[0]
    const assetName = parseAssetNameFromUrl(clean)
    if (assetName) return path.join(assetsFilesDir(this.root), assetName)
    const resMarker = '/api/canvases/'
    const at = clean.indexOf(resMarker)
    if (at >= 0) {
      const segs = clean.slice(at + resMarker.length).split('/')
      if (segs.length >= 3 && segs[1] === 'resources' && isSafeCanvasId(segs[0]) && isSafeAssetName(segs[2])) {
        return path.join(canvasResourcesDir(this.root, segs[0]), segs[2])
      }
    }
    return undefined
  }

  /** 存一份**上传**的字节（内容寻址去重）并登记。 */
  async saveUpload(bytes: Uint8Array, name: string, folderId?: string): Promise<Asset> {
    const dir = assetsFilesDir(this.root)
    await fs.mkdir(dir, { recursive: true })
    const dot = name.lastIndexOf('.')
    const rawExt = dot >= 0 ? name.slice(dot).toLowerCase() : ''
    const ext = ALLOWED_EXT.includes(rawExt) ? rawExt : ''
    const hashName = createHash('sha256').update(bytes).digest('hex').slice(0, 16) + ext
    const file = path.join(dir, hashName)
    if (!(await exists(file))) {
      const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
      await fs.writeFile(tmp, bytes)
      await fs.rename(tmp, file)
    }
    return this.addByUrl({ url: '/api/assets/files/' + hashName, name, source: 'upload', folderId, path: file })
  }

  /** 读上传资产字节（名字不合法 / 不存在 → undefined） */
  async readFile(hashName: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (!isSafeAssetName(hashName)) return undefined
    try {
      const buf = await fs.readFile(path.join(assetsFilesDir(this.root), hashName))
      return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    } catch {
      return undefined
    }
  }

  async remove(id: string): Promise<boolean> {
    return this.runExclusive(async () => {
      const assets = await this.listLocked()
      const target = assets.find((a) => a.id === id)
      if (!target) return false
      await this.write(assets.filter((a) => a.id !== id))
      return true
    })
  }

  /** 资产挪到某个文件夹（folderId 传空 = 回根目录） */
  async setAssetFolder(id: string, folderId?: string): Promise<Asset | undefined> {
    return this.runExclusive(async () => {
      const assets = await this.listLocked()
      const target = assets.find((a) => a.id === id)
      if (!target) return undefined
      if (folderId) {
        const folders = await this.listFoldersLocked()
        if (!folders.some((f) => f.id === folderId)) return undefined
        target.folderId = folderId
      } else {
        delete target.folderId
      }
      await this.write(assets)
      return target
    })
  }

  /**
   * 整组资产挪到某个文件夹（批量「移动到 / 添加到」共用）。
   *
   * 整组**一次**读改写，而不是逐条 setAssetFolder：逐条会让「读—写」来回 N 趟，
   * 中间夹进来的并发写照样能覆盖（与批量删除同一条病）。
   */
  async setAssetsFolder(ids: string[], folderId?: string): Promise<number> {
    const wanted = new Set(ids)
    if (!wanted.size) return 0
    return this.runExclusive(async () => {
      if (folderId) {
        const folders = await this.listFoldersLocked()
        if (!folders.some((f) => f.id === folderId)) return 0
      }
      const assets = await this.listLocked()
      let n = 0
      for (const a of assets) {
        if (!wanted.has(a.id)) continue
        if (folderId) a.folderId = folderId
        else delete a.folderId
        n++
      }
      if (n) await this.write(assets)
      return n
    })
  }

  /** 覆盖式设置标签（固定清单，前端约束） */
  async setAssetTags(id: string, tags: string[]): Promise<Asset | undefined> {
    return this.runExclusive(async () => {
      const assets = await this.listLocked()
      const target = assets.find((a) => a.id === id)
      if (!target) return undefined
      const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
      if (clean.length) target.tags = clean
      else delete target.tags
      await this.write(assets)
      return target
    })
  }

  /** 资产改名 */
  async renameAsset(id: string, name: string): Promise<Asset | undefined> {
    return this.runExclusive(async () => {
      const assets = await this.listLocked()
      const target = assets.find((a) => a.id === id)
      if (!target) return undefined
      const clean = name.trim()
      if (clean) target.name = clean
      await this.write(assets)
      return target
    })
  }

  /** 画布被删时，摘掉它名下的生成产物登记（上传的资产与画布无关，不动） */
  async removeByCanvas(canvasId: string): Promise<void> {
    return this.runExclusive(async () => {
      const assets = await this.listLocked()
      await this.write(assets.filter((a) => !(a.source === 'generated' && a.canvasId === canvasId)))
    })
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
