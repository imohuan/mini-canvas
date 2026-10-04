/**
 * audioOps 测试 —— 载入音频这条路的两个关键约定：
 * 1) 波形**只算一次**：算完就写进节点（data.audioWaveform），再渲染只读缓存（ensureAudioWaveform 不重复分析）；
 * 1) 波形**只算一次**：算完就写进节点（data.audioWaveform），再渲染只读缓存（ensureAudioMeta 不重复分析）；
 * 2) 解码失败也要写一条**确定性回落波形**（同地址同形状）—— 不能留空白波形让用户以为坏了。
 *
 * 用注入的假 transform 跑，所以这里验的是"算得对不对、写回得对不对"，不需要 Web Audio。
 */
import { describe, it, expect } from 'vitest'
import { WAVEFORM_BUCKETS, fallbackWaveform, isValidWaveform } from '../waveform'
import {
  createAudioOps,
  loadAudio,
  uploadAudio,
 reanalyzeAudio,
  ensureAudioMeta,
  downloadAudioNode,
  type AudioOpsContext,
  type AudioTransform,
} from '../audioOps'

/** 一个只认"按名取服务"的假宿主：data 存在一张表里，写回记录调用次数（验"只写一次 / 不重复分析"） */
function fakeOps(initial: Record<string, Record<string, unknown>> = {}) {
  const table: Record<string, Record<string, unknown>> = JSON.parse(JSON.stringify(initial))
  const writes: Array<{ id: string; data: Record<string, unknown> }> = []
  const runtimeWrites: Array<{ id: string; data: Record<string, unknown> }> = []
  /**
   * 与内核 nodeStore.applyPatch 同一套语义：显式 undefined 的键是**删字段**（不是写个 undefined）。
   * 不照这个来的话，"清掉旧时长"这条在测试里就永远看不出来（真机上却是对的）。
   */
  const merge = (id: string, data: Record<string, unknown>): void => {
    const next: Record<string, unknown> = { ...(table[id] ?? {}) }
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) delete next[key]
      else next[key] = value
    }
    table[id] = next
  }
  const ops: AudioOpsContext = {
    read: (id) => table[id],
    write: (id, data) => {
      merge(id, data)
      writes.push({ id, data })
    },
    writeRuntime: (id, data) => {
      merge(id, data)
      runtimeWrites.push({ id, data })
    },
  }
  return { ops, table, writes, runtimeWrites }
}

/** 计数用的假 transform：默认分析成功（给一条稳定的斜坡波形 + 12.5 秒时长） */
function fakeTransform(overrides: Partial<AudioTransform> = {}) {
  let analyzeCalls = 0
  const transform: AudioTransform = {
    analyze: async () => {
      analyzeCalls += 1
      return {
        peaks: Array.from({ length: WAVEFORM_BUCKETS }, (_, i) => (i % 10) + 1),
        duration: 12.5,
      }
    },
    pickFile: async () => null,
    download: () => true,
    objectUrl: () => 'blob:fake',
    ...overrides,
  }
  return { transform, calls: () => analyzeCalls }
}

