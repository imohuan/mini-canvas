/**
 * anyToolRunning / thinkingLive 必须真的挂在控制器返回值上（真机报错回归，2026-11-05）。
 *
 * 现象：浏览器控制台
 *   Uncaught (in promise) TypeError: $setup.anyToolRunning is not a function
 *     at AgentMessageList.vue:218
 * 这两个函数只在模板里用（组标题行的转圈/对勾、思考中自动展开），
 * 类型检查抓不到"控制器没导出"，只有真正挂载时才会炸。
 *
 * 为什么用源码校验：控制器 setup 里要 useCanvasRender()，node 环境没有画布上下文，
 * 挂不起来（实测直接调用会抛 "缺少渲染上下文"）。这与包内既有做法一致。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (name: string): string =>
  readFileSync(path.resolve(HERE, '../ui/conversation', name), 'utf8')
// 只读主控制器：readAgentConversationSource() 是把 11 个文件拼起来的，
// lastIndexOf('return {') 会落到最后一个文件上，解析不到主控制器的 return。
const controller = read('useAgentConversation.ts')
const views = read('useAgentMessageViews.ts')

/** 取控制器 return { ... } 里出现的名字 */
function returnedNames(source: string): Set<string> {
  const at = source.lastIndexOf('\n  return {')
  // 结束位置：下一个缩进为 2 的独立闭括号行（属性行是 4 个空格，不会误命中）
  const end = at < 0 ? -1 : source.indexOf('\n  }', at)
  const block = at < 0 || end < 0 ? '' : source.slice(at, end)
  const names = new Set<string>()
  for (const line of block.split('\n')) {
    const m = /^ {4}([A-Za-z_$][\w$]*),?$/.exec(line.trimEnd())
    if (m) names.add(m[1])
  }
  return names
}

describe('控制器暴露 anyToolRunning / thinkingLive', () => {
  for (const name of ['anyToolRunning', 'thinkingLive']) {
    it(name + ' 在视图层实现、从视图层导出、控制器再导出', () => {
      expect(views, name + ' 必须有实现').toContain('function ' + name)
      expect(views, name + ' 必须从视图层 return').toContain('\n  ' + name + ',')
      expect(controller, name + ' 必须从 useAgentMessageViews 解构').toContain('\n  ' + name + ',')
      expect(returnedNames(controller).has(name), name + ' 必须出现在控制器 return 里').toBe(true)
    })
  }

  it('anyToolRunning 的实现语义：有未完成工具才算运行中', () => {
    const at = views.indexOf('function anyToolRunning')
    expect(at).toBeGreaterThanOrEqual(0)
    const body = views.slice(at, at + 200)
    expect(body).toContain('settled')
    expect(body).toContain('.some(')
  })
})
