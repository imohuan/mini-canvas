// 文件：packages/docs/public/examples/save/plugin-remember-panel/src/index.ts
// 格式：TypeScript 模块（插件的入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import { createRememberStore, type PanelName, type RememberStore } from './store'

export const name = 'remember-panel'
// 硬依赖：save 没就绪就停在 PENDING，别在 apply 里靠 get 拿 undefined 兜底
export const inject = ['save'] as string[]

/** 当前面板（模块级的内存态；真正的持久化在 store 里） */
let current: PanelName = 'settings'
let store: RememberStore | undefined

export function apply(ctx: Context) {
  const save = ctx.get('save')
  store = createRememberStore(save)

  // ① 启动时把"上次打开的面板"读回来。
  //    注意这一步是异步的，apply 不能 await —— 所以读回来之后再写内存态。
  void store.loadLastPanel().then((last) => {
    if (last) {
      current = last
      console.log('[remember-panel] 恢复上次的面板：' + last)
    }
  })

  // ② 换后端（比如装云插件时）之后重读一次。
  //    ctx.effect 保证插件卸载时自动退订，不用手写清理。
  ctx.effect(() =>
    store!.watchAdapterChange(() => {
      void store!.loadLastPanel().then((last) => {
        if (last) current = last
      })
    }),
  )

  // ③ 一条命令：切换面板并记住它
  ctx.commands.register({
    id: 'remember-panel:open',
    title: '打开面板（并记住）',
    run: (_c, payload) => {
      const arg = (payload ?? {}) as { panel?: PanelName }
      if (!arg.panel) return false
      current = arg.panel
      store!.rememberPanel(arg.panel) // 入队；真正落盘由 save 的防抖 flush 完成
      return true
    },
  })

  // ④ 一条命令：立即落盘并读回来核对（"我到底存进去了没有"）
  ctx.commands.register({
    id: 'remember-panel:verify',
    title: '记住面板：立即落盘并核对',
    run: async () => {
      const dirtyBefore = store!.hasUnsaved()
      await save.flush() // 立刻把脏队列写完
      const back = await store!.loadLastPanel()
      console.log(
        '[remember-panel] 落盘前有未保存改动：' + String(dirtyBefore) +
          '，落盘后读到：' + String(back) +
          '，现在还有未保存改动：' + String(store!.hasUnsaved()),
      )
      return true
    },
  })

  // ⑤ 一条命令：清掉这张画布的草稿
  ctx.commands.register({
    id: 'remember-panel:clear-draft',
    title: '记住面板：清掉本画布草稿',
    run: async () => {
      await store!.clearDraft()
      return true
    },
  })
}

