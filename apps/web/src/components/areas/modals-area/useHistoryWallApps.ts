/**
 * 历史卡片墙的缓存与应用回收（从 HistoryModal.vue 原样迁出）。
 *
 * 只把「状态放哪」从模块级改为每次调用新建：墙缓存、当前墙签名、卡片→应用表
 * 都必须跟这个弹窗实例走，避免两个历史面板互相串墙。
 * 其余逻辑、注释与调用时机保持不变。
 */
import { ref, type App as VueApp } from 'vue'

export interface WallSnapshot {
  /** 墙的容器（masonry 直接挂在这上面） */
  wall: HTMLElement
  /** 墙里已经画了多少张（= 当时的 renderedCount） */
  count: number
  /** 当时的数据签名：和当前签名不一致就不复用 */
  signature: string
  /** 当时的列宽（缩放滑杆档位变了要重排） */
  columnWidth: number
  /** 滚动位置：切回来还停在原地 */
  scrollTop: number
}

export function useHistoryWallApps() {
  const wallCache = new Map<string, WallSnapshot>()
  /** 当前挂在页面上的墙属于哪个签名（'' = 还没建） */
  const mountedWallKey = ref('')
  const appsByWall = new Map<string, Set<VueApp>>()
  /** 当前挂载中的那面墙的 key（与 mountedWallKey 同步；'' = 还没建） */
  const MOUNTED_WALL = 'mounted'
  const appOfCard = new WeakMap<HTMLElement, VueApp>()

  function unmountCardApp(card: HTMLElement): void {
    const app = appOfCard.get(card)
    if (!app) return
    appOfCard.delete(card)
    try {
      app.unmount()
    } catch {
      /* 已经卸过/宿主已失效：忽略 */
    }
  }

  function appsOfWall(key: string): Set<VueApp> {
    let set = appsByWall.get(key)
    if (!set) {
      set = new Set<VueApp>()
      appsByWall.set(key, set)
    }
    return set
  }

  function unmountMountedApps(key: string = MOUNTED_WALL): void {
    const keys = key === '*' ? [...appsByWall.keys()] : [key]
    for (const k of keys) {
      const set = appsByWall.get(k)
      if (!set) continue
      appsByWall.delete(k)
      for (const app of set) {
        try {
          app.unmount()
        } catch {
          /* 单个应用卸载失败不阻断其余卡片回收 */
        }
      }
      set.clear()
    }
  }

  function unmountWallApps(key: string): void {
    unmountMountedApps(key)
  }

  function rekeyWallApps(from: string, to: string): void {
    const set = appsByWall.get(from)
    if (!set || from === to) return
    appsByWall.delete(from)
    const target = appsOfWall(to)
    for (const app of set) target.add(app)
    set.clear()
  }

  const WALL_CACHE_LIMIT = 6

  function trimWallCache(): void {
    while (wallCache.size >= WALL_CACHE_LIMIT) {
      const oldest = wallCache.keys().next().value
      if (oldest === undefined) break
      wallCache.delete(oldest)
      unmountWallApps(oldest)
    }
  }

  return {
    wallCache,
    mountedWallKey,
    MOUNTED_WALL,
    appsOfWall,
    appOfCard,
    unmountCardApp,
    unmountMountedApps,
    rekeyWallApps,
    trimWallCache,
  }
}

