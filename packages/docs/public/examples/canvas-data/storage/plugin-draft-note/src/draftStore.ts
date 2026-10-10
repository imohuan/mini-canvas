// 文件：packages/docs/public/examples/canvas-data/storage/plugin-draft-note/src/draftStore.ts
// 格式：TypeScript 模块（薄封装：一处管住 key 与换后端重读）
// 位置：插件包里唯一碰 save 的地方

import type { SaveService } from '@mini-canvas/canvas-data'

/** 裸 key 统一小写 kebab —— 前缀由 save 自己加（canvas:draft-note / config:draft-note-panel） */
export const DRAFT_KEY = 'draft-note'
export const PANEL_KEY = 'draft-note-panel'

export interface DraftStore {
  /** 读草稿（'canvas' 抽屉） */
  load(): Promise<string[]>
  /** 存草稿（'canvas' 抽屉）—— 同步入队，落盘由防抖 flush 做 */
  save(lines: string[]): void
  /** 记住上次用的面板名（'config' 抽屉） */
  rememberPanel(name: string): void
  /** 念出上次的面板名 */
  lastPanel(): Promise<string | undefined>
  /** 解除订阅（插件卸载时调） */
  dispose(): void
}

/**
 * 建一个草稿仓。
 *
 * 两个抽屉刻意分开：草稿是**画布内容**（跟画布一起迁移），
 * 面板名是**用户习惯**（跟配置一起迁移）—— 它们该跟着不同的东西走。
 */
export function createDraftStore(save: SaveService, onReload: (lines: string[]) => void): DraftStore {
  const store: DraftStore = {
    async load() {
      const raw = await save.get<string[]>(DRAFT_KEY, 'canvas')
      return Array.isArray(raw) ? raw : []
    },
    save(lines) {
      save.set(DRAFT_KEY, lines, 'canvas')
    },
    rememberPanel(name) {
      save.set(PANEL_KEY, name, 'config')
    },
    async lastPanel() {
      const raw = await save.get<string>(PANEL_KEY, 'config')
      return typeof raw === 'string' ? raw : undefined
    },
    dispose() {
      off.dispose()
    },
  }

  // 换后端（比如云插件把 canvas 切到服务器）后要把新后端里那份读回来，
  // 否则用户看到的是本地旧值。订阅在这里建立，dispose 时解除。
  const off = save.onAdapterChange((type) => {
    if (type !== 'canvas') return
    void store.load().then(onReload)
  })

  return store
}

