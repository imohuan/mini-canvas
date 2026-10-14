/**
 * 节点名去重（nodeLabel）—— 用户 2026-10-14 口径：
 * 「你拖出来的这些节点，名称没有自动追加，导致了名称重复。
 * 我的画布里面添加节点的时候，名称是会自动累加的，你可以看一下」。
 *
 * 钉的是「拖进来的包名字要跟着画布现状走」这条规则本身：
 * 不撞就原样用、撞了才加号、名字本身带号就从那个号往上接。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { uniqueLabel } from '../composables/nodeLabel'

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('uniqueLabel', () => {
  it('没撞名 → 原样用（不画蛇添足）', () => {
    expect(uniqueLabel('跑一下', [])).toBe('跑一下')
    expect(uniqueLabel('跑一下', ['别的'])).toBe('跑一下')
  })

  it('★ 撞名 → 追加序号（与自动名同一形态：空格 + 数字）', () => {
    expect(uniqueLabel('跑一下', ['跑一下'])).toBe('跑一下 2')
    expect(uniqueLabel('跑一下', ['跑一下', '跑一下 2'])).toBe('跑一下 3')
  })

  it('★ 名字本身带序号 → 从那个号往上接（不叠成「可视化 3 2」）', () => {
    expect(uniqueLabel('可视化 3', ['可视化 3'])).toBe('可视化 4')
    expect(uniqueLabel('可视化 3', ['可视化 3', '可视化 4'])).toBe('可视化 5')
  })

  it('纯数字名字也算带序号（「3」→「4」）', () => {
    expect(uniqueLabel('3', ['3'])).toBe('4')
  })

  it('空名 → 空串（交回数据层按类型模板补「图片 1」这种）', () => {
    expect(uniqueLabel('', ['x'])).toBe('')
    expect(uniqueLabel('   ', ['x'])).toBe('')
  })

  it('两侧空白不算名字差异（trim 后比）', () => {
    expect(uniqueLabel(' 跑一下 ', ['跑一下'])).toBe('跑一下 2')
    expect(uniqueLabel('跑一下', [' 跑一下 '])).toBe('跑一下 2')
  })

  it('taken 里有空串 / 非字符串也不炸', () => {
    expect(uniqueLabel('a', ['', '  ', 'a'])).toBe('a 2')
  })
})

describe('★ 与插件后台那份实现规则一致（防悄悄漂移）', () => {
  /**
   * 两份为什么必须各写一份：ui 侧不能 import 插件（会把 node 逻辑拖进浏览器包），
   * 插件后台半是外挂单文件（data: URL 里解析不了裸模块名）。
   * 漂了的后果：网页端拖包会去重、MCP 建节点不会 —— 同一个包里出来的节点一半重名一半不重名。
   * 这里用「同一批输入 → 同一批输出」的方式量一次，而不是比字符串（注释/换行不该算差异）。
   */
  it('两份 uniqueLabel 对同一批输入给出同一批结果', async () => {
    const mod = await import(
      path.resolve(
        HERE,
        '../../../plugins/plugin-node-ui/src/task/uniqueLabel.ts',
      )
    )
    const other = (mod as { uniqueLabel: (b: string, t: Iterable<string>) => string }).uniqueLabel
    expect(typeof other).toBe('function')
    const cases: Array<[string, string[]]> = [
      ['跑一下', []],
      ['跑一下', ['跑一下']],
      ['跑一下', ['跑一下', '跑一下 2']],
      ['可视化 3', ['可视化 3']],
      ['可视化 3', ['可视化 3', '可视化 4']],
      ['3', ['3']],
      ['', ['x']],
      [' 跑一下 ', ['跑一下']],
      ['a', ['', '  ', 'a']],
    ]
    for (const [base, taken] of cases) {
      expect(other(base, taken), base + ' / ' + JSON.stringify(taken)).toBe(uniqueLabel(base, taken))
    }
  })
})
