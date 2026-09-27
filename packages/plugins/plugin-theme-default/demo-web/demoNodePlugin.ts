// demo-web/demoNodePlugin.ts —— 预览页专用的"示例节点类型"插件（**不是产品代码，只服务 pnpm dev 预览**）。
//
// 为什么需要它：步骤 7 断环要求本包（plugin-theme-default）不再 import 节点插件
// （历史上 demo-web/App.vue 直接 import nodeTextPlugin / nodeImagePlugin，是"theme-default → 节点插件"
// 那条腿在 devDependencies 之外的另一处落点）。预览页的用途是"自看默认皮的壳/端口/标题/连线/背景"，
// 只需要有节点类型能被 BaseNode 壳渲染，并不需要真实节点的业务能力（编辑落盘/AI 生成/裁剪…）。
// 所以这里自备两个最小内容组件，让预览页零节点插件依赖地照常跑起来。
//
// 真实产品里 text/image 节点请装 @mini-canvas/plugin-node-text、@mini-canvas/plugin-node-image。
import { defineComponent, h } from 'vue'
import type { Context, DocService } from '@mini-canvas/canvas-data'
import type { PluginModule } from '@mini-canvas/kernel'

/** 示例文本内容：只把 data.text 画出来（真实文本节点有编辑态/LOD，见 plugin-node-text）。 */
const DemoTextContent = defineComponent({
  name: 'DemoTextContent',
  props: { id: { type: String, required: true }, data: { type: Object, required: true } },
  setup(props) {
    return () =>
      h(
        'div',
        {
          style: {
            padding: '16px',
            fontSize: '14px',
            lineHeight: '1.6',
            color: 'var(--canvas-node-text-body, #1f2937)',
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
          },
        },
        String((props.data as { text?: string }).text ?? ''),
      )
  },
})

/** 示例图片内容：只把 data.imageUrl 画出来（真实图片节点有裁剪/生成面板，见 plugin-node-image）。 */
const DemoImageContent = defineComponent({
  name: 'DemoImageContent',
  props: { id: { type: String, required: true }, data: { type: Object, required: true } },
  setup(props) {
    return () =>
      h('img', {
        src: String((props.data as { imageUrl?: string }).imageUrl ?? ''),
        alt: '示例图片',
        style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
      })
  },
})

export const name = 'demo-nodes'
// 与真实节点插件同形：建节点的 create 走 doc 写入口，故声明硬依赖（缺则 PENDING，而非调用时静默拿不到）。
// （5c 起数据那一格只有 doc 一个名字，graph 老名已下线。）
export const inject = ['doc'] as string[]

export function apply(ctx: Context) {
  // 建节点走数据层唯一写入口（与真实节点插件同一条路径：可撤销 + 自动落盘），
  // 这样预览页右键"新建节点"也能用。
  const create = (type: string, data?: Record<string, unknown>) => (position: { x: number; y: number }) =>
    ctx.get('doc').transaction('demo-add-node', (tx) => tx.createNode(type, position, data))

  ctx.nodes.register({
    type: 'text',
    label: '文本',
    description: '预览用示例文本节点',
    size: { w: 300, h: 200 },
    inputs: [{ port: 'target', acceptsTypes: ['text'] }],
    outputs: [{ port: 'source', contentType: 'text' }],
    resizable: true,
    in: DemoTextContent,
    create: create('text', { text: '我是一段示例文本' }),
  })
  ctx.nodes.register({
    type: 'image',
    label: '图片',
    description: '预览用示例图片节点',
    size: { w: 320, h: 240 },
    inputs: [{ port: 'target', acceptsTypes: ['text', 'image'] }],
    outputs: [{ port: 'source', contentType: 'image' }],
    frameless: true,
    in: DemoImageContent,
    create: create('image'),
  })
}

/** 预览装配用的 PluginModule 出口（与宿主 :plugins=[...] 同形）。 */
export const demoNodePlugin: PluginModule = { name, inject, apply }
