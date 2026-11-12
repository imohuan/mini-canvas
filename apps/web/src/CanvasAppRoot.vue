<script setup lang="ts">
/**
 * CanvasAppRoot —— 对外导出的成品画布应用。
 *
 * 画布工作台 App.vue 现在从根上下文取服务，不再自己建 Provider；
 * 独立使用 <CanvasApp/> 或 mountCanvasApp() 时，由这里补上同一个根 Provider。
 */
import CanvasWorkspace from './App.vue'
import AppProvider from './AppProvider.vue'
</script>

<template>
  <AppProvider>
    <CanvasWorkspace />
  </AppProvider>
</template>
