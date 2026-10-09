<script setup lang="ts">
/**
 * HotReloadManager —— 「热重载」分类的**整页容器**。
 *
 * 为什么要这层壳：设置面板渲染 `settingsGroup/<分类>` 时**只给组件本身**、不传任何业务 prop
 * （对齐 plugin-cursor-effect 的写法）。而 HotReloadPage 需要那个共享单例，所以这里负责
 * 把 `window.MiniCanvasHotReload` 取出来、当 prop 传下去。
 *
 * 这样 HotReloadPage 就完全是"纯展示 + 转发"，宿主也能在别处（插件管理页里嵌一小块）
 * 复用它 —— 组件可替换、数据在单例。
 */
import { onMounted, ref } from 'vue'
import HotReloadPage from './HotReloadPage.vue'
import type { HotReload } from '../data/hotReload'
import { HOT_RELOAD_WINDOW_KEY } from '../index'

const mgr = ref<HotReload | undefined>(
  (globalThis as unknown as Record<string, HotReload | undefined>)[HOT_RELOAD_WINDOW_KEY],
)

// 宿主可能在面板打开后才挂上（启动顺序不定）：打开时再取一次
onMounted(() => {
  if (!mgr.value) {
    mgr.value = (globalThis as unknown as Record<string, HotReload | undefined>)[HOT_RELOAD_WINDOW_KEY]
  }
})
</script>

<template>
  <HotReloadPage :manager="mgr" />
</template>

