<script setup lang="ts">
/**
 * ToolParamHint —— 参数说明的一行灰字。
 *
 * 为什么单独一件：参数说明会出现在四种控件下面（下拉 / 按钮网格 / 比例网格 / 滑块），
 * 还有参数组浮层里「非预设件」自己画标题那一支。四处各写一份字号颜色，迟早漂移。
 *
 * 版式（照 ui-style-guide 的「描述副标题」）：12px / 400 / --ui-ink-mute / 行高 18，
 * 允许折行，中文不断词靠 `word-break: break-word`。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 说明文字；空串 / undefined 时整行不渲染 */
    text?: string
  }>(),
  { text: '' },
)

const shown = computed(() => String(props.text ?? '').trim())
</script>

<template>
  <p v-if="shown" class="tph-hint">{{ shown }}</p>
</template>

<style scoped>
.tph-hint {
  margin: 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  word-break: break-word;
}
</style>
