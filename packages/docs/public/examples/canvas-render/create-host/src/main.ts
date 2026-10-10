// 文件：packages/docs/public/examples/canvas-render/create-host/src/main.ts
// 格式：TypeScript 模块（入口，跑完即退出）
// 位置：演示宿主句柄 / 门面 / 安装句柄三件怎么配合
import { boot } from './host'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'

const { host, api, manager, exposeToWindow } = await boot()
exposeToWindow('MiniCanvasDemo')   // ① Node 里挂到 globalThis；浏览器里就挂在 window 上

// ② 宿主句柄：服务名走 ctx，数据门面走 doc
const doc = host.ctx.get('doc')
console.log('启动后节点：', doc.getNodes().map((n) => n.id + '(' + n.type + ')'))

// ③ 建一个节点（经插件服务 → doc.transaction，自动进历史 + 提交落盘）
const text = host.ctx.get<TextNodeService>('text')
const id = text.addTextNode({ x: 420, y: 120 })
text.editText(id, '这句话是代码写进去的')

// ④ 撤销 / 重做：数据层自带那四条命令，宿主 boot 时就注册好了
host.command.execute('command:undo')
console.log('撤销后：', host.doc.getNodes().map((n) => n.id))
host.command.execute('command:redo')

// ⑤ 热装一个插件：它写的副作用随卸载自动回收
const mark: { on?: boolean } = {}
api.installPlugin({
  name: 'demo-mark',
  inject: [],
  apply(ctx) {
    mark.on = true
    ctx.effect(() => () => { mark.on = false })   // 卸载时自动跑
  },
})
console.log('插件已装：', api.listPlugins(), '标记：', mark.on)
console.log('运行态诊断：', manager.diagnose())
api.uninstallPlugin('demo-mark')
console.log('卸载后标记：', mark.on)

// ⑥ 落盘 + 停用（stop 会先 flush，再回收服务与插件副作用）
await host.save.flush()
host.stop()
