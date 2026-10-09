<script setup lang="ts">
// AxMenuItem —— 菜单里的一行。可以是普通行、分组标题、分隔线或危险操作。
const props = withDefaults(
  defineProps<{
    danger?: boolean
    active?: boolean
    /** 右侧提示（快捷键 / 副标题） */
    hint?: string
    /**
     * 不可点（灰掉但**仍然显示**）。
     *
     * 为什么要「显示但灰掉」而不是整项隐藏（用户口径 2026-10-09）：
     * 画布列表行尾的操作菜单里，「当前是内置画布（default）」时不允许删 —— 早先直接隐藏那一项，
     * 菜单就比别的行少一条，用户看到的是「二级菜单显示不完整」。菜单条目**固定**才读得出这是
     * 「这条当前不可用」，而不是「菜单没画全 / 坏了」。
     */
    disabled?: boolean
  }>(),
  { danger: false, active: false, hint: '', disabled: false },
)
const emit = defineEmits<{ click: [MouseEvent] }>()

/** 灰掉的项：不派发点击（真 <button disabled> 本身就不触发 click，这里再挡一道防键盘/程序触发） */
function onClick(e: MouseEvent): void {
  if (props.disabled) return
  emit('click', e)
}
</script>

<template>
  <button
    type="button"
    role="menuitem"
    class="ax-menu-item"
    :class="{ 'is-danger': danger, 'is-active': active, 'is-disabled': disabled }"
    :disabled="disabled"
    :aria-disabled="disabled ? 'true' : undefined"
    @click="onClick"
  >
    <slot />
    <span v-if="hint" class="ax-menu-hint">{{ hint }}</span>
  </button>
</template>
