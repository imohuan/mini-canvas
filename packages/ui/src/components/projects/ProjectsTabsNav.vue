<script setup lang="ts">
/**
 * 项目页左栏的插件页签。
 *
 * 只画「工具」这一组：插件注册什么，这里就出现什么；没注册时整组不占位。
 * 外观与上面的「首页 / 项目 / 资产」使用同一套导航按钮，避免插件页看起来像另一个应用。
 */
import { useUiComponentOutside } from '../../composables/ui'
import type { ProjectsTabEntry } from './useProjectsPanels'

defineProps<{ tabs: ProjectsTabEntry[]; activeId: string }>()
const emit = defineEmits<{ select: [id: string] }>()

const Button = useUiComponentOutside('Button')
</script>

<template>
  <div v-if="tabs.length" class="mt-3 flex flex-col gap-0.5">
    <p class="px-2 pb-1 text-[11px] font-medium text-ink-dim">工具</p>
    <Button
      v-for="tab in tabs"
      :key="tab.id"
      variant="ghost"
      size="sm"
      class="h-9 w-full justify-start gap-2 rounded-lg text-[13px] font-normal"
      :class="tab.id === activeId ? 'bg-hover-strong font-semibold text-ink' : 'text-ink/90'"
      :title="tab.meta.hint"
      @click="emit('select', tab.id)"
    >
      <component :is="tab.meta.icon" v-if="tab.meta.icon" :size="15" />
      {{ tab.meta.title }}
    </Button>
  </div>
</template>
