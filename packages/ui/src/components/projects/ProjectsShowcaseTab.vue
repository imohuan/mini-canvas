<script setup lang="ts">
/**
 * 项目页「组件库」整页：用 iframe 内嵌组件库自己的预览站。
 *
 * 为什么不直接把 ComponentShowcase 组件塞进项目页（上一版的做法）：
 * 预览页的圆角 / 字体走的是它自己的一套变量（--radius / --font-body），
 * 而成品应用里组件库读的是主题桥写的 --mct-radius / --mct-font-body。
 * 两套变量叠在同一个 document 里，预览页写的那份被覆盖，改圆角、改字体毫无反应。
 * iframe 是独立 document，组件库用它自己的 CSS 与变量，改什么就是什么。
 *
 * 地址规则（与构建产物一致）：
 * - 线上 / cloud-server 托管：ui 产物里带 ui-kit/ 子目录，走同源 ./ui-kit/；
 * - ui 单独 dev：vite 把 /ui-kit 代理到组件库 dev server（5295）。
 * 可用 ?uiKit=/某地址 覆盖（嵌入其它宿主时用）。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 显式地址（缺省按运行环境推断） */
    src?: string
  }>(),
  { src: '' },
)

/** 组件库站点的入口地址（相对 ui 站点，末尾必须带 /）。 */
const url = computed(() => {
  if (props.src) return props.src
  if (typeof window === 'undefined') return './ui-kit/'
  const override = new URLSearchParams(window.location.search).get('uiKit')
  if (override) return override
  return new URL('ui-kit/', document.baseURI).href
})
</script>

<template>
  <div class="h-full min-h-0 w-full">
    <iframe
      :src="url"
      class="h-full w-full border-0 bg-background"
      title="组件库预览"
      loading="lazy"
      referrerpolicy="same-origin"
    />
  </div>
</template>
