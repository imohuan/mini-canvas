/**
 * 剪贴板仲裁纯逻辑测试（canvas-data）。
 *
 * 钉死"一个粘贴键、多方按 order 竞争、按剪贴板标记决定归属"这三条契约。
 * 用户缺陷背景见 clipboardActions.ts 头注释。
 */
import { describe, it, expect } from 'vitest'
import {
  CANVAS_CLIPBOARD_MIME,
  CANVAS_CLIPBOARD_TEXT_PREFIX,
  canvasClipboardMarker,
  canvasClipboardPayload,
  parseCanvasClipboardText,
  readCanvasClipboardPayload,
  hasCanvasClipboardMarker,
  dispatchClipboardPaste,
  dispatchClipboardWrite,
  buildClipboardPastePayload,
  type ClipboardPasteHandler,
  type ClipboardWriteHandler,
  type ClipboardPastePayload,
} from '../clipboardActions'

/** 造一个最小的 paste 事件形状（只覆盖契约用到的字段） */
function pasteEvent(opts: {
  types?: string[]
  files?: File[]
  data?: Record<string, string>
}): ClipboardEvent & { defaultPreventedFlag: boolean } {
  const data = opts.data ?? {}
  const ev = {
    defaultPreventedFlag: false,
    preventDefault() {
      ev.defaultPreventedFlag = true
    },
    clipboardData: {
      types: opts.types ?? [],
      files: opts.files ?? [],
      items: Object.entries(data).map(([type, value]) => ({
        kind: 'string',
        type,
        getAsString(cb: (s: string) => void) {
          cb(value)
        },
      })),
      getData(mime: string) {
        return data[mime] ?? ''
      },
    },
  }
  return ev as unknown as ClipboardEvent & { defaultPreventedFlag: boolean }
}

function writeEvent(): ClipboardEvent & { defaultPreventedFlag: boolean; written: Record<string, string> } {
  const written: Record<string, string> = {}
  const ev = {
    defaultPreventedFlag: false,
    written,
    preventDefault() {
      ev.defaultPreventedFlag = true
    },
    clipboardData: {
      setData(mime: string, v: string) {
        written[mime] = v
      },
    },
  }
  return ev as unknown as ClipboardEvent & { defaultPreventedFlag: boolean; written: Record<string, string> }
}

describe('hasCanvasClipboardMarker（粘贴时判"最后这次复制来自画布"）', () => {
  it('自定义 MIME 命中', () => {
    const p = buildClipboardPastePayload(pasteEvent({ types: [CANVAS_CLIPBOARD_MIME], data: { [CANVAS_CLIPBOARD_MIME]: canvasClipboardMarker(3, 1) } }))
    expect(hasCanvasClipboardMarker(p)).toBe(true)
  })

  it('text/plain 前缀命中（只认 text/plain 的来源兜底）', () => {
    const p = buildClipboardPastePayload(pasteEvent({ types: ['text/plain'], data: { 'text/plain': CANVAS_CLIPBOARD_TEXT_PREFIX + '{"v":1}' } }))
    expect(hasCanvasClipboardMarker(p)).toBe(true)
  })

  it('外部图片（无标记）不命中', () => {
    const p = buildClipboardPastePayload(pasteEvent({ types: ['image/png'] }))
    expect(hasCanvasClipboardMarker(p)).toBe(false)
  })

  it('普通外部文本不命中', () => {
    const p = buildClipboardPastePayload(pasteEvent({ types: ['text/plain'], data: { 'text/plain': 'hello world' } }))
    expect(hasCanvasClipboardMarker(p)).toBe(false)
  })
})

/**
 * 跨页面互粘（用户 2026-10-12 报的"复制一个节点，无法在另一个浏览器页面粘贴"）。
 *
 * 机制：剪贴板里带**完整载荷**（节点 + 边），另一个页面读它就能贴 —— 不依赖任何内存态。
 */
