<script setup lang="ts">
// AxMenuItem —— 菜单里的一行。可以是普通行、分组标题、分隔线或危险操作。
withDefaults(
  defineProps<{
    danger?: boolean
    active?: boolean
    /** 右侧提示（快捷键 / 副标题） */
    hint?: string
  }>(),
  { danger: false, active: false, hint: '' },
)
defineEmits<{ click: [MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    role="menuitem"
    class="ax-menu-item"
    :class="{ 'is-danger': danger, 'is-active': active }"
    @click="$emit('click', $event)"
  >
    <slot />
    <span v-if="hint" class="ax-menu-hint">{{ hint }}</span>
  </button>
</template>
