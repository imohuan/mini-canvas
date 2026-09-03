<script setup lang="ts">
/**
 * AxToaster —— vue-sonner <Toaster /> 的薄封装宿主。
 *
 * 全局 notify 的展示宿主：在应用根（如 App.vue）渲染一次即可，
 * 供所有路由/视图（Canvas、ui-test、mcp 等）经由 Ui/notify.ts 弹出的 AxToast 统一展示。
 * 这里收敛对 vue-sonner 的依赖与样式引入，调用方（外层应用）无需直接依赖 vue-sonner。
 */
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'

// 位置等偏好集中在此配置（bottom-center + toast 右上角关闭按钮）
</script>

<template>
  <Toaster :position="'bottom-center'" closeButtonPosition="top-right" />
</template>
