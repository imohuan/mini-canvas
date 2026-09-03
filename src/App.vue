<script setup lang="ts">
import { AxToaster } from '@mini-canvas/canvas-core/components/Ui'
</script>

<template>
  <!-- 全局 toast 宿主：所有路由/视图（Canvas、ui-test、mcp…）统一经由 Ui/notify 弹出 AxToast -->
  <AxToaster />
  <router-view />
</template>
