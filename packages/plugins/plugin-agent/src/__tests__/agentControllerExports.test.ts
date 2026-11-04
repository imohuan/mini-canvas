/**
 * 控制器返回值的完整性守卫（2026-11-03 拆分后发现）。
 *
 * 背景：useAgentConversation 把状态拆到 10 个 composable 后，模板仍在解构
 * \`segClickable\`，但主文件把它从 import 里删了、返回值也没导出 ——
 * 类型检查通不过是不可能的（模板里是动态注入），运行时直接
 * "segClickable is not a function"，整块消息流渲染失败。
 *
 * 这里按「子组件解构的每个名字，控制器返回对象里必须有」做检查，
 * 把这类拆分漏接线挡在提交前。只查两个子组件真正会用的控制器成员。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '../ui/conversation')
const read = (name: string): string => readFileSync(path.join(DIR, name), 'utf8')

/** 从 "const {...} = c" / "const {...} = cProps" 里取出解构的名字 */
function destructuredNames(source: string): string[] {
  const m = /const \{([\s\S]*?)\} = c(?:Props)?\b/.exec(source)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim().split(':')[0].trim())
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
}

/** 取控制器 return { ... } 里出现的名字（按行首两项缩进识别） */
function returnedNames(source: string): Set<string> {
  const at = source.lastIndexOf('\n  return {')
  const end = at < 0 ? -1 : source.indexOf('\n  }', at)
  const block = at < 0 || end < 0 ? '' : source.slice(at, end)
  const names = new Set<string>()
  for (const line of block.split('\n')) {
    const m = /^ {4}([A-Za-z_$][\w$]*),?$/.exec(line.trimEnd())
    if (m) names.add(m[1])
  }
  return names
}

describe('控制器返回值覆盖子组件的解构', () => {
  const controller = read('useAgentConversation.ts')
  const returned = returnedNames(controller)

  for (const file of ['AgentComposer.vue', 'AgentMessageList.vue']) {
    it(file + ' 解构到的成员都能在控制器返回值里找到', () => {
      const wanted = destructuredNames(read(file))
      expect(wanted.length, '没解析到解构列表').toBeGreaterThan(10)
      const missing = wanted.filter((n) => !returned.has(n))
      expect(missing, '这些名字子组件在用，但控制器没返回').toEqual([])
    })
  }
})

