/**
 * 框内按下的归属（用户报的缺陷：「多选之后，在多选区域拖拽没有效果……拖拽多选框内部的空白区域就不行了」）。
 *
 * 根因：整组拖动的门写成了「落点是 pane 空白 + 不在任何节点矩形里」。
 * 多选框里大片"看起来是空白"的位置其实属于节点元素：
 *   - 卡片上方的标题条（位于节点矩形之外、外框之内）；
 *   - 选中卡片自己的透明覆盖层/装饰区。
 * 这些位置整组拖动全被跳过，最后落到节点自己的点选上 —— 多选当场收缩成单选，
 * 用户看到的就是"拖一下就取消了多选、好像穿透了一样"。
 *
 * 现在按「是否在框内 + 是否在选中节点上 + 是否是控件」来判断，这条测试锁住这张真值表。
 */
import { describe, it, expect } from 'vitest'
import { resolveGroupDragHit, type GroupDragHitInput } from '../multiSelectEngine'

const base: GroupDragHitInput = {
  insideFrame: true,
  overNode: false,
  nodeSelected: false,
  interactive: false,
  nativeDraggable: false,
}

describe('resolveGroupDragHit', () => {
  it('框内空白 → 整组拖动', () => {
    expect(resolveGroupDragHit(base)).toBe('group')
  })

  it('框内、落在**已选中**节点上（标题条/透明装饰区）→ 仍然整组拖动', () => {
    // 这一条正是用户截图里红圈的位置：看着是空白，其实属于选中卡片。
    expect(resolveGroupDragHit({ ...base, overNode: true, nodeSelected: true })).toBe('group')
  })

  it('框内、落在已选中节点本来就能拖的正文上 → 交给宿主（VueFlow 本来就会带整组动）', () => {
    expect(
      resolveGroupDragHit({ ...base, overNode: true, nodeSelected: true, nativeDraggable: true }),
    ).toBe('native')
  })

  it('框内、落在未选中节点上 → 交给节点自己（保持"点它 = 选中并拖它"）', () => {
    expect(resolveGroupDragHit({ ...base, overNode: true, nodeSelected: false })).toBe('native')
    expect(
      resolveGroupDragHit({ ...base, overNode: true, nodeSelected: false, nativeDraggable: true }),
    ).toBe('native')
  })

  it('框外 → 不接管（画布照常平移/框选）', () => {
    expect(resolveGroupDragHit({ ...base, insideFrame: false })).toBe('ignore')
    expect(resolveGroupDragHit({ ...base, insideFrame: false, overNode: true, nodeSelected: true })).toBe('ignore')
  })

  it('落在控件上（按钮/滑杆/缩放角/端口/浮层按钮）→ 不接管，控件保持自己的动作', () => {
    expect(resolveGroupDragHit({ ...base, interactive: true })).toBe('ignore')
    expect(resolveGroupDragHit({ ...base, interactive: true, overNode: true, nodeSelected: true })).toBe('ignore')
  })

  it('不在框内时控件判断不影响结论（先后顺序稳定）', () => {
    expect(resolveGroupDragHit({ ...base, insideFrame: false, interactive: true })).toBe('ignore')
  })
})
