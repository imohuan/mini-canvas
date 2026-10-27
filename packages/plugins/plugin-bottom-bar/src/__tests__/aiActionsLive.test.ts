/**
 * 「保存 → 实时生效」的事件契约（用户口径 2026-10-27：保存后底栏要立即刷新，
 * 不能等重新触发下拉/重挂）。锁三件事：
 * 1. 事件名登记进 EventBus 白名单（dev 下 emit 不 warn）；
 * 2. 载荷形状：actions 数组（可空）+ 可选 baseUrl —— 底栏据此零延迟采用或重拉；
 * 3. normalizeAiActions 对载荷里的清单照常归一（坏项丢弃，不把底栏渲染炸掉）。
 */
import { describe, it, expect } from 'vitest'
import { hasKnownEvent } from '@mini-canvas/kernel'
import {
  AI_ACTIONS_CHANGED_EVENT,
  normalizeAiActions,
  DEFAULT_AI_ACTIONS,
} from '../aiActions'

describe('AI 按钮清单的实时生效事件', () => {
  it('事件名已登记进 EventBus 白名单（emit 不触发 dev warn）', () => {
    expect(AI_ACTIONS_CHANGED_EVENT).toBe('bottom-bar:ai-actions-changed')
    expect(hasKnownEvent(AI_ACTIONS_CHANGED_EVENT)).toBe(true)
  })

  it('载荷形状：带完整清单（可空数组）与可选 baseUrl', () => {
    const full: import('../aiActions').AiActionsChangedPayload = {
      actions: DEFAULT_AI_ACTIONS.map((a) => ({ ...a })),
      baseUrl: 'http://127.0.0.1:8865',
    }
    expect(Array.isArray(full.actions)).toBe(true)
    expect(full.actions).toHaveLength(2)
    const empty: import('../aiActions').AiActionsChangedPayload = { actions: [] }
    expect(empty.actions).toHaveLength(0)
    expect(empty.baseUrl).toBeUndefined()
  })

  it('底栏拿到广播清单后走同一份归一（坏项丢弃，渲染不炸）', () => {
    const pushed = [{ id: 'ok', name: '好按钮', template: 'T {{prompt}}' }, { id: '' }, 'junk']
    const list = normalizeAiActions(pushed)
    expect(list.map((a) => a.id)).toEqual(['ok'])
  })
})