describe('画布载荷（跨页面粘贴的唯一通道）', () => {
  const nodes = [{ id: '1', type: 'text', position: { x: 0, y: 0 }, absPosition: { x: 0, y: 0 }, data: { label: '文本 1' } }]

  it('写出去的载荷能被读回来（自定义 MIME）', () => {
    const text = canvasClipboardPayload(nodes, [], 1234)
    const p = buildClipboardPastePayload(pasteEvent({ types: [CANVAS_CLIPBOARD_MIME], data: { [CANVAS_CLIPBOARD_MIME]: text } }))
    const back = readCanvasClipboardPayload(p)
    expect(back?.nodes).toEqual(nodes)
    expect(back?.edges).toEqual([])
    // copyTime 一起带回来："这份是不是本页自己复制的"靠它分辨（别的页面复制的才需要重建图地址）
    expect(back?.copyTime).toBe(1234)
  })

  it('text/plain 那条也带完整数据（程序化复制只能写 text/plain）', () => {
    // 右键菜单/脚本走 navigator.clipboard.writeText，自定义 MIME 写不进去 —— text/plain 必须自带数据，
    // 否则"菜单里复制 → 另一个页面粘贴"什么也贴不出来。
    const text = CANVAS_CLIPBOARD_TEXT_PREFIX + canvasClipboardPayload(nodes, [], 1)
    const p = buildClipboardPastePayload(pasteEvent({ types: ['text/plain'], data: { 'text/plain': text } }))
    expect(readCanvasClipboardPayload(p)?.nodes).toEqual(nodes)
  })

  it('外部文本 / 旧版纯标记 JSON 都读不成载荷（继续让位给 file-drop）', () => {
    const plain = buildClipboardPastePayload(pasteEvent({ types: ['text/plain'], data: { 'text/plain': 'hello world' } }))
    expect(readCanvasClipboardPayload(plain)).toBeUndefined()
    const oldMarker = buildClipboardPastePayload(
      pasteEvent({ types: ['text/plain'], data: { 'text/plain': CANVAS_CLIPBOARD_TEXT_PREFIX + canvasClipboardMarker(1, 0) } }),
    )
    // 老格式（只有 nodes/edges 的**计数**）不是载荷 —— 但它仍是"来自画布"的标记
    expect(readCanvasClipboardPayload(oldMarker)).toBeUndefined()
    expect(hasCanvasClipboardMarker(oldMarker)).toBe(true)
  })

  it('parseCanvasClipboardText 认裸 JSON 与带前缀两种形态，非法文本一律 undefined', () => {
    const json = JSON.stringify({ v: 2, nodes: [], edges: [] })
    expect(parseCanvasClipboardText(json)?.nodes).toEqual([])
    expect(parseCanvasClipboardText(CANVAS_CLIPBOARD_TEXT_PREFIX + json)?.edges).toEqual([])
    expect(parseCanvasClipboardText('not json')).toBeUndefined()
    expect(parseCanvasClipboardText(JSON.stringify({ hello: 1 }))).toBeUndefined()
    expect(parseCanvasClipboardText(undefined)).toBeUndefined()
  })
})
describe('dispatchClipboardPaste（按 order 仲裁、第一个接管的赢）', () => {
  it('order 小者先被问；它接管后后面的不再被问', () => {
    const calls: string[] = []
    const a: ClipboardPasteHandler = () => {
      calls.push('a')
      return true
    }
    const b: ClipboardPasteHandler = () => {
      calls.push('b')
      return true
    }
    // 已是 list() 的顺序：order 升序
    const claimed = dispatchClipboardPaste([{ value: a }, { value: b }], buildClipboardPastePayload(pasteEvent({})))
    expect(claimed).toBe(true)
    expect(calls).toEqual(['a'])
  })

  it('前面的不认领则顺位给后面', () => {
    const calls: string[] = []
    const a: ClipboardPasteHandler = () => {
      calls.push('a')
      return false
    }
    const b: ClipboardPasteHandler = () => {
      calls.push('b')
      return true
    }
    expect(dispatchClipboardPaste([{ value: a }, { value: b }], buildClipboardPastePayload(pasteEvent({})))).toBe(true)
    expect(calls).toEqual(['a', 'b'])
  })

  it('全部不认领 → false，不 preventDefault', () => {
    const ev = pasteEvent({})
    const pass: ClipboardPasteHandler = () => false
    expect(dispatchClipboardPaste([{ value: pass }], buildClipboardPastePayload(ev))).toBe(false)
    expect(ev.defaultPreventedFlag).toBe(false)
  })

  it('接管时 preventDefault（避免浏览器默认粘贴覆盖画布行为）', () => {
    const ev = pasteEvent({})
    const take: ClipboardPasteHandler = () => true
    expect(dispatchClipboardPaste([{ value: take }], buildClipboardPastePayload(ev))).toBe(true)
    expect(ev.defaultPreventedFlag).toBe(true)
  })

  it('单个处理器抛错只跳过它，不阻断后续', () => {
    const boom: ClipboardPasteHandler = () => {
      throw new Error('boom')
    }
    const ok: ClipboardPasteHandler = () => true
    expect(dispatchClipboardPaste([{ value: boom }, { value: ok }], buildClipboardPastePayload(pasteEvent({})))).toBe(true)
  })
})

