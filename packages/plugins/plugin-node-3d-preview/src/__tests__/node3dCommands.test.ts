/**
 * 3D 预览的节点快捷键 —— 目标判定契约（纯函数，Node 直接跑）。
 *
 * 用户要求（原话）："给他一些节点操作快捷键…r 重置，f 全屏（切换效果-注意这里画布也可能注册了 f，
 * 你需要有一个优先级，选中节点之后支持这些快捷键）"。
 *
 * 关键就在"选中节点之后"这半句：快捷键归节点用是有**条件**的 ——
 * 只有"当前恰好选中一个、且它就是 3D 预览节点"时才该由节点接管 f/r；
 * 其它情况（没选、选的是别的类型、选了多个）一律让位给画布原有的 f/r。
 * 本文件锁的就是这条条件，它同时也是命令 when 的判定（when=false → 分发时让位）。
 */
import { describe, it, expect } from 'vitest'
import { PANORAMA_FULLSCREEN_COMMAND, PANORAMA_RESET_COMMAND, resolveCommandTarget } from '../node3dCommands'

/** 造一个"按 id 查类型"的表 */
const typeOf = (types: Record<string, string>) => (id: string): string | undefined => types[id]

describe('resolveCommandTarget：什么情况下快捷键归 3D 节点', () => {
  const types = { pano: '3d-preview', img: 'image', pano2: '3d-preview' }

  it('恰好选中一个 3D 预览节点 → 返回它（快捷键归节点）', () => {
    expect(resolveCommandTarget(['pano'], typeOf(types))).toBe('pano')
  })

  it('没选任何节点 → 空串（让位给画布快捷键）', () => {
    expect(resolveCommandTarget([], typeOf(types))).toBe('')
  })

  it('选中的是别的类型 → 空串（不能抢画布的 f/r）', () => {
    expect(resolveCommandTarget(['img'], typeOf(types))).toBe('')
  })

  it('选了多个（哪怕其中有 3D 节点）→ 空串：多选时该操作谁并不明确，不猜', () => {
    expect(resolveCommandTarget(['pano', 'img'], typeOf(types))).toBe('')
    expect(resolveCommandTarget(['pano', 'pano2'], typeOf(types))).toBe('')
  })

  it('选中集里有已被删掉的幽灵 id（查不到类型）→ 也当"不适用"，不让位逻辑出错', () => {
    expect(resolveCommandTarget(['gone'], typeOf(types))).toBe('')
  })
})

describe('命令 id 是稳定契约（快捷键帮助面板/右键菜单按 id 引用）', () => {
  it('fullscreen / reset 两个 id 固定不变', () => {
    expect(PANORAMA_FULLSCREEN_COMMAND).toBe('3d-preview:fullscreen')
    expect(PANORAMA_RESET_COMMAND).toBe('3d-preview:reset')
  })
})
