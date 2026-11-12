<script setup lang="ts">
/**
 * 组件库展厅 —— 配置条 + 卡片墙。
 *
 * 由组件库自己的预览页（src/App.vue）渲染；主题变量只作用于这个预览页。
 */
import { onBeforeUnmount, ref, watchEffect } from 'vue'
import { Badge } from '../previewKit'
import { UiToaster } from '../components/notification'
import ThemeConfigBar from './ThemeConfigBar.vue'
import { useThemePreview, type PreviewThemeConfig } from './useThemePreview'
import GenerateCard from './cards/GenerateCard.vue'
import BasicsCard from './cards/BasicsCard.vue'
import TabsCard from './cards/TabsCard.vue'
import SelectCard from './cards/SelectCard.vue'
import FloatingCard from './cards/FloatingCard.vue'
import FeedbackCard from './cards/FeedbackCard.vue'

const dark = ref(true)
const themeConfig = ref<PreviewThemeConfig>({
  baseColor: 'neutral',
  theme: 'neutral',
  font: 'montserrat',
  heading: 'inherit',
  radius: 'large',
  size: 'default',
  arrowVisible: false,
  gap: 8,
  offset: 0,
  subGap: 8,
})

useThemePreview(themeConfig, dark)

// 浮层会 Teleport 到 body，暗色变量必须挂在 <html> 上。
watchEffect(() => {
  document.documentElement.classList.toggle('dark', dark.value)
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('dark')
})
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <!-- 一行标题，把版面让给卡片墙 -->
    <header class="flex flex-wrap items-center gap-2 px-4 pt-3">
      <Badge variant="outline">shadcn-vue</Badge>
      <Badge variant="secondary">reka-ui</Badge>
      <h2 class="text-base font-semibold tracking-tight">
        plume-canvas · shadcn UI 预览
      </h2>
      <span class="text-[11px] text-muted-foreground">
        顶部改一项，卡片里的组件立刻跟着变
      </span>
    </header>

    <!--
      吸顶配置栏：滚动看卡片时随时能改。
      只留一条细边，不抢卡片的视觉重心。
    -->
    <div class="sticky top-0 z-30 border-b border-border/60 bg-background/85 px-4 py-2 backdrop-blur">
      <ThemeConfigBar
        v-model:config="themeConfig"
        v-model:dark="dark"
      />
    </div>

    <!--
      卡片墙：三列各自的竖向堆叠。
      每列内部按内容高度自然排列，列与列之间不互相对齐（像 shadcn blocks 那样错落），
      同时不会出现「某一列整段空白」——CSS columns 会把短卡集中到第一列，这里改成显式分列。
    -->
    <div class="grid items-start gap-4 p-4 lg:grid-cols-3">
      <div class="flex flex-col gap-4">
        <SelectCard />
        <FeedbackCard />
      </div>
      <div class="flex flex-col gap-4">
        <GenerateCard />
      </div>
      <div class="flex flex-col gap-4">
        <BasicsCard />
        <TabsCard />
        <FloatingCard />
      </div>
    </div>

    <!-- 通知挂载点：Notify 案例（vue-sonner）需要有它才会出现 -->
    <UiToaster />
  </div>
</template>
