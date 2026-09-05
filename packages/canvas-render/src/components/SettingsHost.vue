<script setup lang="ts">
// SettingsHost —— 渲染层"可替换设置面板"宿主：读 themeRegistry.winner('settingsPanel') 渲染当前赢家设置 UI，
// 并把 ctx.settings(内核分组配置单一数据源) 实时喂给赢家组件。
//
// 解决的问题（settings-panel-slot-host-plan §三.A）：
// - 过去设置面板在 demo 里硬写 `<PluginSettingsPanel :settings="settingsStore"/>`，从没注册成槽 → 无法运行时替换。
// - 本组件把设置面板做成"可替换皮"(theme 单赢家槽 settingsPanel)：插件 ctx.theme.register('settingsPanel', 组件, {order})
//   顶替默认；宿主一行 `<SettingsHost/>` 即渲染当前赢家。默认皮由 theme-default 注册(见其 src/settings.ts)。
// - 数据喂法 = 渲染时现取不注册快照：ctx.settings 是画布级恒在数据，现取保证实时；默认/替换面板声明 props.settings 即可。
//
// 职责边界（只管"读赢家 + 喂 settings"）：
// - 不做定位/容器样式/展开收起——那是宿主放本组件处(如设置 dock)的布局职责。
// - settings 值的自刷新由面板组件自己负责(PluginSettingsPanel 内部已订阅 onChange)：这里只读当前赢家 + 传稳定 settings 源，
//   不在每次配置变化时用 :key 重挂面板(否则输入框每按键即重挂丢焦点)。
// - 只在 CanvasHost 渲染子树/宿主业务 UI 区内用（useCanvasRender 拿 ctx）；组件树外会抛清晰错误。
import { markRaw, onBeforeUnmount, ref } from 'vue'
import { useCanvasRender } from '../contracts/renderContext'
import type { SettingsPanelSource } from './settingsPanelTypes'
import { settingsSourceFrom } from './settingsSource'

const props = defineProps<{
  /** 空槽(没插件注册设置面板)时是否显示"无设置面板"占位；默认 false=空 */
  emptyHint?: string
}>()

const { ctx } = useCanvasRender()

// —— settings 数据源：渲染时现取 ctx.get('settings') 适配成面板消费的最小接口，稳定引用传给赢家 ——
const source: SettingsPanelSource = settingsSourceFrom(ctx)

// —— 当前赢家组件：读 themeRegistry.winner('settingsPanel')，插件装卸时整体替换以触发 Vue 更新 ——
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const winner = ref<any>(undefined)

function reload(): void {
  const theme = ctx.get<{ winner(slot: string): unknown }>('themeRegistry')
  const w = theme?.winner('settingsPanel')
  winner.value = w ? markRaw(w as object) : undefined
}

reload() // 初始读一次

// 插件热装/热卸会改某槽的赢家 → 订阅内核事件重读（与 SlotHost 同事件源）。
const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on('ctx:plugin-installed', reload),
  ctx.on('ctx:plugin-uninstalled', reload),
)
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})
</script>

<template>
  <!-- 无赢家：显示空槽占位(宿主可自定义文案)；有赢家则把 settings 喂给它渲染（自刷新由面板负责） -->
  <component v-if="winner" :is="winner" :settings="source" />
  <div v-else-if="emptyHint" class="sh-empty">{{ emptyHint }}</div>
</template>

<style scoped>
.sh-empty {
  color: #9ca3af;
  font-size: 12px;
  padding: 8px;
}
</style>
