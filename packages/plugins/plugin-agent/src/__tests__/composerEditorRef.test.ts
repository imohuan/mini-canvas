/**
 * 输入框插入标签的接线守卫。
 *
 * 真机问题（2026-11-03）：AgentComposer 模板里写着 `ref="editorRef"`，但脚本没有
 * 从控制器解构 `editorRef`，于是模板 ref 落在组件自己的空引用上，控制器始终看不到
 * 编辑器实例；点技能 / MCP「确认引用」都静默不插入。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const composer = readSfcWithStyles(path.resolve(HERE, '../components/agent-conversation/AgentComposer.vue'))
const controller = readFileSync(path.resolve(HERE, '../components/agent-conversation/useAgentConversation.ts'), 'utf8')

describe('AgentComposer 编辑器 ref 接线', () => {
  it('模板 ref 指向控制器暴露的 editorRef', () => {
    expect(composer).toMatch(/<ProseMirrorEditor[^>]*ref="editorRef"/)
    expect(composer).toMatch(/\bprompt,\s*editorRef,/)
  })

  it('控制器确实返回 editorRef，供技能 / MCP 插入标签', () => {
    expect(controller).toMatch(/\n\s+editorRef,/)
    expect(controller).toContain('useAgentMcpPanel(agent, s, editorRef)')
    expect(controller).toContain('useAgentResources(agent, s, { ctx, editorRef, prompt, ICON_COMPACT })')
  })
})
