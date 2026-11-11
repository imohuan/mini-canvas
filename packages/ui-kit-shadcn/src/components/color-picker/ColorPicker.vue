<script lang="ts" setup>
import { ref, computed } from 'vue'
import { useForwardPropsEmits } from 'reka-ui'
import {
  ColorPickerRoot,
  ColorPickerCanvas,
  ColorPickerEyeDropper,
  ColorPickerSliderHue,
  ColorPickerSliderAlpha,
  ColorPickerInputHex,
  ColorPickerInputHSL,
  ColorPickerInputRGB,
  ColorPickerInputHSB,
  type ColorPickerRootProps,
  type ColorPickerRootEmits
} from '@vuelor/picker'

import ColorPickerSelect from './ColorPickerSelect.vue'

const INPUTS = {
  Hex: ColorPickerInputHex,
  RGB: ColorPickerInputRGB,
  HSL: ColorPickerInputHSL,
  HSB: ColorPickerInputHSB
}

type ColorPickerProps = Omit<ColorPickerRootProps, 'styling' | 'ui'>

const props = defineProps<ColorPickerProps>()
const emits = defineEmits<ColorPickerRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)

const format = ref<'Hex' | 'RGB' | 'HSL' | 'HSB'>('Hex')
const formatOptions = ['Hex', 'RGB', 'HSL', 'HSB']
const canvasType = computed<'HSL' | 'HSV'>(() => {
  return format.value === 'HSL' ? 'HSL' : 'HSV'
})
</script>

<template>
  <!-- 包一层：让 scoped :deep() 有父元素可挂，才能覆盖取色器自带的宽高与内衬 -->
  <div class="pk-cp">
    <ColorPickerRoot
      :ui="{
        picker: { root: 'pk-cp-root w-full max-w-full p-0 bg-transparent shadow-none text-inherit' },
        input: { label: 'hidden' },
      }"
      v-bind="forwarded"
    >
      <ColorPickerCanvas :type="canvasType" />
      <div class="flex items-center gap-3">
        <ColorPickerEyeDropper type="button" aria-label="Pick color from screen">
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M17.52 6.471a1.62 1.62 0 0 0-2.295.003l-1.87 1.88-.354.355-.355-.354-.01-.01a.9.9 0 0 0-1.272 0l-.02.02a.9.9 0 0 0 0 1.273l.51.51 2 2 .51.51a.9.9 0 0 0 1.272 0l.02-.02a.9.9 0 0 0 0-1.273l-.01-.01-.352-.353.351-.353 1.879-1.888a1.62 1.62 0 0 0-.003-2.29m-3.004-.702a2.621 2.621 0 1 1 3.717 3.697l-1.57 1.579a1.9 1.9 0 0 1-.3 2.3l-.02.02a1.9 1.9 0 0 1-2.687 0l-.156-.157-5.647 5.642a.5.5 0 0 1-.353.147H5.504a.5.5 0 0 1-.5-.5L5 16.503a.5.5 0 0 1 .146-.354l5.647-5.647-.157-.156a1.9 1.9 0 0 1 0-2.687l.02-.02a1.9 1.9 0 0 1 2.299-.3zm-3.016 5.44 1.293 1.292-5.5 5.496h-1.29L6 16.707z"
            />
          </svg>
        </ColorPickerEyeDropper>
        <div class="flex flex-col flex-1 gap-2">
          <ColorPickerSliderHue />
          <ColorPickerSliderAlpha />
        </div>
      </div>
      <!-- 底部一行：格式下拉 + 色值输入，两者同高同圆角（原来一个 24px、一个 32px） -->
      <div class="pk-cp-value-row flex items-center gap-2">
        <ColorPickerSelect
          v-model="format"
          class="w-16 shrink-0"
          label="Color Format"
          placeholder="Format"
          :disabled="props.disabled"
          :options="formatOptions"
        />
        <component :is="INPUTS[format]" />
      </div>
    </ColorPickerRoot>
  </div>
</template>

<style scoped>
/*
 * 只留外面一层内边距。
 *
 * 取色器自带 `w-60`（固定 240px）和 `p-4`（16px 内衬），而设置面板的
 * Popover 本身已有 16px 内边距。两层 padding 加一个写死宽度，会让面板
 * 又厚又空、边缘对不齐。这里把取色器的宽度改成跟随容器、内衬归零；
 * 外面的 Popover 仍保留自己的留白。
 *
 * 注意：Vuelor 默认用 Tailwind 类，根节点**没有** `vuelor-picker-root` 类；
 * 必须经 `ui.picker.root` 注入 `pk-cp-root` 才能选到它（2026-11-02 实测）。
 */
.pk-cp :deep(.pk-cp-root) {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  padding: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
}

/*
 * 色值输入框（Hex / RGB …）跟随主题。
 *
 * 取色器自带的是 `bg-vuelor-input` + 5px 圆角 + 24px 高，和左边的 Select
 * 一高一矮、圆角也不一致（用户 2026-11-04 截图反馈）。
 * 这里统一成 32px 高、同一档圆角、同一套底色。
 */
/* 外层：一整条圆角输入框，和左边的 Select 同高同圆角 */
.pk-cp-value-row :deep(> div:last-child) {
  height: 2rem;
  gap: 1px;
  border-radius: calc(var(--radius, 0.5rem) * 2.6);
  overflow: hidden;
  background-color: var(--border);
}

/* 内层两段（色值 / 透明度）：去掉各自的圆角，靠外层统一收边 */
.pk-cp-value-row :deep(> div:last-child > div) {
  height: 100%;
  border-radius: 0;
  background-color: var(--muted);
}

.pk-cp-value-row :deep(input) {
  height: 100%;
  font-size: 0.75rem;
  color: var(--foreground);
}

.pk-cp-value-row :deep(span) {
  color: var(--muted-foreground);
}
</style>
