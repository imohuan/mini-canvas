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

/** 把任意裸 key 规范成"小写 kebab"（允许字母/数字/中划线/点/冒号），去掉首尾空白 */
export function normalizeKey(key: string): string {
  const k = key.trim().toLowerCase()
  return k
}

/** 生成某个 type 作用域下的物理 key（= 存储 adapter 真正看到的 key） */
export function scopedKey(type: SaveType, key: string): string {
  return `${type}:${normalizeKey(key)}`
}
