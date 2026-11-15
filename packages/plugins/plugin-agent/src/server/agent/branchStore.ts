import { promises as fs } from 'node:fs'
import path from 'node:path'
import { canvasAgentDir } from './agentPaths.js'

interface BranchFile {
  points: Record<string, string[]>
  /**
   * 子会话 -> 它**接管**的那条会话（切模型产生的接力关系，不产生分页器版本）。
   *
   * 为什么与 points 分开记（用户 2026-11-14）：切换模型只是在同一条对话上换模型，
   * 不该多出一个版本。但历史列表要靠父子关系把整棵树聚成一行，所以这条边得留着 ——
   * 只是**不进**分页器的版本组。
   */
  inherits?: Record<string, string>
}

export interface BranchStore {
  register(canvasId: string, parentSessionId: string, point: string, childSessionId: string): Promise<void>
  /**
   * 用新会话**顶替**同一个分叉位置上的旧会话（切模型接管当前分支）。
   * 位置不变（数组下标原地替换），于是分页器看到的是同一个版本的更新内容，不会多一版。
   */
  replaceChild(canvasId: string, parentSessionId: string, point: string, oldChildId: string, newChildId: string): Promise<void>
  /** 记一条接力：child 接替 parent 继续（同一棵树，但不是新的版本）。 */
  inherit(canvasId: string, childSessionId: string, parentSessionId: string): Promise<void>
  /**
   * 用 newId **完全顶替** oldId（切模型覆盖当前分支）：
   * 它作为谁的子会话、它自己的子会话挂在哪个位置，全部原地改指向。
   * 调用方随后应删掉 oldId 的会话记录，保证历史列表与分页器都只看到一条。
   */
  replaceSession(canvasId: string, oldId: string, newId: string): Promise<void>
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
    return raw.inherits ? { points: raw.points ?? {}, inherits: raw.inherits } : { points: raw.points ?? {} }
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
    async replaceChild(canvasId, parentSessionId, point, oldChildId, newChildId) {
      const data = await read(root, canvasId)
      const key = parentSessionId + '|' + point
      const list = data.points[key] ?? []
      const at = list.indexOf(oldChildId)
      if (at >= 0) list[at] = newChildId
      else if (!list.includes(newChildId)) list.push(newChildId)
      data.points[key] = list
      // 旧会话若还有人接力在它后面，那些接力改指向新会话（否则会指到一条已删的 id）
      if (data.inherits) {
        for (const [child, parent] of Object.entries(data.inherits)) {
          if (parent === oldChildId) data.inherits[child] = newChildId
        }
      }
      await write(root, canvasId, data)
    },
    async inherit(canvasId, childSessionId, parentSessionId) {
      const data = await read(root, canvasId)
      await write(root, canvasId, { ...data, inherits: { ...(data.inherits ?? {}), [childSessionId]: parentSessionId } })
    },
    async replaceSession(canvasId, oldId, newId) {
      const data = await read(root, canvasId)
      // ① 它作为某个位置的版本：原地换成新会话（位置不变 = 分页器页码不变）
      for (const children of Object.values(data.points)) {
        const at = children.indexOf(oldId)
        if (at >= 0) children[at] = newId
      }
      // ② 它下面的分叉点（它自己是父）：key 里的父 id 改成新会话
      for (const [key, children] of Object.entries(data.points)) {
        const at = key.indexOf('|')
        if (key.slice(0, at) !== oldId) continue
        const nextKey = newId + key.slice(at)
        const prev = data.points[nextKey] ?? []
        for (const c of children) if (!prev.includes(c)) prev.push(c)
        data.points[nextKey] = prev
        delete data.points[key]
      }
      // ③ 接力关系跟着换：老会话自己接在谁后面，新会话就接在谁后面
      if (data.inherits) {
        const next: Record<string, string> = {}
        for (const [child, parent] of Object.entries(data.inherits)) {
          if (child === oldId) continue
          next[child] = parent === oldId ? newId : parent
        }
        const upstream = data.inherits[oldId]
        if (upstream) next[newId] = upstream
        data.inherits = next
      }
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
      if (data.inherits?.[sessionId]) {
        delete data.inherits[sessionId]
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
      // 接力关系先铺一层：只影响归属哪棵树，不参与分页器的版本组
      for (const [child, parent] of Object.entries(data.inherits ?? {})) map[child] = parent
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
