/**
 * 错误提醒 / 终端输出 = AI Elements 的 Terminal + Stack Trace（用户口径 2026-11-07）。
 *
 * 文档结构（shadcn-vue: ai-elements/terminal、ai-elements/stack-trace）：
 *   Terminal: Trace > TraceCollapsible > Trigger(TraceLine + TraceIcon(Terminal) + TraceTitle)
 *             > Content > CodeBlock(size=sm) > CodeBlockContent(wrap, max-h-64)
 *   Stack Trace: 同一套 Trace 行，status="error"、标题「Failed: <错误>」，
 *             内容 = bg-muted 的等宽块，node_modules 的帧淡化。
 * 这里在源码层钉住这两处接线，避免有人把它们改回自绘的红字。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

describe('Terminal（命令执行）', () => {
  const t = read('../ui/conversation/AgentTerminal.vue')

  it('用 Trace + TraceCollapsible + Terminal 图标 + 标题', () => {
    expect(t).toContain('TraceCollapsibleTrigger')
    expect(t).toContain('TerminalIcon')
    expect(t).toContain('TraceTitle')
  })

  it('标题是 Ran / Running / exited with code（文档 Exit Code 表）', () => {
    expect(t).toContain("'Running ' + command")
    expect(t).toContain("'Ran ' + command")
    expect(t).toContain('exited with code')
  })

  it('输出在 CodeBlock(size=sm) + CodeBlockContent(wrap, max-h-64) 里', () => {
    expect(t).toContain('<CodeBlock size="sm">')
    expect(t).toContain('wrap')
    expect(t).toContain('max-h-64')
  })
})

describe('Stack Trace（工具失败 / 回合错误）', () => {
  const s = read('../ui/conversation/AgentStackTrace.vue')
  const list = read('../ui/conversation/AgentMessageList.vue')

  it('触发行 status="error"，标题「Failed: <错误>」', () => {
    expect(s).toContain('<TraceLine status="error">')
    // 标题改成三段式：认不出层的错误仍回落成「Failed: <错误>」
    expect(s).toContain("'Failed: ' + error")
    expect(s).toContain('diagnoseError')
    expect(s).toContain("d.status !== undefined ? ' · HTTP ' + d.status : ''")
    expect(s).toContain('CircleX')
  })

  it('展开区第一行先写「哪一层 + 捕获位置」，再是原文', () => {
    expect(s).toContain('placeLine')
    expect(s).toContain('layerLabel')
    expect(s).toContain('位置：')
  })

  it('内容顶部重复完整错误（标题会截断）', () => {
    expect(s).toContain('text-destructive')
    expect(s).toContain('{{ full }}')
  })

  it('帧列表里 node_modules 的帧淡化', () => {
    expect(s).toContain("frame.includes('node_modules')")
  })

  it('消息流：命令走 Terminal，失败走 Stack Trace，回合错误条也用它', () => {
    expect(list).toContain('<AgentTerminal')
    expect(list).toContain('<AgentStackTrace')
    expect(list).toContain("failureOf(row.tools[0]).failed")
    expect(list).toContain('parseError(s.lastError)')
  })
})
