/**
 * 节点包（可视化节点）拖到画布的行为 —— 与图片/视频对齐（用户 2026-10-14 口径）：
 *   ① 去掉拖拽时的「聚焦效果」（不该缩放平移视口）；
 *   ② 修正落点（落在指针处 / 视口中心，而不是级联默认位）；
 *   ③ 缩放行为保持不变（不取景 ⇒ 自然不变）。
 *
 * 为什么要盯源码结构（与本仓 dockAddMenu / assetTreeStructure 同一口径）：
 * "拖包会不会把画布挪走"这件事在单测里跑不出来（要真视口 + VueFlow），
 * 但**它由两个可以静态判定的接线决定** —— 落点传没传、建完调的是
 * selectNewNode（只选中）还是 focusNewNode（按 F 取景）。这两条一旦回退，
 * 表现就是"包又跳位了 / 画布又自己动了"，而单测全绿。所以钉住结构。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const ui = read('../composables/ui.ts')
const drawer = read('../components/areas/LeftDrawer.vue')

/** 取出一个函数的函数体（从声明到下一个顶层 function 之前） */
function bodyOf(src: string, signature: string): string {
  const at = src.indexOf(signature)
  expect(at, '找不到 ' + signature).toBeGreaterThan(-1)
  const rest = src.slice(at)
  const next = rest.indexOf('\n  function ', signature.length)
  const nextAsync = rest.indexOf('\n  async function ', signature.length)
  const candidates = [next, nextAsync].filter((i) => i > 0)
  const end = candidates.length ? Math.min(...candidates) : rest.length
  return rest.slice(0, end)
}

describe('拖节点包到画布：落点要一路传下去', () => {
  it('★ 资产树那条（createAssetNode）把 atFlow 传给 importPackFromUrl', () => {
    const body = bodyOf(ui, 'function createAssetNode(')
    // 少了 atFlow 这个实参 → 包走 spawnPosition(undefined) 的级联默认位（用户报的"位置不对"）
    expect(body).toMatch(/importPackFromUrl\(asset\.url, asset\.name, atFlow\)/)
  })

  it('★ 文件系统那条（LeftDrawer 的 onCanvasDrop）把指针换算成 flow 再传', () => {
    expect(drawer).toMatch(/ui\.screenToFlow\(e\.clientX, e\.clientY\)/)
    expect(drawer).toMatch(/ui\.importPackFile\(p, atFlow\)/)
  })

  it('importPackFile 的落点：优先指针，没给就用视口中心（与媒体文件一致）', () => {
    const body = bodyOf(ui, 'async function importPackFile(')
    // 视口中心那条是给"点菜单/点上传"这类没有指针位置入口的（与 addMediaFilesToCanvas 同口径）
    expect(body).toContain('viewportCenterFlow()')
    expect(body).toMatch(/spawnPosition\(anchor\)/)
  })

  it('addFilesToCanvas（拖文件/点上传）给包也准备了视口中心落点', () => {
    const body = bodyOf(ui, 'async function addFilesToCanvas(')
    expect(body).toContain('viewportCenterFlow()')
    expect(body).toMatch(/importPackFile\(p, packAnchor\)/)
  })
})

describe('拖节点包到画布：不取景（去掉「聚焦效果」）', () => {
  it('★ importPackFile 建完只选中，不调 focusNewNode', () => {
    const body = bodyOf(ui, 'async function importPackFile(')
    expect(body).toContain('selectNewNode(id)')
    // focusNewNode 会执行 auto-layout:focus-selected（按 F），会缩放平移视口 —— 拖拽那条不该有
    expect(body).not.toContain('focusNewNode(id)')
  })

  it('★ 资产库拖拽那条（atFlow 有值）也只选中，不取景', () => {
    const body = bodyOf(ui, 'async function importPackFromUrl(')
    expect(body).toMatch(/if \(atFlow\) selectNewNode\(id\)/)
    expect(body).toMatch(/else focusNewNode\(id\)/)
  })

  it('媒体文件那条本来就不取景（对照：两张卡走同一条规矩）', () => {
    // file-drop 的 commitPayloads 建完只 selection.set，不动视口
    const fileDrop = readFileSync(
      path.resolve(HERE, '../../../plugins/plugin-file-drop/src/fileDropPlugin.ts'),
      'utf8',
    )
    const commit = fileDrop.slice(fileDrop.indexOf('private commitPayloads'))
    const block = commit.slice(0, commit.indexOf('\n  }'))
    expect(block).toContain('this.selection.set(ids)')
    expect(block).not.toContain('animateViewport')
    expect(block).not.toContain('setViewport')
  })
})

describe('缩放行为保持不变', () => {
  it('拖拽那条路径不碰视口服务（不 zoom / 不平移）', () => {
    const create = bodyOf(ui, 'function createAssetNode(')
    // 拖拽分支只 select，不 focus；focus 那条才有 viewport 动作（在 auto-layout 里）
    expect(create).toMatch(/if \(atFlow\) selectNewNode\(newId\)/)
    expect(create).toMatch(/else focusNewNode\(newId\)/)
    // 屏幕坐标 → flow 只用来算落点，不改视口
    const screen = bodyOf(ui, 'function screenToFlow(')
    expect(screen).toContain('vp.screenToFlow')
    expect(screen).not.toContain('setViewport')
    expect(screen).not.toContain('animateViewport')
  })
})
