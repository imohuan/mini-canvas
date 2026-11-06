<script setup lang="ts">
/**
 * 插件整页的宿主。
 *
 * 插件只交一个组件，这里负责让它「占满主内容区」：
 * - 默认由宿主滚动（普通设置页、卡片页）；
 * - meta.scroll === false 时交给页面自己滚（素材库那种全高页面）。
 */
import type { ProjectsTabEntry } from './useProjectsPanels'

defineProps<{ tab: ProjectsTabEntry }>()
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col"
    :class="tab.meta.scroll === false ? 'overflow-hidden' : 'overflow-y-auto px-6 pb-10'"
    :data-projects-tab="tab.id"
  >
    <component :is="tab.component" class="min-h-0 flex-1" />
  </div>
</template>
