import { promises as fs } from 'node:fs'
import path from 'node:path'
import { canvasAgentDir } from './agentPaths.js'

interface BranchFile {
  points: Record<string, string[]>
}

export interface BranchStore {
  register(canvasId: string, parentSessionId: string, point: string, childSessionId: string): Promise<void>
  /** 删会话时清引用：把该会话从所有分叉点的子列表里摘掉（空列表的 key 一并删） */
  unregister(canvasId: string, sessionId: string): Promise<void>
  siblingsOf(canvasId: string, parentSessionId: string, point: string): Promise<string[]>
  pointOf(canvasId: string, childSessionId: string): Promise<{ parentSessionId: string; point: string } | null>
  /** 子会话 → 父会话的映射（历史列表聚合「一个对话 = 一棵分支树」用） */
  parentMap(canvasId: string): Promise<Record<string, string>>
  /** 全部分叉点（父 + 子列表）：分页器与历史聚合一次读全 */
  allPoints(canvasId: string): Promise<Array<{ parentId: string; point: string; children: string[] }>>
}

function fileOf(root: string, canvasId: string): string {
  return path.join(canvasAgentDir(root, canvasId), 'branches.json')
}

async function read(root: string, canvasId: string): Promise<BranchFile> {
  try {
    const raw = JSON.parse(await fs.readFile(fileOf(root, canvasId), 'utf8')) as BranchFile
    return { points: raw.points ?? {} }
  } catch {
    return { points: {} }
  }
}

async function write(root: string, canvasId: string, data: BranchFile): Promise<void> {
  await fs.mkdir(path.dirname(fileOf(root, canvasId)), { recursive: true })
  await fs.writeFile(fileOf(root, canvasId), JSON.stringify(data, null, 2), 'utf8')
}

export function branchStore(root: string): BranchStore {
  return {
    async register(canvasId, parentSessionId, point, childSessionId) {
      const data = await read(root, canvasId)
      const key = parentSessionId + '|' + point
      const list = data.points[key] ?? []
      if (!list.includes(childSessionId)) list.push(childSessionId)
      data.points[key] = list
      await write(root, canvasId, data)
    },
    async unregister(canvasId, sessionId) {
      const data = await read(root, canvasId)
      let changed = false
      for (const [key, children] of Object.entries(data.points)) {
        if (!children.includes(sessionId)) continue
        const next = children.filter((c) => c !== sessionId)
        if (next.length) data.points[key] = next
        else delete data.points[key]
        changed = true
      }
      if (changed) await write(root, canvasId, data)
    },
    async siblingsOf(canvasId, parentSessionId, point) {
      const data = await read(root, canvasId)
      return [...(data.points[parentSessionId + '|' + point] ?? [])]
    },
    async pointOf(canvasId, childSessionId) {
      const data = await read(root, canvasId)
      for (const [key, children] of Object.entries(data.points)) {
        if (children.includes(childSessionId)) {
          const at = key.indexOf('|')
          return { parentSessionId: key.slice(0, at), point: key.slice(at + 1) }
        }
      }
      return null
    },
    async parentMap(canvasId) {
      const data = await read(root, canvasId)
      const map: Record<string, string> = {}
      for (const [key, children] of Object.entries(data.points)) {
        const parent = key.slice(0, key.indexOf('|'))
        for (const child of children) {
          // 一个会话只会 fork 一次；真有重复记录时保留第一条（向上找根不歧义）
          if (!(child in map)) map[child] = parent
        }
      }
      return map
    },
    async allPoints(canvasId) {
      const data = await read(root, canvasId)
      return Object.entries(data.points).map(([key, children]) => {
        const at = key.indexOf('|')
        return { parentId: key.slice(0, at), point: key.slice(at + 1), children: [...children] }
      })
    },
  }
}
