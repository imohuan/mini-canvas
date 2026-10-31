<script setup lang="ts">
/**
 * NotifyHost —— 通知的挂载点。
 *
 * 只负责把 vue-sonner 的 `<Toaster>` 放到页面里：位置固定在右上角，
 * 层级从 Provider 的上下文读，卡片本身由 `NotifyCard.vue` 渲染。
 *
 * 整个应用**只需要挂一次**。挂在多层会得到两个互相独立的队列。
 */
import { computed, type CSSProperties } from 'vue'
import { Toaster } from 'vue-sonner'
// sonner 的定位、堆叠、进出场基础样式在这个文件里；不引入的话
// 卡片会变成一条没有定位的普通 <li>，还会露出列表序号。
import 'vue-sonner/style.css'
import { useUiKit } from '../../provider/context'
import './notify.css'

defineOptions({ name: 'MckNotifyHost' })

const context = useUiKit()
const zIndex = computed(() => context.value.zIndex)

const toasterStyle = computed<CSSProperties>(() => ({
  // sonner 自己写死 999999999；这里接上 Provider 的 toast 档位，
  // 才能和对话框、下拉在同一套层级体系里。
  zIndex: String(zIndex.value.toast),
  // 默认位置固定在视口右上角。预览卡把它包在示例区里时要保持这个行为，
  // 不能变成示例区内部的一条提示。
  position: 'fixed',
  top: '16px',
  right: '16px',
  bottom: 'auto',
  left: 'auto',
  transform: 'none',
}))
</script>

<template>
  <Toaster
    position="top-right"
    close-button-position="top-right"
    :toast-options="{ unstyled: true }"
    :style="toasterStyle"
    :visible-toasts="4"
  />
</template>
