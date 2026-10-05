/**
 * 左侧「画布」树 —— 由**真实画布数据**构建（纯函数，node 可单测）。
 *
 * 用户口径：左侧文件夹/节点的名字全部来自节点本身；文件夹套文件夹 = 分组；
 * 点击节点要让它在画布上居中显示（那是 ui.ts 的 locateNode，本文件只管"树长什么样"）。
 */
import { describe, it, expect } from 'vitest'
import { buildCanvasTree, nodeDisplayName, filterTree } from '../composables/canvasTree'
import type { TreeNode } from '../composables/ui'

describe('buildCanvasTree —— 按 parentId 组织成分组树', () => {
  it('有 parentId 的节点挂到父组下，没父的当根', () => {
    const tree = buildCanvasTree([
      { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { title: '分组 A' } },
      { id: 'a', type: 'image', parentId: 'g', position: { x: 1, y: 2 }, data: { imageName: '甲.png' } },
      { id: 'b', type: 'audio', position: { x: 3, y: 4 }, data: { audioName: '乙.mp3' } },
    ])
    expect(tree.map((n) => n.id)).toEqual(['g', 'b'])
    expect(tree[0].children?.map((n) => n.id)).toEqual(['a'])
  })

  it('父节点不存在（被删/孤儿）时，子节点升为根 —— 不丢节点', () => {
    const tree = buildCanvasTree([
      { id: 'a', type: 'image', parentId: '不存在', position: { x: 0, y: 0 }, data: {} },
    ])
    expect(tree.map((n) => n.id)).toEqual(['a'])
  })

  it('名字只认 data.label（节点自己的名字）', () => {
    expect(nodeDisplayName({ id: '1', type: 'image', data: { label: '图片 1' } })).toBe('图片 1')
    expect(nodeDisplayName({ id: '2', type: 'text', data: { label: '文本 3' } })).toBe('文本 3')
    // 没有 label 才回落「<类型> 节点」
    expect(nodeDisplayName({ id: '4', type: 'image', data: {} })).toBe('图片')
  })

  it('名字后面不带「节点」后缀，也不拿节点文本当名字（用户口径）', () => {
    expect(nodeDisplayName({ id: 'g', type: 'group', data: { nodeType: 'group' } })).toBe('分组')
    expect(nodeDisplayName({ id: 't', type: 'text', data: { text: '一段提示词' } })).toBe('文本')
    // 有 label（用户改过名）时优先用它，且只取首行
    expect(nodeDisplayName({ id: 'x', type: 'text', data: { label: '我的标题\n第二行', text: '正文' } })).toBe('我的标题')
    // 图片有 imageName 时用它（与画布上显示的一致）
    expect(nodeDisplayName({ id: 'i', type: 'image', data: { imageName: 'a.png' } })).toBe('a.png')
  })

  it('图片读 imageName（跟随画布显示），文本只回落到类型名', () => {
    expect(nodeDisplayName({ id: '1', type: 'image', data: { imageName: 'x.png' } })).toBe('x.png')
    expect(nodeDisplayName({ id: '2', type: 'text', data: { text: '一段提示词' } })).toBe('文本')
  })

  it('携带画布坐标（点击居中要用）', () => {
    const tree = buildCanvasTree([{ id: 'a', type: 'image', position: { x: 12, y: 34 }, data: {} }])
    expect(tree[0].x).toBe(12)
    expect(tree[0].y).toBe(34)
  })

  it('分组名读 data.label（外壳标题条改的就是它）', () => {
    const tree = buildCanvasTree([
      { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { label: '发的发大', nodeType: 'group' } },
    ])
    expect(tree[0].name).toBe('发的发大')
    expect(tree[0].icon).toBe('group')
  })

  it('类型优先 data.nodeType（渲染层可能把它包成 custom）', () => {
    const tree = buildCanvasTree([{ id: 'v', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'video', label: '视频 1' } }])
    expect(tree[0].name).toBe('视频 1')
    expect(tree[0].icon).toBe('video')
  })
})

describe('filterTree —— 搜索 + 类型过滤（下拉真正生效）', () => {
  const tree: TreeNode[] = [
    { id: 'g', name: '分组 A', meta: '', icon: 'group', children: [
      { id: 'i1', name: '图片甲', meta: '', icon: 'image' },
      { id: 't1', name: '文本乙', meta: '', icon: 'text' },
    ] },
    { id: 'v1', name: '视频丙', meta: '', icon: 'video' },
  ]

  it('全部：不过滤', () => {
    expect(filterTree(tree, { type: '全部' }).nodes.map((n) => n.id)).toEqual(['g', 'v1'])
  })

  it('类型过滤：图片 → 只留图片（分组因含图片子节点而保留）', () => {
    const { nodes } = filterTree(tree, { type: '图片' })
    expect(nodes.map((n) => n.id)).toEqual(['g'])
    expect(nodes[0].children?.map((n) => n.id)).toEqual(['i1'])
  })

  it('类型过滤：视频 → 只剩视频丙', () => {
    expect(filterTree(tree, { type: '视频' }).nodes.map((n) => n.id)).toEqual(['v1'])
  })

  it('类型过滤：音频 → 只留音频（音频不该被当成图片）', () => {
    const t: TreeNode[] = [
      { id: 'i', name: '图', meta: '', icon: 'image' },
      { id: 'a', name: '音', meta: '', icon: 'audio' },
    ]
    expect(filterTree(t, { type: '音频' }).nodes.map((n) => n.id)).toEqual(['a'])
    expect(filterTree(t, { type: '图片' }).nodes.map((n) => n.id)).toEqual(['i'])
  })

  it('类型过滤：分组 → 只留分组', () => {
    expect(filterTree(tree, { type: '分组' }).nodes.map((n) => n.id)).toEqual(['g'])
  })

  it('文本搜索 + 类型过滤同时生效', () => {
    const { nodes } = filterTree(tree, { query: '甲', type: '图片' })
    expect(nodes.map((n) => n.id)).toEqual(['g'])
    expect(nodes[0].children?.map((n) => n.id)).toEqual(['i1'])
    // 类型不符时（文本乙 不是图片）搜到也不留
    expect(filterTree(tree, { query: '乙', type: '图片' }).nodes).toEqual([])
  })

  it('命中的分组会被标记展开', () => {
    expect(filterTree(tree, { type: '图片' }).expandIds).toContain('g')
  })
})
