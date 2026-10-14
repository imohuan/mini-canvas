/**
 * video / audio 写入器的契约：**产物要先落进本画布，再写节点**。
 *
 * 用户实测报的问题（2026-10-12）：「它使用的是一个外部的 URL，应该将这些 URL 统统转为自己的」。
 * 原来这里的写入器是 `doc.updateNode(nodeId, { data: { videoUrl: url } })` —— 直接把 provider 的
 * 外链抄进节点，换机器/换端口就打不开。现在补上「取字节 → 存进资源库 → 写本画布地址」。
 */
import { describe, it, expect } from 'vitest'
import { writeAudioResult, writeVideoResult, type DocLike } from '../appliers'

/** 造一个记下写入的假 doc */
function fakeDoc() {
  const writes: Array<{ id: string; data: Record<string, unknown> }> = []
  const doc: DocLike = {
    updateNode: (id, patch) => {
      writes.push({ id, data: patch.data })
    },
  }
  return { doc, writes }
}

/** 造一个假资源服务：put 收字节、resolve 换回本画布地址 */
function fakeResources() {
  const stored: Blob[] = []
  return {
    stored,
    resources: {
      async put(blob: Blob) {
        stored.push(blob)
        return 'res-1'
      },
      async resolve() {
        return '/api/canvases/default/resources/hash1.mp4'
      },
    },
  }
}

const EXT = 'http://localhost:8033/api/resources/videos/x.mp4'

describe('产物地址本地化：不留外链在画布上', () => {
  it('视频：外链 → 落进资源库 → 节点上写的是本画布地址', async () => {
    const { doc, writes } = fakeDoc()
    const { resources, stored } = fakeResources()
    await writeVideoResult(doc, 'n1', { urls: [EXT] }, { resources, fetchBytes: async () => new Blob(['V']) })
    expect(stored).toHaveLength(1)
    expect(writes[0]!.data.videoUrl).toBe('/api/canvases/default/resources/hash1.mp4')
  })

  it('音频：同样落地，并把文件名改成落盘后的名字', async () => {
    const { doc, writes } = fakeDoc()
    const { resources } = fakeResources()
    await writeAudioResult(doc, 'n1', { urls: [EXT] }, { resources, fetchBytes: async () => new Blob(['A']) })
    expect(writes[0]!.data.audioUrl).toBe('/api/canvases/default/resources/hash1.mp4')
    expect(writes[0]!.data.audioName).toBe('hash1.mp4')
  })

  it('**已经是本画布地址** → 不再重复落地（否则每写一次多存一份字节）', async () => {
    const { doc, writes } = fakeDoc()
    const { resources, stored } = fakeResources()
    const local = '/api/canvases/default/resources/exists.mp4'
    await writeVideoResult(doc, 'n1', { urls: [local] }, { resources, fetchBytes: async () => new Blob(['X']) })
    expect(stored).toHaveLength(0)
    expect(writes[0]!.data.videoUrl).toBe(local)
  })

  it('取字节失败 → 回落原地址（保住产物是底线，不给用户看空白）', async () => {
    const { doc, writes } = fakeDoc()
    const { resources } = fakeResources()
    await writeVideoResult(doc, 'n1', { urls: [EXT] }, {
      resources,
      fetchBytes: async () => {
        throw new Error('network down')
      },
    })
    expect(writes[0]!.data.videoUrl).toBe(EXT)
  })

  it('没有资源服务（离线/极简宿主）→ 原样写，不炸', async () => {
    const { doc, writes } = fakeDoc()
    await writeVideoResult(doc, 'n1', { urls: [EXT] }, {})
    expect(writes[0]!.data.videoUrl).toBe(EXT)
  })

  it('没有产物地址 → 一个字都不写', async () => {
    const { doc, writes } = fakeDoc()
    await writeVideoResult(doc, 'n1', {}, {})
    await writeAudioResult(doc, 'n1', { urls: [] }, {})
    expect(writes).toHaveLength(0)
  })

  /**
   * `res-<n>` 是资源库**取件码**，不是能显示的地址（`<video src="res-7">` 谁都打不开）。
   *
   * 早先 localizeUrl 把它当"已经是本画布地址"直接返回 —— 于是引用被写进了媒体字段
   * （同型 bug 的第三个变体：blob: 临时地址 / res- 取件码都不能进 videoUrl/audioUrl）。
   * 现在：是引用就先解析；解析不出来**不写节点**（保留原值），绝不落一个打不开的地址。
   */
  it('产物是 res- 引用 → 先解析成显示地址再写（不是把引用原样塞进节点）', async () => {
    const { doc, writes } = fakeDoc()
    const resources = {
      async put() { return 'res-2' },
      async resolve(ref: string) {
        return ref === 'res-7' ? '/api/canvases/default/resources/from-ref.mp4' : undefined
      },
    }
    await writeVideoResult(doc, 'n1', { urls: ['res-7'] }, { resources })
    expect(writes[0]!.data.videoUrl).toBe('/api/canvases/default/resources/from-ref.mp4')
    // 写进去的绝不能还是取件码
    expect(String(writes[0]!.data.videoUrl).startsWith('res-')).toBe(false)
  })

  it('res- 引用解析不出来 → **不写节点**（宁可不改，也不落一个打不开的地址）', async () => {
    const { doc, writes } = fakeDoc()
    const resources = {
      async put() { return 'res-2' },
      async resolve() { return undefined },
    }
    await writeVideoResult(doc, 'n1', { urls: ['res-9'] }, { resources })
    expect(writes).toHaveLength(0)
  })

  it('res- 引用解析回来仍是引用（资源后端行为异常）→ 同样不写', async () => {
    const { doc, writes } = fakeDoc()
    const resources = {
      async put() { return 'res-2' },
      async resolve(ref: string) { return ref },
    }
    await writeAudioResult(doc, 'n1', { urls: ['res-9'] }, { resources })
    expect(writes).toHaveLength(0)
  })

  it('没有资源服务时给了 res- 引用 → 不写（无从解析，写引用必是破图）', async () => {
    const { doc, writes } = fakeDoc()
    await writeVideoResult(doc, 'n1', { urls: ['res-7'] }, {})
    expect(writes).toHaveLength(0)
  })
})

