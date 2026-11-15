<script setup lang="ts">
/**
 * ColorSwatchPicker —— 「预置色 + 自定义取色」的完整取色面板（默认主题的外观件）。
 *
 * 用户口径 2026-11-15：分组节点的背景颜色要和图片节点「绘制」模式的标记颜色**完全一样**——
 * 同样的预置色、同样的自定义取色器、同样的视觉效果。
 *
 * 为什么抽在这里：那段面板原先只长在 plugin-node-image 的 PaintColorPicker 里；
 * 分组如果照着抄一份，两边就会各走各的（一边加色、改间距、换取色器，另一边不动）。
 * 现在只有这一份实现，两个消费方都从 ui 目录按名取 `colorSwatchPicker`。
 *
 * 面板里的「自定义」用的是 `color` 目录件（第三方 Chrome 取色器，带透明度与棋盘格），
 * 换主题时跟着一起换 —— 本组件不 import 取色器实现。
 */
import { computed, ref } from 'vue'
import { useUiComponent } from '@plume-canvas/canvas-render'
import { COLOR_SWATCH_PRESETS } from './colorSwatchPresets'

const props = withDefaults(
  defineProps<{
    /** 当前颜色（#rrggbb / #rrggbbaa） */
    modelValue: string
    /** 触发器上的无障碍名（分组是「背景颜色」，绘制是「标记颜色」） */
    label?: string
    /** 触发器样式：图标态只画色块（工具栏用），文字态画「小圆点 + 文字」 */
    trigger?: 'icon' | 'label'
    /** 点完色块是否收起面板（工具栏里连调要留着，菜单式一次选完要收起） */
    closeOnPick?: boolean
  }>(),
  {
    label: '选择颜色',
    trigger: 'icon',
    closeOnPick: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const ColorField = useUiComponent('color')
const Button = useUiComponent('Button')
const Popover = useUiComponent('Popover')
const PopoverContent = useUiComponent('PopoverContent')
const PopoverTrigger = useUiComponent('PopoverTrigger')

const open = ref(false)

/** 当前色块（取色器回来可能是空串 = 跟随主题，这里回落白色） */
const swatch = computed(() => props.modelValue || '#ffffff') // 主题色白名单: 缺省色块是「还没选过的画笔色 / 分组底色」（内容色），不是界面配色

/** 点预置色：写回，并按 closeOnPick 决定是否收起（菜单式一次选完就关） */
function pick(value: string): void {
  emit('update:modelValue', value)
  if (props.closeOnPick) open.value = false
}

/**
 * 取色器改色：**只回写，绝不收起面板**。
 *
 * 用户实测报的问题（2026-11-15）：分组点开自定义取色器，在色域里点一下，整个面板就消失了；
 * 绘制模式却正常。根因不是取色器本身 —— 是这里复用了 pick()，而分组开了 closeOnPick
 * （预置色点完该收）。取色器拖动时每一帧都会回调，跟着收起就等于「点一下色域就关」；
 * 而且用户还要继续调色相 / 透明度，这时关面板没有任何道理。
 */
function onColorChange(value: string): void {
  if (!value) return
  emit('update:modelValue', value)
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        :class="trigger === 'icon' ? 'csp-trigger csp-trigger--icon' : 'csp-trigger csp-trigger--label'"
        :variant="trigger === 'icon' ? 'ghost' : 'ghost'"
        :size="trigger === 'icon' ? 'sm' : 'sm'"
        :title="label"
        :aria-label="label"
        aria-haspopup="dialog"
        :aria-expanded="open"
      >
        <span class="csp-trigger__content">
          <span class="csp-swatch" :style="{ backgroundColor: swatch }" aria-hidden="true" />
          <span v-if="trigger === 'label'">{{ label }}</span>
        </span>
      </Button>
    </PopoverTrigger>

    <PopoverContent align="start" :side-offset="6" class="csp-panel">
      <div class="csp-title">预置颜色</div>
      <div class="csp-grid">
        <Button
          v-for="c in COLOR_SWATCH_PRESETS"
          :key="c"
          type="button"
          class="csp-dot"
          variant="ghost"
          size="sm"
          :class="{ 'is-active': swatch.toLowerCase() === c }"
          :style="{ backgroundColor: c }"
          :title="c"
          :aria-label="'颜色 ' + c"
          @click="pick(c)"
        />
      </div>
      <div class="csp-title">自定义</div>
      <component
        :is="ColorField"
        v-if="ColorField"
        :model-value="swatch"
        :aria-label="label"
        @update:model-value="onColorChange"
      />
      <div v-else class="csp-missing">主题没有注册颜色组件</div>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
/* 图标态：只画色块，与工具栏上的图标按钮同尺寸 */
.csp-trigger--icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  transition: background 0.16s ease, border-color 0.16s ease;
}
.csp-trigger--icon:hover {
  background: var(--ui-hover-strong, rgba(0, 0, 0, 0.06));
}
.csp-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}

/* 文字态：小圆点 + 文字（分组顶栏用） */
.csp-trigger__content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.csp-swatch {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.18));
  /* 主题色白名单: 色块内描边要压在任意用户色上都看得见，需恒定白 */
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #fff 25%, transparent);
}

/* 文字态的圆点比图标态小一档（16px），与分组原先的观感一致 */
.csp-trigger--label .csp-swatch {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.csp-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 232px;
  padding: 12px;
  border-radius: var(--plume-radius, 16px);
  background: var(--ui-overlay-solid, #fff);
}

.csp-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-ink-dim, #6b7280);
}

.csp-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.csp-dot {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  padding: 0;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.csp-dot:hover {
  transform: scale(1.06);
}
.csp-dot.is-active {
  box-shadow: 0 0 0 2px var(--ui-accent, #0891b2);
}

.csp-missing {
  font-size: 11px;
  color: var(--ui-ink-dim, #6b7280);
}
</style>
