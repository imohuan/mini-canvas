/**
 * demoNodes —— 展厅用的一套示例节点类型（只在本插件里用）。
 *
 * 为什么需要它：节点壳（BaseNode）只有"某节点类型被注册"之后才会出现 —— 它是主题槽 nodeShell，
 * 由 VueFlow 渲染每个节点时套上去。所以想展出节点壳 / 端口 / 连线 / 背景，就得先有节点类型。
 * 这里注册三种，把节点壳的可见部分都覆盖到：
 *   - demo-basic：最普通的一张卡（标题 + 内容 + 端口）
 *   - demo-toolbar：卡外带"上控制栏"（out:top 区域）
 *   - demo-overlay：内容区上盖一层浮层（over:inset 区域）
 */
import { defineComponent, h } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'

/** 内容区：一块居中的说明文字 */
const CardContent = defineComponent({
  name: 'GalleryCardContent',
  props: { data: { type: Object, default: () => ({}) } },
  setup(props) {
    return () =>
      h(
        'div',
        {
          style:
            'width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
  'padding:12px;box-sizing:border-box;color:#64748b;font-size:13px;text-align:center;', // 主题色白名单: 展厅示例节点的说明文字（展品示例内容）
        },
        String((props.data as { text?: string }).text ?? '节点内容区'),
      )
  },
})

/** 上控制栏：三个按钮（展示"卡外那一排"的定位与外观） */
const CardToolbar = defineComponent({
  name: 'GalleryCardToolbar',
  setup() {
    return () =>
      h('div', { style: 'display:flex;gap:6px;' }, [
        h('button', { type: 'button', style: BTN }, '裁剪'),
        h('button', { type: 'button', style: BTN }, '旋转'),
        h('button', { type: 'button', style: BTN }, '下载'),
      ])
  },
})

const BTN =
  'height:26px;padding:0 10px;border-radius:8px;border:1px solid rgba(0,0,0,.08);' + // 主题色白名单: 展厅示例按钮的示例外观（展品本体）
  'background:#fff;color:#374151;font-size:12px;cursor:pointer;'

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>'

export const name = 'theme-gallery-demo-nodes'
export const inject = ['doc'] as string[]

export function apply(ctx: Context): void {
  ctx.nodes.register({
    type: 'demo-basic',
    label: '示例卡片',
    nameTemplate: '示例 {{ID}}',
    description: '展厅用的示例节点',
    icon: ICON,
    size: { w: 240, h: 150 },
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'text' }],
    resizable: true,
    in: CardContent,
    create: (position: { x: number; y: number }) =>
      ctx.doc.createNode('demo-basic', position, { text: '普通节点：标题 + 内容 + 端口' }),
  })

  ctx.nodes.register({
    type: 'demo-toolbar',
    label: '带控制栏',
    nameTemplate: '控制栏 {{ID}}',
    description: '展厅用的示例节点（带上控制栏）',
    icon: ICON,
    size: { w: 240, h: 150 },
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'text' }],
    in: CardContent,
    segments: { 'out:top': CardToolbar },
    create: (position: { x: number; y: number }) =>
      ctx.doc.createNode('demo-toolbar', position, { text: '卡外那排按钮来自 out:top 区域' }),
  })
}

export const galleryDemoNodesPlugin: PluginModule = { name, inject, apply }

