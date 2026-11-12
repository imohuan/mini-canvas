/**
 * naming —— 全仓统一 id 规范的单测。
 *
 * 规则：插件名小写短横线；命令/事件 插件名:动作；槽条目 owner/name；槽名点分层。
 */
import { describe, expect, it } from 'vitest'
import {
  isPluginName,
  isQualifiedId,
  isSlotItemId,
  isSlotName,
  ownerOfSlotItem,
  warnIfBadId,
} from '../naming'

describe('isPluginName', () => {
  it('小写短横线合规，plugin- 前缀不合规', () => {
    for (const ok of ['agent', 'node-image', 'theme-default', '3d-preview']) {
      expect(isPluginName(ok), ok).toBe(true)
    }
    for (const bad of ['plugin-agent', 'Agent', 'node_image', 'agent:open', '']) {
      expect(isPluginName(bad), bad).toBe(false)
    }
  })

  it('plugin-manager 是既有例外（服务名/存储 key 已绑定）', () => {
    expect(isPluginName('plugin-manager')).toBe(true)
  })
})

describe('isQualifiedId（命令 / 事件）', () => {
  it('插件名:动作 合规；点号 / 斜杠 / 多冒号不合规', () => {
    for (const ok of ['agent:open', 'node-image:upload', 'video:crop-confirm', 'node-image:crop.confirm']) {
      expect(isQualifiedId(ok), ok).toBe(true)
    }
    for (const bad of ['audio.upload', 'ui/context', 'agent', 'agent:Open', 'a:b:c', 'plugin-agent:open']) {
      expect(isQualifiedId(bad), bad).toBe(false)
    }
  })
})

describe('isSlotItemId（槽条目）', () => {
  it('owner/name 合规；owner 是插件名或 host', () => {
    for (const ok of ['host/agent', 'agent/nav', 'node-image/preview', 'host/settings-节点']) {
      expect(isSlotItemId(ok), ok).toBe(true)
    }
    for (const bad of ['agent-conversation', 'plugin-agent/nav', 'host', 'host/a/b', 'host/a b', 'host/host']) {
      expect(isSlotItemId(bad), bad).toBe(false)
    }
  })

  it('ownerOfSlotItem 取 owner；不合规返回 undefined', () => {
    expect(ownerOfSlotItem('host/agent')).toBe('host')
    expect(ownerOfSlotItem('agent/nav')).toBe('agent')
    expect(ownerOfSlotItem('bad')).toBeUndefined()
  })
})

describe('isSlotName', () => {
  it('点分层合规；旧的下划线 / 驼峰 / 斜杠不合规', () => {
    for (const ok of ['shell.dock', 'shell.status', 'shell.drawer.tabs', 'settings.nav', 'overlay', 'mini-map']) {
      expect(isSlotName(ok), ok).toBe(true)
    }
    for (const bad of ['settingsNav', 'settingsGroup/Agent', 'shell dock', '']) {
      expect(isSlotName(bad), bad).toBe(false)
    }
  })
})

describe('warnIfBadId', () => {
  it('合规返回 true 且不 warn；不合规 warn 一次后去重', () => {
    const warns: string[] = []
    const original = console.warn
    console.warn = (msg: string) => { warns.push(String(msg)) }
    try {
      const seen = new Set<string>()
      expect(warnIfBadId('command', 'agent:open', seen)).toBe(true)
      expect(warnIfBadId('command', 'audio.upload', seen)).toBe(false)
      expect(warnIfBadId('command', 'audio.upload', seen)).toBe(false)
      expect(warns).toHaveLength(1)
      expect(warns[0]).toContain('audio.upload')
    } finally {
      console.warn = original
    }
  })
})
