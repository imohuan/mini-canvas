<script setup lang="ts">
/**
 * ui-kit-shadcn 预览页 —— 一面卡片墙。
 *
 * 结构（用户口径 2026-11-04）：
 *  1. 顶部一条吸顶的配置栏，改哪一项立刻作用到下面的所有卡片；
 *  2. 下面是一条瀑布式卡片墙，每张卡片只讲一类组件，高度随内容自由错落，
 *     没有一张卡片横跨整行、也没有「卡片里再套一堆小卡片」的盒子套盒子。
 *
 * 组件统一从 `@/previewKit` 取：它多套一层与真实应用相同的 `withComponentConfig`，
 * 所以顶部改尺寸 / 箭头 / 间距时，卡片里的组件会真的跟着变。
 */
import { onBeforeUnmount, ref, watchEffect } from 'vue'
import { Badge } from '@/previewKit'
import { UiToaster } from '@/components/notification'
import ThemeConfigBar from '@/theme/ThemeConfigBar.vue'
import { useThemePreview, type PreviewThemeConfig } from '@/theme/useThemePreview'
import GenerateCard from '@/theme/cards/GenerateCard.vue'
import BasicsCard from '@/theme/cards/BasicsCard.vue'
import TabsCard from '@/theme/cards/TabsCard.vue'
import SelectCard from '@/theme/cards/SelectCard.vue'
import FloatingCard from '@/theme/cards/FloatingCard.vue'
import FeedbackCard from '@/theme/cards/FeedbackCard.vue'

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
  <!-- 暗色变量挂在 <html> 上（见脚本），根节点不需要再加 .dark -->
  <div class="min-h-dvh bg-background text-foreground">
    <!-- 一行标题，把版面让给卡片墙 -->
    <header class="flex flex-wrap items-center gap-2 px-4 pt-3">
      <Badge variant="outline">shadcn-vue</Badge>
      <Badge variant="secondary">reka-ui</Badge>
      <h1 class="text-base font-semibold tracking-tight">mini-canvas · shadcn UI 预览</h1>
      <span class="text-[11px] text-muted-foreground">顶部改一项，卡片里的组件立刻跟着变</span>
    </header>

    <!--
      吸顶配置栏：滚动看卡片时随时能改。
      只留一条细边，不抢卡片的视觉重心。
    -->
    <div class="sticky top-0 z-30 border-b border-border/60 bg-background/85 px-4 py-2 backdrop-blur">
      <ThemeConfigBar v-model:config="themeConfig" v-model:dark="dark" />
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
