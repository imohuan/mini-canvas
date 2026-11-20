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

/** 造一个假资源服务：put 收字节回逻辑 ID、resolve 换回本画布地址（云端行为） */
function fakeResources() {
  const stored: Blob[] = []
  return {
    stored,
    resources: {
      async put(blob: Blob) {
        stored.push(blob)
        return 'default/hash1.mp4'
      },
      async resolve() {
        return '/api/canvases/default/resources/hash1.mp4'
      },
    },
  }
}

const EXT = 'http://localhost:8033/api/resources/videos/x.mp4'

describe('产物地址本地化：不留外链在画布上', () => {
  it('视频：外链 → 落进资源库 → 节点只写本画布的引用', async () => {
    const { doc, writes } = fakeDoc()
    const { resources, stored } = fakeResources()
    await writeVideoResult(doc, 'n1', { urls: [EXT] }, { resources, fetchBytes: async () => new Blob(['V']) })
    expect(stored).toHaveLength(1)
    // 画布就是文件夹：只写本画布的引用，地址是渲染副本，不落存档。
    expect(writes[0]!.data.resourceId).toBe('default/hash1.mp4')
    expect(writes[0]!.data.videoUrl).toBeUndefined()
  })

  it('音频：同样落地，并把文件名改成落盘后的名字', async () => {
    const { doc, writes } = fakeDoc()
    const { resources } = fakeResources()
    await writeAudioResult(doc, 'n1', { urls: [EXT] }, { resources, fetchBytes: async () => new Blob(['A']) })
    expect(writes[0]!.data.audioUrl).toBeUndefined()
    expect(writes[0]!.data.audioName).toBe('hash1.mp4')
    expect(writes[0]!.data.resourceId).toBe('default/hash1.mp4')
  })

  it('**已经是本画布地址** → 不再重复落地（否则每写一次多存一份字节）', async () => {
    const { doc, writes } = fakeDoc()
    const { resources, stored } = fakeResources()
    // 资源名必须是服务端认的形态（16 位哈希或 slot-…）：签名名会被资源接口 400 拒掉，
    // 让它"可用地址"本身就不成立 —— 这里用真实形态，顺带挡住"随便一个名字都当资源"的错觉。
    const local = '/api/canvases/default/resources/0123456789abcdef.mp4'
    await writeVideoResult(doc, 'n1', { urls: [local] }, { resources, fetchBytes: async () => new Blob(['X']) })
    expect(stored).toHaveLength(0)
    // 旧 URL 顺手拆成逻辑 ID，下次保存后节点里就有 ID 了。
    expect(writes[0]!.data.resourceId).toBe('default/0123456789abcdef.mp4')
    expect(writes[0]!.data.videoUrl).toBeUndefined()
  })

  it('取字节失败 → 不把外链写进画布（宁可保留节点原值）', async () => {
    const { doc, writes } = fakeDoc()
    const { resources } = fakeResources()
    await writeVideoResult(doc, 'n1', { urls: [EXT] }, {
      resources,
      fetchBytes: async () => {
        throw new Error('network down')
      },
    })
    expect(writes).toHaveLength(0)
  })

  it('没有资源服务（离线/极简宿主）→ 不写外链，不炸', async () => {
    const { doc, writes } = fakeDoc()
    await writeVideoResult(doc, 'n1', { urls: [EXT] }, {})
    // 没有资源库就收不进本画布；外链不能落进节点（画布禁止第三方地址）。
    expect(writes).toHaveLength(0)
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
    // 取件码只进 resourceId，不当地址写
    expect(writes[0]!.data.resourceId).toBe('res-7')
    expect(writes[0]!.data.videoUrl).toBeUndefined()
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

  /**
   * 云端逻辑 ID（`<canvasId>/<hashName>`）是引用、不是地址 —— 必须 resolve 后再写，
   * 且 ID 本身进 resourceId（不能进 videoUrl）。
   */
  it('产物是逻辑 ID → resolve 成地址写 videoUrl，ID 写 resourceId', async () => {
    const { doc, writes } = fakeDoc()
    const resources = {
      async put() { return 'default/not-used.mp4' },
      async resolve(ref: string) {
        return ref === 'default/abcdef0123456789.mp4'
          ? '/api/canvases/default/resources/abcdef0123456789.mp4'
          : undefined
      },
    }
    await writeVideoResult(doc, 'n1', { urls: ['default/abcdef0123456789.mp4'] }, { resources })
    expect(writes[0]!.data.resourceId).toBe('default/abcdef0123456789.mp4')
    expect(writes[0]!.data.videoUrl).toBeUndefined()
  })

  it('逻辑 ID 解析不出来 → 不写节点（不落打不开的地址，也不落空引用）', async () => {
    const { doc, writes } = fakeDoc()
    const resources = {
      async put() { return 'default/x.mp4' },
      async resolve() { return undefined },
    }
    await writeVideoResult(doc, 'n1', { urls: ['default/abcdef0123456789.mp4'] }, { resources })
    expect(writes).toHaveLength(0)
  })
})

