<script setup lang="ts">
/**
 * 组件库展厅 —— 配置条 + 卡片墙。
 *
 * 两处共用同一份代码：
 * - 组件库自己的预览页（src/App.vue）：可以改颜色 / 暗色，验证「配置真的生效」；
 * - 成品应用「项目 → 组件库」页：只保留会作用到真实界面的项（尺寸 / 圆角 / 字体 / 浮层间距），
 *   颜色和暗色交给应用自己的主题设置，避免在这里改一套、回到画布又变回去。
 *
 * 默认（不传 embedded）就是预览页的完整行为。
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

const props = withDefaults(
  defineProps<{
    /** 嵌进成品应用：不接管全站暗色，也不写预览专用的颜色变量。 */
    embedded?: boolean
  }>(),
  { embedded: false },
)

const dark = ref(!props.embedded)
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

useThemePreview(themeConfig, dark, { embedded: props.embedded })

// 预览页自己管暗色；嵌进应用时暗色由应用的设置面板决定，这里不能抢。
if (!props.embedded) {
  watchEffect(() => {
    document.documentElement.classList.toggle('dark', dark.value)
  })
  onBeforeUnmount(() => {
    document.documentElement.classList.remove('dark')
  })
}
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <!-- 一行标题，把版面让给卡片墙 -->
    <header class="flex flex-wrap items-center gap-2 px-4 pt-3">
      <Badge v-if="!embedded" variant="outline">shadcn-vue</Badge>
      <Badge v-if="!embedded" variant="secondary">reka-ui</Badge>
      <h2 class="text-base font-semibold tracking-tight">
        {{ embedded ? '组件预览' : 'mini-canvas · shadcn UI 预览' }}
      </h2>
      <span class="text-[11px] text-muted-foreground">
        {{ embedded ? '这里看到的就是画布里真实使用的组件与外观' : '顶部改一项，卡片里的组件立刻跟着变' }}
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
        :show-colors="!embedded"
        :show-dark="!embedded"
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

    <!-- 通知挂载点：Notify 案例（vue-sonner）需要有它才会出现；应用里已有全局 Toaster。 -->
    <UiToaster v-if="!embedded" />
  </div>
</template>
