<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'
import { ICON_PLUS, ICON_TAG } from './icons'

defineProps<{
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
</script>

<template>
  <div v-if="!expanded" class="nb-pills">
    <Button variant="ghost" size="sm" class="nb-pill" :class="{ 'is-active': referencing }" type="button"
      :title="referencing ? '退出参考选择' : '在画布上选择参考（选一个就连到本节点）'"
      @click.stop="emit('toggleReference')"
    >
      <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_PLUS" />
      <span>参考</span>
      <span v-if="cardCount > 0" class="nb-pill-badge">{{ cardCount }}</span>
    </Button>
    <Button variant="ghost" size="sm" class="nb-pill" type="button"
      :title="'标记：把输入框里的 @图片1 这类文字转成素材标签'" data-testid="bar-mark"
      @click.stop="emit('mark')"
    >
      <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
      <span>标记</span>
    </Button>
    <Button variant="ghost" size="sm" v-if="invalidCount > 0" class="nb-pill nb-pill--danger" type="button"
      data-testid="bar-clear-invalid" @click.stop="emit('clearInvalid')"
    >
      <span class="nb-pill-icon" aria-hidden="true" v-html="ICON_TAG" />
      <span>清理失效</span>
    </Button>
  </div>
</template>
