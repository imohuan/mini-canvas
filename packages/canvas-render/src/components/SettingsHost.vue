<script setup lang="ts">
// SettingsHost —— 渲染层"可替换设置面板"宿主：**提供外壳** + 读 themeRegistry.winner('settingsPanel') 渲染当前赢家的**内容区**，
// 并把 ctx.settings(内核分组配置单一数据源) 实时喂给赢家组件。
//
// 职责切分（外壳归宿主，皮只管内容）：
// - 本宿主只提供**最外层 Dialog**：遮罩 / 居中 / 框 / 标题栏 / ✕ / Esc / 点遮罩关闭 / 关闭广播，
//   以及窗口级能力（浮动窗、拖拽、resize、悬浮球）。**不提供任何中间容器**。
// - 槽里的皮渲染**中间层**（左导航 + 右侧设置项都归它），声明 props.settings 即可，不必自己画窗口、也不必自己处理关闭。
// 这样"关闭"只有一份实现：皮的 ✕ 由外壳画，点遮罩/Esc 也由外壳统一处理 —— 历史缺陷（各皮自己实现、
// closeOnMask 默认值不一致导致点遮罩关不掉）从结构上不会再出现。
//
// 数据喂法 = 渲染时现取不注册快照：ctx.settings 是画布级恒在数据，现取保证实时；皮声明 props.settings 即可。
// settings 值的自刷新由皮自己负责（默认皮内部已订阅 onChange）：这里只读当前赢家 + 传稳定 settings 源，
// 不在每次配置变化时用 :key 重挂（否则输入框每按键即重挂丢焦点）。
// 只在 CanvasHost 渲染子树/宿主业务 UI 区内用（useCanvasRender 拿 ctx）；组件树外会抛清晰错误。
import { markRaw, onBeforeUnmount, ref } from 'vue'
import { useCanvasRender } from '../contracts/renderContext'
import type { SettingsPanelSource } from './settingsPanelTypes'
import { settingsSourceFrom } from './settingsSource'
import SettingsShell from './SettingsShell.vue'

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
// 运行期 theme occupant 替换（不经过插件装卸）也会改变赢家 → 直接订阅 themeRegistry。
const themeRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('themeRegistry')
if (themeRegistry && typeof themeRegistry.subscribe === 'function') {
  disposers.push({ dispose: themeRegistry.subscribe(reload) })
}
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})

/** 外壳的关闭动作统一从这里出去：广播内核事件，宿主收起面板（<SettingsHost v-if> 卸载本组件）。 */
function onShellClose(): void {
  ctx.emit('settings:ui-close')
}
</script>

<template>
  <!-- 有赢家：外壳包住赢家渲染的内容区；无赢家：显示空槽占位 -->
  <SettingsShell v-if="winner" @close="onShellClose">
    <component :is="winner" :settings="source" />
  </SettingsShell>
  <div v-else-if="emptyHint" class="sh-empty">{{ emptyHint }}</div>
</template>

<style scoped>
.sh-empty {
  color: var(--ui-ink-mute, #9ca3af);
  font-size: 12px;
  padding: 8px;
}
</style>
