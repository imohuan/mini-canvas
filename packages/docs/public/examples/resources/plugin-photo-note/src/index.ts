// 文件：packages/docs/public/examples/resources/plugin-photo-note/src/index.ts
// 格式：TypeScript 模块（插件的入口，导出 name / inject / apply）
// 位置：一个可安装插件包的源码入口

import type { Context } from '@mini-canvas/canvas-base'
import PhotoContent from './PhotoContent.vue'

export const name = 'photo-note'
// 硬依赖：resources 没就绪就停在 PENDING（本插件不使用资源就没意义）
export const inject = ['resources', 'doc'] as string[]

export function apply(ctx: Context) {
  // ① 注册"图片便签"类型：卡片内容区用 PhotoContent.vue。
  //    create 里建节点一开始不给图 —— 图由内容组件里的按钮选。
  ctx.nodes.register({
    type: 'photo-note',
    label: '图片便签',
    size: { w: 240, h: 200 },
    resizable: true,
    frameless: true,
    in: PhotoContent,
    outputs: [{ port: 'source', contentType: 'image' }],
    create(position) {
      return ctx.get('doc').createNode('photo-note', position, {})
    },
  })

  // ② 一条命令：把一张远端图存进资源库并建一个节点。
  //    这条路演示"没有本地文件选择器时"怎么用 resources —— 先 fetch 成 Blob，再 put。
  ctx.commands.register({
    id: 'photo-note:add-from-url',
    title: '图片便签：从网址加一张',
    run: async (_c, payload) => {
      const arg = (payload ?? {}) as { url?: string; x?: number; y?: number }
      if (!arg.url) return false
      const resources = ctx.get('resources')
      const doc = ctx.get('doc')

      const resp = await fetch(arg.url)
      const blob = await resp.blob()
      // ③ put：字节进库，拿到持久引用
      const resourceId = await resources.put(blob, { kind: 'image' })
      // ④ resolve：引用换当前可显示地址
      const imageUrl = await resources.resolve(resourceId)

      const id = doc.createNode('photo-note', { x: arg.x ?? 120, y: arg.y ?? 120 }, {
        resourceId,
        imageUrl,
      })
      console.log('[photo-note] 已建节点 ' + id + '，引用 = ' + resourceId)
      return true
    },
  })

  // ⑤ 一条命令：回收当前所有"没被任何节点引用"的资源。
  //    这是删除节点之后的标准收尾 —— 宿主落盘前做的就是这件事。
  ctx.commands.register({
    id: 'photo-note:gc',
    title: '图片便签：回收没人用的资源',
    run: () => {
      const resources = ctx.get('resources')
      const doc = ctx.get('doc')
      // 活着的引用 = 所有节点 data.resourceId 的集合
      const alive = new Set<string>()
      for (const node of doc.getNodes()) {
        const ref = node.data.resourceId
        if (typeof ref === 'string' && ref) alive.add(ref)
      }
      const freed = resources.disposeUnreferenced(alive)
      console.log('[photo-note] 回收了 ' + freed + ' 条没人用的资源，画布上还引用着 ' + alive.size + ' 条')
      return true
    },
  })
}