describe('dispatchClipboardWrite（复制/剪切仲裁）', () => {
  it('第一个接管的赢并 preventDefault', () => {
    const ev = writeEvent()
    const first: ClipboardWriteHandler = (p) => {
      p.write(CANVAS_CLIPBOARD_MIME, 'marker')
      return true
    }
    expect(dispatchClipboardWrite([{ value: first }], buildWrite(ev))).toBe(true)
    expect(ev.defaultPreventedFlag).toBe(true)
    expect(ev.written[CANVAS_CLIPBOARD_MIME]).toBe('marker')
  })

  it('都不认领 → false，不 preventDefault（放行浏览器默认复制）', () => {
    const ev = writeEvent()
    const pass: ClipboardWriteHandler = () => false
    expect(dispatchClipboardWrite([{ value: pass }], buildWrite(ev))).toBe(false)
    expect(ev.defaultPreventedFlag).toBe(false)
  })
})


/**
 * 用户 2026-10-10 报的缺陷：**一张图贴出来两张**。
 *
 * 根因（真机实测）：粘贴一张图时 clipboardData.files 有 1 个 File，items 里也有 1 个 file 项，
 * 但 item.getAsFile() 返回的是**另一个 File 对象**（内容相同、引用不同）。早期实现把两处合并后
 * 按对象身份去重，对这两个不同对象无效，同一张图被算成两份，建出两个节点。
 *
 * 修法：文件只取**一份**事实来源，优先 clipboardData.files，仅在它为空的浏览器里回落到 items。
 */
describe('粘贴文件归一：一张图只能算一份（用户缺陷：贴出两张）', () => {
  it('files 与 items 都有同一张图（不同 File 对象）→ payload.files 只有 1 份', () => {
    const fromFiles = new File(['png-bytes'], 'image.png', { type: 'image/png' })
    const fromItems = new File(['png-bytes'], 'image.png', { type: 'image/png' })
    const ev = {
      preventDefault() {},
      clipboardData: {
        types: ['Files'],
        files: [fromFiles],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => fromItems }],
        getData: () => '',
      },
    } as unknown as ClipboardEvent
    const payload = buildClipboardPastePayload(ev)
    expect(payload.files.length).toBe(1)
    expect(payload.files[0].type).toBe('image/png')
  })

  it('files 为空时才回落到 items（老浏览器兼容不能丢）', () => {
    const only = new File(['x'], 'a.png', { type: 'image/png' })
    const ev = {
      preventDefault() {},
      clipboardData: {
        types: ['Files'],
        files: [],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => only }],
        getData: () => '',
      },
    } as unknown as ClipboardEvent
    const payload = buildClipboardPastePayload(ev)
    expect(payload.files.length).toBe(1)
  })
})
// buildClipboardWritePayload 需要 ClipboardEvent；测试用同一假对象
import { buildClipboardWritePayload } from '../clipboardActions'
function buildWrite(ev: ClipboardEvent) {
  return buildClipboardWritePayload(ev)
}

