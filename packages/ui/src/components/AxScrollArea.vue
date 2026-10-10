<script setup lang="ts">
// AxScrollArea —— 画布应用统一滚动容器。
// 滚动条样式照 LibTV 实测：轨道 6px 透明、滑块 4px 圆角 6、rgba(255,255,255,.4)，
// hover 加深。亮色主题下换成 rgba(0,0,0,.2)。
// 用法：<AxScrollArea class="flex-1 min-h-0"><div>…</div></AxScrollArea>
//
// 滚动事件转发（用户口径 2026-10-10，「生成历史」的"加载更多"没效果）：
// **真正的滚动层是内部的 .ax-sa-view**（根 .ax-sa 是 overflow: hidden，永远不滚）。
// Vue 把写在组件上的 @scroll 当作组件自定义事件消费，组件没声明 emit 就被吞掉 ——
// 外层的触底逻辑（如 ModalsArea 的 onHistScroll）一次都不会跑。这里显式声明 scroll
// 并把内部层的原生事件转发出去（$event 必须是原生事件，外层要读 e.target 的滚动几何）。
withDefaults(
  defineProps<{
    /** x 横向 / y 纵向 / both 双向 */
    direction?: 'x' | 'y' | 'both'
    /** 滚动层额外 class（padding / gap 等布局样式放这里） */
    bodyClass?: string
  }>(),
  { direction: 'y', bodyClass: '' },
)

/** 转发内部滚动层的 scroll（原生事件一起带出，供外层做触底/懒加载判断） */
defineEmits<{ (e: 'scroll', payload: Event): void }>()
</script>

<template>
  <div class="ax-sa" :class="'ax-sa--' + direction">
    <div class="ax-sa-view" :class="bodyClass" @scroll="$emit('scroll', $event)">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ax-sa { position: relative; min-height: 0; overflow: hidden; }
.ax-sa-view { height: 100%; }
.ax-sa--x .ax-sa-view { overflow-x: auto; overflow-y: hidden; }
.ax-sa--y .ax-sa-view { overflow-y: auto; overflow-x: hidden; }
.ax-sa--both .ax-sa-view { overflow: auto; }

/* 滚动条：细条 + 圆角 + 半透明白（照 LibTV 实测） */
.ax-sa-view { scrollbar-width: thin; scrollbar-color: var(--ui-scroll-thumb) transparent; }
.ax-sa-view::-webkit-scrollbar { width: 6px; height: 6px; }
.ax-sa-view::-webkit-scrollbar-track { background: transparent; }
.ax-sa-view::-webkit-scrollbar-thumb { background: var(--ui-scroll-thumb); border-radius: 6px; }
.ax-sa-view::-webkit-scrollbar-thumb:hover { background: var(--ui-scroll-thumb-hover); }
.ax-sa-view::-webkit-scrollbar-corner { background: transparent; }
</style>
