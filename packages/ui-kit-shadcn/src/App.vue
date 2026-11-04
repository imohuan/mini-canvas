<script setup lang="ts">
/**
 * ui-kit-shadcn 预览页。
 *
 * 这一页只做一件事：把 shadcn-vue 的组合件按真实用法摆出来，方便先看交互再决定
 * 哪些件注册进画布的 ui 目录。组件本身保持原样，没有在预览里再包一层"适配组件"。
 *
 * 组件统一从 @/previewKit 取：它只多套一层和真实应用相同的 withComponentConfig，
 * 这样顶部「组件配置」改尺寸/箭头/间距时，页面上的组件会真的跟着变。
 *
 * 布局（用户口径 2026-11-04）：顶部配置条 6 列；下方展厅 4 列。
 * 之前是左右两张大卡，卡片过宽，一件控件占半屏；现在拆成独立卡片并按列排。
 */
import { onBeforeUnmount, ref, watchEffect } from 'vue'
import { Badge } from '@/previewKit'
import ThemeConfigBar from '@/theme/ThemeConfigBar.vue'
import { useThemePreview, type PreviewThemeConfig } from '@/theme/useThemePreview'
import GenerationParamsCard from '@/preview/GenerationParamsCard.vue'
import MenusCard from '@/preview/MenusCard.vue'
import FormsCard from '@/preview/FormsCard.vue'
import FeedbackCard from '@/preview/FeedbackCard.vue'
import ComboboxCard from '@/preview/ComboboxCard.vue'
import CoverageCard from '@/preview/CoverageCard.vue'

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

// 浮层（下拉 / 弹窗 / Popover）会 Teleport 到 body，暗色变量必须挂在 <html> 上，
// 只挂在预览根节点上时这些浮层拿不到 .dark 的配色。
watchEffect(() => {
  document.documentElement.classList.toggle('dark', dark.value)
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('dark')
})

function note(text: string): void {
  // 展厅里的动作只需要一个可见反馈；具体交互各自在卡片内完成。
  console.info('[preview]', text)
}
</script>

<template>
  <!-- 暗色变量挂在 <html> 上（见脚本），预览根不需要再加上 .dark 类。 -->
  <div class="min-h-dvh bg-background text-foreground">
    <div class="mx-auto flex max-w-[1600px] flex-col gap-5 px-6 py-8">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <Badge variant="outline">shadcn-vue</Badge>
            <Badge variant="secondary">reka-ui</Badge>
          </div>
          <h1 class="text-2xl font-semibold tracking-tight">mini-canvas · shadcn UI 预览</h1>
          <p class="max-w-2xl text-sm text-muted-foreground">
            这些组件保持 shadcn-vue 的原始组合结构。下面所有下拉都走同一套组件配置，
            顶部改一项，页面上的触发器和浮层就跟着变。
          </p>
        </div>
      </header>

      <ThemeConfigBar v-model:config="themeConfig" v-model:dark="dark" />

      <!-- 展厅：桌面 4 列，每张卡片只占一格；中屏 2 列，窄屏 1 列 -->
      <div class="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GenerationParamsCard @action="note" />
        <MenusCard />
        <FormsCard />
        <FeedbackCard />
        <ComboboxCard />
        <CoverageCard />
      </div>
    </div>
  </div>
</template>
