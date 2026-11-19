<script setup lang="ts">
import { useUiComponent } from '@plume-canvas/canvas-render'
import { computed } from 'vue'
import { ICON_PLUS, ICON_TAG } from './icons'

const props = defineProps<{
  expanded: boolean
  referencing: boolean
  cardCount: number
  invalidCount: number
}>()

const emit = defineEmits<{
  toggleReference: []
  mark: []
  clearInvalid: []
}>()

const Button = useUiComponent('Button')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')

/** 提示文案（用户 2026-11-18：底栏不再用浏览器原生 title） */
const referenceTip = computed(() =>
  props.referencing ? '退出参考选择' : '在画布上选择参考（选一个就连到本节点）',
)
</script>

<template>
  <div v-if="!expanded" class="nb-pills">
    <TooltipProvider :delay-duration="220">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="xs" class="nb-pill" :class="{ 'is-active': referencing }" type="button"
            @click.stop="emit('toggleReference')"
          >
            <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_PLUS" />
            <span>参考</span>
            <span v-if="cardCount > 0" class="nb-pill-badge">{{ cardCount }}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" :arrow="true">{{ referenceTip }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <TooltipProvider :delay-duration="220">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="xs" class="nb-pill" type="button" data-testid="bar-mark"
            @click.stop="emit('mark')"
          >
            <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
            <span>标记</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" :arrow="true">标记：把输入框里的 @图片1 这类文字转成素材标签</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <Button variant="ghost" size="xs" v-if="invalidCount > 0" class="nb-pill nb-pill--danger" type="button"
      data-testid="bar-clear-invalid" @click.stop="emit('clearInvalid')"
    >
      <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
      <span>清理失效</span>
    </Button>
  </div>
</template>
