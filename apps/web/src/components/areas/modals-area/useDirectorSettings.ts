import { computed } from 'vue'
import { useUi } from '../../../composables/ui'
import { useAgentSettings } from '../../../composables/agentSettings'

/**
 * TV Director 全局设置的展示状态与写入口。
 *
 * 从 ModalsArea.vue 原样搬出。真源仍在 composables/agentSettings 与 ui.state，
 * 这里只做绑定与提交，不新增本地状态。
 */
export function useDirectorSettings() {
  const ui = useUi()
  const s = ui.state
  const agent = useAgentSettings()

  const SUBMIT_KEY_MODE_OPTIONS = [
    { value: 'ctrl-enter' as const, label: 'Ctrl + 回车', hint: '单独回车换行（默认）' },
    { value: 'shift-enter' as const, label: 'Shift + 回车', hint: '单独回车换行' },
    { value: 'enter' as const, label: '回车', hint: 'Shift + 回车换行' },
  ]

  const sendKeyLabel = computed(
    () => SUBMIT_KEY_MODE_OPTIONS.find((m) => m.value === agent.state.submitKeyMode)?.label ?? 'Ctrl + 回车',
  )

  /**
   * 目标默认预算输入框：改完（失焦 / 回车）归一化再落 KV，并把归一化结果写回输入框
   * （0 / 空 / 负数都收成 0 = 不限）。不用 v-model：默认预算的真源在后台，本地再绑一个变量就是第三份状态。
   */
  function agentBudgetOnChange(value: number | undefined): void {
    void agent.setGoalBudget(value === undefined ? '' : String(value))
  }

  return {
    ui,
    s,
    agent,
    SUBMIT_KEY_MODE_OPTIONS,
    sendKeyLabel,
    agentBudgetOnChange,
  }
}
