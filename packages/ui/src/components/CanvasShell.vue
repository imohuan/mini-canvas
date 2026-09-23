<script setup lang="ts">
// CanvasShell —— 画布应用基础布局壳。
//
// 只负责「谁在哪一层、哪一块留多大」，不含任何业务：
//   左上角 / 右上角 / 底部居中 / 左下角状态条 / 中间画布 / 左抽屉 / 右抽屉 / 各种浮层
// 每一块都是一个具名插槽，业务方往里塞 UI 即可。
//
// 左抽屉打开时会把左上角、左下角、底部居中一起右推（照 LibTV 实测：像抽屉挤出来，不是盖住）。
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 左抽屉宽度（0 = 关闭） */
    leftWidth?: number
    /** 右抽屉宽度（0 = 关闭） */
    rightWidth?: number
    /** 左下状态条是否跟着左抽屉右移 */
    pushStatus?: boolean
    /** 底部居中 dock 是否跟着左抽屉右移 */
    pushDock?: boolean
    theme?: 'dark' | 'light'
  }>(),
  { leftWidth: 0, rightWidth: 0, pushStatus: true, pushDock: true, theme: 'dark' },
)

const leftOpen = computed(() => props.leftWidth > 0)
const rightOpen = computed(() => props.rightWidth > 0)
/** 左抽屉打开时，左上角 / 左下角 / 底部 dock 一起向右「挤」出抽屉的宽度 */
const pushStyle = computed(() => (leftOpen.value ? { transform: `translateX(${props.leftWidth}px)` } : {}))
/** 右抽屉打开时，右上角按钮组 / 底部 dock 一起向左「挤」（它们贴着画布右缘，不被盖住） */
const pullStyle = computed(() => (rightOpen.value ? { transform: `translateX(-${props.rightWidth}px)` } : {}))
/** 状态条只跟左抽屉；右抽屉不影响左下角（它在最左边） */
const statusStyle = computed(() => (props.pushStatus && leftOpen.value ? pushStyle.value : {}))
const dockStyle = computed(() => {
  const shift = (props.leftWidth - props.rightWidth) / 2
  return shift !== 0 ? { transform: `translateX(calc(-50% + ${shift}px))` } : {}
})
</script>

<template>
  <div class="shell" :data-theme="theme" :style="{ '--shell-push': leftWidth + 'px' }">
    <!-- 中间：真实画布（放最底层，其它都是浮层） -->
    <div class="shell-canvas">
      <slot name="canvas" />
    </div>

    <!-- 左上角 -->
    <!-- 顶栏：左组随左抽屉右移；右组随右抽屉左移（flex 三区域共用屏幕，谁也不盖谁） -->
    <header class="shell-topbar">
      <div class="shell-top-left" :class="{ pulled: leftOpen }">
        <slot name="top-left" />
      </div>
      <div class="shell-top-right" :class="{ pulled: rightOpen }" :style="pullStyle">
        <slot name="top-right" />
      </div>
    </header>

    <!-- 左下角状态条：随左抽屉右移 / 随右抽屉左移（画布区变窄，它贴着画布左缘） -->
    <div class="shell-status" :style="statusStyle">
      <slot name="status" />
    </div>

    <!-- 底部居中工具条（居中在画布区） -->
    <div class="shell-dock" :style="pushDock ? dockStyle : {}">
      <slot name="dock" />
      <slot name="dock-append" />
    </div>

    <!-- 左右抽屉（抽屉本身由插槽渲染，外壳只提供推挤量） -->
    <slot name="left-drawer" />
    <slot name="right-drawer" />

    <!-- 浮层（弹窗 / 菜单 / toast） -->
    <slot name="overlays" />

    <!-- 其它任意内容（抽屉 / 对话面板 / toast…） -->
    <slot />
  </div>
</template>

<style scoped>
.shell { position: relative; height: 100vh; overflow: hidden; background: #141414; color: #f7f7f7; font-family: system-ui, 'Microsoft YaHei', sans-serif; }
.shell[data-theme='light'] { background: #f5f6f8; color: #18202b; }
.shell-canvas { position: absolute; inset: 0; }
.shell-topbar { position: absolute; inset: 8px 8px auto; z-index: 60; display: flex; align-items: center; justify-content: space-between; height: 32px; pointer-events: none; }
/* 块 A（项目胶囊）与块 B（视图切换）之间的间隔：照目标实测 8px */
.shell-top-left { display: flex; align-items: center; gap: 8px; pointer-events: auto; transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
.shell-top-left.pulled { transform: translateX(var(--shell-push, 320px)); }
.shell-top-right { display: flex; align-items: center; pointer-events: auto; }
.shell-top-right { gap: 8px; }
.shell-top-right.pulled { transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
/* 外壳只负责「定位」：视觉（背景/边框/圆角）由插槽内容自己带，避免两层重复。 */
.shell-status { position: fixed; left: 8px; bottom: 12px; z-index: 30; display: flex; align-items: flex-end; transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
.shell-dock { position: fixed; left: 50%; bottom: 12px; z-index: 30; display: flex; align-items: center; transform: translateX(-50%); transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
</style>
