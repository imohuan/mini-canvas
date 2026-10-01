/**
 * referenceMode 判定契约（纯逻辑，Node 可测）。
 *
 * 锁的都是用户明确点出来的语义：
 * 1. 「只能选择它支持的节点」—— 支持与否**读节点类型自己声明的端口能力**，不是本插件写死一张表；
 * 2. 不支持的节点 → 灰掉（blocked）；
 * 3. 点可选节点 = 建立链接（connect）；点已连的 = 解除（disconnect）；
 * 4. 「参考」是**两态开关**（用户实测：点开之后取消不掉）—— 再点一次、或走「返回节点」都收工。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  canReference,
  outputKindOf,
  inputAcceptsOf,
  referenceNodeState,
  referenceHintText,
  referencePickAction,
  enterReference,
  exitReference,
  toggleReference,
  referenceActive,
  referenceOwner,
  resolveFocusZoom,
  focusViewportFor,
  FOCUS_ZOOM,
  type NodeTypeLike,
} from '../referenceMode'

// 与真实节点类型同形的两份声明（照 plugin-node-image / plugin-node-text）
const IMAGE: NodeTypeLike = {
  inputs: [{ acceptsTypes: ['text', 'image'] }],
  outputs: [{ contentType: 'image' }],
}
const TEXT: NodeTypeLike = {
  inputs: [{ acceptsTypes: ['text'] }],
  outputs: [{ contentType: 'text' }],
}
/** 只有输入口、不产出任何内容（分组/画板这类容器） */
const CONTAINER: NodeTypeLike = { inputs: [{ acceptsTypes: ['image'] }] }
/** 什么都没声明（老类型/极简类型） */
const BARE: NodeTypeLike = {}

describe('referenceMode：谁可以当参考（读端口声明，不写死表）', () => {
  it('产出 image 的节点可以给「收 image」的图片节点当参考', () => {
    expect(canReference(IMAGE, IMAGE)).toBe(true)
  })

  it('产出 text 的文本节点可以给图片节点当参考（文生图要文字）', () => {
    expect(canReference(TEXT, IMAGE)).toBe(true)
  })

  it('产出 image 的图片节点不能给只收 text 的文本节点当参考', () => {
    expect(canReference(IMAGE, TEXT)).toBe(false)
  })

  it('不产出任何内容的节点（容器类）不能当参考', () => {
    expect(canReference(CONTAINER, IMAGE)).toBe(false)
  })

  it('目标没声明 acceptsTypes → 来者不拒（与内核「缺省即全收」同一口径）', () => {
    expect(canReference(IMAGE, BARE)).toBe(true)
  })

  it('源类型没声明产出内容 → 不知道它产出什么，不当参考', () => {
    expect(canReference(BARE, IMAGE)).toBe(false)
    expect(canReference(undefined, IMAGE)).toBe(false)
  })

  it('outputKindOf / inputAcceptsOf 只读声明、不做猜测', () => {
    expect(outputKindOf(IMAGE)).toBe('image')
    expect(outputKindOf(BARE)).toBeUndefined()
    expect(inputAcceptsOf(IMAGE)).toEqual(['text', 'image'])
    expect(inputAcceptsOf(BARE)).toEqual([])
    // 多输入口时合并去重
    expect(inputAcceptsOf({ inputs: [{ acceptsTypes: ['image'] }, { acceptsTypes: ['image', 'video'] }] })).toEqual([
      'image',
      'video',
    ])
  })
})

describe('referenceMode：节点在选择态里的四种面孔', () => {
  it('自己 → owner（不铺盖层）', () => {
    expect(referenceNodeState({ isOwner: true, canReference: false, connected: false })).toBe('owner')
  })

  it('不支持 → blocked（灰掉、不可点）', () => {
    expect(referenceNodeState({ isOwner: false, canReference: false, connected: false })).toBe('blocked')
  })

  it('支持且未连 → selectable（悬停提示 + 可点）', () => {
    expect(referenceNodeState({ isOwner: false, canReference: true, connected: false })).toBe('selectable')
  })

  it('支持且已连 → connected（点它解除）', () => {
    expect(referenceNodeState({ isOwner: false, canReference: true, connected: true })).toBe('connected')
  })

  it('提示文案就是用户看到的那两句；blocked / owner 不显字', () => {
    expect(referenceHintText('selectable', '图片节点 1')).toBe('选择 图片节点 1')
    expect(referenceHintText('connected', '图片节点 1')).toBe('取消选择 图片节点 1')
    expect(referenceHintText('blocked', '图片节点 1')).toBe('')
    expect(referenceHintText('owner', '图片节点 1')).toBe('')
  })
})

describe('referenceMode：点一下该做什么', () => {
  it('可选 → 建立链接', () => {
    expect(referencePickAction('selectable')).toBe('connect')
  })

  it('已连 → 解除链接', () => {
    expect(referencePickAction('connected')).toBe('disconnect')
  })

  it('灰掉的 / 自己的 → 什么都不做', () => {
    expect(referencePickAction('blocked')).toBe('none')
    expect(referencePickAction('owner')).toBe('none')
  })
})

describe('referenceMode：会话状态（参考是一个开关）', () => {
  beforeEach(() => exitReference())

  it('进入后 active / owner 一致；退出后清干净', () => {
    expect(referenceActive()).toBe(false)
    enterReference('n1')
    expect(referenceActive()).toBe(true)
    expect(referenceOwner()).toBe('n1')
    exitReference()
    expect(referenceActive()).toBe(false)
    expect(referenceOwner()).toBeNull()
  })

  it('toggleReference：第一次进入、第二次退出（用户实测的"取消不掉"就是这条）', () => {
    toggleReference('n1')
    expect(referenceActive()).toBe(true)
    expect(referenceOwner()).toBe('n1')
    toggleReference('n1')
    expect(referenceActive()).toBe(false)
    expect(referenceOwner()).toBeNull()
  })

  it('toggleReference 传别的节点 = 改给那个节点选参考（不是退出）', () => {
    toggleReference('n1')
    toggleReference('n2')
    expect(referenceActive()).toBe(true)
    expect(referenceOwner()).toBe('n2')
  })

  it('空 id 不进入（防呆）', () => {
    enterReference('')
    expect(referenceActive()).toBe(false)
  })
})

describe('referenceMode：返回节点时的聚焦', () => {
  it('缩放太小时抬到 100%（节点不至于只有巴掌大）', () => {
    expect(resolveFocusZoom(0.2)).toBe(FOCUS_ZOOM)
    expect(resolveFocusZoom(0.59)).toBe(FOCUS_ZOOM)
  })

  it('用户已经放大看细节时，保留他当前的缩放（不擅自重置）', () => {
    expect(resolveFocusZoom(1)).toBe(1)
    expect(resolveFocusZoom(2.4)).toBe(2.4)
  })

  it('非法缩放按 1 处理（不把视口搞坏）', () => {
    expect(resolveFocusZoom(0)).toBe(1)
    expect(resolveFocusZoom(Number.NaN)).toBe(1)
    expect(resolveFocusZoom(-3)).toBe(1)
  })

  it('聚焦点 = 节点矩形中心；缩放按上面的规则', () => {
    const vp = focusViewportFor({ x: 100, y: 200, w: 400, h: 300 }, 0.3)
    expect(vp).toEqual({ x: 300, y: 350, zoom: 1 })
    const keep = focusViewportFor({ x: 0, y: 0, w: 10, h: 10 }, 1.5)
    expect(keep).toEqual({ x: 5, y: 5, zoom: 1.5 })
  })
})

