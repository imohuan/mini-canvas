/**
 * keys —— Save 层 key 规范（api.md §三(3.1) + types.ts 注释：key 统一小写 kebab、带作用域前缀）。
 *
 * 模型：业务方传"裸 key"（如 'graph'），save 内部给它加 type 前缀形成物理 key。
 * 例如 type='canvas' key='graph' → 物理 key 'canvas:graph'；project 级给 pid 作用域：`project:{pid}:graph`。
 * 作用域由调用方拼进裸 key（'project:p1:theme'），本模块只保证：小写 kebab、type 前缀、唯一物理名。
 */
import type { SaveType } from './types'

/** 四类 type 常量（枚举用，避免散写字符串） */
export const SAVE_TYPES: readonly SaveType[] = ['config', 'canvas', 'resource', 'shortcut']

/** 画布"节点图"持久化裸 key（type='canvas'）。值为 CanvasNode[]（历史遗留）或 { nodes, edges } 信封(边下沉后用) */
export const GRAPH_KEY = 'graph'
/** 画布"边集"独立持久化裸 key（type='canvas'）。值 = CanvasEdge[]；与 GRAPH_KEY 分存以兼容旧节点图数组 */
export const GRAPH_EDGES_KEY = 'graph-edges'
/** 画布"视口"持久化裸 key（type='canvas'）。值 = { x, y, zoom }；与 graph/graph-edges 一起恢复，
 *  刷新后回到上次停的缩放/平移位置（对齐"刷新不丢"的整图画布状态语义，v2 host 持久化用） */
export const GRAPH_VIEWPORT_KEY = 'graph-viewport'

/** 把任意裸 key 规范成"小写化 + 去首尾空白"（调用方请直接传 kebab-case key；本函数不转分隔符） */
export function normalizeKey(key: string): string {
  const k = key.trim().toLowerCase()
  return k
}

/** 生成某个 type 作用域下的物理 key（= 存储 adapter 真正看到的 key） */
export function scopedKey(type: SaveType, key: string): string {
  return `${type}:${normalizeKey(key)}`
}
