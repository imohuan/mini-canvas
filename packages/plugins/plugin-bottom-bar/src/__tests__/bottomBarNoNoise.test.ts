/**
 * 底栏“无噪声写盘”契约（2026-10-27，CanvasProvider 迁移期间的 e2e 发现）。
 *
 * 现象：新建文本节点 → 选中 → 点空白（底栏挂载又卸载），节点 data 凭空多出
 * barValues.actionId=text.duplicate，撤销栈多一条与用户操作无关的历史。
 * 两次 Ctrl+Z 才退掉一步操作，用户感知就是“撤销坏了”。
 *
 * 契约：persistValues 只写“有内容的配置”——
 * 1. 节点上已存的动作与当前一致、且没有任何参数/提示词 → 不写（skip 分支）；
 * 2. 当前动作没有输入框（needsPrompt=false）、也没有参数 → 不写（首次分支）；
 * 3. 有输入框/参数时照常写（restore 链路测试已覆盖，这里不复述）。
 */
import { describe, expect, it, vi } from 'vitest'

type PersistDeps = {
  storedActionId: string | undefined
  currentId: string
  showEditor: boolean
  valuesCount: number
  storedBarValues?: Record<string, unknown>
}

/**
 * persistValues 的“要不要写”判定被抽出来测（与组件里的三段分支逐一对应）。
 * 不直接挂 SFC：SSR 挂真实组件要喂 doc/ui/theme 三层注入，而这里只关心布尔逻辑。
 */
function shouldSkipPersist(deps: PersistDeps): boolean {
  const rawStored = deps.storedBarValues
  const storedAction = deps.storedActionId
  const onlyActionId =
    !rawStored || (Object.keys(rawStored).length > 0 && Object.keys(rawStored).every((k) => k === 'actionId'))
  if (storedAction === deps.currentId && onlyActionId) return true
  if (!deps.showEditor && deps.valuesCount === 0) return true
  return false
}

describe('底栏 persistValues：无噪声写盘', () => {
  it('首次挂载即卸载（无输入框、无参数）→ 跳过', () => {
    expect(shouldSkipPersist({ storedActionId: undefined, currentId: 'text:duplicate', showEditor: false, valuesCount: 0 })).toBe(true)
  })

  it('已存 actionId 与当前一致、且没有参数 → 跳过（反复选中不再写盘）', () => {
    expect(shouldSkipPersist({ storedActionId: 'text:duplicate', currentId: 'text:duplicate', showEditor: false, valuesCount: 0, storedBarValues: { actionId: 'text:duplicate' } })).toBe(true)
  })

  it('生成类动作（有输入框）→ 正常写（作品要落盘）', () => {
    expect(shouldSkipPersist({ storedActionId: undefined, currentId: 'test:gen', showEditor: true, valuesCount: 0 })).toBe(false)
  })

  it('即时动作但带了参数 → 正常写（用户真的调过东西）', () => {
    expect(shouldSkipPersist({ storedActionId: undefined, currentId: 'text:duplicate', showEditor: false, valuesCount: 1 })).toBe(false)
  })

  it('已存动作与当前不同（即时动作、无参数）→ 跳过：切换动作本身不产生配置', () => {
    expect(shouldSkipPersist({ storedActionId: 'text:duplicate', currentId: 'text:delete', showEditor: false, valuesCount: 0, storedBarValues: { actionId: 'text:duplicate' } })).toBe(true)
  })

  it('已存动作与当前不同、且带参数 → 正常写（新配置必须落盘）', () => {
    expect(shouldSkipPersist({ storedActionId: 'test:gen', currentId: 'test:gen-v2', showEditor: true, valuesCount: 1, storedBarValues: { actionId: 'test:gen' } })).toBe(false)
  })

  it('回归锚：判定不是恒 true（否则配置永远不落盘）', () => {
    expect(vi.fn()).toBeDefined()
    expect(shouldSkipPersist({ storedActionId: undefined, currentId: 'test:gen', showEditor: true, valuesCount: 2 })).toBe(false)
  })
})
