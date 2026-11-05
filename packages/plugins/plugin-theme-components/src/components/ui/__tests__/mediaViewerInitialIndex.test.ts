// @vitest-environment happy-dom
/**
 * MediaViewer 首次挂载时的起始下标（用户 2026-11-06 实测）。
 *
 * 三个宿主（生成历史、资产预览、底栏素材）都只在预览项存在时才挂组件：
 *   <MediaViewer v-if="previewItem" :item="previewItem" />
 * 因此组件收到的第一份 item 已经带着正确的 index。
 *
 * 旧实现用 `watch(item, ...)` 读取 index，却没有 immediate —— 首次挂载时回调不跑，
 * currentIdx 永远停在 0。表现就是：点第二张、第三张都只显示列表第一张。
 */
import { computed, createApp, defineComponent, h, nextTick, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMediaViewerController } from '../media-viewer/useMediaViewerController'
import type { MediaViewerEmits, MediaViewerItem, MediaViewerProps } from '../media-viewer/types'

function mountViewer(initial: MediaViewerItem | null) {
  const props = reactive<MediaViewerProps>({ item: initial })
  const emit = vi.fn() as unknown as MediaViewerEmits
  const item = computed(() => props.item ?? null)

  const Probe = defineComponent({
    setup() {
      const viewer = useMediaViewerController(props, emit, item)
      return () => h('output', { 'data-testid': 'current-index' }, String(viewer.currentIdx.value))
    },
  })
  const host = document.createElement('div')
  const app = createApp(Probe)
  app.mount(host)

  return {
    host,
    emit,
    /** 模拟宿主的 ← / →：直接替换预览项（与 assetUiBus / history 的同一套接法） */
    async setItem(next: MediaViewerItem | null) {
      props.item = next
      await nextTick()
    },
    unmount() {
      app.unmount()
    },
  }
}

describe('MediaViewer 首次打开的下标', () => {
  it('挂载时已经带着 index=2 → 直接从第三张开始，不退回到第一张', () => {
    const viewer = mountViewer({
      name: '第三张',
      kind: 'image',
      url: '/c.png',
      list: ['/a.png', '/b.png', '/c.png'],
      index: 2,
    })

    expect(viewer.host.textContent).toBe('2')
    expect(viewer.emit).toHaveBeenCalledWith('index', 2)
    viewer.unmount()
  })

  it('已挂载后再打开另一组清单 → 仍按下标切换（不破坏原有的二次打开）', async () => {
    const viewer = mountViewer(null)
    await viewer.setItem({
      name: '第二张',
      kind: 'image',
      url: '/y.png',
      list: ['/x.png', '/y.png'],
      index: 1,
    })

    expect(viewer.host.textContent).toBe('1')
    viewer.unmount()
  })
})
