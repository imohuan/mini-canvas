<script setup lang="ts">
/**
 * UiToaster —— 应用唯一的 sonner 通知挂载点。
 *
 * 默认主题把它登记到 ui 目录的 `Toaster`，宿主只从目录取一次并挂到路由外。
 * 业务代码不要直接 import `vue-sonner` 或再挂一个 Toaster：所有通知统一走 ctx 的
 * `notify` 服务，视觉与位置才会全项目一致。
 */
import { Toaster, type ToasterProps } from 'vue-sonner'
import 'vue-sonner/style.css'

withDefaults(defineProps<ToasterProps>(), {
  position: 'bottom-right',
  closeButtonPosition: 'top-right',
})
</script>

<template>
  <Toaster v-bind="$props" />
</template>
