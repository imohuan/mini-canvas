<script setup lang="ts">
/**
 * BottomBarHost —— 底栏宿主：读 themeRegistry.winner('bottomBar') 渲染当前赢家。
 *
 * 只负责「按赢家渲染」——判空留给皮（NodeBottomBar 无动作时自己返回空）。
 * 写法照 canvas-render 的 SettingsHost.vue：初始读一次，订阅热装卸与主题槽变化重读。
 * 组件拿到的是根 ctx（没有服务代理），所以这里一律 ctx.get(...)，不直访 ctx.xxx（计划 §0.1）。
 */
import { markRaw, onBeforeUnmount, ref } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

// —— 当前赢家组件：读 themeRegistry.winner('bottomBar')，插件装卸时整体替换以触发 Vue 更新 ——
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const winner = ref<any>(undefined)

function reload(): void {
  const theme = ctx.get<{ winner(slot: string): unknown }>('themeRegistry')
  const w = theme?.winner('bottomBar')
  winner.value = w ? markRaw(w as object) : undefined
}

reload() // 初始读一次

const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on('ctx:plugin-installed', reload),
  ctx.on('ctx:plugin-uninstalled', reload),
)
const themeRegistry = ctx.get<{ subscribe(cb: () => void): { dispose(): void } } | undefined>('themeRegistry')
if (themeRegistry && typeof themeRegistry.subscribe === 'function') {
  disposers.push(themeRegistry.subscribe(reload))
}
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})
</script>

<template>
  <component :is="winner" :id="props.id" :data="props.data" />
</template>

