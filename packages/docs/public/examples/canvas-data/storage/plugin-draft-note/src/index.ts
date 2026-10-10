// 文件：packages/docs/public/examples/canvas-data/storage/plugin-draft-note/src/index.ts
// 格式：TypeScript 模块（插件入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import type { SaveService } from '@mini-canvas/canvas-data'
import { createDraftStore } from './draftStore'

export const name = 'draft-note'
// 硬依赖 save：本插件做的事就是存东西
export const inject = ['save'] as string[]

export function apply(ctx: Context) {
  const save = ctx.get<SaveService>('save')
  let cached: string[] = []
  const store = createDraftStore(save, (lines) => {
    cached = lines
    console.log('[draft-note] 后端换了，重读到 ' + lines.length + ' 行草稿')
  })

  // ① 启动时先把已有草稿读进来（异步：save.get 是 Promise）
  void store.load().then((lines) => {
    cached = lines
    console.log('[draft-note] 启动恢复 ' + lines.length + ' 行草稿')
  })

  // ② 一条命令：把当前草稿追加一行并落盘（记住调 flush，不然关页可能丢）
  ctx.commands.register({
    id: 'draft-note:append',
    title: '草稿：加一行',
    run: () => {
      cached = [...cached, '第 ' + (cached.length + 1) + ' 行']
      store.save(cached)
      store.rememberPanel('main')
      // set 只是入队；这里显式 flush 让“命令一执行就写下去”这件事可见
      void save.flush()
      return true
    },
  })

  // ③ 一条命令：念一遍（读的是内存缓存 + 两个抽屉各读一次对照）
  ctx.commands.register({
    id: 'draft-note:report',
    title: '草稿：念一遍',
    run: async () => {
      const fromCanvas = await store.load()
      const panel = await store.lastPanel()
      console.log('[draft-note] 内存里有 ' + cached.length + ' 行；canvas 抽屉里有 ' + fromCanvas.length + ' 行')
      console.log('[draft-note] 上次的面板：' + String(panel))
      console.log('[draft-note] 现在还有未落盘的脏数据？' + String(save.isDirty()))
      return true
    },
  })

  // ④ 卸载时解除 adapter 订阅（本插件的副作用全随 scope 回收）
  ctx.effect(() => () => store.dispose())
}

