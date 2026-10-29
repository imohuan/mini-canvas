/**
 * plugin-node-rotate —— 图片节点的「旋转与镜像」插件。
 *
 * 按 docs/examples/node-toolbar.md（案例 9）的机制写：
 * - 方式 A：往图片默认顶栏按钮组插一条「旋转与镜像」入口（slots.register('image.topToolbar')）；
 * - 方式 C：注册功能模式 node-rotate/mode，进入后顶栏整格换成 RotatePanel
 *   （退出 / 右转 90° / 水平翻转 / 垂直翻转），底栏整格隐藏（bottomBar: null）；
 * - 点击入口 = 复制当前图片节点 + 建连接线，**副本**进入该模式（见 rotateCopy.ts）。
 *
 * 旋转复用图片插件的 image:rotate 命令（同一实现，不重复写）；翻转在本包 flipImage.ts 实现
 * （走 doc/resources 公共契约，不 import 其它插件）。nodeToolbar 是主题的服务：可选依赖
 * 用 tryGet + ctx:plugin-installed 两腿走路（案例 7 同款），不赌装配顺序。
 */
import { markRaw } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import RotateEntry from './RotateEntry.vue'
import RotatePanel from './RotatePanel.vue'
import { ROTATE_MODE_ID } from './rotateSession'

export const name = 'node-rotate'
export const inject = [] as string[]

/** 图片默认顶栏内置按钮的 order：上传 100 / 裁剪 200 / 扩展 300 /（进行中的绘制 400）→ 本插件排 500 */
const ENTRY_ORDER = 500
/** 功能模式的 order：必须大于图片默认模式（100），只接管自己的会话，不抢默认栏 */
const MODE_ORDER = 500

export function apply(ctx: Context): void {
  // ① 图片默认顶栏按钮组里的一条（显隐由组件自己判断：选中本节点 + 有图）
  ctx.slots.register('image.topToolbar', {
    id: 'node-rotate/entry',
    order: ENTRY_ORDER,
    component: markRaw(RotateEntry),
  })

  // ② 功能模式：顶栏整格换成旋转面板（topBar: RotatePanel）
  const registerMode = (): boolean => {
    const svc = ctx.tryGet<{ registerMode?(mode: unknown): void } | undefined>('nodeToolbar')
    if (!svc?.registerMode) return false
    svc.registerMode({
      id: ROTATE_MODE_ID,
      types: ['image'],
      title: '旋转与镜像',
      topBar: markRaw(RotatePanel),
      // 旋转模式下底部状态栏整格消失（用户口径：编辑期间只留顶栏按钮）
      bottomBar: null,
      order: MODE_ORDER,
    })
    return true
  }
  if (!registerMode()) {
    // 主题还没装（装配顺序在后/热装）：等它上架再试一次
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerMode()) off.dispose()
    })
  }
}

export const nodeRotatePlugin: PluginModule = { name, inject, apply }
export default nodeRotatePlugin
