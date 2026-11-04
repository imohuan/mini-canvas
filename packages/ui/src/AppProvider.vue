<script setup lang="ts">
/**
 * AppProvider —— ui-shell 的根级 Provider（过渡实现）。
 *
 * 这一步先把唯一的 Provider 提到 RouterView 外面，让项目页和画布页长在同一棵树里。
 * 当前内部仍复用 CanvasProvider：它会在挂载时启动画布宿主。下一步把画布服务拆到
 * mountCanvas / unmountCanvas 后，这里只创建应用级 Context，不再在项目页启动画布。
 *
 * 为什么单独抽一个组件：Root.vue 负责页面出口，独立 CanvasApp 入口也需要同一套 Provider。
 * 两边共用这里，插件清单、存储适配器和 window 调试句柄只写一份。
 */
import { CanvasProvider } from '@mini-canvas/canvas-render'
import { createDefaultStorageAdapter, resolveAppPlugins, seedDefaultCanvas } from './assembly'

const plugins = resolveAppPlugins()
const adapter = createDefaultStorageAdapter()
const DEV = import.meta.env.DEV
</script>

<template>
  <CanvasProvider
    :plugins="plugins"
    :adapter="adapter"
    :seed="seedDefaultCanvas"
    :dev="DEV"
    window-key="MiniCanvasUI"
  >
    <slot />
  </CanvasProvider>
</template>
