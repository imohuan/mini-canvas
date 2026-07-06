<script setup lang="ts">
import { computed } from 'vue'
import type { Node } from '@vue-flow/core'
import type { CommandContext } from '../../registry/types'
import AxDropdown from '../../components/Ui/AxDropdown.vue'
import { GROUP_COLOR_SWATCHES, resolveGroupBackgroundColor } from './model'

const props = defineProps<{
  commandContext?: CommandContext
  disabled?: boolean
  title?: string
}>()

const currentColor = computed(() => resolveGroupBackgroundColor((props.commandContext?.node?.data as any)?.backgroundColor))

function updateColor(color: string) {
  const node = props.commandContext?.node as Node | undefined
  const runtime = props.commandContext?.runtime as any
  if (!node?.id || !runtime?.vueFlowInstance?.updateNode) return
  runtime.vueFlowInstance.updateNode(node.id, {
    data: {
      ...(node.data as any),
      backgroundColor: color,
    },
  })
}

function pickCustomColor(close: () => void) {
  const input = document.createElement('input')
  input.type = 'color'
  input.value = currentColor.value
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  document.body.appendChild(input)
  input.addEventListener('change', () => {
    updateColor(input.value)
    close()
    input.remove()
  }, { once: true })
  input.addEventListener('cancel', () => input.remove(), { once: true })
  input.click()
}
</script>

<template>
  <AxDropdown placement="bottom-start" :offset="8" menu-width="112px" body-class="p-2" :teleport="true">
    <template #trigger>
      <button
        class="group-color-trigger"
        type="button"
        :disabled="disabled"
        :title="title || '背景颜色'"
      >
        <span
          class="group-color-trigger__dot"
          :style="{ backgroundColor: currentColor }"
        />
      </button>
    </template>

    <template #default="{ close }">
      <div class="group-color-grid" @click.stop>
        <button
          v-for="swatch in GROUP_COLOR_SWATCHES"
          :key="swatch.id"
          class="group-color-swatch"
          :class="{ 'group-color-swatch--custom': swatch.kind === 'custom' }"
          type="button"
          :title="swatch.label"
          :style="swatch.kind === 'preset' ? { backgroundColor: swatch.color } : undefined"
          @click.stop="swatch.kind === 'preset' ? (updateColor(swatch.color), close()) : pickCustomColor(close)"
        >
          <svg v-if="swatch.kind === 'custom'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </template>
  </AxDropdown>
</template>

<style scoped>
.group-color-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--canvas-node-text, #374151);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.group-color-trigger:hover:not(:disabled) {
  background: var(--canvas-node-panel-surface-hover, rgba(0, 0, 0, 0.06));
  color: var(--canvas-node-text-strong, #111827);
}
.group-color-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.group-color-trigger__dot {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 999px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.42),
    0 0 0 1px rgba(15, 23, 42, 0.28);
}
.group-color-grid {
  display: grid;
  grid-template-columns: repeat(4, 22px);
  gap: 6px;
}
.group-color-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.38),
    0 0 0 1px rgba(15, 23, 42, 0.22);
}
.group-color-swatch:hover {
  transform: scale(1.08);
}
.group-color-swatch--custom {
  background: rgba(15, 23, 42, 0.06);
  color: rgba(15, 23, 42, 0.78);
}
.group-color-swatch svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.4;
  stroke-linecap: round;
}
</style>