describe('audioOps · 载入音频', () => {
  it('一次写回音频信息、一次写回波形；波形是 100 个合法整数', async () => {
    const { ops, table, writes, runtimeWrites } = fakeOps({ n1: {} })
    const { transform } = fakeTransform()
    const ok = await loadAudio(ops, 'n1', 'https://x/a.mp3', { name: 'a.mp3' }, transform)
    expect(ok).toBe(true)
    expect(table.n1.audioUrl).toBe('https://x/a.mp3')
    expect(table.n1.audioName).toBe('a.mp3')
    expect(table.n1.audioDuration).toBe(12.5)
    expect(isValidWaveform(table.n1.audioWaveform)).toBe(true)
    // 音频信息（进历史）与波形（派生，不进历史）各写一次，不多写
    expect(writes).toHaveLength(1)
    expect(runtimeWrites).toHaveLength(1)
  })

  it('解码失败时落确定性回落波形（同地址同形状），而不是留空白', async () => {
    const { ops, table } = fakeOps({ n1: {} })
    const { transform } = fakeTransform({ analyze: async () => null })
    await loadAudio(ops, 'n1', 'https://x/broken.mp3', undefined, transform)
    expect(table.n1.audioWaveform).toEqual(fallbackWaveform('https://x/broken.mp3'))
  })

  it('读不到时长时不写 audioDuration（不留脏字段）', async () => {
    const { ops, table } = fakeOps({ n1: {} })
    const { transform } = fakeTransform({ analyze: async () => ({ peaks: fallbackWaveform('z'), duration: 0 }) })
    await loadAudio(ops, 'n1', 'https://x/c.wav', undefined, transform)
    expect('audioDuration' in table.n1).toBe(false)
    expect(isValidWaveform(table.n1.audioWaveform)).toBe(true)
  })

  it('地址为空 / 节点不存在都返回 false，且什么都没写', async () => {
    const { ops, writes, runtimeWrites } = fakeOps({ n1: {} })
    const { transform } = fakeTransform()
    expect(await loadAudio(ops, 'n1', '', undefined, transform)).toBe(false)
    expect(await loadAudio(ops, 'missing', 'https://x/a.mp3', undefined, transform)).toBe(false)
    expect(writes).toHaveLength(0)
    expect(runtimeWrites).toHaveLength(0)
  })

  it('换地址会重算波形（旧形状不能留在新音频上）', async () => {
    const before = fallbackWaveform('old')
    const { ops, table } = fakeOps({ n1: { audioUrl: 'https://x/old.mp3', audioWaveform: before } })
    const { transform, calls } = fakeTransform()
    await loadAudio(ops, 'n1', 'https://x/new.mp3', undefined, transform)
    expect(calls()).toBe(1)
    expect(table.n1.audioWaveform).not.toEqual(before)
    expect(isValidWaveform(table.n1.audioWaveform)).toBe(true)
  })
})

describe('audioOps · 波形与时长只补一次', () => {
  it('波形和时长都齐了 → 不分析、不写（零开销）', async () => {
    const wf = fallbackWaveform('https://x/a.mp3')
    const { ops, writes, runtimeWrites } = fakeOps({
      n1: { audioUrl: 'https://x/a.mp3', audioWaveform: wf, audioDuration: 12.5 },
    })
    const { transform, calls } = fakeTransform()
    expect(await ensureAudioMeta(ops, 'n1', transform)).toBe(false)
    expect(calls()).toBe(0)
    expect(writes).toHaveLength(0)
    expect(runtimeWrites).toHaveLength(0)
  })

  it('第一次加载：波形与时长一起存进节点（用户要的"加载波形时把时长也存下来"）', async () => {
    const { ops, table, runtimeWrites } = fakeOps({ n1: { audioUrl: 'https://x/a.mp3' } })
    const { transform, calls } = fakeTransform()
    expect(await ensureAudioMeta(ops, 'n1', transform)).toBe(true)
    expect(calls()).toBe(1)
    expect(runtimeWrites).toHaveLength(1)
    expect(isValidWaveform(table.n1.audioWaveform)).toBe(true)
    expect(table.n1.audioDuration).toBe(12.5)
  })

  it('只有波形、缺时长 → 会再分析一次并把时长补进节点（时长缺失正是实测那个 bug）', async () => {
    const wf = fallbackWaveform('https://x/a.mp3')
    const { ops, table } = fakeOps({ n1: { audioUrl: 'https://x/a.mp3', audioWaveform: wf } })
    const { transform, calls } = fakeTransform()
    expect(await ensureAudioMeta(ops, 'n1', transform)).toBe(true)
    expect(calls()).toBe(1)
    expect(table.n1.audioDuration).toBe(12.5)
    expect(isValidWaveform(table.n1.audioWaveform)).toBe(true)
  })

  it('分析失败但已有真波形 → 保留原波形，不用回落波形盖掉它', async () => {
    const wf = fallbackWaveform('keep-me')
    const { ops, table } = fakeOps({ n1: { audioUrl: 'https://x/a.mp3', audioWaveform: wf } })
    const { transform } = fakeTransform({ analyze: async () => null })
    await ensureAudioMeta(ops, 'n1', transform)
    expect(table.n1.audioWaveform).toEqual(wf)
  })

  it('分析失败且本来没有波形 → 落确定性回落波形', async () => {
    const { ops, table } = fakeOps({ n1: { audioUrl: 'https://x/broken.mp3' } })
    const { transform } = fakeTransform({ analyze: async () => null })
    await ensureAudioMeta(ops, 'n1', transform)
    expect(table.n1.audioWaveform).toEqual(fallbackWaveform('https://x/broken.mp3'))
  })

  it('波形是脏数据（长度/值域不对）时当作没有波形，重算一次', async () => {
    const { ops, table } = fakeOps({ n1: { audioUrl: 'https://x/a.mp3', audioWaveform: [1, 2, 3] } })
    const { transform, calls } = fakeTransform()
    expect(await ensureAudioMeta(ops, 'n1', transform)).toBe(true)
    expect(calls()).toBe(1)
    expect(table.n1.audioWaveform).toHaveLength(WAVEFORM_BUCKETS)
  })

  it('没有音频地址时什么都不做', async () => {
    const { ops, runtimeWrites } = fakeOps({ n1: {} })
    const { transform, calls } = fakeTransform()
    expect(await ensureAudioMeta(ops, 'n1', transform)).toBe(false)
    expect(calls()).toBe(0)
    expect(runtimeWrites).toHaveLength(0)
  })
})

