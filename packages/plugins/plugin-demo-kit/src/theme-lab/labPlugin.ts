/**
 * theme-lab 的展示节点。
 *
 * 这一版不再注册“选择框样张 / 参考线样张 / 切割样张”这类假元素。
 * 工作台里能看到的每一种颜色目标，都来自真实插件自己的组件：
 * - 强调色 → shadcn Button（配合全局 .mck-toolbar-btn 的强调色样式）；
 * - 危险/警示 → 默认主题的 NodeEmptyState；
 * - 连线 / 流光 → 默认主题的 CustomEdge；
 * - 多选框 / 绘制框 / 参考线 / 刀光 → 三个真实插件自己绘制。
 *
 * 本文件只提供两块内容：文本节点内容 + 两个语义状态节点（危险/警示）。
 * 它们都通过默认主题的真实组件渲染，颜色仍由主题变量控制。
 */
import { defineComponent, h } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import { NodeEmptyState } from '@mini-canvas/plugin-theme-default'
import { Button } from '@mini-canvas/ui-kit-shadcn'

const NODE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>'

/** 文本内容：和真实文本节点一样，两段文字 + 一个 NodeEmptyState 的小提示 */
const TextContent = defineComponent({
  name: 'ThemeLabTextContent',
  props: { data: { type: Object, default: () => ({}) } },
  setup(props) {
    return () =>
      h('div', { class: 'theme-lab-text' }, [
        h('p', String((props.data as { text?: string }).text ?? '拖圆点连线，双击改字。')),
      ])
  },
})

/** 图片内容：真实图片节点的空态组件（默认主题 NodeEmptyState） */
const SwatchContent = defineComponent({
  name: 'ThemeLabSwatchContent',
  props: { data: { type: Object, default: () => ({}) } },
  setup(props) {
    return () =>
      h('div', { class: 'theme-lab-swatch' }, [
        h('span', { class: 'theme-lab-swatch-sheet', 'aria-hidden': 'true' }),
        h('div', { class: 'theme-lab-swatch-copy' }, [
          h('strong', String((props.data as { title?: string }).title ?? '海边房间')),
          h('small', String((props.data as { subtitle?: string }).subtitle ?? '示例图片节点')),
        ]),
      ])
  },
})

/** 语义状态节点：直接渲染默认主题的真实空状态组件（危险色 / 警示色的真实消费方） */
const SemanticContent = defineComponent({
  name: 'ThemeLabSemanticContent',
  props: { data: { type: Object, default: () => ({}) } },
  setup(props) {
    return () => {
      const data = props.data as { tone?: 'warning' | 'danger'; text?: string; description?: string }
      const tone = data.tone === 'warning' ? 'warning' : 'danger'
      return h(NodeEmptyState, {
        tone,
        text: String(data.text ?? (tone === 'warning' ? '待确认' : '素材已失效')),
        description: String(data.description ?? (tone === 'warning' ? '检查后才会继续' : '请重新上传')),
      })
    }
  },
})

/** 顶部操作条：shadcn Button（强调色的真实消费方） */
const LabTopBar = defineComponent({
  name: 'ThemeLabTopBar',
  setup() {
    return () =>
      h('div', { class: 'lab-topbar' }, [
        h(
          Button,
          {
            title: '确认',
            variant: 'default',
            size: 'sm',
            class: 'mck-toolbar-btn mck-toolbar-btn--primary',
            'data-lab': 'accent-action',
          },
          () => '确认',
        ),
      ])
  },
})

export const name = 'demo-theme-lab'
export const inject = ['doc'] as string[]

export function apply(ctx: Context): void {
  ctx.nodes.register({
    type: 'lab-text',
    label: '文本',
    nameTemplate: '灵感速记 {{ID}}',
    description: '主题工作台示例文本节点',
    icon: NODE_ICON,
    size: { w: 300, h: 170 },
    inputs: [{ port: 'target', acceptsTypes: ['text', 'image'] }],
    outputs: [{ port: 'source', contentType: 'text' }],
    resizable: true,
    in: TextContent,
    segments: { 'out:top': LabTopBar },
    create: (position: { x: number; y: number }) =>
      ctx.doc.createNode('lab-text', position, { text: '主题改色时，节点壳、端口和连线会一起变。' }),
  })

  ctx.nodes.register({
    type: 'lab-image',
    label: '图片',
    nameTemplate: '海边房间 {{ID}}',
    description: '主题工作台示例图片节点',
    icon: NODE_ICON,
    size: { w: 300, h: 220 },
    inputs: [{ port: 'target', acceptsTypes: ['text', 'image'] }],
    outputs: [{ port: 'source', contentType: 'image' }],
    in: SwatchContent,
    create: (position: { x: number; y: number }) =>
      ctx.doc.createNode('lab-image', position, { title: '海边房间', subtitle: '示例图片节点' }),
  })

  ctx.nodes.register({
    type: 'lab-warning',
    label: '待确认',
    nameTemplate: '待确认 {{ID}}',
    description: '警示色的真实状态块',
    icon: NODE_ICON,
    size: { w: 240, h: 110 },
    frameless: false,
    in: SemanticContent,
    create: (position: { x: number; y: number }) =>
      ctx.doc.createNode('lab-warning', position, { tone: 'warning', text: '待确认', description: '检查后才会继续' }),
  })

  ctx.nodes.register({
    type: 'lab-danger',
    label: '已失效',
    nameTemplate: '已失效 {{ID}}',
    description: '危险色的真实状态块',
    icon: NODE_ICON,
    size: { w: 240, h: 110 },
    frameless: false,
    in: SemanticContent,
    create: (position: { x: number; y: number }) =>
      ctx.doc.createNode('lab-danger', position, { tone: 'danger', text: '素材已失效', description: '请重新上传' }),
  })
}

export const themeLabPlugin: PluginModule = { name, inject, apply }
