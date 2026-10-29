<script setup lang="ts">
/**
 * 组件库路由壳：展示页本身住在 @mini-canvas/ui-kit/preview，
 * 这里只负责把「返回首页」接到本应用的 router，避免 ui-kit 依赖 vue-router。
 */
import { useRouter } from 'vue-router'
import { uiKitPreviewRoute } from '@mini-canvas/ui-kit/preview'

const router = useRouter()
const UiKitPreview = uiKitPreviewRoute.component
</script>

<template>
  <UiKitPreview show-home @home="router.push('/')" />
</template>
