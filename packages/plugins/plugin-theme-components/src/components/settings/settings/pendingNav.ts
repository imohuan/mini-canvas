/**
 * pendingNav —— 「设置面板打开时选中哪个导航」的一次性传递（用户口径 2026-11-23）。
 *
 * 场景：更新通知点「去更新」→ 应用壳打开设置面板并跳到插件页。
 * 面板是 v-if 挂载的：事件可能在面板挂载前发出，挂载的组件读不到；
 * 所以在这里暂存，面板挂载时消费一次。
 */
import { ref } from 'vue'

const pending = ref<string>('')

export function setPendingNav(key: string): void {
  pending.value = key
}

export function takePendingNav(): string {
  const v = pending.value
  pending.value = ''
  return v
}
