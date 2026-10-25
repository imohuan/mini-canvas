/**
 * 动作项（@ 菜单里的「压缩」这类命令）与标签项的分流。
 *
 * 为什么用源码守卫而不是挂载真实编辑器：这条路径要真 contenteditable + 真实浏览器
 * 事件才会跑起来（jsdom 里造 EditorView 也不产生真实 selection），成本远高于收益。
 * 而这里最容易回归的是"分流本身"——把 onPick 分支删了、或在它之前先跑插入逻辑，
 * 用户看到的就是「点完压缩，输入框里留下一颗空标签 / 一串 @关键词」。
 *
 * 真机复现的原始症状（2026-10-11）：点「压缩上下文」后输入框里剩着「@压缩」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = readFileSync(path.join(__dirname, '../useEditor.ts'), 'utf8')

describe('动作项：选中后不插标签、只跑命令', () => {
  it('onPick 分支在插入逻辑**之前**（否则会先插出一颗空标签）', () => {
    const onPick = src.indexOf('if (item.onPick)')
    // 只看 insertSelectedItem 的函数体：同一个 buildResourceNode 也被 @槽位插件用，
    // 全局 indexOf 会先命中那处（它在本函数之前），断言就失去意义了。
    const bodyStart = src.indexOf('function insertSelectedItem')
    const body = src.slice(bodyStart, src.indexOf('emit("resource-insert", item)', bodyStart))
    const insert = bodyStart + body.indexOf('buildResourceNode(nodeType, item)')
    expect(onPick).toBeGreaterThan(0)
    expect(insert).toBeGreaterThan(0)
    expect(onPick).toBeLessThan(insert)
  })

  it('执行命令后把用户打进去的 @关键词 删掉（真机症状：输入框里剩着「@压缩」）', () => {
    const bodyStart = src.indexOf('function insertSelectedItem')
    const body = src.slice(bodyStart)
    const branch = body.slice(body.indexOf('if (item.onPick)'), body.indexOf('buildResourceNode(nodeType, item)'))
    expect(branch).toContain('mentionQuery.value.length')
    expect(branch).toContain('tr.delete(')
    // 长度必须在**真正调用** hideMenu() 之前取（它会清掉 mentionQuery）。
    // 注意别匹配到注释里那处同名文字：锚上真实的调用缩进。
    expect(branch.indexOf('mentionQuery.value.length')).toBeLessThan(branch.indexOf('\n      hideMenu()'))
  })
})

