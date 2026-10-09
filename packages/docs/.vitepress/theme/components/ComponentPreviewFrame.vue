<script setup lang="ts">
import { ref } from 'vue'

/**
 * 整页预览台：用 iframe 把「已经在跑的应用/插件页」嵌进文档。
 *
 * 适合那些需要完整宿主才能跑的界面（比如画布本体）：
 * 内联 <ComponentPreview/> 要求组件能独立渲染；跑不起来的就用这个 iframe 版。
 *
 * 约定：src 指向一个可访问的地址，通常带上「打开哪个界面」的参数，例如
 *   src="/?plugin=showcase"        → 打开画布并聚焦 showcase 插件的界面
 *   src="http://localhost:5288/"   → 直接嵌本地起的应用
 */
withDefaults(
  defineProps<{
    src: string
    title?: string
    height?: number
  }>(),
  { height: 480 },
)

const nonce = ref(0)
const expanded = ref(false)
</script>

<template>
  <div class="mc-preview">
    <div class="mc-preview__bar">
      <span class="mc-preview__title">{{ title ?? '整页预览' }}</span>
      <span class="mc-code">{{ src }}</span>
      <span class="mc-preview__spacer" />
      <button class="mc-preview__btn" @click="nonce++">刷新</button>
      <a class="mc-preview__btn" :href="src" target="_blank" rel="noopener">新窗口打开</a>
      <button class="mc-preview__btn" @click="expanded = !expanded">
        {{ expanded ? '退出全屏' : '全屏' }}
      </button>
    </div>

    <ClientOnly>
      <div :class="['mc-preview__stage', { 'mc-preview__stage--fullscreen': expanded }]">
        <iframe
          :key="nonce"
          class="mc-preview__frame"
          :src="src"
          :style="{ height: (height ?? 480) + 'px' }"
          title="preview"
        />
      </div>
    </ClientOnly>
  </div>
</template>
