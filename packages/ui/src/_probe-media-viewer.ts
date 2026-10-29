// 临时探针：只为本轮「全屏预览底部控制条按媒体类型给工具」真机核对，验证完删除，不提交。
import { createApp, h, ref } from 'vue'
import MediaViewer from '../../plugins/plugin-theme-default/src/components/ui/MediaViewer.vue'

const IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="currentColor" opacity=".45"/><text x="40" y="240" fill="currentColor" font-size="48">image</text></svg>',
  )
const AUDIO = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA='

const Probe = {
  setup() {
    const item = ref<Record<string, unknown> | null>(null)
    function open(kind: string): void {
      if (kind === 'image') {
        item.value = { name: '图片样本', kind: 'image', url: IMAGE, list: [IMAGE, IMAGE + '#2', IMAGE + '#3'], index: 0 }
      } else if (kind === 'video') {
        item.value = { name: '视频样本', kind: 'video', url: '/api/none.mp4', list: ['/api/none.mp4', '/api/none2.mp4'], index: 0 }
      } else if (kind === 'audio') {
        item.value = { name: '音频样本', kind: 'audio', url: AUDIO, list: [AUDIO, AUDIO + '#2'], index: 0 }
      } else {
        item.value = { name: '文本样本', kind: 'text', text: 'hello' }
      }
    }
    const btn = (kind: string, label: string) =>
      h('button', { style: 'margin-right:8px;padding:6px 12px', onClick: () => open(kind) }, label)
    return () =>
      h('div', [
        h('div', { style: 'padding:12px' }, [btn('image', '图片'), btn('video', '视频'), btn('audio', '音频'), btn('text', '文本')]),
        h(MediaViewer, { item: item.value, onClose: () => { item.value = null } }),
      ])
  },
}

const host = document.createElement('div')
document.body.appendChild(host)
createApp(Probe).mount(host)