describe('audioOps · 上传与重分析', () => {
  it('上传把文件转成 objectURL 后走同一条载入路（文件名写进 audioName）', async () => {
    const { ops, table } = fakeOps({ n1: {} })
    const { transform } = fakeTransform()
    const file = { name: 'voice.mp3', size: 1024 } as unknown as Blob
    const ok = await uploadAudio(ops, 'n1', file, transform, async () => 'res-1')
    expect(ok).toBe(true)
    expect(table.n1.audioUrl).toBe('blob:fake')
    expect(table.n1.audioName).toBe('voice.mp3')
    expect(table.n1.resourceId).toBe('res-1')
    expect(isValidWaveform(table.n1.audioWaveform)).toBe(true)
  })

  it('没有给文件、也选不出文件时返回 false', async () => {
    const { ops } = fakeOps({ n1: {} })
    const { transform } = fakeTransform({ pickFile: async () => null })
    expect(await uploadAudio(ops, 'n1', undefined, transform)).toBe(false)
  })

  it('重分析强制重算一次波形（用户点了"重新分析"就该真重算）', async () => {
    const before = fallbackWaveform('https://x/a.mp3')
    const { ops, table } = fakeOps({ n1: { audioUrl: 'https://x/a.mp3', audioWaveform: before } })
    const { transform, calls } = fakeTransform()
    expect(await reanalyzeAudio(ops, 'n1', transform)).toBe(true)
    expect(calls()).toBe(1)
    expect(table.n1.audioWaveform).not.toEqual(before)
  })

 it('重分析没有地址的节点返回 false', async () => {
   const { ops } = fakeOps({ n1: {} })
   const { transform } = fakeTransform()
   expect(await reanalyzeAudio(ops, 'n1', transform)).toBe(false)
 })

  it('重分析拿不到时长时不写 duration（不把好数据抹成 0）', async () => {
    const { ops, table } = fakeOps({ n1: { audioUrl: 'https://x/a.mp3', audioDuration: 9 } })
    const { transform } = fakeTransform({ analyze: async () => ({ peaks: fallbackWaveform('z'), duration: 0 }) })
    await reanalyzeAudio(ops, 'n1', transform)
    expect(table.n1.audioDuration).toBe(9)
  })

  it('下载用节点上的文件名；没有音频返回 false', async () => {
    const { ops } = fakeOps({ n1: { audioUrl: 'https://x/a.mp3', audioName: 'a.mp3' }, n2: {} })
    const seen: string[] = []
    const { transform } = fakeTransform({ download: (url, name) => { seen.push(`${url}|${name}`); return true } })
    expect(downloadAudioNode(ops, 'n1', transform)).toBe(true)
    expect(seen[0]).toBe('https://x/a.mp3|a.mp3')
    expect(downloadAudioNode(ops, 'n2', transform)).toBe(false)
  })
})

describe('audioOps · 从内核服务拼句柄', () => {
  it('createAudioOps 在缺 doc 的桩上安全降级（读 undefined、写 no-op）', () => {
    const ops = createAudioOps({ get: () => undefined, tryGet: () => undefined } as never)
    expect(ops.read('x')).toBeUndefined()
    expect(() => ops.write('x', { audioUrl: 'y' })).not.toThrow()
    expect(() => ops.writeRuntime('x', { audioWaveform: [] })).not.toThrow()
  })
})
