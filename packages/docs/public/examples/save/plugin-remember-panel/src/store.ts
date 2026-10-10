// 文件：packages/docs/public/examples/save/plugin-remember-panel/src/store.ts
// 格式：TypeScript 模块（纯逻辑的持久化封装，不 import Vue）
// 位置：插件包内部的小模块，被 src/index.ts 引用

import type { SaveService } from '@mini-canvas/canvas-data'

/** 面板名（本插件只认这三种） */
export type PanelName = 'settings' | 'assets' | 'history'

/** 设备级偏好：上次打开的面板（存 config 域，跟着这台设备走） */
const LAST_PANEL_KEY = 'remember-panel:last'
/** 画布级草稿：这张画布上还没提交的一小段笔记（存 canvas 域，跟着画布走） */
const DRAFT_KEY = 'remember-panel:draft'

export interface RememberStore {
  /** 读上次打开的面板；没存过返回 null */
  loadLastPanel(): Promise<PanelName | null>
  /** 记住这次打开的面板（同步入队，落盘时机由 save 统一安排） */
  rememberPanel(name: PanelName): void
  /** 读当前画布的草稿；没存过返回空串 */
  loadDraft(): Promise<string>
  /** 写草稿 */
  saveDraft(text: string): void
  /** 彻底清掉草稿（用户点"丢弃"时） */
  clearDraft(): Promise<void>
  /** 订阅"后端换了"，切完重读一遍，返回取消函数 */
  watchAdapterChange(onReload: () => void): () => void
  /** 攒着没落盘的改动有多少（供 UI 显示"未保存"圆点） */
  hasUnsaved(): boolean
}

/**
 * 把 save 服务包成"这个插件自己看得懂"的形状。
 *
 * 为什么要包一层：业务代码里到处出现裸 key 字符串，改名字时必漏。
 * 这里把 key 收成常量、把 type 收进调用点，插件其余部分就不用再记"哪个 key 存在哪个抽屉"。
 */
export function createRememberStore(save: SaveService): RememberStore {
  const isPanelName = (v: unknown): v is PanelName =>
    v === 'settings' || v === 'assets' || v === 'history'

  return {
    async loadLastPanel(): Promise<PanelName | null> {
      // ① config 域：设备级偏好。get 是异步的（可能要去 local storage / 云端取）
      const raw = await save.get<unknown>(LAST_PANEL_KEY, 'config')
      return isPanelName(raw) ? raw : null
    },

    rememberPanel(name: PanelName): void {
      // ② set 同步返回：这一行执行完只是"入了脏队列"，没有写磁盘
      save.set(LAST_PANEL_KEY, name, 'config')
    },

    async loadDraft(): Promise<string> {
      const raw = await save.get<unknown>(DRAFT_KEY, 'canvas')
      return typeof raw === 'string' ? raw : ''
    },

    saveDraft(text: string): void {
      save.set(DRAFT_KEY, text, 'canvas')
    },

    async clearDraft(): Promise<void> {
      // ③ remove 会同时把它从脏队列里剔掉：不然刚删的东西会被下一次 flush 写回来
      await save.remove(DRAFT_KEY, 'canvas')
    },

    watchAdapterChange(onReload: () => void): () => void {
      // ④ 后端是运行期可换的（云插件启动时把抽屉切到云端）。
      //    切完必须重读一次，否则新后端里存着的值永远读不进来。
      const sub = save.onAdapterChange((type) => {
        if (type === 'config' || type === 'canvas') onReload()
      })
      return () => sub.dispose()
    },

    hasUnsaved(): boolean {
      return save.isDirty()
    },
  }
}

