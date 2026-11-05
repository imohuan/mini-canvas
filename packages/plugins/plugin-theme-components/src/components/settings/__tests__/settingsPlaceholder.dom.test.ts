// @vitest-environment happy-dom
/**
 * 设置里的文本输入框必须把 schema.placeholder 渲染出来。
 *
 * 用户实测 2026-11-05 截图「常规 → 上游接口 → 上游资源接口」：控件是空的，
 * 上方只有说明文字，看不出来这里该填什么。说明文字不能代替输入框里的提示，
 * 所以这里钉「真的渲染到了 input 的 placeholder 属性上」，而不是只看 schema 有没有字段。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import type { SettingEntry, SettingsPanelSource } from '@mini-canvas/canvas-render'
import SettingsSchemaField from '../SettingsSchemaField.vue'

function settingsWith(entry: SettingEntry): SettingsPanelSource {
  return {
    groups: () => [entry.group],
    groupOf: () => [entry],
    set: () => true,
    onChange: () => ({ dispose() {} }),
  }
}

let app: App | undefined

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})

describe('设置输入框的 placeholder', () => {
  it('★ 文本字段空值时输入框显示 schema.placeholder', async () => {
    const entry: SettingEntry = {
      group: '常规/上游接口',
      key: 'preview3dUpstreamApi',
      schema: {
        type: 'text',
        default: '',
        label: '上游资源接口',
        placeholder: 'https://example.com/api/upstream?canvasId={canvasId}&nodeId={nodeId}',
      },
      value: '',
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({ render: () => h(SettingsSchemaField, { group: entry.group, fieldKey: entry.key, settings: settingsWith(entry) }) })
    app.mount(host)
    await nextTick()

    const input = host.querySelector('input')
    expect(input, '文本字段没有渲染出输入框').toBeTruthy()
    expect(input!.getAttribute('placeholder')).toBe(entry.schema.placeholder)
  })

  it('没声明 placeholder 的字段保持未设（不拿 label 冒充）', async () => {
    const entry: SettingEntry = {
      group: 'g', key: 'plain', schema: { type: 'text', default: '', label: '普通字段' }, value: '',
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({ render: () => h(SettingsSchemaField, { group: entry.group, fieldKey: entry.key, settings: settingsWith(entry) }) })
    app.mount(host)
    await nextTick()
    expect(host.querySelector('input')!.hasAttribute('placeholder')).toBe(false)
  })
})
