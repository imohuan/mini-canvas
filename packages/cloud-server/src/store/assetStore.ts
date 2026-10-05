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
import { assetsFilesDir, assetsIndexFile, isSafeAssetName } from './canvasPaths.js'

export type AssetKind = 'image' | 'video' | 'audio' | 'other'
export interface Asset {
  id: string
  name: string
  kind: AssetKind
  /** 可加载的地址（生成的指回画布资源；上传的指 assets/files） */
  url: string
  /** 来源画布（生成产物才有；用于溯源，也便于画布删除时清理） */
  canvasId?: string
  size?: number
  source: 'generated' | 'upload'
  createdAt: number
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** 由扩展名 / MIME 猜资产类型 */
export function kindOfName(name: string): AssetKind {
  const ext = (name.split('?')[0].split('.').pop() ?? '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio'
  return 'other'
}

export class AssetStore {
  constructor(private readonly root: string) {}

  async list(): Promise<Asset[]> {
    const raw = await readJson(assetsIndexFile(this.root))
    const arr = Array.isArray(raw) ? raw : []
    return arr
      .filter((a): a is Asset => !!a && typeof a === 'object' && typeof (a as Asset).id === 'string')
      .sort((a, b) => b.createdAt - a.createdAt)
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
  }): Promise<Asset> {
    const assets = await this.list()
    const dup = assets.find((a) => a.url === input.url)
    if (dup) return dup
    const name = input.name?.trim() || (input.url.split('/').pop() ?? 'asset')
    const asset: Asset = {
      id: randomUUID(),
      name,
      kind: kindOfName(name),
      url: input.url,
      ...(input.canvasId ? { canvasId: input.canvasId } : {}),
      source: input.source ?? 'generated',
      createdAt: Date.now(),
    }
    await this.write([asset, ...assets])
    return asset
  }

  /** 存一份**上传**的字节（内容寻址去重）并登记。 */
  async saveUpload(bytes: Uint8Array, name: string): Promise<Asset> {
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
    return this.addByUrl({ url: '/api/assets/files/' + hashName, name, source: 'upload' })
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
    const assets = await this.list()
    const target = assets.find((a) => a.id === id)
    if (!target) return false
    await this.write(assets.filter((a) => a.id !== id))
    return true
  }

  /** 画布被删时，摘掉它名下的生成产物登记（上传的资产与画布无关，不动） */
  async removeByCanvas(canvasId: string): Promise<void> {
    const assets = await this.list()
    await this.write(assets.filter((a) => !(a.source === 'generated' && a.canvasId === canvasId)))
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
