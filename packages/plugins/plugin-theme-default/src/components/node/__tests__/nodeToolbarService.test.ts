/**
 * nodeToolbarService 的语义锁（用户 2026-10-29 确认的三条规则）：
 * 1. 同一个 id 可以注册多份，用 types 区分、order 小者赢；
 * 2. 一根栏的取值可以是 null（不显示）/ 字符串（引用别的模式 id）/ 组件；
 * 3. 顶栏与底栏**分开裁决** —— 只注册了底栏的那份不会把别人注册的顶栏顶掉。
 */
import { describe, it, expect } from 'vitest'
import { NodeToolbarService } from '../nodeToolbarService'

const TopA = { name: 'TopA' }
const TopB = { name: 'TopB' }
const BottomA = { name: 'BottomA' }
const BottomB = { name: 'BottomB' }

function withTypes(map: Record<string, string>): NodeToolbarService {
  const svc = new NodeToolbarService()
  svc.docPeek = { getNode: (id: string) => (map[id] ? { type: map[id] } : undefined) }
  return svc
}

describe('同 id 多份注册：types 过滤 + order 最小者赢', () => {
  it('两份都匹配时 order 小的赢', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomA, order: 100 })
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomB, order: 10 })
    expect(svc.resolveBar('n1', 'bottom', 'image')).toEqual({ kind: 'component', component: BottomB })
  })

  it('types 不匹配的那份不参与裁决', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'default', types: ['text'], bottomBar: BottomA, order: 1 })
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomB, order: 99 })
    expect(svc.resolveBar('n1', 'bottom', 'image')).toEqual({ kind: 'component', component: BottomB })
    expect(svc.resolveBar('n2', 'bottom', 'text')).toEqual({ kind: 'component', component: BottomA })
  })

  it('缺省 types = 适用所有类型', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'default', bottomBar: BottomA, order: 100 })
    expect(svc.resolveBar('n1', 'bottom', 'audio')).toEqual({ kind: 'component', component: BottomA })
  })

  it('同 id + 同 order + 同 types = 热更覆盖（不会越注册越多）', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomA, order: 10 })
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomB, order: 10 })
    expect(svc.resolveBar('n1', 'bottom', 'image')).toEqual({ kind: 'component', component: BottomB })
  })
})

describe('顶栏与底栏分开裁决', () => {
  it('只注册底栏的那份不会顶掉别人注册的顶栏', () => {
    const svc = new NodeToolbarService()
    // 图片插件：默认顶栏是它自己的上传条
    svc.registerMode({ id: 'default', types: ['image'], topBar: TopA, order: 100 })
    // bottom-bar：默认底栏，没声明 topBar
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomA, order: 100 })
    expect(svc.resolveBar('n1', 'top', 'image')).toEqual({ kind: 'component', component: TopA })
    expect(svc.resolveBar('n1', 'bottom', 'image')).toEqual({ kind: 'component', component: BottomA })
  })

  it('顶栏也能被更小 order 的注册单独顶替', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'default', types: ['image'], topBar: TopA, order: 100 })
    svc.registerMode({ id: 'default', types: ['image'], topBar: TopB, order: 5 })
    expect(svc.resolveBar('n1', 'top', 'image')).toEqual({ kind: 'component', component: TopB })
  })
})

describe('一根栏的三种取值', () => {
  it('null = 这一格不显示', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'image/crop', types: ['image'], topBar: null })
    svc.enter('n1', 'image/crop')
    expect(svc.resolveBar('n1', 'top', 'image')).toEqual({ kind: 'none' })
  })

  it('字符串 = 引用另一个模式 id 的同一格（default 即保持默认面板）', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomA })
    svc.registerMode({ id: 'image/crop', types: ['image'], bottomBar: 'default', topBar: null })
    svc.enter('n1', 'image/crop')
    expect(svc.resolveBar('n1', 'bottom', 'image')).toEqual({ kind: 'component', component: BottomA })
  })

  it('引用链断掉（目标 id 不存在）→ 回落到 default', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomA })
    svc.registerMode({ id: 'x', types: ['image'], bottomBar: 'nope' })
    svc.enter('n1', 'x')
    expect(svc.resolveBar('n1', 'bottom', 'image')).toEqual({ kind: 'component', component: BottomA })
  })

  it('互相引用不会死循环（超过深度就回落）', () => {
    const svc = new NodeToolbarService()
    svc.registerMode({ id: 'a', bottomBar: 'b' })
    svc.registerMode({ id: 'b', bottomBar: 'a' })
    svc.enter('n1', 'a')
    expect(svc.resolveBar('n1', 'bottom', 'image')).toEqual({ kind: 'inherit' })
  })
})

describe('会话进出与回退', () => {
  it('没进模式 → 用 default 的注册', () => {
    const svc = withTypes({ n1: 'image' })
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomA })
    expect(svc.resolveBar('n1', 'bottom')).toEqual({ kind: 'component', component: BottomA })
  })

  it('进模式后 → 用模式的那一格；没声明的那一格仍回退 default', () => {
    const svc = withTypes({ n1: 'image' })
    svc.registerMode({ id: 'default', types: ['image'], topBar: TopA, bottomBar: BottomA })
    svc.registerMode({ id: 'image/crop', types: ['image'], bottomBar: BottomB })
    svc.enter('n1', 'image/crop')
    expect(svc.resolveBar('n1', 'bottom')).toEqual({ kind: 'component', component: BottomB })
    expect(svc.resolveBar('n1', 'top')).toEqual({ kind: 'component', component: TopA })
  })

  it('exit 后回到 default；exit 别的节点不影响本节点', () => {
    const svc = withTypes({ n1: 'image', n2: 'image' })
    svc.registerMode({ id: 'default', types: ['image'], bottomBar: BottomA })
    svc.registerMode({ id: 'm', types: ['image'], bottomBar: BottomB })
    svc.enter('n1', 'm')
    svc.exit('n2')
    expect(svc.inMode('n1')).toBe(true)
    svc.exit('n1')
    expect(svc.inMode('n1')).toBe(false)
    expect(svc.resolveBar('n1', 'bottom')).toEqual({ kind: 'component', component: BottomA })
  })

  it('什么都没注册 → inherit（宿主透传自己的默认内容）', () => {
    const svc = withTypes({ n1: 'image' })
    expect(svc.resolveBar('n1', 'top')).toEqual({ kind: 'inherit' })
    expect(svc.resolveBar('n1', 'bottom')).toEqual({ kind: 'inherit' })
  })

  it('enter 不存在的 id → 忽略（防止会话指向悬空模式）', () => {
    const svc = withTypes({ n1: 'image' })
    svc.enter('n1', 'nope')
    expect(svc.inMode('n1')).toBe(false)
  })
})
