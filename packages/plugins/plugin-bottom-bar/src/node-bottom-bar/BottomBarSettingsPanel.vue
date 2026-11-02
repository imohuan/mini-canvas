<script setup lang="ts">
defineProps<{ settingsOpen: boolean }>()

function onGlobalEnter(el: Element): void {
  const h = el as HTMLElement
  h.style.height = '0px'
  h.style.opacity = '0'
  void h.offsetHeight
  h.style.height = h.scrollHeight + 'px'
  h.style.opacity = '1'
}

function onGlobalAfterEnter(el: Element): void {
  const h = el as HTMLElement
  h.style.height = ''
  h.style.opacity = ''
}

function onGlobalLeave(el: Element): void {
  const h = el as HTMLElement
  h.style.height = h.scrollHeight + 'px'
  void h.offsetHeight
  h.style.height = '0px'
  h.style.opacity = '0'
}
</script>


<template>
  <!-- 全局设置区：在底栏下面追加的一块，动画沿用原 height 过渡。 -->
  <Transition name="nb-gset" @enter="onGlobalEnter" @after-enter="onGlobalAfterEnter" @leave="onGlobalLeave">
    <div v-if="settingsOpen" class="nb-global nodrag nopan nowheel">
      <div class="nb-global-inner">
        <p class="nb-global-title">全局设置</p>
        <p class="nb-global-hint">这里放全局设置（与插件/动作无关）。暂为占位，后续实现。</p>
      </div>
    </div>
  </Transition>
</template>
