/**
 * 拆分后的 scoped 样式归属。
 *
 * 拆 AgentConversation 时，消息流的空态 / 模型分割线 / 提示样式被留在了输入组件的
 * `<style scoped>` 里。scoped 不会跨兄弟组件，那些规则对消息流节点完全不生效：
 * 空态渐变球、模型分割线、用户文本换行、停止与错误提示全都掉样式。
 * 这里按「模板用到的类名 → 同一组件样式里有定义」检查，不依赖具体数值。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSfcWithStyles } from './readSfcWithStyles'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (name: string): string =>
  readSfcWithStyles(path.resolve(HERE, '../components/agent-conversation', name))

/** 只扫消息流真正拥有的类名（输入区的另行检查） */
const MESSAGE_LIST_OWNED = [
  'ac-earlier', 'ac-earlier-loading', 'ac-earlier-hint',
  'ac-welcome', 'ac-welcome-orb', 'ac-welcome-title',
  'ac-model-split', 'ac-model-split-line', 'ac-model-split-badge', 'ac-model-split-name',
  'ac-user-text', 'ac-editing-badge', 'ac-stopped', 'ac-notice', 'ac-error',
]

describe('Agent 拆分的 scoped 样式归属', () => {
  const messageList = read('AgentMessageList.vue')
  const composer = read('AgentComposer.vue')

  it('消息流用到的类名必须在自己的 scoped 样式里有定义', () => {
    const missing = MESSAGE_LIST_OWNED.filter((cls) => !new RegExp('\\.' + cls + '\\b').test(messageList))
    expect(missing, '这些类名在 AgentMessageList 的模板里用到，但样式不在本组件').toEqual([])
  })

  it('输入组件不再重复定义消息流专属样式（避免以后改错一处）', () => {
    const duplicated = ['ac-earlier', 'ac-welcome', 'ac-model-split', 'ac-user-text', 'ac-stopped', 'ac-notice']
      .filter((cls) => new RegExp('^\\.' + cls + '\\b', 'm').test(composer))
    expect(duplicated, '这些规则只服务消息流，留在 AgentComposer 不会生效').toEqual([])
  })

  it('输入组件自己用到的 ac-editing-badge.is-compact 有完整基础样式', () => {
    expect(composer).toMatch(/^\.ac-editing-badge \{/m)
    expect(composer).toMatch(/^\.ac-editing-badge\.is-compact \{/m)
  })
})
