/**
 * store —— `ctx.store` 能力段：给插件一块**自己的持久化命名空间**。
 *
 * 为什么需要它：插件常要存自己的小数据（上次运行时间、缓存、配额计数）。
 * 没有它，插件只能去挤 KV 的公共域 —— 键名会互相打架，卸载后还留垃圾。
 * 有了它：**一个插件一个命名空间**，卸载时**清干净**（谁也不会捡到别人的残留）。
 *
 * 存储形态：JSON 文件落在 `<数据根>/plugin-data/<插件名>.json`。
 * 为什么是文件而不是内存：插件要"下次启动还记得"，内存做不到。
 * 为什么不用 KV 服务：那是宿主的公共存储，插件不该往里面塞自己的私货。
 *
 * 归属与回收：命名空间随插件 scope 注册，**卸载即清**（见 createStoreRegistrar）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PluginScope } from '@mini-canvas/kernel'

/** 插件私有存储（键 → JSON 值） */
export interface PluginStoreNamespace {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  keys(): Promise<string[]>
  /** 清空本命名空间（卸载时由框架自动调；插件也可手动调） */
  clear(): Promise<void>
}

/** `ctx.store` 的形状 */
export interface StoreRegistrar {
  /** 取一个命名空间（同插件同名多次取 = 同一份） */
  namespace(name: string): PluginStoreNamespace
}

/** 命名空间名白名单（防路径穿越）：字母数字下划线连字符点，1-64 位 */
const NS_RE = /^[A-Za-z0-9_.-]{1,64}$/

export interface StoreRegistrarOptions {
  /** 数据根目录（文件落在 <root>/plugin-data/<ns>.json） */
  root: string
}

/**
 * 建一个绑定到某插件作用域的 store 注册器。
 *
 * 回收策略：命名空间一旦取过，就在本插件 fiber 上挂一个"卸载时清空该命名空间"的副作用。
 * 这是用户明确要的"别留垃圾"：卸载插件 = 它的私有数据一起走。
 */
export function createStoreRegistrar(ctx: PluginScope, _scopeName: string, opts: StoreRegistrarOptions): StoreRegistrar {
  const dir = path.join(opts.root, 'plugin-data')
  const memo = new Map<string, PluginStoreNamespace>()

  function fileOf(ns: string): string {
    if (!NS_RE.test(ns)) throw new Error('[store] 非法命名空间名：' + ns)
    return path.join(dir, ns + '.json')
  }

  return {
    namespace(name) {
      const existed = memo.get(name)
      if (existed) return existed
      const file = fileOf(name)
      const ns: PluginStoreNamespace = {
        async get<T>(key: string): Promise<T | undefined> {
          const all = await readAll(file)
          return all[key] as T | undefined
        },
        async set(key: string, value: unknown): Promise<void> {
          const all = await readAll(file)
          all[key] = value
          await writeAll(file, all)
        },
        async delete(key: string): Promise<boolean> {
          const all = await readAll(file)
          if (!(key in all)) return false
          delete all[key]
          await writeAll(file, all)
          return true
        },
        async keys(): Promise<string[]> {
          return Object.keys(await readAll(file))
        },
        async clear(): Promise<void> {
          await fs.rm(file, { force: true })
        },
      }
      memo.set(name, ns)
      // 卸载即清：随插件 fiber 回收（用户要的"别留垃圾"）
      ctx.effect(() => () => {
        void ns.clear()
      })
      return ns
    },
  }
}

/** 读整个 JSON（不存在/坏掉 → 空对象，不抛） */
async function readAll(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 原子写（先写临时文件再 rename，避免读到半截） */
async function writeAll(file: string, data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
  await fs.rename(tmp, file)
}
