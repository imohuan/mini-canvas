<script setup lang="ts">
// Root —— 应用根：路由出口 + 全应用唯一的通知宿主。
//
// 为什么不让 main.ts 直接挂 App.vue：App.vue 现在是**画布工作台**（路由 /canvas/:id 的组件，
// 也是对外导出的 CanvasApp）。根组件要按路由切换到「项目页 / 画布工作台」，所以单独一个 Root。
import { RouterView, useRoute } from 'vue-router'
import { useUiComponentOutside } from './composables/ui'

// 项目页和画布页都在这棵树下：Toaster 只在这里挂一次，两个路由共用。
const Toaster = useUiComponentOutside('Toaster')

// 用 fullPath 当 key：切画布（#/canvas/A → #/canvas/B）时**重新挂载**路由组件。
// 为什么必须：画布那个 CanvasHost 在插件 apply 时按当时的 `?canvas=` / hash 读出画布 id，
// 不重新挂载的话切了画布还是老那份数据（同一个路由、组件被复用）。重新挂载 = 干净的重新装载。
const route = useRoute()
</script>

<template>
  <RouterView :key="route.fullPath" />
  <component :is="Toaster" v-if="Toaster" position="bottom-right" close-button-position="top-right" />
</template>
