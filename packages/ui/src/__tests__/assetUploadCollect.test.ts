/**
 * 节点右键「收藏到资产库」：**要认全三类媒体**（用户 2026-10-14 报的
 * 「加入资产库点击没有任何反应」的根因就在这里）。
 *
 * 早先只读 imageUrl / resourceUrl，而视频节点存 videoUrl、音频存 audioUrl ——
 * 右键一个视频节点时取到的地址是空串，于是**静默什么都不做**。
 * 图片没事，所以这个 bug 一直没显形。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { pendingUploads, queueUploadsFromNodeIds, drainUploads } from '../composables/assetUploadBus'

beforeEach(() => {
  pendingUploads.value = []
})

const node = (id: string, data: Record<string, unknown>) => ({ id, data })

describe('queueUploadsFromNodeIds：三类媒体都要认', () => {
  it('图片节点（imageUrl）→ 贴进去，名字按图补 .png', () => {
    queueUploadsFromNodeIds(['1'], (id) => node(id, { label: '封面', imageUrl: '/api/a.png' }))
    const got = drainUploads()
    expect(got).toHaveLength(1)
    expect(got[0].url).toBe('/api/a.png')
    expect(got[0].name).toBe('封面.png')
  })

  it('★ 视频节点（videoUrl）→ 也要贴进去（以前这里取不到 → 静默不动）', () => {
    queueUploadsFromNodeIds(['2'], (id) => node(id, { label: '视频 1', videoUrl: '/api/v.mp4' }))
    const got = drainUploads()
    expect(got).toHaveLength(1)
    expect(got[0].url).toBe('/api/v.mp4')
    // 扩展名要按**真实类型**给 —— 早先一律 .png，视频会被当成图
    expect(got[0].name).toBe('视频 1.mp4')
  })

  it('★ 音频节点（audioUrl）→ 也要贴进去', () => {
    queueUploadsFromNodeIds(['3'], (id) => node(id, { label: '配乐', audioUrl: '/api/a.mp3' }))
    const got = drainUploads()
    expect(got[0].url).toBe('/api/a.mp3')
    expect(got[0].name).toBe('配乐.mp3')
  })

  it('什么媒体都没有的节点（文本 / 可视化）→ 不产生条目（调用方据此提示）', () => {
    queueUploadsFromNodeIds(['4'], (id) => node(id, { label: '说明文字', text: '你好' }))
    expect(drainUploads()).toHaveLength(0)
  })

  it('多选里混着"有媒体"与"没媒体" → 只贴有的那几个（不因为一个空的整批失败）', () => {
    const byId: Record<string, Record<string, unknown>> = {
      '1': { label: '图', imageUrl: '/api/a.png' },
      '2': { label: '文本', text: 'x' },
      '3': { label: '视频', videoUrl: '/api/v.mp4' },
    }
    queueUploadsFromNodeIds(['1', '2', '3'], (id) => node(id, byId[id]))
    expect(drainUploads().map((x) => x.url)).toEqual(['/api/a.png', '/api/v.mp4'])
  })
})

describe('预选（用户 2026-10-14：节点包要自动选「节点」标签 + 「节点库」位置）', () => {
  it('PendingUpload 能带上 tags / folderId（由弹窗宿主读走）', () => {
    pendingUploads.value = [{ name: 'a.mcnode', file: new File([new Uint8Array([1])], 'a.mcnode'), tags: ['节点'], folderId: 'f1' }]
    const got = drainUploads()
    expect(got[0].tags).toEqual(['节点'])
    expect(got[0].folderId).toBe('f1')
  })
})
